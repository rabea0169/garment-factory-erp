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
import {
  ApiHeader,
  ApiTags,
  ApiOperation,
  ApiQuery,
  ApiResponse,
} from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
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
  // PROD-7 (GF-IMP-W3): includeInactive اختياري (افتراضي false) — نفس
  // الافتراضي في القائمة والتفاصيل (توحيد السلوكين المتضاربين).
  @ApiQuery({
    name: 'includeInactive',
    required: false,
    type: Boolean,
    description: 'تضمين المتغيرات غير النشطة (الافتراضي: النشطة فقط)',
  })
  async getAllProducts(
    @Query() pagination: PaginationDto = new PaginationDto(),
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.productsService.getAllProducts(
      pagination,
      includeInactive === 'true',
    );
  }

  @Get(':id')
  @ApiOperation({
    summary: 'تفاصيل المنتج تشمل مقاساته وألوانه والخامات (BOM)',
  })
  // PROD-7: نفس معامل الاستعلام في التفاصيل — الافتراضي موحد (false).
  @ApiQuery({
    name: 'includeInactive',
    required: false,
    type: Boolean,
    description: 'تضمين المتغيرات غير النشطة (الافتراضي: النشطة فقط)',
  })
  async getProduct(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.productsService.getProductDetails(
      id,
      includeInactive === 'true',
    );
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
    @CurrentUser('id') actorId: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    // PROD-6: الفاعل من الجلسة لسجل التدقيق داخل المعاملة
    return this.productsService.createFullProduct(
      body,
      idempotencyKey,
      actorId,
    );
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
    @CurrentUser('id') actorId: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    // PROD-6: الفاعل من الجلسة لسجل التدقيق داخل المعاملة
    return this.productsService.createVariant(
      id,
      body.size,
      body.color,
      idempotencyKey,
      actorId,
    );
  }

  @Post(':id/bom')
  @Roles(UserRole.GENERAL_MANAGER, UserRole.PRODUCTION_MANAGER)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description: 'RES-F02: مفتاح إعادة المحاولة الآمنة لإضافة بند BOM',
  })
  @ApiOperation({
    summary:
      'إضافة مادة خام لشجرة التصنيع (BOM) — تعديل بند قائم ينشئ إصدارًا جديدًا (PROD-4)',
  })
  async addBomItem(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: CreateBomLineDto,
    @CurrentUser('id') actorId: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    // PROD-6: الفاعل من الجلسة لسجل التدقيق داخل المعاملة
    return this.productsService.addBomItem(
      id,
      body.rawMaterialId,
      body.quantity,
      body.unit,
      idempotencyKey,
      actorId,
    );
  }

  @Post('bom/:bomId/delete')
  @Roles(UserRole.GENERAL_MANAGER, UserRole.PRODUCTION_MANAGER)
  // Delete method can be tricky with some mobile clients, so using POST to delete is sometimes safer or we can just use Delete()
  @ApiOperation({ summary: 'حذف مادة من شجرة التصنيع' })
  async deleteBomItem(
    @Param('bomId', new ParseUUIDPipe()) bomId: string,
    @CurrentUser('id') actorId: string,
  ) {
    // PROD-6: الفاعل من الجلسة لسجل التدقيق داخل معاملة الحذف
    return this.productsService.deleteBomItem(bomId, actorId);
  }
}
