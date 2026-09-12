import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.guard';
import { CreateAdvanceDto } from './dto/create-advance.dto';
import { CreateAttendanceDto } from './dto/create-attendance.dto';
import { CreatePayrollDto } from './dto/create-payroll.dto';
import { CreateWorkerDto } from './dto/create-worker.dto';
import { PayPayrollDto } from './dto/pay-payroll.dto';
import { RecordProductionDto } from './dto/record-production.dto';
import { PayrollQueryDto } from './dto/payroll-query.dto';
import { WorkerPeriodQueryDto } from './dto/worker-period-query.dto';
import { HrService } from './hr.service';

@ApiTags('HR (الموارد البشرية والعمال)')
@Controller('hr')
export class HrController {
  constructor(private readonly hrService: HrService) {}

  @Get('workers')
  @ApiOperation({ summary: 'قائمة جميع العمال' })
  async getWorkers(
    @Query() pagination: PaginationDto = new PaginationDto(),
    // HR-8 (ب): دور الجلسة يقرر ظهور حقول الهوية (نمط INV-2).
    @CurrentUser('role') viewerRole?: UserRole,
  ) {
    return this.hrService.getAllWorkers(pagination, viewerRole);
  }

  @Post('workers')
  @Roles(UserRole.HR_MANAGER, UserRole.GENERAL_MANAGER)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description: 'RES-F02: مفتاح إعادة المحاولة الآمنة لإنشاء عامل',
  })
  @ApiOperation({ summary: 'إنشاء عامل جديد' })
  async createWorker(
    @Body() body: CreateWorkerDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const { hireDate, ...workerData } = body;
    return this.hrService.createWorker(
      {
        ...workerData,
        hireDate: hireDate ? new Date(hireDate) : undefined,
      },
      idempotencyKey,
    );
  }

  @Get('workers/:id')
  @ApiOperation({ summary: 'تفاصيل العامل مع إنتاجه وسلفه' })
  async getWorkerDetails(
    @Param('id', new ParseUUIDPipe()) id: string,
    // HR-8 (ب): حقول الهوية (nationalId/phone) لأدوار HR فقط.
    @CurrentUser('role') viewerRole?: UserRole,
  ) {
    return this.hrService.getWorkerDetails(id, viewerRole);
  }

  @Post('attendance')
  @Roles(UserRole.HR_MANAGER, UserRole.GENERAL_MANAGER)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description: 'RES-F02: مفتاح إعادة المحاولة الآمنة لتسجيل الحضور',
  })
  @ApiOperation({ summary: 'تسجيل حضور عامل ليوم محدد' })
  async recordAttendance(
    @Body() body: CreateAttendanceDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.hrService.recordAttendance(
      {
        ...body,
        date: new Date(body.date),
      },
      idempotencyKey,
    );
  }

  @Post('production')
  @Roles(
    UserRole.PRODUCTION_MANAGER,
    UserRole.HR_MANAGER,
    UserRole.GENERAL_MANAGER,
  )
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description: 'RES-F02: مفتاح إعادة المحاولة الآمنة لتسجيل الإنتاج',
  })
  @ApiOperation({ summary: 'تسجيل إنتاج يومي بالقطعة لعامل' })
  async recordProduction(
    @Body() body: RecordProductionDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.hrService.recordDailyProduction(body, idempotencyKey);
  }

  @Post('advances')
  @Roles(UserRole.HR_MANAGER)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description: 'RES-F02: مفتاح إعادة المحاولة الآمنة لتسجيل السلفة',
  })
  @ApiOperation({
    summary:
      'تسجيل سلفة مالية لعامل — عند توفير treasuryId تُرحَّل قيد GL مزدوج',
  })
  async recordAdvance(
    @Body() body: CreateAdvanceDto,
    @CurrentUser('id') actorId: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.hrService.recordAdvance(body, actorId, idempotencyKey);
  }

  @Post('payrolls')
  @Roles(UserRole.HR_MANAGER, UserRole.GENERAL_MANAGER)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description: 'مفتاح إعادة المحاولة الآمنة لإنشاء كشف الراتب',
  })
  @ApiOperation({ summary: 'إنشاء كشف راتب محسوب خادميًا بحالة مسودة' })
  async createPayroll(
    @Body() body: CreatePayrollDto,
    @CurrentUser('id') actorId: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.hrService.createPayroll(
      {
        ...body,
        periodStart: new Date(body.periodStart),
        periodEnd: new Date(body.periodEnd),
      },
      actorId,
      idempotencyKey,
    );
  }

  @Post('payrolls/:id/approve')
  @Roles(UserRole.HR_MANAGER, UserRole.GENERAL_MANAGER)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description: 'مفتاح إعادة المحاولة الآمنة لاعتماد كشف الراتب',
  })
  @ApiOperation({ summary: 'اعتماد كشف راتب مسودة دون ترحيل مالي' })
  async approvePayroll(
    @Param('id', new ParseUUIDPipe()) payrollId: string,
    @CurrentUser('id') actorId: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.hrService.approvePayroll(payrollId, actorId, idempotencyKey);
  }

  @Post('payrolls/:id/pay')
  // HR-5 (P2 — GF-IMP-W3): المحاسب وأمين الصندوق يدفعان الرواتب إلى جانب
  // HR والمدير العام — والخدمة تفرض فصل الواجبات (الدافع ≠ المعتمد).
  @Roles(
    UserRole.HR_MANAGER,
    UserRole.GENERAL_MANAGER,
    UserRole.ACCOUNTANT,
    UserRole.CASHIER,
  )
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description: 'مفتاح إعادة المحاولة الآمنة لدفع كشف الراتب',
  })
  @ApiOperation({
    summary:
      'دفع كشف راتب معتمد وترحيله إلى الخزينة (الخزينة اختيارية عند صافٍ = صفر — HR-4)',
  })
  async payPayroll(
    @Param('id', new ParseUUIDPipe()) payrollId: string,
    @Body() body: PayPayrollDto,
    @CurrentUser('id') actorId: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.hrService.payPayroll(
      payrollId,
      {
        treasuryId: body.treasuryId,
        paymentDate: body.paymentDate ? new Date(body.paymentDate) : undefined,
        notes: body.notes,
      },
      actorId,
      idempotencyKey,
    );
  }

  // ===================== GF-IMP-W3 / W3-A: HR-6 =====================

  // HR-6: أدوار القراءة HR_MANAGER وGENERAL_MANAGER (نص البند) —
  // SUPER_ADMIN يتجاوز عبر RolesGuard كما في كل المسارات.
  @Get('payrolls')
  @Roles(UserRole.HR_MANAGER, UserRole.GENERAL_MANAGER)
  @ApiOperation({
    summary: 'HR-6: قائمة كشوف الرواتب (فلاتر status/workerId/نطاق فترة)',
  })
  async getPayrolls(@Query() query: PayrollQueryDto) {
    return this.hrService.getPayrolls(query);
  }

  @Post('payrolls/:id/cancel')
  // HR-6 (ب): الإبطال إجراء إداري مقصور على HR_MANAGER وGENERAL_MANAGER.
  @Roles(UserRole.HR_MANAGER, UserRole.GENERAL_MANAGER)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description: 'مفتاح إعادة المحاولة الآمنة لإبطال مسودة كشف الراتب',
  })
  @ApiOperation({
    summary: 'HR-6: إبطال مسودة كشف راتب (DRAFT فقط) بـ CAS وتدقيق كامل',
  })
  async cancelPayroll(
    @Param('id', new ParseUUIDPipe()) payrollId: string,
    @CurrentUser('id') actorId: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.hrService.cancelPayroll(payrollId, actorId, idempotencyKey);
  }

  // HR-6 (ج): قراءات الجوال — السلف والإنتاج اليومي بنفس أدوار HR-6
  // (HR_MANAGER وGENERAL_MANAGER — نص البند؛ الجوال HR هو مستهلكها).
  @Get('advances')
  @Roles(UserRole.HR_MANAGER, UserRole.GENERAL_MANAGER)
  @ApiOperation({
    summary: 'HR-6: قائمة سلف العمال (فلاتر workerId/from/to) — للجوال',
  })
  async getAdvances(@Query() query: WorkerPeriodQueryDto) {
    return this.hrService.getWorkerAdvances(query);
  }

  @Get('production')
  @Roles(UserRole.HR_MANAGER, UserRole.GENERAL_MANAGER)
  @ApiOperation({
    summary:
      'HR-6: قائمة سجلات الإنتاج اليومي (فلاتر workerId/from/to) — للجوال',
  })
  async getProduction(@Query() query: WorkerPeriodQueryDto) {
    return this.hrService.getDailyProductionRecords(query);
  }
}
