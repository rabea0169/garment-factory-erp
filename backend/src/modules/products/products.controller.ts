import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { ProductsService } from './products.service';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/roles.guard';
import { CreateProductDto } from './dto/create-product.dto';
import { CreateProductVariantDto } from './dto/create-product-variant.dto';
import { CreateBomLineDto } from './dto/create-bom-line.dto';

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
  @ApiOperation({
    summary: 'تفاصيل المنتج تشمل مقاساته وألوانه والخامات (BOM)',
  })
  async getProduct(@Param('id') id: string) {
    return this.productsService.getProductDetails(id);
  }

  @Post()
  @Roles(UserRole.GENERAL_MANAGER, UserRole.PRODUCTION_MANAGER)
  @ApiOperation({ summary: 'إضافة منتج جديد' })
  async createProduct(@Body() body: CreateProductDto) {
    return this.productsService.createProduct(body);
  }

  @Post(':id/variants')
  @ApiOperation({ summary: 'إضافة مقاس/لون جديد للمنتج' })
  async createVariant(
    @Param('id') id: string,
    @Body() body: CreateProductVariantDto,
  ) {
    return this.productsService.createVariant(id, body.size, body.color);
  }

  @Post(':id/bom')
  @ApiOperation({ summary: 'إضافة مادة خام لشجرة التصنيع (BOM)' })
  async addBomItem(@Param('id') id: string, @Body() body: CreateBomLineDto) {
    return this.productsService.addBomItem(
      id,
      body.rawMaterialId,
      body.quantity,
      body.unit,
    );
  }

  @Post('bom/:bomId/delete') // Delete method can be tricky with some mobile clients, so using POST to delete is sometimes safer or we can just use Delete()
  @ApiOperation({ summary: 'حذف مادة من شجرة التصنيع' })
  async deleteBomItem(@Param('bomId') bomId: string) {
    return this.productsService.deleteBomItem(bomId);
  }
}
