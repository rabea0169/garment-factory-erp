import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { QualityService } from './quality.service';
import { ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/roles.guard';
import { CreateQualityCheckDto } from './dto/create-quality-check.dto';
import { PaginationDto } from '../../common/dto/pagination.dto';

@ApiTags('Quality Control (مراقبة الجودة)')
@Controller('quality')
export class QualityController {
  constructor(private readonly qualityService: QualityService) {}

  @Get()
  async getChecks(@Query() pagination: PaginationDto = new PaginationDto()) {
    return this.qualityService.getQualityChecks(pagination);
  }

  @Post()
  @Roles(UserRole.PRODUCTION_MANAGER, UserRole.GENERAL_MANAGER)
  async addCheck(@Body() body: CreateQualityCheckDto) {
    return this.qualityService.addQualityCheck(body);
  }
}
