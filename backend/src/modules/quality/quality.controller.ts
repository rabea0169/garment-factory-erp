import { Body, Controller, Get, Headers, Post, Query } from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.guard';
import { CreateQualityCheckDto } from './dto/create-quality-check.dto';
import { QualityKpiQueryDto } from './dto/quality-kpi-query.dto';
import { QualityCheckQueryDto } from './dto/quality-check-query.dto';
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
  // QLT-3 (GF-IMP-W2): فلاتر اختيارية (stage/workOrderId/from/to) + ترقيم.
  // الأدوار كما هي (قراءة مفتوحة للمصادقين) — بلا قيود جديدة.
  async getChecks(
    @Query() query: QualityCheckQueryDto = new QualityCheckQueryDto(),
  ) {
    return this.qualityService.getQualityChecks(query);
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
