import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { HrService } from './hr.service';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

@ApiTags('HR (الموارد البشرية والعمال)')
@Controller('hr')
export class HrController {
  constructor(private readonly hrService: HrService) {}

  @Get('workers')
  @ApiOperation({ summary: 'قائمة جميع العمال' })
  async getWorkers() {
    return this.hrService.getAllWorkers();
  }

  @Get('workers/:id')
  @ApiOperation({ summary: 'تفاصيل العامل مع إنتاجه وسلفه' })
  async getWorkerDetails(@Param('id') id: string) {
    return this.hrService.getWorkerDetails(id);
  }

  @Post('production')
  @ApiOperation({ summary: 'تسجيل إنتاج يومي بالقطعة لعامل' })
  async recordProduction(@Body() body: { workerId: string; workOrderId?: string; date: Date; piecesCount: number }) {
    return this.hrService.recordDailyProduction(body);
  }

  @Post('advances')
  @ApiOperation({ summary: 'تسجيل سلفة مالية لعامل' })
  async recordAdvance(@Body() body: { workerId: string; amount: number; notes?: string }) {
    return this.hrService.recordAdvance(body);
  }
}
