import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { PaginatedResult } from '../../common/dto/paginated-result.dto';
import {
  computeRequestHash,
  storeIdempotencyResponse,
  tryReplayIdempotencyKey,
} from '../../core/common/idempotency.util';

/**
 * PROD-4 (GF-IMP-W3): نتيجة إضافة/تعديل بند BOM — علم newVersion يميّز إن
 * كان التعديل أنشأ إصدارًا جديدًا (تعديل جوهري على إصدار نشط) أم لا.
 */
export interface BomItemResult {
  id: string;
  bomVersionId: string;
  rawMaterialId: string;
  quantity: Prisma.Decimal;
  unit: string;
  rawMaterial: unknown;
  /** PROD-4: true عند إنشاء إصدار جديد بالتعديل الجوهري. */
  newVersion: boolean;
  /** PROD-4: الإصدار الذي كُتب فيه البند (الجديد عند الإصدار). */
  versionName?: string;
  /** PROD-4: الإصدار السابق المُطفأ عند الإصدار الجديد. */
  previousVersionId?: string;
  replayed?: boolean;
}

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async getAllSeasons(pagination: PaginationDto = new PaginationDto()) {
    const page = pagination.page ?? 1;
    const pageSize = pagination.limit ?? 20;
    const skip = (page - 1) * pageSize;
    const options = {
      orderBy: { createdAt: 'desc' } as const,
      skip,
      take: pageSize,
    };

    const [data, total] = await Promise.all([
      this.prisma.season.findMany(options),
      this.prisma.season.count(),
    ]);

    return new PaginatedResult(data, total, page, pageSize);
  }

  /**
   * PROD-7 (P2 — GF-IMP-W3): معامل استعلام اختياري includeInactive (افتراضي
   * false) — قائمة المنتجات كانت تُخفي المتغيرات غير النشطة بينما التفاصيل
   * تعرضها جميعًا (سلوكان متضاربان). الآن كلا المسارين يحترم نفس الافتراضي:
   * المتغيرات النشطة فقط ما لم يُطلب صراحةً تضمين غير النشطة.
   */
  async getAllProducts(
    pagination: PaginationDto = new PaginationDto(),
    includeInactive = false,
  ) {
    const page = pagination.page || 1;
    const limit = pagination.limit || 20;
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.product.findMany({
        skip,
        take: limit,
        where: { deletedAt: null },
        include: {
          season: true,
          // PROD-7: النشطة فقط افتراضيًا — الكل عند includeInactive=true
          variants: includeInactive ? true : { where: { isActive: true } },
        },
        orderBy: { name: 'asc' },
      }),
      this.prisma.product.count({ where: { deletedAt: null } }),
    ]);

    return new PaginatedResult(data, total, page, limit);
  }

  /** PROD-7: نفس المعامل والافتراضي في التفاصيل — سلوك موحد بين المسارين. */
  async getProductDetails(id: string, includeInactive = false) {
    // PROD-7: النشطة فقط افتراضيًا — نفس قاعدة القائمة بلا تضارب.
    const product = await this.prisma.product.findFirst({
      where: { id, deletedAt: null },
      include: {
        season: true,
        variants: includeInactive ? true : { where: { isActive: true } },
        bomVersions: {
          include: { lines: { include: { rawMaterial: true } } },
        },
      },
    });

    if (!product) throw new NotFoundException('المنتج غير موجود');
    return product;
  }

  async createProduct(
    data: {
      code: string;
      name: string;
      category: string;
      retailPrice: number;
      wholesalePrice: number;
      seasonId?: string;
    },
    idempotencyKey?: string,
  ) {
    // RES-F02: replay-safe retry via Idempotency-Key header.
    const requestHash = computeRequestHash({
      code: data.code,
      name: data.name,
      category: data.category,
      retailPrice: data.retailPrice,
      wholesalePrice: data.wholesalePrice,
      seasonId: data.seasonId ?? null,
    });
    const scope = 'product-create';
    return this.prisma.$transaction(async (tx) => {
      const replay = await tryReplayIdempotencyKey(
        tx,
        idempotencyKey,
        scope,
        requestHash,
      );
      if (replay)
        return replay as Awaited<ReturnType<typeof tx.product.create>> & {
          replayed: true;
        };

      // PROD-3: فحص صريح لمعرّف الموسم داخل المعاملة — الـ P2003 يُحوَّل
      // مركزيًا إلى 400 (من الموجة الأولى) لكن الرسالة المركزية عامة؛ هذا
      // الفحص يرفض مبكرًا بـ 404 عربي ودود قبل أي محاولة إنشاء.
      if (data.seasonId) {
        const season = await tx.season.findUnique({
          where: { id: data.seasonId },
          select: { id: true },
        });
        if (!season) {
          throw new NotFoundException(
            `الموسم المحدد غير موجود: ${data.seasonId}`,
          );
        }
      }

      const created = await tx.product.create({ data });
      await storeIdempotencyResponse(tx, idempotencyKey, created);
      return created;
    });
  }

  /**
   * PROD-6 (قرار موثق — الفاعل): ActivityLog.userId NOT NULL في المخطط ولا
   * يوجد مستخدم نظام؛ لذلك سجل التدقيق يُكتب فقط عند توفر actorId من الجلسة
   * (المتحكم يمرره) — استدعاء برمجي قديم بلا فاعل = لا سجل (البيانات نفسها
   * تظل متاحة من الكيان) — نفس قرار INV-7 للمخزون.
   */
  async createFullProduct(
    data: {
      code: string;
      name: string;
      category: string;
      retailPrice: number;
      wholesalePrice: number;
      seasonId?: string;
      variants?: Array<{ size: string; color: string }>;
      bomItems?: Array<{
        rawMaterialId: string;
        quantity: number;
        unit: string;
      }>;
    },
    idempotencyKey?: string,
    actorId?: string,
  ) {
    // RES-F02: replay-safe retry via Idempotency-Key header.
    const requestHash = computeRequestHash({
      ...data,
      variants: data.variants ?? [],
      bomItems: data.bomItems ?? [],
    });
    const scope = 'product-full-create';
    const variants = data.variants ?? [];
    const bomItems = data.bomItems ?? [];
    const variantKeys = new Set<string>();
    for (const variant of variants) {
      const key = `${variant.size.trim().toLowerCase()}::${variant.color.trim().toLowerCase()}`;
      if (variantKeys.has(key)) {
        throw new BadRequestException(
          'لا يمكن تكرار المقاس واللون داخل المنتج',
        );
      }
      variantKeys.add(key);
    }

    const materialIds = new Set<string>();
    for (const item of bomItems) {
      if (materialIds.has(item.rawMaterialId)) {
        throw new BadRequestException('لا يمكن تكرار الخامة داخل BOM');
      }
      materialIds.add(item.rawMaterialId);
    }

    const { variants: _variants, bomItems: _bomItems, ...productData } = data;
    return this.prisma.$transaction(async (tx) => {
      const replay = await tryReplayIdempotencyKey(
        tx,
        idempotencyKey,
        scope,
        requestHash,
      );
      if (replay)
        return replay as Awaited<ReturnType<typeof tx.product.findUnique>> & {
          replayed: true;
        };

      // PROD-3: نفس فحص الموسم في المسار الكامل — داخل المعاملة قبل أي
      // إنشاء (المنتج أو نسخه أو BOM) برسالة عربية ودودة.
      if (productData.seasonId) {
        const season = await tx.season.findUnique({
          where: { id: productData.seasonId },
          select: { id: true },
        });
        if (!season) {
          throw new NotFoundException(
            `الموسم المحدد غير موجود: ${productData.seasonId}`,
          );
        }
      }

      const product = await tx.product.create({
        data: {
          ...productData,
          code: productData.code.trim(),
          name: productData.name.trim(),
          category: productData.category.trim(),
        },
      });

      if (variants.length > 0) {
        await tx.productVariant.createMany({
          data: variants.map((variant) => ({
            productId: product.id,
            size: variant.size.trim(),
            color: variant.color.trim(),
          })),
        });
      }

      if (bomItems.length > 0) {
        const bomVersion = await tx.bomVersion.create({
          data: {
            productId: product.id,
            versionName: 'v1.0',
            isActive: true,
          },
        });
        await tx.bomLine.createMany({
          data: bomItems.map((item) => ({
            bomVersionId: bomVersion.id,
            rawMaterialId: item.rawMaterialId,
            quantity: item.quantity,
            unit: item.unit.trim(),
          })),
        });
      }

      const result = await tx.product.findUnique({
        where: { id: product.id },
        include: {
          variants: { where: { isActive: true } },
          bomVersions: { include: { lines: true } },
        },
      });

      // PROD-6: سجل تدقيق داخل نفس المعاملة — إنشاء منتج كامل بالقيم الجوهرية
      if (actorId) {
        await tx.activityLog.create({
          data: {
            userId: actorId,
            action: 'PRODUCT_CREATED',
            module: 'products',
            details: {
              productId: product.id,
              code: product.code,
              name: product.name,
              variantsCount: variants.length,
              bomItemsCount: bomItems.length,
              seasonId: productData.seasonId ?? null,
            },
          },
        });
      }

      await storeIdempotencyResponse(tx, idempotencyKey, result);
      return result;
    });
  }

  async createVariant(
    productId: string,
    size: string,
    color: string,
    idempotencyKey?: string,
    actorId?: string,
  ) {
    // RES-F02: replay-safe retry via Idempotency-Key header.
    const requestHash = computeRequestHash({
      productId,
      size,
      color,
    });
    const scope = 'product-variant-create';
    return this.prisma.$transaction(async (tx) => {
      const replay = await tryReplayIdempotencyKey(
        tx,
        idempotencyKey,
        scope,
        requestHash,
      );
      if (replay)
        return replay as Awaited<
          ReturnType<typeof tx.productVariant.create>
        > & { replayed: true };

      const product = await tx.product.findFirst({
        where: { id: productId, isActive: true, deletedAt: null },
        select: { id: true },
      });
      if (!product) throw new NotFoundException('المنتج غير موجود أو غير نشط');
      const created = await tx.productVariant.create({
        // PROD-2: نفس تطبيع createFullProduct (السطور 181-183 هناك) — trim
        // للمقاس واللون كي لا يدخل ' L ' كقيمة مختلفة عن 'L' (كان يخلق
        // تكرارات وهمية للمقاسات نفسها في نفس المنتج).
        data: { productId, size: size.trim(), color: color.trim() },
      });

      // PROD-6: سجل تدقيق داخل نفس المعاملة — إنشاء متغير بالقيم الجوهرية
      if (actorId) {
        await tx.activityLog.create({
          data: {
            userId: actorId,
            action: 'VARIANT_CREATED',
            module: 'products',
            details: {
              variantId: created.id,
              productId,
              size: created.size,
              color: created.color,
            },
          },
        });
      }

      await storeIdempotencyResponse(tx, idempotencyKey, created);
      return created;
    });
  }

  async addBomItem(
    productId: string,
    rawMaterialId: string,
    quantity: number,
    unit: string,
    idempotencyKey?: string,
    actorId?: string,
  ) {
    // RES-F02: replay-safe retry via Idempotency-Key header.
    // Note: addBomItem مسار add فقط (البند الجديد يُنشأ على الإصدار النشط)؛
    // تعديل البنود القائمة يخضع لإصدار PROD-4 أدناه، وidempotency-Key يضمن
    // أن نفس إعادة المحاولة تعيد نفس الاستجابة بلا تنفيذ مزدوج.
    const requestHash = computeRequestHash({
      productId,
      rawMaterialId,
      quantity,
      unit,
    });
    const scope = 'product-bom-add';
    return this.prisma.$transaction(async (tx) => {
      const replay = await tryReplayIdempotencyKey(
        tx,
        idempotencyKey,
        scope,
        requestHash,
      );
      if (replay) return replay as BomItemResult & { replayed: true };

      const [product, rawMaterial] = await Promise.all([
        tx.product.findFirst({
          where: { id: productId, isActive: true, deletedAt: null },
        }),
        tx.rawMaterial.findFirst({
          where: { id: rawMaterialId, isActive: true },
        }),
      ]);

      if (!product) throw new NotFoundException('المنتج غير موجود');
      if (!rawMaterial) throw new NotFoundException('الخامة غير موجودة');

      const activeBom = await tx.bomVersion.findFirst({
        where: { productId, isActive: true },
        orderBy: { createdAt: 'desc' },
      });

      const bomVersion =
        activeBom ??
        (await tx.bomVersion.create({
          data: {
            productId,
            versionName: 'v1.0',
            isActive: true,
          },
        }));

      // PROD-4: البند القائم على الإصدار النشط — أساس قرار الإصدار
      const existingLine = await tx.bomLine.findUnique({
        where: {
          bomVersionId_rawMaterialId: {
            bomVersionId: bomVersion.id,
            rawMaterialId,
          },
        },
      });

      const substantiveChange =
        existingLine !== null &&
        (!new Prisma.Decimal(quantity).equals(existingLine.quantity) ||
          existingLine.unit !== unit);

      let result: BomItemResult;

      if (substantiveChange && activeBom) {
        // PROD-4 (P2 — GF-IMP-W3): تعديل جوهري (quantity أو unit) على بند
        // قائم في إصدار نشط — لا تعديل في مكان أبدًا: الإصدار الحالي
        // يُطفأ (isActive=false)، وإصدار جديد version+1 يُنشأ بنفس المعاملة
        // حاملًا كل البنود (نسخ البنود الأخرى كما هي + البند المعدّل
        // بالقيم الجديدة) — أوامر التشغيل المرتبطة بالإصدار القديم تبقى
        // تشير لقيمها التاريخية (تدقيق تكلفة سليم).
        const allLines = await tx.bomLine.findMany({
          where: { bomVersionId: activeBom.id },
        });
        // version+1: أول رقم في versionName (مثل v1.0 → v2.0)؛ اسم غير رقمي
        // يُعامل كـ v1 فيُصبح التالي v2.0 (تحديد حتمي بلا عدّ فعل).
        const versionMatch = /(\d+)/.exec(activeBom.versionName);
        const nextVersionName = `v${(versionMatch ? Number(versionMatch[1]) : 1) + 1}.0`;

        await tx.bomVersion.update({
          where: { id: activeBom.id },
          data: { isActive: false },
        });
        const newVersion = await tx.bomVersion.create({
          data: {
            productId,
            versionName: nextVersionName,
            isActive: true,
          },
        });

        // نسخ بقية بنود الإصدار كما هي (بنفس القيم التاريخية)
        const otherLines = allLines.filter(
          (line) => line.rawMaterialId !== rawMaterialId,
        );
        if (otherLines.length > 0) {
          await tx.bomLine.createMany({
            data: otherLines.map((line) => ({
              bomVersionId: newVersion.id,
              rawMaterialId: line.rawMaterialId,
              quantity: line.quantity,
              unit: line.unit,
            })),
          });
        }
        // البند المعدّل يُنشأ بالقيم الجديدة (create يعيد الصف كاملاً)
        const createdLine = await tx.bomLine.create({
          data: {
            bomVersionId: newVersion.id,
            rawMaterialId,
            quantity,
            unit,
          },
          include: { rawMaterial: true },
        });

        // PROD-6: سجل تدقيق الإصدار الجديد داخل نفس المعاملة
        if (actorId) {
          await tx.activityLog.create({
            data: {
              userId: actorId,
              action: 'BOM_VERSION_CREATED',
              module: 'products',
              details: {
                productId,
                newVersionId: newVersion.id,
                versionName: nextVersionName,
                previousVersionId: activeBom.id,
                changedRawMaterialId: rawMaterialId,
                quantity,
                unit,
              },
            },
          });
        }

        result = {
          ...createdLine,
          newVersion: true,
          versionName: nextVersionName,
          previousVersionId: activeBom.id,
        };
      } else if (existingLine) {
        // PROD-4: نفس القيم (quantity وunit بلا تغيير) — لا إصدار جديد ولا
        // كتابة على الإطلاق: إعادة نفس البند كما هو.
        result = { ...existingLine, rawMaterial, newVersion: false };
      } else {
        // بند جديد على الإصدار النشط (أو المُنشأ للتو) — إضافة لا تعدّل
        // قيمًا قائمة فلا تحتاج إصدارًا (PROD-4 يستهدف التعديل الجوهري).
        const createdLine = await tx.bomLine.create({
          data: {
            bomVersionId: bomVersion.id,
            rawMaterialId,
            quantity,
            unit,
          },
          include: { rawMaterial: true },
        });
        result = { ...createdLine, newVersion: false };
      }

      // PROD-6: سجل تدقيق إضافة البند داخل نفس المعاملة
      if (actorId) {
        await tx.activityLog.create({
          data: {
            userId: actorId,
            action: 'BOM_ITEM_ADDED',
            module: 'products',
            details: {
              bomLineId: result.id,
              productId,
              bomVersionId: result.bomVersionId,
              rawMaterialId,
              quantity,
              unit,
              newVersion: result.newVersion,
            },
          },
        });
      }

      await storeIdempotencyResponse(tx, idempotencyKey, result);
      return result;
    });
  }

  async deleteBomItem(id: string, actorId?: string) {
    // PROD-1: فحص الوجود أولًا — الحذف المباشر لبند غير موجود كان يرمي P2025
    // خامًا فيصل GlobalExceptionFilter كخطأ 500. الآن يُرفض مبكرًا بـ 404
    // برسالة عربية واضحة (وبقية مسارات P2025 يلتقطها الفلتر العام لاحقًا).
    // PROD-6: الفحص والحذف وسجل التدقيق داخل معاملة واحدة (كان الحذف بلا
    // معاملة ولا سجل) — تفاصيل البند المحذوف تُلتقط قبل الحذف للسجل.
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.bomLine.findUnique({
        where: { id },
        select: {
          id: true,
          bomVersionId: true,
          rawMaterialId: true,
          quantity: true,
          unit: true,
        },
      });
      if (!existing) {
        throw new NotFoundException('بند قائمة المواد غير موجود');
      }

      const deleted = await tx.bomLine.delete({ where: { id } });

      // PROD-6: سجل تدقيق حذف البند بالقيم الجوهرية داخل نفس المعاملة
      if (actorId) {
        await tx.activityLog.create({
          data: {
            userId: actorId,
            action: 'BOM_ITEM_DELETED',
            module: 'products',
            details: {
              bomLineId: existing.id,
              bomVersionId: existing.bomVersionId,
              rawMaterialId: existing.rawMaterialId,
              quantity: existing.quantity.toString(),
              unit: existing.unit,
            },
          },
        });
      }

      return deleted;
    });
  }
}
