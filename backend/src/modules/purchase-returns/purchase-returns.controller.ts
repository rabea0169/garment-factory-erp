import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.guard';
import { CreatePurchaseReturnDto } from './dto/create-purchase-return.dto';
import { QueryPurchaseReturnDto } from './dto/query-purchase-return.dto';
import { PurchaseReturnsService } from './purchase-returns.service';

/**
 * SELIM-ERP W1 — كنترولر مرتجع المشتريات (يقلد /api/purchase-returns
 * في Selim ERP).
 *
 * الأدوار (اتباع تفويض المشتريات/المحاسبة في المشروع الحالي):
 * - القراءة: إدارة عامة + محاسبة (قراءة مالية).
 * - الإنشاء: إدارة عامة + كاشير (استرداد نقدي = عملية نقدية).
 * - الحذف (يعكس قيدًا ويستعيد مخزونًا): إدارة عامة فقط.
 */
@ApiTags('Purchase Returns (مرتجع المشتريات)')
@Controller('purchase-returns')
export class PurchaseReturnsController {
  constructor(
    private readonly purchaseReturnsService: PurchaseReturnsService,
  ) {}

  @Get()
  @Roles(UserRole.GENERAL_MANAGER, UserRole.ACCOUNTANT, UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'قائمة مرتجعات المشتريات ببحث/نطاق تاريخي/مورد + ترقيم',
  })
  async findAll(
    @Query() query: QueryPurchaseReturnDto = new QueryPurchaseReturnDto(),
  ) {
    return this.purchaseReturnsService.findAll(query);
  }

  @Get(':id')
  @Roles(UserRole.GENERAL_MANAGER, UserRole.ACCOUNTANT, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'تفاصيل مرتجع ببنوده وقيده المالي' })
  async findOne(@Param('id') id: string) {
    return this.purchaseReturnsService.findOne(id);
  }

  @Post()
  @Roles(UserRole.GENERAL_MANAGER, UserRole.CASHIER, UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary:
      'إنشاء مرتجع — الإجماليات على الخادم، قيد عكسي وحركة مخزون داخل معاملة واحدة',
  })
  async create(
    @Body() dto: CreatePurchaseReturnDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.purchaseReturnsService.create(dto, user.id);
  }

  @Delete(':id')
  @Roles(UserRole.GENERAL_MANAGER, UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'حذف مرتجع — عكس القيد واستعادة المخزون داخل معاملة واحدة',
  })
  async remove(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.purchaseReturnsService.remove(id, user.id);
  }
}
