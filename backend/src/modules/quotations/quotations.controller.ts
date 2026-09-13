import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.guard';
import { CreateQuotationDto } from './dto/create-quotation.dto';
import { QueryQuotationDto, UpdateQuotationStatusDto } from './dto/query-quotation.dto';
import { QuotationsService } from './quotations.service';

/**
 * SELIM-ERP W1 — كنترولر عروض الأسعار (يقلد /api/quotations في Selim ERP).
 *
 * الأدوار (نفس تفويض المبيعات في المشروع الحالي):
 * - القراءة: مبيعات + محاسبة + إدارة عامة.
 * - الإنشاء/التعديل/الحذف: مبيعات + إدارة عامة.
 * - التحويل لأمر بيع: مبيعات + إدارة عامة (يقود مبيعات فعلية).
 */
@ApiTags('Quotations (عروض الأسعار)')
@Controller('quotations')
export class QuotationsController {
  constructor(private readonly quotationsService: QuotationsService) {}

  @Get()
  @Roles(
    UserRole.GENERAL_MANAGER,
    UserRole.ACCOUNTANT,
    UserRole.CASHIER,
    UserRole.SUPER_ADMIN,
  )
  @ApiOperation({
    summary: 'قائمة عروض الأسعار بمرشحات البحث/الحالة/التاريخ/العميل',
  })
  async findAll(@Query() query: QueryQuotationDto = new QueryQuotationDto()) {
    return this.quotationsService.findAll(query);
  }

  @Get('stats')
  @Roles(
    UserRole.GENERAL_MANAGER,
    UserRole.ACCOUNTANT,
    UserRole.SUPER_ADMIN,
  )
  @ApiOperation({ summary: 'إحصائيات عروض الأسعار حسب الحالة والقيمة' })
  async getStats() {
    return this.quotationsService.getStats();
  }

  @Get(':id')
  @Roles(
    UserRole.GENERAL_MANAGER,
    UserRole.ACCOUNTANT,
    UserRole.CASHIER,
    UserRole.SUPER_ADMIN,
  )
  @ApiOperation({ summary: 'تفاصيل عرض سعر ببنوده وربط أمر البيع الناتج' })
  async findOne(@Param('id') id: string) {
    return this.quotationsService.findOne(id);
  }

  @Post()
  @Roles(UserRole.GENERAL_MANAGER, UserRole.CASHIER, UserRole.SUPER_ADMIN)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description: 'مفتاح ثابت لإعادة إرسال نفس عرض السعر بأمان',
  })
  @ApiOperation({
    summary: 'إنشاء عرض سعر — الإجماليات تُحسب على الخادم من البنود',
  })
  async create(
    @Body() dto: CreateQuotationDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.quotationsService.create(dto, user.id);
  }

  @Patch(':id')
  @Roles(UserRole.GENERAL_MANAGER, UserRole.CASHIER, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'تعديل عرض سعر — مسودة فقط' })
  async update(
    @Param('id') id: string,
    @Body() dto: CreateQuotationDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.quotationsService.update(id, dto, user.id);
  }

  @Patch(':id/status')
  @Roles(UserRole.GENERAL_MANAGER, UserRole.CASHIER, UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'انتقال الحالة: إرسال / قبول / رفض (مسارات محددة فقط)',
  })
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateQuotationStatusDto,
  ) {
    const action = dto.action as 'SENT' | 'ACCEPTED' | 'REJECTED';
    return this.quotationsService.updateStatus(id, action);
  }

  @Post(':id/convert')
  @Roles(UserRole.GENERAL_MANAGER, UserRole.CASHIER, UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'تحويل عرض مقبول إلى أمر بيع داخل معاملة واحدة',
  })
  async convert(
    @Param('id') id: string,
    @Body('paymentType') paymentType?: 'CASH' | 'CREDIT' | 'PARTIAL',
    @CurrentUser() user: { id: string } = { id: '' },
  ) {
    const resolvedType: 'CASH' | 'CREDIT' | 'PARTIAL' =
      paymentType === 'CREDIT' || paymentType === 'PARTIAL'
        ? paymentType
        : 'CASH';
    return this.quotationsService.convert(id, user.id, resolvedType);
  }

  @Delete(':id')
  @Roles(UserRole.GENERAL_MANAGER, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'حذف عرض سعر — مسودة فقط' })
  async remove(@Param('id') id: string) {
    return this.quotationsService.remove(id);
  }
}
