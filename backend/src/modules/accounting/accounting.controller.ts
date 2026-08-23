import { Controller, Get, Post, Body } from '@nestjs/common';
import { AccountingService } from './accounting.service';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

@ApiTags('Accounting (الحسابات والمالية)')
@Controller('accounting')
export class AccountingController {
  constructor(private readonly accountingService: AccountingService) {}

  @Get('accounts')
  @ApiOperation({ summary: 'شجرة الحسابات' })
  async getAccounts() {
    return this.accountingService.getChartOfAccounts();
  }

  @Post('accounts')
  @ApiOperation({ summary: 'إضافة حساب جديد' })
  async createAccount(@Body() body: any) {
    return this.accountingService.createAccount(body);
  }

  @Get('vouchers')
  @ApiOperation({ summary: 'أوامر الصرف والقبض' })
  async getVouchers() {
    return this.accountingService.getVouchers();
  }

  @Post('vouchers')
  @ApiOperation({ summary: 'إنشاء أمر صرف أو قبض جديد' })
  async createVoucher(@Body() body: any) {
    return this.accountingService.createVoucher(body);
  }
}
