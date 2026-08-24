import { Controller, Get, Post, Body } from '@nestjs/common';
import { QualityService } from './quality.service';
import { ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
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
  async addCheck(@Body() body: any) {
    return this.qualityService.addQualityCheck(body);
  }
}
