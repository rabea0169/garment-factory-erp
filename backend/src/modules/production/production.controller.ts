import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.guard';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { CreateWorkOrderDto } from './dto/create-work-order.dto';
import { UpdateWorkOrderStatusDto } from './dto/update-work-order-status.dto';
import { ConsumeMaterialDto } from './dto/consume-material.dto';
import { RecordStageOutputDto } from './dto/record-stage-output.dto';
import { TransitionStageDto } from './dto/transition-stage.dto';
import { ProductionService } from './production.service';
import { ProductionWorkflowService } from './production-workflow.service';

@ApiTags('Production (الإنتاج)')
@ApiBearerAuth()
@Controller('production')
export class ProductionController {
  constructor(
    private readonly productionService: ProductionService,
    private readonly workflowService: ProductionWorkflowService,
  ) {}

  @Get('work-orders')
  @ApiOperation({ summary: 'الحصول على جميع أوامر التشغيل' })
  async getWorkOrders(@Query() pagination: PaginationDto) {
    return this.productionService.getAllWorkOrders(pagination);
  }

  @Post('work-orders')
  @Roles(UserRole.PRODUCTION_MANAGER, UserRole.GENERAL_MANAGER)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description: 'RES-F02: مفتاح إعادة المحاولة الآمنة لإنشاء أمر تشغيل',
  })
  @ApiOperation({ summary: 'إنشاء أمر تشغيل جديد' })
  async createWorkOrder(
    @CurrentUser('id') userId: string,
    @Body() body: CreateWorkOrderDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    // P0-04: creatorId/createdById من الجلسة فقط — إرساله في body يُرفض بـ 400
    return this.productionService.createWorkOrder(body, userId, idempotencyKey);
  }

  @Patch('work-orders/:id/status')
  @Roles(UserRole.PRODUCTION_MANAGER, UserRole.GENERAL_MANAGER)
  @ApiOperation({
    summary:
      'تحديث حالة أمر التشغيل (المسار القديم - مقيد الآن بـ CANCELLED/PLANNED)',
    description:
      'يمنع هذا المسار الآن الانتقال إلى COMPLETED أو أي حالة تدار عبر ProductionWorkflowService.',
  })
  async updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateWorkOrderStatusDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.productionService.updateOrderStatus(id, body.status, userId);
  }

  @Post('work-orders/:id/stage-transitions')
  @Roles(UserRole.PRODUCTION_MANAGER, UserRole.GENERAL_MANAGER)
  @ApiOperation({ summary: 'نقل أمر التشغيل إلى المرحلة التالية' })
  async transitionStage(
    @Param('id', ParseUUIDPipe) workOrderId: string,
    @Body() body: TransitionStageDto,
    @CurrentUser('id') actorId: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.workflowService.transitionStage(
      { workOrderId, ...body, idempotencyKey },
      actorId,
    );
  }

  @Post('work-orders/:id/stage-output')
  @Roles(UserRole.PRODUCTION_MANAGER, UserRole.GENERAL_MANAGER)
  @ApiOperation({ summary: 'تسجيل مخرجات مرحلة إنتاج مكتملة' })
  async recordStageOutput(
    @Param('id', ParseUUIDPipe) workOrderId: string,
    @Body() body: RecordStageOutputDto,
    @CurrentUser('id') actorId: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const result = await this.workflowService.recordStageOutput(
      { workOrderId, ...body, idempotencyKey },
      actorId,
    );
    return {
      workOrderId,
      stage: body.stage,
      status: 'COMPLETED',
      replayed: result.replayed,
      stageRunId: result.stageRunId,
    };
  }

  @Post('work-orders/:id/material-consumptions')
  @Roles(
    UserRole.PRODUCTION_MANAGER,
    UserRole.INVENTORY_MANAGER,
    UserRole.GENERAL_MANAGER,
  )
  @ApiOperation({ summary: 'تسجيل استهلاك خامة فعلي لمرحلة إنتاج' })
  async consumeMaterial(
    @Param('id', ParseUUIDPipe) workOrderId: string,
    @Body() body: ConsumeMaterialDto,
    @CurrentUser('id') actorId: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.workflowService.consumeMaterial(
      { workOrderId, ...body, idempotencyKey },
      actorId,
    );
  }

  @Post('work-orders/:id/cost/finalize')
  @Roles(UserRole.PRODUCTION_MANAGER, UserRole.GENERAL_MANAGER)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description: 'RES-F02: مفتاح إعادة المحاولة الآمنة لتثبيت التكلفة',
  })
  @ApiOperation({ summary: 'تثبيت لقطة تكلفة المواد لأمر التشغيل' })
  async finalizeCost(
    @Param('id', ParseUUIDPipe) workOrderId: string,
    @CurrentUser('id') actorId: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.workflowService.finalizeCost(
      workOrderId,
      actorId,
      idempotencyKey,
    );
  }
}
