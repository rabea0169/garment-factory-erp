import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';

@ApiTags('Dashboard (لوحة التحكم)')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('stats')
  @ApiOperation({
    summary: 'مؤشرات لوحة التحكم من بيانات المبيعات والإنتاج الفعلية',
  })
  getStats() {
    return this.dashboardService.getStats();
  }
}
