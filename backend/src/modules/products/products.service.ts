import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { PaginatedResult } from '../../common/dto/paginated-result.dto';
import {
  computeRequestHash,
  storeIdempotencyResponse,
  tryReplayIdempotencyKey,
} from '../../core/common/idempotency.util';

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

  async getAllProducts(pagination: PaginationDto) {
    const page = pagination.page || 1;
    const limit = pagination.limit || 20;
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.product.findMany({
        skip,
        take: limit,
        where: { deletedAt: null },
        include: { season: true, variants: { where: { isActive: true } } },
        orderBy: { name: 'asc' },
      }),
      this.prisma.product.count({ where: { deletedAt: null } }),
    ]);

    return new PaginatedResult(data, total, page, limit);
  }

  async getProductDetails(id: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, deletedAt: null },
      include: {
        season: true,
        variants: true,
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
      const created = await tx.product.create({ data });
      await storeIdempotencyResponse(tx, idempotencyKey, created);
      return created;
    });
  }

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
      await storeIdempotencyResponse(tx, idempotencyKey, result);
      return result;
    });
  }

  async createVariant(
    productId: string,
    size: string,
    color: string,
    idempotencyKey?: string,
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
        data: { productId, size, color },
      });
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
  ) {
    // RES-F02: replay-safe retry via Idempotency-Key header.
    // Note: addBomItem uses upsert so duplicate input is naturally safe,
    // but idempotency-Key ensures the same retry returns the same response
    // (without executing the upsert twice in the network-failure case).
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
      if (replay)
        return replay as Awaited<ReturnType<typeof tx.bomLine.upsert>> & {
          replayed: true;
        };

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

      const result = await tx.bomLine.upsert({
        where: {
          bomVersionId_rawMaterialId: {
            bomVersionId: bomVersion.id,
            rawMaterialId,
          },
        },
        create: {
          bomVersionId: bomVersion.id,
          rawMaterialId,
          quantity,
          unit,
        },
        update: { quantity, unit },
        include: { rawMaterial: true },
      });
      await storeIdempotencyResponse(tx, idempotencyKey, result);
      return result;
    });
  }

  async deleteBomItem(id: string) {
    return this.prisma.bomLine.delete({ where: { id } });
  }
}
