import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
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
import { RecordProductionDto } from './dto/record-production.dto';
import { HrService } from './hr.service';

@ApiTags('HR (الموارد البشرية والعمال)')
@Controller('hr')
export class HrController {
  constructor(private readonly hrService: HrService) {}

  @Get('workers')
  @ApiOperation({ summary: 'قائمة جميع العمال' })
  async getWorkers(@Query() pagination: PaginationDto = new PaginationDto()) {
    return this.hrService.getAllWorkers(pagination);
  }

  @Get('workers/:id')
  @ApiOperation({ summary: 'تفاصيل العامل مع إنتاجه وسلفه' })
  async getWorkerDetails(@Param('id') id: string) {
    return this.hrService.getWorkerDetails(id);
  }

  @Post('attendance')
  @Roles(UserRole.HR_MANAGER, UserRole.GENERAL_MANAGER)
  @ApiOperation({ summary: 'تسجيل حضور عامل ليوم محدد' })
  async recordAttendance(@Body() body: CreateAttendanceDto) {
    return this.hrService.recordAttendance({
      ...body,
      date: new Date(body.date),
    });
  }

  @Post('production')
  @Roles(
    UserRole.PRODUCTION_MANAGER,
    UserRole.HR_MANAGER,
    UserRole.GENERAL_MANAGER,
  )
  @ApiOperation({ summary: 'تسجيل إنتاج يومي بالقطعة لعامل' })
  async recordProduction(@Body() body: RecordProductionDto) {
    return this.hrService.recordDailyProduction(body);
  }

  @Post('advances')
  @Roles(UserRole.HR_MANAGER)
  @ApiOperation({ summary: 'تسجيل سلفة مالية لعامل' })
  async recordAdvance(@Body() body: CreateAdvanceDto) {
    return this.hrService.recordAdvance(body);
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
    @Param('id') payrollId: string,
    @CurrentUser('id') actorId: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.hrService.approvePayroll(payrollId, actorId, idempotencyKey);
  }
}
