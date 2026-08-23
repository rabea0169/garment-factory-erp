import { Controller, Get, Post, Body } from '@nestjs/common';
import { QualityService } from './quality.service';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('Quality Control (مراقبة الجودة)')
@Controller('quality')
export class QualityController {
  constructor(private readonly qualityService: QualityService) {}

  @Get()
  async getChecks() {
    return this.qualityService.getQualityChecks();
  }

  @Post()
  async addCheck(@Body() body: any) {
    return this.qualityService.addQualityCheck(body);
  }
}
