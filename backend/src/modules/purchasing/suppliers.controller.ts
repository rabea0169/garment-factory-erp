import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.guard';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { SupplierQueryDto } from './dto/supplier-query.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { SuppliersService } from './suppliers.service';

/**
 * PUR-7 (P2 — GF-IMP-W3): متحكم الموردين — استكمال التكافؤ مع العملاء.
 *
 * القائمة (GET) متاحة لكل الأدوار المصادَقة كما كانت (شاشات الاختيار
 * تقرأ الموردين النشطين). كل عمليات الكتابة الجديدة (تحديث/تعطيل/
 * تنشيط) INVENTORY_MANAGER أو GENERAL_MANAGER — نفس أدوار الإنشاء.
 */
@ApiTags('Suppliers (الموردون)')
@ApiBearerAuth()
@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly suppliersService: SuppliersService) {}

  @Get()
  @ApiOperation({
    summary:
      'PUR-7: قائمة الموردين (النشطون افتراضيًا) مع includeInactive وq/from/to (CC-6)',
  })
  async getSuppliers(
    @Query() query: SupplierQueryDto = new SupplierQueryDto(),
  ) {
    return this.suppliersService.getSuppliers(query);
  }

  @Post()
  @Roles(UserRole.INVENTORY_MANAGER, UserRole.GENERAL_MANAGER)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description: 'RES-F02: مفتاح إعادة المحاولة الآمنة لإنشاء مورد',
  })
  @ApiOperation({ summary: 'إنشاء مورد جديد' })
  async createSupplier(
    @Body() body: CreateSupplierDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.suppliersService.createSupplier(body, idempotencyKey);
  }

  @Patch(':id')
  @Roles(UserRole.INVENTORY_MANAGER, UserRole.GENERAL_MANAGER)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description:
      'PUR-7: مفتاح ثابت لإعادة إرسال نفس التحديث بأمان — نفس المفتاح + نفس المحتوى = نفس الاستجابة، ومحتوى مختلف = 409',
  })
  @ApiOperation({
    summary: 'PUR-7: تحديث name/phone/address/notes لمورد (PATCH دلالي)',
  })
  async updateSupplier(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateSupplierDto,
    @CurrentUser('id') actorId: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.suppliersService.updateSupplier(
      id,
      body,
      actorId,
      idempotencyKey,
    );
  }

  @Patch(':id/deactivate')
  @Roles(UserRole.INVENTORY_MANAGER, UserRole.GENERAL_MANAGER)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description: 'PUR-7: مفتاح إعادة محاولة آمنة للتعطيل',
  })
  @ApiOperation({
    summary: 'PUR-7: تعطيل مورد (isActive=false بـ CAS وتدقيق)',
  })
  async deactivateSupplier(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser('id') actorId: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.suppliersService.deactivateSupplier(
      id,
      actorId,
      idempotencyKey,
    );
  }

  @Patch(':id/activate')
  @Roles(UserRole.INVENTORY_MANAGER, UserRole.GENERAL_MANAGER)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description: 'PUR-7: مفتاح إعادة محاولة آمنة للتنشيط',
  })
  @ApiOperation({
    summary: 'PUR-7: تنشيط مورد (isActive=true بـ CAS وتدقيق)',
  })
  async activateSupplier(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser('id') actorId: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.suppliersService.activateSupplier(id, actorId, idempotencyKey);
  }
}
