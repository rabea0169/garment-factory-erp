import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../modules/auth/public.decorator';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

/**
 * C9: health endpoint — يستخدمه الـ orchestrator (Docker/K8s) للتحقق من
 * صحة العملية دون الحاجة لمصادقة. يُعطي فقط معلومات عامة (لا أسرار).
 */
@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @SkipThrottle()
  @Get()
  @ApiOperation({ summary: 'فحص الصحة (للorchestrator)' })
  health() {
    return {
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }

  @Public()
  @SkipThrottle()
  @Get('ready')
  @ApiOperation({ summary: 'فحص الجاهزية واتصال قاعدة البيانات' })
  async readiness() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return {
        status: 'ok',
        database: 'ok',
        timestamp: new Date().toISOString(),
      };
    } catch {
      throw new ServiceUnavailableException('قاعدة البيانات غير جاهزة');
    }
  }
}
