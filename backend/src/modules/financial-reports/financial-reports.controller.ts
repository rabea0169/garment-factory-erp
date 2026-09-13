import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/roles.guard';
import {
  ReportRangeQueryDto,
  AsOfQueryDto,
  AgingQueryDto,
} from './dto/report-query.dto';
import {
  CreateBudgetDto,
  UpdateBudgetDto,
  QueryBudgetDto,
  BudgetVarianceQueryDto,
} from './dto/budget.dto';
import { FinancialReportsService } from './financial-reports.service';

/**
 * SELIM-ERP W1 — كنترولر التقارير المالية (يقلد /api/financial-reports
 * في Selim ERP): قائمة الدخل، الميزانية العمومية، VAT، أعمار الذمم،
 * الميزانيات وتباينها.
 *
 * الأدوار: محاسبة + مدير عام (+SUPER_ADMIN يتجاوز في RolesGuard أصلًا —
 * يُصرَّح به للوثائق) — نفس تفويض قراءات المحاسبة في المشروع.
 * لا نكرر ميزان المراجعة (GET accounting/trial-balance قائم) — التقارير
 * هنا فوق نفس أسلوب التجميع من journal_lines.
 */
@ApiTags('Financial Reports (التقارير المالية)')
@Controller('financial-reports')
export class FinancialReportsController {
  constructor(
    private readonly financialReportsService: FinancialReportsService,
  ) {}

  @Get('income-statement')
  @Roles(UserRole.ACCOUNTANT, UserRole.GENERAL_MANAGER, UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary:
      'قائمة الدخل: الإيرادات والمصروفات وصافي الربح لفترة (افتراضي الشهر الحالي)',
  })
  async getIncomeStatement(
    @Query() query: ReportRangeQueryDto = new ReportRangeQueryDto(),
  ) {
    return this.financialReportsService.getIncomeStatement(query);
  }

  @Get('balance-sheet')
  @Roles(UserRole.ACCOUNTANT, UserRole.GENERAL_MANAGER, UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary:
      'الميزانية العمومية لحظة asOf: أصول/التزامات/حقوق ملكية + صافي الربح التراكمي + فحص التوازن',
  })
  async getBalanceSheet(@Query() query: AsOfQueryDto = new AsOfQueryDto()) {
    return this.financialReportsService.getBalanceSheet(query);
  }

  @Get('vat')
  @Roles(UserRole.ACCOUNTANT, UserRole.GENERAL_MANAGER, UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'تقرير ضريبة القيمة المضافة: مخرجات/مدخلات/صافي + مبيعات الفترة',
  })
  async getVatReport(
    @Query() query: ReportRangeQueryDto = new ReportRangeQueryDto(),
  ) {
    return this.financialReportsService.getVatReport(query);
  }

  @Get('aging')
  @Roles(UserRole.ACCOUNTANT, UserRole.GENERAL_MANAGER, UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'أعمار الذمم (AR عملاء / AP موردون): 0-30 / 31-60 / 61-90 / 90+',
  })
  async getAging(@Query() query: AgingQueryDto = new AgingQueryDto()) {
    return this.financialReportsService.getAging(query);
  }

  @Get('budgets/variance')
  @Roles(UserRole.ACCOUNTANT, UserRole.GENERAL_MANAGER, UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'تباين الميزانية لسنة مالية: المخطط مقابل الفعلي لكل صف',
  })
  async getBudgetVariance(@Query() query: BudgetVarianceQueryDto) {
    return this.financialReportsService.getBudgetVariance(query.fiscalYear);
  }

  @Get('budgets')
  @Roles(UserRole.ACCOUNTANT, UserRole.GENERAL_MANAGER, UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'قائمة الميزانيات بفلترة سنة/حساب/فترة + ترقيم',
  })
  async getBudgets(@Query() query: QueryBudgetDto = new QueryBudgetDto()) {
    return this.financialReportsService.getBudgets(query);
  }

  @Post('budgets')
  @Roles(UserRole.ACCOUNTANT, UserRole.GENERAL_MANAGER, UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'إنشاء ميزانية — تفرد (حساب، سنة، فترة، رقم فترة)',
  })
  async createBudget(@Body() dto: CreateBudgetDto) {
    return this.financialReportsService.createBudget(dto);
  }

  @Patch('budgets/:id')
  @Roles(UserRole.ACCOUNTANT, UserRole.GENERAL_MANAGER, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'تعديل مبلغ/مركز تكلفة ميزانية' })
  async updateBudget(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBudgetDto,
  ) {
    return this.financialReportsService.updateBudget(id, dto);
  }

  @Delete('budgets/:id')
  @Roles(UserRole.ACCOUNTANT, UserRole.GENERAL_MANAGER, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'حذف ميزانية' })
  async removeBudget(@Param('id', ParseUUIDPipe) id: string) {
    return this.financialReportsService.removeBudget(id);
  }
}
