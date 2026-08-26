import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { HrService } from './hr.service';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/roles.guard';
import { RecordProductionDto } from './dto/record-production.dto';
import { CreateAdvanceDto } from './dto/create-advance.dto';
import { CreateAttendanceDto } from './dto/create-attendance.dto';
import { PaginationDto } from '../../common/dto/pagination.dto';

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
}
