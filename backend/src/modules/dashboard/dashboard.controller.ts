import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/roles.guard';
import { DashboardService } from './dashboard.service';
import { DashboardQueryDto } from './dto/dashboard-query.dto';

@ApiTags('Dashboard (لوحة التحكم)')
@ApiBearerAuth()
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('stats')
  // GF-IMP-W2 / DSH-1 (P1): مؤشرات مالية مجمعة على مستوى الشركة (إيرادات
  // وإنتاج وقيمة مخزون) — كانت مكشوفة لأي دور مصادق بما فيه VIEWER. تُقصر
  // الآن على الإدارة العليا؛ الأدوار التشغيلية ترى مؤشراتها من شاشاتها
  // المتخصصة (الإنتاج/المخزون) بلا سلاسل نقدية.
  @Roles(UserRole.GENERAL_MANAGER, UserRole.SUPER_ADMIN, UserRole.ACCOUNTANT)
  @ApiOperation({
    summary: 'مؤشرات لوحة التحكم من قاعدة البيانات ضمن فترة زمنية',
  })
  getStats(@Query() query: DashboardQueryDto) {
    return this.dashboardService.getStats(query);
  }
}
