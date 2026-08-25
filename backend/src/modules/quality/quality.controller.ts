import { Controller, Get, Post, Body } from '@nestjs/common';
import { QualityService } from './quality.service';
import { ApiTags } from '@nestjs/swagger';
import { RejectionReason, UserRole, WorkOrderStatus } from '@prisma/client';
import { Roles } from '../auth/roles.guard';

@ApiTags('Quality Control (مراقبة الجودة)')
@Controller('quality')
export class QualityController {
  constructor(private readonly qualityService: QualityService) {}

  @Get()
  async getChecks() {
    return this.qualityService.getQualityChecks();
  }

  @Post()
  @Roles(UserRole.PRODUCTION_MANAGER, UserRole.GENERAL_MANAGER)
  async addCheck(
    @Body()
    body: {
      workOrderId: string;
      stage: WorkOrderStatus;
      checkedQty: number;
      passedQty: number;
      rejectedQty: number;
      rejectionReason?: RejectionReason;
      notes?: string;
    },
  ) {
    return this.qualityService.addQualityCheck(body);
  }
}
