import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SequenceService } from '../../core/sequence/sequence.service';
import { InventoryService } from '../inventory/inventory.service';
import { CreatePackDto } from './dto/create-pack.dto';
import { BuildPackDto } from './dto/build-pack.dto';
import { QueryPackDto } from './dto/query-pack.dto';

/**
 * SELIM-ERP W1 — خدمة العبوات (تقلد نظام التعبئة في Selim ERP: Item
 * type=pack + PackComponent): كود عبوة = مجموعة توليفات بكميات محددة.
 *
 * تكيف مقصود وموثق (لا تغيير في المخطط — قيد التعليمات):
 * في Selim للعبوة «رصيد عبوات» مستقل (بند صنف من نوع pack يتحرك في
 * المخزون). مخططنا الحالي لا يملك جدول رصيد للعبوات (FinishedGoodStock
 * يقف على توليفات المنتجات فقط)، لذا:
 * - البناء (build) يخصم مكونات العبوة فقط (حركات StockLedgerEntry عبر
 *   inventory.issueFinishedGood داخل معاملة واحدة) ويوثّق العملية
 *   بسجل تدقيق ActivityLog (action=PACK_BUILD) يحمل الكميات وتكلفة
 *   الوحدة وقت البناء.
 * - التفكيك (unpack) يعيد المكونات للمخزن بتكلفة البناء المسجلة
 *   (receiveFinishedGood) ويسجّل ActivityLog (action=PACK_UNPACK).
 * - «المتاح» من كل عبوة يُشتق من سجل التدقيق (بناء − تفكيك) في
 *   listPacks/availability — بديل قراءةٍ لجدول رصيد غير موجود.
 * - حذف العبوة يُرفض إن كان لها أي عملية بناء (تدقيق الأثر).
 */
@Injectable()
export class PackingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequence: SequenceService,
    private readonly inventory: InventoryService,
  ) {}

  /** قائمة العبوات بمكوناتها + المتاح المشتق من سجل التدقيق. */
  async listPacks(query: QueryPackDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.PackWhereInput = query.includeInactive
      ? {}
      : { isActive: true };

    const [packs, total] = await this.prisma.$transaction([
      this.prisma.pack.findMany({
        where,
        include: {
          components: {
            include: {
              productVariant: {
                select: {
                  id: true,
                  size: true,
                  color: true,
                  productId: true,
                  isActive: true,
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.pack.count({ where }),
    ]);

    // المتاح = مجموع عمليات البناء − التفكيك من سجل التدقيق (قراءة
    // واحدة ثم تجميع في الذاكرة — نفس نمط تجميعات لوحات التحكم).
    const availability = await this.computeAvailability();

    return {
      items: packs.map((pack) => ({
        ...pack,
        availableCount: availability.get(pack.id) ?? 0,
      })),
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    };
  }

  /** ملخص توافر العبوات (بناء − تفكيك لكل عبوة). */
  async availability() {
    const map = await this.computeAvailability();
    const packs = await this.prisma.pack.findMany({
      where: { isActive: true },
      select: { id: true, code: true, name: true },
      orderBy: { code: 'asc' },
    });
    return packs.map((pack) => ({
      packId: pack.id,
      code: pack.code,
      name: pack.name,
      availableCount: map.get(pack.id) ?? 0,
    }));
  }

  /**
   * تفاصيل عبوة واحدة بمكوناتها + متاحها المشتق من سجل التدقيق.
   */
  async findOne(id: string) {
    const pack = await this.prisma.pack.findUnique({
      where: { id },
      include: {
        components: {
          include: {
            productVariant: {
              select: {
                id: true,
                size: true,
                color: true,
                productId: true,
                isActive: true,
              },
            },
          },
        },
      },
    });
    if (!pack) throw new NotFoundException('العبوة غير موجودة');
    const availability = await this.computeAvailability();
    return { ...pack, availableCount: availability.get(pack.id) ?? 0 };
  }

  /**
   * إنشاء عبوة: ترقيم نظامي PACK-0001 (كود العميل يُتجاهَل — توافق
   * Selim فقط)، والتوليفات تُتحقق وجودها وتنشأ مرة واحدة داخل معاملة.
   */
  async create(dto: CreatePackDto, userId: string) {
    // كل توليفة تظهر مرة واحدة (قيد التفرد في المخطط يفرضه أيضًا).
    const variantIds = dto.components.map((c) => c.productVariantId);
    if (new Set(variantIds).size !== variantIds.length) {
      throw new BadRequestException(
        'كل توليفة تظهر مرة واحدة في مكونات العبوة',
      );
    }
    const found = await this.prisma.productVariant.count({
      where: { id: { in: variantIds }, isActive: true },
    });
    if (found !== variantIds.length) {
      throw new BadRequestException(
        'توليفة في مكونات العبوة غير موجودة أو غير نشطة',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // (كود العميل يُتجاهل عمدًا — الترقيم عنصر نظامي كما في بقية
      // المستندات: QUO/CUT/SHF...)
      const code = await this.sequence.nextNumber('PACK', tx);
      return tx.pack.create({
        data: {
          code,
          name: dto.name,
          notes: dto.notes,
          isActive: true,
          createdById: userId,
          components: {
            create: dto.components.map((c) => ({
              productVariantId: c.productVariantId,
              quantity: new Prisma.Decimal(c.quantity),
            })),
          },
        },
        include: { components: true },
      });
    });
  }

  /**
   * بناء عدد من العبوات: خصم مكوناتها من المخزن داخل معاملة واحدة +
   * توثيق بسجل تدقيق PACK_BUILD (بكميات وتكلفة الوحدة وقت البناء —
   * يستعملها التفكيك لإعادة المكونات بنفس التكلفة).
   */
  async build(id: string, dto: BuildPackDto, userId: string) {
    const pack = await this.prisma.pack.findUnique({
      where: { id },
      include: { components: true },
    });
    if (!pack) throw new NotFoundException('العبوة غير موجودة');
    if (!pack.isActive) {
      throw new BadRequestException('العبوة غير نشطة');
    }

    // فحص كفاية أرصدة المكونات مسبقًا برسالة المتاح (الحرس الذري
    // النهائي داخل issueFinishedGood نفسه لكل مكون).
    for (const component of pack.components) {
      const needed = Number(component.quantity) * dto.count;
      if (!Number.isInteger(needed) || needed <= 0) {
        throw new BadRequestException('بناء العبوات يتطلب كميات مكونات صحيحة');
      }
      const stock = await this.prisma.finishedGoodStock.findUnique({
        where: {
          warehouseId_productVariantId: {
            warehouseId: dto.warehouseId,
            productVariantId: component.productVariantId,
          },
        },
        select: { quantity: true },
      });
      const available = stock?.quantity ?? 0;
      if (available < needed) {
        throw new BadRequestException(
          `رصيد المكون غير كافٍ — المتاح: ${available} والمطلوب: ${needed}`,
        );
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const movements: {
        productVariantId: string;
        quantity: number;
        unitCost: number;
      }[] = [];
      for (const component of pack.components) {
        const quantity = Number(component.quantity) * dto.count;
        const result = await this.inventory.issueFinishedGood(
          {
            productVariantId: component.productVariantId,
            warehouseId: dto.warehouseId,
            quantity,
            reference: pack.code,
            notes: `بناء ${dto.count} عبوة ${pack.code}`,
          },
          userId,
          tx,
        );
        movements.push({
          productVariantId: component.productVariantId,
          quantity,
          // لقطة تكلفة الوحدة وقت الخصم (لتوثيق التفكيك بنفس التكلفة)
          // — حركات المنتج التام تحملها دائمًا؛ ?? 0 حماية أنواع فقط.
          unitCost: result.unitCost ?? 0,
        });
      }

      // توثيق البناء في سجل التدقيق (نفس حقول activityLog.create في
      // sales.service) — هذا هو «رصيد العبوات» المشتق.
      await tx.activityLog.create({
        data: {
          userId,
          action: 'PACK_BUILD',
          module: 'PACKING',
          details: {
            packId: pack.id,
            packCode: pack.code,
            warehouseId: dto.warehouseId,
            count: dto.count,
            components: movements,
          },
        },
      });

      return {
        packId: pack.id,
        code: pack.code,
        builtCount: dto.count,
        movements,
      };
    });
  }

  /**
   * تفكيك عدد من العبوات: إعادة المكونات للمخزن بتكلفة البناء المسجلة
   * في آخر PACK_BUILD (استرجاع بالتكلفة الأصلية — نفس مبدأ عكس القص)
   * + سجل تدقيق PACK_UNPACK.
   */
  async unpack(id: string, dto: BuildPackDto, userId: string) {
    const pack = await this.prisma.pack.findUnique({
      where: { id },
      include: { components: true },
    });
    if (!pack) throw new NotFoundException('العبوة غير موجودة');
    if (!pack.isActive) {
      throw new BadRequestException('العبوة غير نشطة');
    }

    // آخر عملية بناء تحمل تكاليف الوحدة وقت الخصم (لقطة العكس).
    const lastBuild = await this.prisma.activityLog.findFirst({
      where: {
        action: 'PACK_BUILD',
        details: { path: ['packId'], equals: pack.id },
      },
      orderBy: { createdAt: 'desc' },
      select: { details: true },
    });
    if (!lastBuild) {
      throw new BadRequestException('لا يمكن تفكيك عبوة لم تُبنَ بعد');
    }
    const buildComponents = ((lastBuild.details as Record<string, unknown>)
      ?.components ?? []) as { productVariantId: string; unitCost?: number }[];
    const costMap = new Map(
      buildComponents.map((c) => [c.productVariantId, Number(c.unitCost ?? 0)]),
    );

    return this.prisma.$transaction(async (tx) => {
      const movements: {
        productVariantId: string;
        quantity: number;
        unitCost: number;
      }[] = [];
      for (const component of pack.components) {
        const quantity = Number(component.quantity) * dto.count;
        if (!Number.isInteger(quantity) || quantity <= 0) {
          throw new BadRequestException(
            'تفكيك العبوات يتطلب كميات مكونات صحيحة',
          );
        }
        // تكلفة الاسترجاع: من لقطة البناء، وإلا تكلفة الرصيد الحالية.
        let unitCost = costMap.get(component.productVariantId);
        if (unitCost === undefined) {
          const stock = await tx.finishedGoodStock.findUnique({
            where: {
              warehouseId_productVariantId: {
                warehouseId: dto.warehouseId,
                productVariantId: component.productVariantId,
              },
            },
            select: { unitCost: true },
          });
          unitCost = Number(stock?.unitCost ?? 0);
        }
        await this.inventory.receiveFinishedGood(
          {
            productVariantId: component.productVariantId,
            warehouseId: dto.warehouseId,
            quantity,
            unitCost,
            reference: pack.code,
            notes: `تفكيك ${dto.count} عبوة ${pack.code}`,
          },
          userId,
          tx,
        );
        movements.push({
          productVariantId: component.productVariantId,
          quantity,
          unitCost,
        });
      }

      await tx.activityLog.create({
        data: {
          userId,
          action: 'PACK_UNPACK',
          module: 'PACKING',
          details: {
            packId: pack.id,
            packCode: pack.code,
            warehouseId: dto.warehouseId,
            count: dto.count,
            components: movements,
          },
        },
      });

      return {
        packId: pack.id,
        code: pack.code,
        unpackedCount: dto.count,
        movements,
      };
    });
  }

  /**
   * حذف عبوة (منطقي) — يُرفض إن كان لها أي عملية بناء موثقة: الأثر
   * المخزني للبناء يستلزم بقاء تعريف العبوة قابلاً للقراءة والتدقيق.
   */
  async remove(id: string) {
    const pack = await this.prisma.pack.findUnique({ where: { id } });
    if (!pack) throw new NotFoundException('العبوة غير موجودة');

    const builds = await this.prisma.activityLog.count({
      where: {
        action: 'PACK_BUILD',
        details: { path: ['packId'], equals: id },
      },
    });
    if (builds > 0) {
      throw new ConflictException(
        'لا يمكن حذف عبوة لها عمليات بناء موثقة — عطّلها بدلًا من ذلك',
      );
    }

    await this.prisma.pack.update({
      where: { id },
      data: { isActive: false },
    });
    return { deleted: true, code: pack.code };
  }

  /** حساب متاح كل عبوة = مجموع بناء − تفكيك من سجل التدقيق. */
  private async computeAvailability(): Promise<Map<string, number>> {
    const logs = await this.prisma.activityLog.findMany({
      where: {
        module: 'PACKING',
        action: { in: ['PACK_BUILD', 'PACK_UNPACK'] },
      },
      select: { action: true, details: true },
      orderBy: { createdAt: 'asc' },
    });
    const map = new Map<string, number>();
    for (const log of logs) {
      const details = log.details as Record<string, unknown> | null;
      if (!details || typeof details.packId !== 'string') continue;
      const count = Number(details.count ?? 0);
      const current = map.get(details.packId) ?? 0;
      map.set(
        details.packId,
        log.action === 'PACK_BUILD' ? current + count : current - count,
      );
    }
    return map;
  }
}
