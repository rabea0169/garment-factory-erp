import { Body, Controller, Get, Headers, Post, Query } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
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
  // QLT-6 (P2 — GF-IMP-W3): قراءة KPI الجودة قيّمت بأدوار الإدارة/الإنتاج —
  // لا دور QUALITY مستقل في UserRole فالتفويض: مدير الإنتاج + المدير العام
  // (+SUPER_ADMIN يتجاوز في RolesGuard أصلًا — يُصرَّح به للوثائق). القراءة
  // كانت مفتوحة لكل مصادق (بلا قيد أدوار) قبل هذا البند.
  @Roles(
    UserRole.PRODUCTION_MANAGER,
    UserRole.GENERAL_MANAGER,
    UserRole.SUPER_ADMIN,
  )
  @ApiOperation({
    summary: 'مؤشرات الجودة (KPIs) من الفحوص المكتملة مع فلاتر فترة/أمر/مرحلة',
  })
  async getKpis(@Query() query: QualityKpiQueryDto = new QualityKpiQueryDto()) {
    return this.qualityService.getQualityKpis(query);
  }

  @Get()
  // QLT-6 (P2 — GF-IMP-W3): نفس قيود الأدوار للقائمة — قراءة تدقيق الجودة
  // ليست مفتوحة لكل مصادق (كان التعليق القديم يسمح بالقراءة المفتوحة؛ الآن
  // موحّدة مع KPI: إنتاج/إدارة عامة/سوبر أدمن).
  @Roles(
    UserRole.PRODUCTION_MANAGER,
    UserRole.GENERAL_MANAGER,
    UserRole.SUPER_ADMIN,
  )
  @ApiOperation({
    summary:
      'قائمة فحوص الجودة بمرشحات stage/workOrderId/from/to مع ترقيم صفحات',
  })
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
