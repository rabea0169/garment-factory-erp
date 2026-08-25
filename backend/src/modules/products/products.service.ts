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

  async addBomItem(
    productId: string,
    rawMaterialId: string,
    quantity: number,
    unit: string,
  ) {
    const [product, rawMaterial] = await Promise.all([
      this.prisma.product.findUnique({ where: { id: productId } }),
      this.prisma.rawMaterial.findUnique({ where: { id: rawMaterialId } }),
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
