import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';
import { DashboardQueryDto } from './dto/dashboard-query.dto';

@ApiTags('Dashboard (لوحة التحكم)')
@ApiBearerAuth()
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('stats')
  @ApiOperation({
    summary: 'مؤشرات لوحة التحكم من قاعدة البيانات ضمن فترة زمنية',
  })
  getStats(@Query() query: DashboardQueryDto) {
    return this.dashboardService.getStats(query);
  }
}
