import { Injectable, NotFoundException } from '@nestjs/common';
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
    const [product, rawMaterial] = await Promise.all([
      this.prisma.product.findFirst({
        where: { id: productId, isActive: true, deletedAt: null },
      }),
      this.prisma.rawMaterial.findFirst({
        where: { id: rawMaterialId, isActive: true },
      }),
    ]);

    if (!product) throw new NotFoundException('المنتج غير موجود');
    if (!rawMaterial) throw new NotFoundException('الخامة غير موجودة');

    const activeBom = await this.prisma.bomVersion.findFirst({
      where: { productId, isActive: true },
      orderBy: { createdAt: 'desc' },
    });

    const bomVersion =
      activeBom ??
      (await this.prisma.bomVersion.create({
        data: {
          productId,
          versionName: 'v1.0',
          isActive: true,
        },
      }));

    return this.prisma.bomLine.upsert({
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
  }

  async deleteBomItem(id: string) {
    return this.prisma.bomLine.delete({ where: { id } });
  }
}
