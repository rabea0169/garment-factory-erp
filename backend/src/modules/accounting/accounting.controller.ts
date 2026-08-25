import { Controller, Get, Post, Body } from '@nestjs/common';
import { AccountingService } from './accounting.service';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AccountType, UserRole, VoucherType } from '@prisma/client';
import { Roles } from '../auth/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';

@ApiTags('Accounting (الحسابات والمالية)')
@Controller('accounting')
export class AccountingController {
  constructor(private readonly accountingService: AccountingService) {}

  @Get('accounts')
  @Roles(UserRole.ACCOUNTANT, UserRole.GENERAL_MANAGER)
  @ApiOperation({ summary: 'شجرة الحسابات' })
  async getAccounts() {
    return this.accountingService.getChartOfAccounts();
  }

  @Post('accounts')
  @Roles(UserRole.ACCOUNTANT)
  @ApiOperation({ summary: 'إضافة حساب جديد' })
  async createAccount(
    @Body()
    body: {
      code: string;
      name: string;
      type: AccountType;
      parentId?: string;
      isGroup?: boolean;
    },
  ) {
    return this.accountingService.createAccount(body);
  }

  @Get('vouchers')
  @Roles(UserRole.ACCOUNTANT, UserRole.GENERAL_MANAGER)
  @ApiOperation({ summary: 'أوامر الصرف والقبض' })
  async getVouchers() {
    return this.accountingService.getVouchers();
  }

  @Post('vouchers')
  @Roles(UserRole.ACCOUNTANT, UserRole.CASHIER)
  @ApiOperation({ summary: 'إنشاء أمر صرف أو قبض جديد' })
  async createVoucher(
    @CurrentUser('id') userId: string,
    @Body()
    body: {
      type: VoucherType;
      amount: number;
      description: string;
      reference?: string;
    },
  ) {
    // P0-04: createdById من الجلسة فقط — أي قيمة واردة في body تُتجاهل
    return this.accountingService.createVoucher(body, userId);
  }
}
