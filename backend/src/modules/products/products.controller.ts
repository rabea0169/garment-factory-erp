import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { ProductsService } from './products.service';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/roles.guard';

@ApiTags('Products (المنتجات)')
@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get('seasons')
  @ApiOperation({ summary: 'الحصول على جميع المواسم' })
  async getSeasons() {
    return this.productsService.getAllSeasons();
  }

  @Get()
  @ApiOperation({ summary: 'الحصول على جميع المنتجات' })
  async getProducts() {
    return this.productsService.getAllProducts();
  }

  @Get(':id')
  @ApiOperation({ summary: 'تفاصيل المنتج تشمل مقاساته وألوانه والخامات (BOM)' })
  async getProduct(@Param('id') id: string) {
    return this.productsService.getProductDetails(id);
  }

  @Post()
  @Roles(UserRole.GENERAL_MANAGER, UserRole.PRODUCTION_MANAGER)
  @ApiOperation({ summary: 'إضافة منتج جديد' })
  async createProduct(@Body() body: any) {
    return this.productsService.createProduct(body);
  }
}
