import { Controller, Get } from '@nestjs/common';
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
}
