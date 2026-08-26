import { Body, Controller, Get, Headers, Post, Query } from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.guard';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { CreateQualityCheckDto } from './dto/create-quality-check.dto';
import { QualityKpiQueryDto } from './dto/quality-kpi-query.dto';
import { QualityService } from './quality.service';

@ApiTags('Quality Control (مراقبة الجودة)')
@Controller('quality')
export class QualityController {
  constructor(private readonly qualityService: QualityService) {}

  @Get('kpis')
  async getKpis(@Query() query: QualityKpiQueryDto = new QualityKpiQueryDto()) {
    return this.qualityService.getQualityKpis(query);
  }

  @Get()
  async getChecks(@Query() pagination: PaginationDto = new PaginationDto()) {
    return this.qualityService.getQualityChecks(pagination);
  }

  @Post()
  @Roles(UserRole.PRODUCTION_MANAGER, UserRole.GENERAL_MANAGER)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description: 'مفتاح ثابت لإعادة إرسال نفس فحص الجودة بأمان',
  })
  async addCheck(
    @Body() body: CreateQualityCheckDto,
    @CurrentUser('id') actorId: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.qualityService.addQualityCheck(body, actorId, idempotencyKey);
  }
}
