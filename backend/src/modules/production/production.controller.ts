import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Patch,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ProductionService } from './production.service';
import { UserRole } from '@prisma/client';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Roles } from '../auth/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { CreateWorkOrderDto } from './dto/create-work-order.dto';
import { UpdateWorkOrderStatusDto } from './dto/update-work-order-status.dto';

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
  @Roles(UserRole.PRODUCTION_MANAGER, UserRole.GENERAL_MANAGER)
  @ApiOperation({ summary: 'إنشاء أمر تشغيل جديد' })
  async createWorkOrder(
    @CurrentUser('id') userId: string,
    @Body() body: CreateWorkOrderDto,
  ) {
    // P0-04: creatorId/createdById من الجلسة فقط — إرساله في body يُرفض بـ 400
    return this.productionService.createWorkOrder(body, userId);
  }

  @Patch('work-orders/:id/status')
  @Roles(UserRole.PRODUCTION_MANAGER)
  @ApiOperation({
    summary: 'تحديث حالة أمر التشغيل (مخطط، قيد التنفيذ، مكتمل)',
  })
  async updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateWorkOrderStatusDto,
  ) {
    return this.productionService.updateOrderStatus(id, body.status);
  }
}
