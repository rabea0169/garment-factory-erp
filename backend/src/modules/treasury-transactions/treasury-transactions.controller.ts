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
import {
  CreateTreasuryTransactionDto,
  QueryTreasuryTransactionDto,
} from './dto/create-treasury-transaction.dto';
import { TreasuryTransactionsService } from './treasury-transactions.service';

/**
 * SELIM-ERP W1 — كنترولر حركات الخزينة (يقلد /api/treasury-transactions
 * في Selim ERP).
 *
 * الأدوار (اتباع التفويض المالي في المشروع الحالي):
 * - قراءة الحركات: إدارة عامة + محاسبة + كاشير (الصندوق اليومي).
 * - الملخص المحاسبي (أرصدة كل الخزائن): إدارة عامة + محاسبة.
 * - إنشاء الحركات (عمليات نقدية): إدارة عامة + كاشير.
 * - الحذف (يعكس قيدًا ويعيد أرصدة): إدارة عامة فقط.
 */
@ApiTags('Treasury Transactions (حركات الخزينة)')
@Controller('treasury-transactions')
export class TreasuryTransactionsController {
  constructor(
    private readonly treasuryTransactionsService: TreasuryTransactionsService,
  ) {}

  @Get('summary')
  @Roles(UserRole.GENERAL_MANAGER, UserRole.ACCOUNTANT, UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'ملخص الخزائن: الرصيد الحالي لكل خزينة + المجاميع حسب النوع',
  })
  async getSummary() {
    return this.treasuryTransactionsService.getSummary();
  }

  @Get()
  @Roles(
    UserRole.GENERAL_MANAGER,
    UserRole.ACCOUNTANT,
    UserRole.CASHIER,
    UserRole.SUPER_ADMIN,
  )
  @ApiOperation({
    summary: 'قائمة حركات الخزينة بفلترة خزينة/نوع/تاريخ + ترقيم',
  })
  async findAll(
    @Query()
    query: QueryTreasuryTransactionDto = new QueryTreasuryTransactionDto(),
  ) {
    return this.treasuryTransactionsService.findAll(query);
  }

  @Get(':id')
  @Roles(
    UserRole.GENERAL_MANAGER,
    UserRole.ACCOUNTANT,
    UserRole.CASHIER,
    UserRole.SUPER_ADMIN,
  )
  @ApiOperation({ summary: 'تفاصيل حركة خزينة بقيندها وخزينتيها' })
  async findOne(@Param('id') id: string) {
    return this.treasuryTransactionsService.findOne(id);
  }

  @Post()
  @Roles(UserRole.GENERAL_MANAGER, UserRole.CASHIER, UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary:
      'إنشاء حركة (إيداع/سحب/تحويل) — أرصدة وقيد داخل معاملة واحدة، ترقيم TRT-0001',
  })
  async create(
    @Body() dto: CreateTreasuryTransactionDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.treasuryTransactionsService.create(dto, user.id);
  }

  @Delete(':id')
  @Roles(UserRole.GENERAL_MANAGER, UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'حذف حركة يدوية (بلا مرجع) — عكس القيد وإعادة الأرصدة',
  })
  async remove(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.treasuryTransactionsService.remove(id, user.id);
  }
}
