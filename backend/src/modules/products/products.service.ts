import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async getAllSeasons() {
    return this.prisma.season.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async getAllProducts() {
    return this.prisma.product.findMany({
      include: {
        season: true,
        variants: true,
      },
      orderBy: { name: 'asc' },
    });
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
}
