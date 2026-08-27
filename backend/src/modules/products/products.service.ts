import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { PaginatedResult } from '../../common/dto/paginated-result.dto';

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

  async createProduct(data: {
    code: string;
    name: string;
    category: string;
    retailPrice: number;
    wholesalePrice: number;
    seasonId?: string;
  }) {
    return this.prisma.product.create({ data });
  }

  async createVariant(productId: string, size: string, color: string) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, isActive: true, deletedAt: null },
      select: { id: true },
    });
    if (!product) throw new NotFoundException('المنتج غير موجود أو غير نشط');
    return this.prisma.productVariant.create({
      data: { productId, size, color },
    });
  }

  async addBomItem(
    productId: string,
    rawMaterialId: string,
    quantity: number,
    unit: string,
  ) {
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new BadRequestException('كمية BOM يجب أن تكون موجبة وصالحة');
    }
    if (!unit.trim()) {
      throw new BadRequestException('وحدة BOM مطلوبة');
    }

    return this.prisma.$transaction(async (tx) => {
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
        include: { lines: true },
        orderBy: { createdAt: 'desc' },
      });
      const existingLines = activeBom?.lines ?? [];
      const nextLines = existingLines.some(
        (line) => line.rawMaterialId === rawMaterialId,
      )
        ? existingLines.map((line) =>
            line.rawMaterialId === rawMaterialId
              ? { rawMaterialId, quantity, unit }
              : {
                  rawMaterialId: line.rawMaterialId,
                  quantity: line.quantity,
                  unit: line.unit,
                },
          )
        : [
            ...existingLines.map((line) => ({
              rawMaterialId: line.rawMaterialId,
              quantity: line.quantity,
              unit: line.unit,
            })),
            { rawMaterialId, quantity, unit },
          ];

      if (activeBom) {
        await tx.bomVersion.update({
          where: { id: activeBom.id },
          data: { isActive: false },
        });
      }

      return tx.bomVersion.create({
        data: {
          productId,
          versionName: nextBomVersionName(activeBom?.versionName),
          isActive: true,
          lines: { create: nextLines },
        },
        include: { lines: { include: { rawMaterial: true } } },
      });
    });
  }

  async deleteBomItem(id: string) {
    return this.prisma.$transaction(async (tx) => {
      const line = await tx.bomLine.findUnique({
        where: { id },
        include: { bomVersion: { include: { lines: true } } },
      });
      if (!line) throw new NotFoundException('بند BOM غير موجود');

      const bomVersion = line.bomVersion;
      if (!bomVersion.isActive) {
        throw new BadRequestException('لا يمكن تعديل إصدار BOM غير فعال');
      }
      const nextLines = bomVersion.lines
        .filter((candidate) => candidate.id !== id)
        .map((candidate) => ({
          rawMaterialId: candidate.rawMaterialId,
          quantity: candidate.quantity,
          unit: candidate.unit,
        }));

      await tx.bomVersion.update({
        where: { id: bomVersion.id },
        data: { isActive: false },
      });
      const replacement = await tx.bomVersion.create({
        data: {
          productId: bomVersion.productId,
          versionName: nextBomVersionName(bomVersion.versionName),
          isActive: true,
          lines: { create: nextLines },
        },
        include: { lines: { include: { rawMaterial: true } } },
      });
      return { deletedLineId: id, bomVersion: replacement };
    });
  }
}

function nextBomVersionName(current?: string): string {
  if (!current) return 'v1.0';
  const match = /^v(\d+)(?:\.(\d+))?$/.exec(current.trim());
  if (!match) return `${current}-next`;
  return `v${Number(match[1]) + 1}.0`;
}
