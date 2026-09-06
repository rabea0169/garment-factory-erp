import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Patch,
  Query,
} from '@nestjs/common';
import { AccountingService } from './accounting.service';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { CreateAccountDto } from './dto/create-account.dto';
import { CreateVoucherDto } from './dto/create-voucher.dto';
import { ReverseJournalEntryDto } from './dto/reverse-journal-entry.dto';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { CreateFiscalPeriodDto } from './dto/create-fiscal-period.dto';
import { CreateJournalEntryDto } from './dto/create-journal-entry.dto';
import { VoucherQueryDto } from './dto/voucher-query.dto';
import { JournalEntryQueryDto } from './dto/journal-entry-query.dto';
import { AccountStatementQueryDto } from './dto/account-statement-query.dto';

@ApiTags('Accounting (الحسابات والمالية)')
@Controller('accounting')
export class AccountingController {
  constructor(private readonly accountingService: AccountingService) {}

  @Get('accounts')
  @Roles(UserRole.ACCOUNTANT, UserRole.GENERAL_MANAGER)
  @ApiOperation({ summary: 'شجرة الحسابات' })
  async getAccounts(@Query() pagination: PaginationDto) {
    return this.accountingService.getChartOfAccounts(pagination);
  }

  @Post('accounts')
  @Roles(UserRole.ACCOUNTANT)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description: 'RES-F02: مفتاح إعادة المحاولة الآمنة لإنشاء حساب',
  })
  @ApiOperation({ summary: 'إضافة حساب جديد' })
  async createAccount(
    @Body() body: CreateAccountDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.accountingService.createAccount(body, idempotencyKey);
  }

  @Post('fiscal-periods')
  @Roles(UserRole.ACCOUNTANT, UserRole.GENERAL_MANAGER)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description: 'RES-F02: مفتاح إعادة المحاولة الآمنة لإنشاء فترة مالية',
  })
  @ApiOperation({ summary: 'إنشاء فترة مالية مفتوحة' })
  async createFiscalPeriod(
    @Body() body: CreateFiscalPeriodDto,
    @CurrentUser('id') userId: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.accountingService.createFiscalPeriod(
      body,
      userId,
      idempotencyKey,
    );
  }

  @Patch('fiscal-periods/:id/close')
  @Roles(UserRole.ACCOUNTANT, UserRole.GENERAL_MANAGER)
  @ApiOperation({ summary: 'إغلاق فترة مالية' })
  async closeFiscalPeriod(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.accountingService.closeFiscalPeriod(id, userId);
  }

  @Post('journal-entries')
  @Roles(UserRole.ACCOUNTANT, UserRole.GENERAL_MANAGER)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description: 'RES-F02: مفتاح إعادة المحاولة الآمنة لإنشاء قيد مالي',
  })
  @ApiOperation({ summary: 'إنشاء قيد متعدد البنود داخل فترة مفتوحة' })
  async createJournalEntry(
    @Body() body: CreateJournalEntryDto,
    @CurrentUser('id') userId: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.accountingService.createJournalEntry(
      body,
      userId,
      idempotencyKey,
    );
  }

  @Get('treasuries')
  @Roles(UserRole.ACCOUNTANT, UserRole.GENERAL_MANAGER)
  @ApiOperation({ summary: 'الخزائن النشطة' })
  async getTreasuries(@Query() pagination: PaginationDto) {
    return this.accountingService.getTreasuries(pagination);
  }

  @Get('vouchers')
  // ACC-5 (P2 — GF-IMP-W3): أمين الصندوق ينشئ السندات — والقراءة آمنة،
  // فقائمة السندات تُتاح له (كانت محصورة بالمحاسب والمدير العام).
  @Roles(UserRole.ACCOUNTANT, UserRole.GENERAL_MANAGER, UserRole.CASHIER)
  @ApiOperation({ summary: 'أوامر الصرف والقبض (فلاتر اختيارية — ACC-6)' })
  async getVouchers(@Query() query: VoucherQueryDto) {
    return this.accountingService.getVouchers(query);
  }

  @Post('vouchers')
  @Roles(UserRole.ACCOUNTANT, UserRole.CASHIER)
  @ApiOperation({ summary: 'إنشاء أمر صرف أو قبض جديد' })
  async createVoucher(
    @CurrentUser('id') userId: string,
    @Body() body: CreateVoucherDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    // P0-04: createdById من الجلسة فقط — إرساله في body يُرفض بـ 400 (أقوى من التجاهل)
    return this.accountingService.createVoucher(body, userId, idempotencyKey);
  }

  @Post('journal-entries/:id/reverse')
  @Roles(UserRole.ACCOUNTANT, UserRole.GENERAL_MANAGER)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description: 'RES-F02: مفتاح إعادة المحاولة الآمنة لعكس القيد',
  })
  @ApiOperation({
    summary: 'A9: عكس قيد مالي — قيد عكسي مرتبط بالأصلي (غير تدميري)',
  })
  async reverseJournalEntry(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() body: ReverseJournalEntryDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    // A9: عكس قيد سابق — يُنشئ قيدًا عكسيًا مقلوبًا ويربطه بالأصلي.
    // لا cascade — القيد الأصلي يبقى محفوظًا (audit trail).
    return this.accountingService.reverseJournalEntry(
      id,
      userId,
      body.description,
      idempotencyKey,
    );
  }

  // ===================== ACC-8 (P2 — GF-IMP-W3): سطح القراءة المحاسبي =====================

  @Get('journal-entries')
  // الأدوار المالية: ACCOUNTANT / GENERAL_MANAGER (وSUPER_ADMIN يتجاوز
  // في RolesGuard — لكن الخطة تنص على إدراجه صراحةً هنا للقراءة المالية).
  @Roles(UserRole.ACCOUNTANT, UserRole.GENERAL_MANAGER, UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary:
      'ACC-8: قائمة قيود اليومية ببنودها (فلاتر: from/to وisReversed وreference)',
  })
  async getJournalEntries(@Query() query: JournalEntryQueryDto) {
    return this.accountingService.getJournalEntries(query);
  }

  @Get('accounts/:id/statement')
  @Roles(UserRole.ACCOUNTANT, UserRole.GENERAL_MANAGER, UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary:
      'ACC-8: كشف حساب — بنود المفهرسة (مدين/دائن/رصيد جارٍ) من journal_lines',
  })
  async getAccountStatement(
    @Param('id') id: string,
    @Query() query: AccountStatementQueryDto,
  ) {
    return this.accountingService.getAccountStatement(id, query);
  }

  @Get('trial-balance')
  @Roles(UserRole.ACCOUNTANT, UserRole.GENERAL_MANAGER, UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary:
      'ACC-8: ميزان المراجعة — تجميع مدين/دائن لكل حساب نشط + تحقق التوازن',
  })
  async getTrialBalance() {
    return this.accountingService.getTrialBalance();
  }
}
