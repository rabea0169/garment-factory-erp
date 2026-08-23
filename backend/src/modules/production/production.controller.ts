import { Controller, Get, Post, Body, Param, Patch } from '@nestjs/common';
import { ProductionService } from './production.service';
import { WorkOrderStatus } from '@prisma/client';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

@ApiTags('Production (الإنتاج)')
@Controller('production')
export class ProductionController {
  constructor(private readonly productionService: ProductionService) {}

  @Get('work-orders')
  @ApiOperation({ summary: 'الحصول على جميع أوامر التشغيل' })
  async getWorkOrders() {
    return this.productionService.getAllWorkOrders();
  }

  @Post('work-orders')
  @ApiOperation({ summary: 'إنشاء أمر تشغيل جديد' })
  async createWorkOrder(@Body() body: { productId: string; quantity: number; creatorId: string }) {
    return this.productionService.createWorkOrder(body);
  }

  @Patch('work-orders/:id/status')
  @ApiOperation({ summary: 'تحديث حالة أمر التشغيل (مخطط، قيد التنفيذ، مكتمل)' })
  async updateStatus(@Param('id') id: string, @Body() body: { status: WorkOrderStatus }) {
    return this.productionService.updateOrderStatus(id, body.status);
  }
}
