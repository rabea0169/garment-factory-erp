import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CuttingOrderStatus,
  Prisma,
  StockMovementType,
  WarehouseType,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SequenceService } from '../../core/sequence/sequence.service';
import { InventoryService } from '../inventory/inventory.service';
import { CreateColorDto, UpdateColorDto } from './dto/color.dto';
import { CreateSizeGroupDto, UpdateSizeGroupDto } from './dto/size-group.dto';
import { CreateCuttingOrderDto } from './dto/create-cutting-order.dto';
import { QueryCuttingOrderDto } from './dto/query-cutting-order.dto';
import { ActivateCuttingOrderDto } from './dto/activate-cutting-order.dto';
import { round2, round4 } from '../../core/common/money.util';

/**
 * SELIM-ERP W1 — خدمة القص (تقلد CuttingOrder + Color + SizeGroup في
 * Selim ERP).
 *
 * دورة حياة أمر القص (نفس مسار Selim):
 *   DRAFT → ACTIVE → REVERSED
 * - الإنشاء: بنود رقصات (lays) بكميات محسوبة على الخادم — لا حركات
 *   مخزون في المسودة (نفس Selim: المسودة تخطيط فقط).
 * - التفعيل (activate) داخل معاملة واحدة:
 *   1) صرف رصيد الموديل الرئيسي (توليفة المصدر) عبر
 *      inventory.issueFinishedGood (حرس رصيد ذري + قيد دفتر حركات).
 *   2) find-or-create توليفة لكل بند (لون × مقاس) ثم إدخالها بمخزون
 *      تام عبر inventory.receiveFinishedGood بتكلفة المصدر نفسها.
 *   3) إن وُجد عامل بأجر قطعة: سجل DailyProduction لأجر القص.
 * - العكس (reverse): يقرأ حركات StockLedgerEntry التي أنشأها التفعيل
 *   (reference = رقم المستند) ويعكس كلًا منها بحركة مقابلة تعيد
 *   أرصدة FinishedGoodStock، ويحذف سجل أجر القص، ويعلّم REVERSED.
 *
 * تكيف مقصود (موثق): في Selim يُقص «رصيد الموديل الرئيسي» إلى توليفات؛
 * مخزوننا يعيش على مستوى التوليفة أصلا (FinishedGoodStock لكل
 * productVariantId). التفعيل يستهلك رصيد توليفة «مصدر» واحدة — يحددها
 * العميل عبر sourceVariantId أو تُختار تلقائيًا بأنها صاحبة أكبر رصيد
 * للموديل في المخزن — ثم يوزّع القطع على توليفات البنود.
 */
@Injectable()
export class CuttingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequence: SequenceService,
    private readonly inventory: InventoryService,
  ) {}

  // ------------------------------------------------------------------
  // الألوان (Colors) — مرجع لون فريد بترميز hex.
  // ------------------------------------------------------------------

  /** قائمة الألوان النشطة (مع المعطلة اختياريًا). */
  async listColors(includeInactive = false) {
    return this.prisma.color.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  /** إنشاء لون — الاسم فريد (فحص مسبق + قيد DB فريد). */
  async createColor(dto: CreateColorDto) {
    const existing = await this.prisma.color.findUnique({
      where: { name: dto.name },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(`يوجد لون بهذا الاسم بالفعل: ${dto.name}`);
    }
    return this.prisma.color.create({
      data: { name: dto.name, hex: dto.hex, isActive: true },
    });
  }

  /** تعديل لون — الحقول المرسلة فقط. */
  async updateColor(id: string, dto: UpdateColorDto) {
    const color = await this.prisma.color.findUnique({ where: { id } });
    if (!color) throw new NotFoundException('اللون غير موجود');
    if (dto.name && dto.name !== color.name) {
      const duplicate = await this.prisma.color.findUnique({
        where: { name: dto.name },
        select: { id: true },
      });
      if (duplicate) {
        throw new ConflictException(`يوجد لون بهذا الاسم بالفعل: ${dto.name}`);
      }
    }
    return this.prisma.color.update({
      where: { id },
      data: {
        ...(dto.name ? { name: dto.name } : {}),
        ...(dto.hex ? { hex: dto.hex } : {}),
      },
    });
  }

  /** حذف لون — منطقي (isActive=false): التوليفات القديمة تُبقي مرجعها. */
  async removeColor(id: string) {
    const color = await this.prisma.color.findUnique({ where: { id } });
    if (!color) throw new NotFoundException('اللون غير موجود');
    await this.prisma.color.update({
      where: { id },
      data: { isActive: false },
    });
    return { deleted: true, name: color.name };
  }

  // ------------------------------------------------------------------
  // مجموعات المقاسات (SizeGroups) — "شبابي S M L XL".
  // ------------------------------------------------------------------

  /** قائمة مجموعات المقاسات النشطة (مع المعطلة اختياريًا). */
  async listSizeGroups(includeInactive = false) {
    return this.prisma.sizeGroup.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  /** إنشاء مجموعة مقاسات — الاسم فريد والمقاسات مرتبة كما أُدخلت. */
  async createSizeGroup(dto: CreateSizeGroupDto) {
    const sizes = dto.sizes.map((s) => s.trim());
    if (sizes.some((s) => !s)) {
      throw new BadRequestException('المقاسات لا يمكن أن تحتوي قيمًا فارغة');
    }
    const existing = await this.prisma.sizeGroup.findUnique({
      where: { name: dto.name },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(`توجد مجموعة مقاسات بهذا الاسم: ${dto.name}`);
    }
    return this.prisma.sizeGroup.create({
      data: { name: dto.name, sizes, isActive: true },
    });
  }

  /** تعديل مجموعة مقاسات — المقاسات الجديدة تستبدل القديمة. */
  async updateSizeGroup(id: string, dto: UpdateSizeGroupDto) {
    const group = await this.prisma.sizeGroup.findUnique({ where: { id } });
    if (!group) throw new NotFoundException('مجموعة المقاسات غير موجودة');
    if (dto.name && dto.name !== group.name) {
      const duplicate = await this.prisma.sizeGroup.findUnique({
        where: { name: dto.name },
        select: { id: true },
      });
      if (duplicate) {
        throw new ConflictException(
          `توجد مجموعة مقاسات بهذا الاسم: ${dto.name}`,
        );
      }
    }
    const sizes = dto.sizes?.map((s) => s.trim());
    if (sizes?.some((s) => !s)) {
      throw new BadRequestException('المقاسات لا يمكن أن تحتوي قيمًا فارغة');
    }
    return this.prisma.sizeGroup.update({
      where: { id },
      data: {
        ...(dto.name ? { name: dto.name } : {}),
        ...(sizes ? { sizes } : {}),
      },
    });
  }

  /** حذف مجموعة مقاسات — منطقي (isActive=false). */
  async removeSizeGroup(id: string) {
    const group = await this.prisma.sizeGroup.findUnique({ where: { id } });
    if (!group) throw new NotFoundException('مجموعة المقاسات غير موجودة');
    await this.prisma.sizeGroup.update({
      where: { id },
      data: { isActive: false },
    });
    return { deleted: true, name: group.name };
  }

  // ------------------------------------------------------------------
  // أوامر القص (CuttingOrders)
  // ------------------------------------------------------------------

  /**
   * إنشاء أمر قص مسودة: الكميات والإجماليات تُحسب على الخادم من البنود —
   * لا حركة مخزون ولا قيود في المسودة (نفس Selim).
   */
  async create(dto: CreateCuttingOrderDto, userId: string) {
    // التحقق من الروابط قبل أي كتابة (نفس نمط عروض الأسعار).
    const product = await this.prisma.product.findFirst({
      where: { id: dto.productId, isActive: true, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!product) {
      throw new BadRequestException('المنتج المحدد غير موجود أو غير نشط');
    }
    const warehouse = await this.prisma.warehouse.findUnique({
      where: { id: dto.warehouseId },
    });
    if (!warehouse || !warehouse.isActive) {
      throw new BadRequestException('المخزن المحدد غير موجود أو غير نشط');
    }
    if (warehouse.type !== WarehouseType.FINISHED_GOODS) {
      throw new BadRequestException('أوامر القص تتطلب مخزن منتج تام نشط');
    }
    if (dto.workerId) {
      const worker = await this.prisma.worker.findUnique({
        where: { id: dto.workerId },
        select: { id: true, isActive: true },
      });
      if (!worker || !worker.isActive) {
        throw new BadRequestException('العامل المحدد غير موجود أو غير نشط');
      }
    }

    // حساب الكميات على الخادم: لكل بند كمية = رقصات × قطع الرقصة،
    // والقطع الصحيحة شرط صارم (حركات مخزون المنتج التام أعداد صحيحة).
    for (const line of dto.lines) {
      const quantity = round4(line.layCount * line.piecesPerLay);
      if (!Number.isInteger(quantity) || quantity <= 0) {
        throw new BadRequestException('أوامر القص تتطلب قطعًا صحيحة');
      }
    }

    const totalPieces = round4(
      dto.lines.reduce(
        (sum, line) => sum + line.layCount * line.piecesPerLay,
        0,
      ),
    );
    const totalLays = round4(
      dto.lines.reduce((sum, line) => sum + line.layCount, 0),
    );
    // أجر القص لا يُحسب إلا مع عامل + أجر قطعة (نفس Selim).
    const wageTotal =
      dto.workerId && dto.wagePerPiece
        ? round2(totalPieces * dto.wagePerPiece)
        : 0;

    return this.prisma.$transaction(async (tx) => {
      const docNumber = await this.sequence.nextNumber('CUTTING_ORDER', tx);

      // لقطات أسماء الألوان/مجموعات المقاسات المرجعية (فحص الوجود أيضًا).
      const colorIds = dto.lines
        .map((l) => l.colorId)
        .filter((id): id is string => Boolean(id));
      const sizeGroupIds = dto.lines
        .map((l) => l.sizeGroupId)
        .filter((id): id is string => Boolean(id));
      const colors = colorIds.length
        ? await tx.color.findMany({
            where: { id: { in: colorIds }, isActive: true },
            select: { id: true, name: true },
          })
        : [];
      const sizeGroups = sizeGroupIds.length
        ? await tx.sizeGroup.findMany({
            where: { id: { in: sizeGroupIds }, isActive: true },
            select: { id: true, name: true },
          })
        : [];
      if (colors.length !== new Set(colorIds).size) {
        throw new BadRequestException('لون في بنود القص غير موجود أو غير نشط');
      }
      if (sizeGroups.length !== new Set(sizeGroupIds).size) {
        throw new BadRequestException(
          'مجموعة مقاسات في بنود القص غير موجودة أو غير نشطة',
        );
      }

      return tx.cuttingOrder.create({
        data: {
          docNumber,
          date: dto.date ? new Date(dto.date) : new Date(),
          productId: dto.productId,
          warehouseId: dto.warehouseId,
          workerId: dto.workerId,
          wagePerPiece: dto.wagePerPiece
            ? new Prisma.Decimal(dto.wagePerPiece)
            : null,
          wageTotal: new Prisma.Decimal(wageTotal),
          remnantQty: new Prisma.Decimal(dto.remnantQty ?? 0),
          remnantNotes: dto.remnantNotes,
          totalPieces: new Prisma.Decimal(totalPieces),
          totalLays: new Prisma.Decimal(totalLays),
          status: CuttingOrderStatus.DRAFT,
          notes: dto.notes,
          createdById: userId,
          lines: {
            create: dto.lines.map((line) => ({
              colorId: line.colorId,
              // لقطة اسم اللون: نص البند يتغلب وإلا اسم اللون المرجعي.
              color:
                line.color ??
                colors.find((c) => c.id === line.colorId)?.name ??
                null,
              sizeGroupId: line.sizeGroupId,
              size: line.size,
              layCount: new Prisma.Decimal(line.layCount),
              piecesPerLay: new Prisma.Decimal(line.piecesPerLay),
              quantity: new Prisma.Decimal(
                round4(line.layCount * line.piecesPerLay),
              ),
              notes: line.notes,
            })),
          },
        },
        include: { lines: true },
      });
    });
  }

  /**
   * تفعيل أمر القص: صرف المصدر + إدخال التوليفات + أجر العامل — كلها
   * داخل معاملة واحدة (فشل أي خطوة يرجع الأمر مسودة كما كان).
   */
  async activate(id: string, dto: ActivateCuttingOrderDto, userId: string) {
    const order = await this.prisma.cuttingOrder.findUnique({
      where: { id },
      include: { lines: true },
    });
    if (!order) throw new NotFoundException('أمر القص غير موجود');
    if (order.status !== CuttingOrderStatus.DRAFT) {
      throw new BadRequestException('لا يمكن تفعيل أمر قص غير مسودة');
    }

    const totalPieces = Number(order.totalPieces);
    if (!Number.isInteger(totalPieces) || totalPieces <= 0) {
      throw new BadRequestException('أوامر القص تتطلب قطعًا صحيحة');
    }

    return this.prisma.$transaction(async (tx) => {
      // (تكيف موثق) تحديد توليفة المصدر: من العميل أو صاحبة أكبر رصيد.
      let sourceVariantId = dto.sourceVariantId;
      if (sourceVariantId) {
        const variant = await tx.productVariant.findUnique({
          where: { id: sourceVariantId },
          select: { id: true, productId: true, isActive: true },
        });
        if (
          !variant ||
          !variant.isActive ||
          variant.productId !== order.productId
        ) {
          throw new BadRequestException(
            'التوليفة المصدر غير موجودة أو لا تنتمي للموديل المقصوص',
          );
        }
      } else {
        const largest = await tx.finishedGoodStock.findFirst({
          where: {
            warehouseId: order.warehouseId,
            productVariant: { productId: order.productId, isActive: true },
          },
          orderBy: { quantity: 'desc' },
        });
        if (!largest) {
          throw new BadRequestException(
            'لا يوجد رصيد للموديل في المخزن المحدد — لا يمكن تفعيل القص',
          );
        }
        sourceVariantId = largest.productVariantId;
      }

      // فحص كفاية رصيد المصدر قبل الحركة (المتاح في رسالة الرفض) —
      // الحرس الذري النهائي داخل issueFinishedGood نفسه.
      const sourceStock = await tx.finishedGoodStock.findUnique({
        where: {
          warehouseId_productVariantId: {
            warehouseId: order.warehouseId,
            productVariantId: sourceVariantId,
          },
        },
        select: { id: true, quantity: true, unitCost: true },
      });
      if (!sourceStock || sourceStock.quantity < totalPieces) {
        throw new BadRequestException(
          `المخزون غير كافٍ — المتاح: ${
            sourceStock?.quantity ?? 0
          } والمطلوب: ${totalPieces}`,
        );
      }
      const sourceUnitCost = Number(sourceStock.unitCost);

      // (ب) صرف رصيد الموديل الرئيسي (توليفة المصدر).
      await this.inventory.issueFinishedGood(
        {
          productVariantId: sourceVariantId,
          warehouseId: order.warehouseId,
          quantity: totalPieces,
          reference: order.docNumber,
          notes: `قص ${order.docNumber}: صرف رصيد الموديل الرئيسي`,
        },
        userId,
        tx,
      );

      // (ج) find-or-create توليفة كل بند ثم إدخالها بتكلفة المصدر.
      for (const line of order.lines) {
        const lineQty = Number(line.quantity);
        if (!Number.isInteger(lineQty) || lineQty <= 0) {
          throw new BadRequestException('أوامر القص تتطلب قطعًا صحيحة');
        }
        // اسم اللون الفعلي: لقطة البند، وإلا اسم اللون المرجعي.
        let colorLabel = line.color;
        if (!colorLabel && line.colorId) {
          const ref = await tx.color.findUnique({
            where: { id: line.colorId },
            select: { name: true },
          });
          colorLabel = ref?.name ?? null;
        }
        const target = await this.findOrCreateVariantInTx(
          tx,
          order.productId,
          line.size,
          colorLabel,
          line.colorId,
        );
        await this.inventory.receiveFinishedGood(
          {
            productVariantId: target.id,
            warehouseId: order.warehouseId,
            quantity: lineQty,
            unitCost: sourceUnitCost,
            reference: order.docNumber,
            notes: `قص ${order.docNumber}: إدخال التوليفة ${line.size}`,
          },
          userId,
          tx,
        );
        await tx.cuttingLine.update({
          where: { id: line.id },
          data: { productVariantId: target.id },
        });
      }

      // (د) أجر القص للعامل: سجل DailyProduction بالقطع (نفس حقول
      // recordDailyProduction في hr.service) — يُعثر عليه عند العكس
      // بملاحظة قياسية تحمل رقم المستند.
      if (order.workerId && Number(order.wageTotal) > 0) {
        await tx.dailyProduction.create({
          data: {
            workerId: order.workerId,
            date: order.date,
            piecesCount: totalPieces,
            pieceRate: order.wagePerPiece ?? new Prisma.Decimal(0),
            totalAmount: order.wageTotal,
            notes: `أجر قص ${order.docNumber}`,
          },
        });
      }

      return tx.cuttingOrder.update({
        where: { id, status: CuttingOrderStatus.DRAFT },
        data: { status: CuttingOrderStatus.ACTIVE },
        include: { lines: true },
      });
    });
  }

  /**
   * عكس أمر قص مفعّل: كل حركة أنشأها التفعيل (مرجعها رقم المستند في
   * StockLedgerEntry) تُعكس بحركة مقابلة تعيد أرصدة FinishedGoodStock —
   * صرف التوليفات المستلمة واسترجاع رصيد المصدر بتكلفته الأصلية —
   * ويُحذف سجل أجر القص، داخل معاملة واحدة.
   */
  async reverse(id: string, userId: string) {
    const order = await this.prisma.cuttingOrder.findUnique({
      where: { id },
      include: { lines: true },
    });
    if (!order) throw new NotFoundException('أمر القص غير موجود');
    if (order.status !== CuttingOrderStatus.ACTIVE) {
      throw new BadRequestException('لا يمكن عكس أمر قص غير مفعّل');
    }

    return this.prisma.$transaction(async (tx) => {
      // حركات التفعيل كلها تحمل reference = رقم المستند.
      const movements = await tx.stockLedgerEntry.findMany({
        where: { reference: order.docNumber },
        orderBy: { createdAt: 'asc' },
      });
      if (movements.length === 0) {
        throw new BadRequestException(
          'لا توجد حركات مخزون مرتبطة بأمر القص لعكسها',
        );
      }

      for (const movement of movements) {
        const delta = Number(movement.quantityDelta);
        const qty = Math.abs(delta);
        if (!movement.productVariantId) continue;

        if (delta > 0) {
          // حركة إدخال (توليفة مستلمة) → عكسها صرف الآن بحرس شرطي
          // (نفس نمط issueFinishedGood).
          const stock = await tx.finishedGoodStock.findUnique({
            where: {
              warehouseId_productVariantId: {
                warehouseId: order.warehouseId,
                productVariantId: movement.productVariantId,
              },
            },
            select: { id: true, quantity: true, unitCost: true },
          });
          if (!stock) {
            throw new ConflictException(
              'رصيد التوليفة غير موجود في المخزن المحدد',
            );
          }
          const claimed = await tx.finishedGoodStock.updateMany({
            where: { id: stock.id, quantity: { gte: qty } },
            data: { quantity: { decrement: qty } },
          });
          if (claimed.count !== 1) {
            throw new ConflictException(
              'المخزون التام غير كافٍ أو تغير بالتزامن',
            );
          }
          await tx.stockLedgerEntry.create({
            data: {
              entryCode: generateCuttingEntryCode(),
              type: StockMovementType.ISSUE,
              warehouseId: order.warehouseId,
              productVariantId: movement.productVariantId,
              quantityDelta: new Prisma.Decimal(-qty),
              balanceAfter: new Prisma.Decimal(stock.quantity - qty),
              unitCost: stock.unitCost,
              totalValue: stock.unitCost.mul(qty),
              reference: order.docNumber,
              notes: `عكس قص ${order.docNumber}: رد التوليفة إلى المصدر`,
              createdById: userId,
            },
          });
        } else {
          // حركة صرف (المصدر) → عكسها إدخال الآن بنفس التكلفة الأصلية
          // (متوسط مرجح مثل receiveFinishedGood — يعيد القيمة للرصيد).
          const stock = await tx.finishedGoodStock.findUnique({
            where: {
              warehouseId_productVariantId: {
                warehouseId: order.warehouseId,
                productVariantId: movement.productVariantId,
              },
            },
            select: { id: true, quantity: true, unitCost: true },
          });
          if (!stock) {
            throw new ConflictException(
              'رصيد المصدر غير موجود في المخزن المحدد',
            );
          }
          const restoreCost = Number(movement.unitCost ?? 0);
          const newQty = stock.quantity + qty;
          const weightedCost =
            newQty === 0
              ? 0
              : (stock.quantity * Number(stock.unitCost) + qty * restoreCost) /
                newQty;
          await tx.finishedGoodStock.update({
            where: { id: stock.id },
            data: {
              quantity: { increment: qty },
              unitCost: new Prisma.Decimal(round4(weightedCost)),
            },
          });
          await tx.stockLedgerEntry.create({
            data: {
              entryCode: generateCuttingEntryCode(),
              type: StockMovementType.RECEIVE,
              warehouseId: order.warehouseId,
              productVariantId: movement.productVariantId,
              quantityDelta: new Prisma.Decimal(qty),
              balanceAfter: new Prisma.Decimal(newQty),
              unitCost: new Prisma.Decimal(restoreCost),
              totalValue: new Prisma.Decimal(round2(restoreCost * qty)),
              reference: order.docNumber,
              notes: `عكس قص ${order.docNumber}: استرجاع رصيد المصدر`,
              createdById: userId,
            },
          });
        }
      }

      // حذف سجل أجر القص إن وُجد (يُنشأ بملاحظة قياسية تحمل رقم الأمر).
      if (order.workerId) {
        const wageRecord = await tx.dailyProduction.findFirst({
          where: {
            workerId: order.workerId,
            notes: `أجر قص ${order.docNumber}`,
          },
          select: { id: true },
        });
        if (wageRecord) {
          await tx.dailyProduction.delete({
            where: { id: wageRecord.id },
          });
        }
      }

      return tx.cuttingOrder.update({
        where: { id },
        data: {
          status: CuttingOrderStatus.REVERSED,
          reversedAt: new Date(),
          reversedById: userId,
        },
        include: { lines: true },
      });
    });
  }

  /** قائمة أوامر القص بمرشحات الحالة/المنتج/العامل/التاريخ + ترقيم. */
  async findAll(query: QueryCuttingOrderDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.CuttingOrderWhereInput = {};
    if (query.status) {
      where.status = query.status as CuttingOrderStatus;
    }
    if (query.productId) {
      where.productId = query.productId;
    }
    if (query.workerId) {
      where.workerId = query.workerId;
    }
    if (query.from || query.to) {
      where.date = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }
    const [items, total] = await this.prisma.$transaction([
      this.prisma.cuttingOrder.findMany({
        where,
        include: {
          product: { select: { id: true, code: true, name: true } },
          worker: { select: { id: true, name: true, code: true } },
          warehouse: { select: { id: true, code: true, name: true } },
          lines: true,
        },
        orderBy: { date: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.cuttingOrder.count({ where }),
    ]);
    return { items, total, page, limit, pages: Math.ceil(total / limit) };
  }

  /** تفاصيل أمر قص ببنوده وروابطه. */
  async findOne(id: string) {
    const order = await this.prisma.cuttingOrder.findUnique({
      where: { id },
      include: {
        product: { select: { id: true, code: true, name: true } },
        worker: { select: { id: true, name: true, code: true } },
        warehouse: { select: { id: true, code: true, name: true } },
        lines: {
          include: {
            productVariant: {
              select: { id: true, size: true, color: true, isActive: true },
            },
            colorRef: { select: { id: true, name: true, hex: true } },
            sizeGroup: { select: { id: true, name: true, sizes: true } },
          },
        },
        reversedBy: { select: { id: true, name: true } },
      },
    });
    if (!order) throw new NotFoundException('أمر القص غير موجود');
    return order;
  }

  /**
   * find-or-create توليفة (موديل × مقاس × لون) — قيد التفرد في المخطط
   * يضمن التوليفة الواحدة؛ الإنشاء عند أول قص لها (نفس روح Selim: القص
   * «يخلق» توليفات الموديل).
   */
  private async findOrCreateVariantInTx(
    tx: Prisma.TransactionClient,
    productId: string,
    size: string,
    color: string | null,
    colorId: string | null,
  ) {
    const existing = await tx.productVariant.findUnique({
      where: {
        productId_size_color: {
          productId,
          size,
          color: color ?? '',
        },
      },
      select: { id: true, isActive: true },
    });
    if (existing) {
      if (!existing.isActive) {
        throw new BadRequestException(
          `التوليفة (${size}/${color ?? 'بلا لون'}) معطلة — نشّطها قبل القص`,
        );
      }
      return existing;
    }
    return tx.productVariant.create({
      data: {
        productId,
        size,
        color: color ?? '',
        colorId,
        isActive: true,
      },
      select: { id: true, isActive: true },
    });
  }
}

/**
 * كود حركة عكس القص — نفس صيغة inventory.service (SLE-YYYYMMDD-XXXX)
 * ليبقى دفتر الحركات متجانس القراءة.
 */
function generateCuttingEntryCode(): string {
  const now = new Date();
  const ymd = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    String(now.getUTCDate()).padStart(2, '0'),
  ].join('');
  return `SLE-${ymd}-${randomBytes(4).toString('hex').toUpperCase()}`;
}
