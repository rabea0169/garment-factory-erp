import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { PaginatedResult } from '../../common/dto/paginated-result.dto';

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async getAllSeasons(pagination: PaginationDto) {
    const page = pagination.page || 1;
    const limit = pagination.limit || 20;
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.season.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.season.count(),
    ]);

    return new PaginatedResult(data, total, page, limit);
  }

  async getAllProducts(pagination: PaginationDto) {
    const page = pagination.page || 1;
    const limit = pagination.limit || 20;
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.product.findMany({
        skip,
        take: limit,
        include: {
          season: true,
          variants: true,
        },
        orderBy: { name: 'asc' },
      }),
      this.prisma.product.count(),
    ]);

    return new PaginatedResult(data, total, page, limit);
  }

  async getProductDetails(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
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
    return this.prisma.productVariant.create({
      data: { productId, size, color },
    });
  }

  /*
  async addBomItem(productId: string, rawMaterialId: string, quantity: number, unit: string) {
    return this.prisma.bomItem.create({
      data: {
        productId,
        rawMaterialId,
        quantity,
        unit,
      },
      include: { rawMaterial: true }
    });
  }

  async deleteBomItem(id: string) {
    return this.prisma.bomItem.delete({
      where: { id }
    });
  }
  */
}
