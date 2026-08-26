import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';

/**
 * MOBILE-F03 / MOBILE-F04 (backend side):
 * مسار تجميعي واحد لكل ما تحتاجه شاشة لوحة التحكم وشاشة التقارير.
 *
 * `GET /dashboard/stats` يجمع من جداول SalesOrder + DailyProduction + WorkOrder
 * + Treasury + RawMaterial + FinishedGoodStock + Voucher عبر DashboardService
 * ويُرجعها في استجابة JSON واحدة. أي مستخدم موثّق يستطيع قراءتها (لا @Roles()).
 */
@ApiTags('Dashboard (لوحة التحكم)')
@ApiBearerAuth()
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('stats')
  @ApiOperation({
    summary: 'إحصائيات لوحة التحكم والتقارير (بيانات حقيقية مجمعة)',
  })
  async getStats() {
    return this.dashboardService.getStats();
  }
}
