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
import { GeneratePayrollStatementDto } from './dto/generate-payroll-statement.dto';
import { QueryPayrollStatementDto } from './dto/query-payroll-statement.dto';
import { PayrollStatementsService } from './payroll-statements.service';

/**
 * SELIM-ERP W1 — كنترولر كشوف الرواتب المجمدة (يقلد /api/payroll-statements
 * في Selim ERP).
 *
 * الأدوار: موارد بشرية (توليد الكشوف من رواتب الشهر) + محاسبة (الترحيل
 * المالي) + إدارة عامة. السوبر أدمن يتجاوز دائمًا (RolesGuard العام).
 */
@ApiTags('Payroll Statements (كشوف الرواتب المجمدة)')
@Controller('payroll-statements')
export class PayrollStatementsController {
  constructor(
    private readonly payrollStatementsService: PayrollStatementsService,
  ) {}

  @Post('generate')
  @Roles(UserRole.HR_MANAGER, UserRole.ACCOUNTANT, UserRole.GENERAL_MANAGER)
  @ApiOperation({
    summary:
      'توليد كشف مجمع من الكشوف المعتمدة غير المدفوعة في الفترة — لقطة JSON مجمدة',
  })
  async generate(@Body() dto: GeneratePayrollStatementDto) {
    // لا يوثَّق مستخدم هنا — المُرحّل يُوثّق عند post (approvedById/At).
    return this.payrollStatementsService.generate(dto);
  }

  @Post(':id/post')
  @Roles(UserRole.HR_MANAGER, UserRole.ACCOUNTANT, UserRole.GENERAL_MANAGER)
  @ApiOperation({
    summary:
      'ترحيل الكشف المجمع — قيد رواتب واحد وتعليم الكشوف المرتبطة مدفوعة',
  })
  async post(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.payrollStatementsService.post(id, user.id);
  }

  @Get()
  @Roles(UserRole.HR_MANAGER, UserRole.ACCOUNTANT, UserRole.GENERAL_MANAGER)
  @ApiOperation({
    summary: 'قائمة الكشوف المجمدة بمرشحات الحالة/الفترة + ترقيم',
  })
  async findAll(
    @Query() query: QueryPayrollStatementDto = new QueryPayrollStatementDto(),
  ) {
    return this.payrollStatementsService.findAll(query);
  }

  @Get(':id')
  @Roles(UserRole.HR_MANAGER, UserRole.ACCOUNTANT, UserRole.GENERAL_MANAGER)
  @ApiOperation({ summary: 'تفاصيل كشف مجمع (اللقطة + الكشوف المرتبطة)' })
  async findOne(@Param('id') id: string) {
    return this.payrollStatementsService.findOne(id);
  }

  @Delete(':id')
  @Roles(UserRole.HR_MANAGER, UserRole.ACCOUNTANT, UserRole.GENERAL_MANAGER)
  @ApiOperation({
    summary: 'حذف كشف مجمع — مسودة فقط مع فك ربط الكشوف',
  })
  async remove(@Param('id') id: string) {
    return this.payrollStatementsService.remove(id);
  }
}
