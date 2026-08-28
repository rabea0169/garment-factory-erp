import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Headers,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ProductsService } from './products.service';
import { ApiHeader, ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/roles.guard';
import { CreateProductDto } from './dto/create-product.dto';
import { CreateProductVariantDto } from './dto/create-product-variant.dto';
import { CreateBomLineDto } from './dto/create-bom-line.dto';
import { CreateFullProductDto } from './dto/create-full-product.dto';
import { PaginationDto } from '../../common/dto/pagination.dto';

@ApiTags('Products (المنتجات)')
@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get('seasons')
  @ApiOperation({ summary: 'الحصول على جميع المواسم' })
  async getSeasons(@Query() pagination: PaginationDto = new PaginationDto()) {
    return this.productsService.getAllSeasons(pagination);
  }

  @Get()
  @ApiOperation({ summary: 'جلب كل المنتجات' })
  @ApiResponse({ status: 200, description: 'قائمة المنتجات (Paginated)' })
  async getAllProducts(
    @Query() pagination: PaginationDto = new PaginationDto(),
  ) {
    return this.productsService.getAllProducts(pagination);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'تفاصيل المنتج تشمل مقاساته وألوانه والخامات (BOM)',
  })
  async getProduct(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.productsService.getProductDetails(id);
  }

  @Post('full')
  @Roles(UserRole.GENERAL_MANAGER, UserRole.PRODUCTION_MANAGER)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description: 'RES-F02: مفتاح إعادة المحاولة الآمنة لإنشاء منتج كامل',
  })
  @ApiOperation({ summary: 'إضافة منتج كامل مع المتغيرات وBOM ذرّيًا' })
  async createFullProduct(
    @Body() body: CreateFullProductDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.productsService.createFullProduct(body, idempotencyKey);
  }

  @Post()
  @Roles(UserRole.GENERAL_MANAGER, UserRole.PRODUCTION_MANAGER)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description: 'RES-F02: مفتاح إعادة المحاولة الآمنة لإنشاء منتج',
  })
  @ApiOperation({ summary: 'إضافة منتج جديد' })
  async createProduct(
    @Body() body: CreateProductDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.productsService.createProduct(body, idempotencyKey);
  }

  @Post(':id/variants')
  @Roles(UserRole.GENERAL_MANAGER, UserRole.PRODUCTION_MANAGER)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description: 'RES-F02: مفتاح إعادة المحاولة الآمنة لإنشاء متغير',
  })
  @ApiOperation({ summary: 'إضافة مقاس/لون جديد للمنتج' })
  async createVariant(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: CreateProductVariantDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.productsService.createVariant(
      id,
      body.size,
      body.color,
      idempotencyKey,
    );
  }

  @Post(':id/bom')
  @Roles(UserRole.GENERAL_MANAGER, UserRole.PRODUCTION_MANAGER)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description: 'RES-F02: مفتاح إعادة المحاولة الآمنة لإضافة بند BOM',
  })
  @ApiOperation({ summary: 'إضافة مادة خام لشجرة التصنيع (BOM)' })
  async addBomItem(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: CreateBomLineDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.productsService.addBomItem(
      id,
      body.rawMaterialId,
      body.quantity,
      body.unit,
      idempotencyKey,
    );
  }

  @Post('bom/:bomId/delete')
  @Roles(UserRole.GENERAL_MANAGER, UserRole.PRODUCTION_MANAGER)
  // Delete method can be tricky with some mobile clients, so using POST to delete is sometimes safer or we can just use Delete()
  @ApiOperation({ summary: 'حذف مادة من شجرة التصنيع' })
  async deleteBomItem(@Param('bomId', new ParseUUIDPipe()) bomId: string) {
    return this.productsService.deleteBomItem(bomId);
  }
}
