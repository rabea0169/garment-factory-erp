import { Controller, Get, Post, Body, Query, Param } from '@nestjs/common';
import { AccountingService } from './accounting.service';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { CreateAccountDto } from './dto/create-account.dto';
import { CreateVoucherDto } from './dto/create-voucher.dto';
import { ReverseJournalEntryDto } from './dto/reverse-journal-entry.dto';
import { PaginationDto } from '../../common/dto/pagination.dto';

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
  @ApiOperation({ summary: 'إضافة حساب جديد' })
  async createAccount(@Body() body: CreateAccountDto) {
    return this.accountingService.createAccount(body);
  }

  @Get('vouchers')
  @Roles(UserRole.ACCOUNTANT, UserRole.GENERAL_MANAGER)
  @ApiOperation({ summary: 'أوامر الصرف والقبض' })
  async getVouchers(@Query() pagination: PaginationDto) {
    return this.accountingService.getVouchers(pagination);
  }

  @Post('vouchers')
  @Roles(UserRole.ACCOUNTANT, UserRole.CASHIER)
  @ApiOperation({ summary: 'إنشاء أمر صرف أو قبض جديد' })
  async createVoucher(
    @CurrentUser('id') userId: string,
    @Body() body: CreateVoucherDto,
  ) {
    // P0-04: createdById من الجلسة فقط — إرساله في body يُرفض بـ 400 (أقوى من التجاهل)
    return this.accountingService.createVoucher(body, userId);
  }

  @Post('journal-entries/:id/reverse')
  @Roles(UserRole.ACCOUNTANT, UserRole.GENERAL_MANAGER)
  @ApiOperation({
    summary: 'A9: عكس قيد مالي — قيد عكسي مرتبط بالأصلي (غير تدميري)',
  })
  async reverseJournalEntry(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() body: ReverseJournalEntryDto,
  ) {
    // A9: عكس قيد سابق — يُنشئ قيدًا عكسيًا مقلوبًا ويربطه بالأصلي.
    // لا cascade — القيد الأصلي يبقى محفوظًا (audit trail).
    return this.accountingService.reverseJournalEntry(
      id,
      userId,
      body.description,
    );
  }
}
