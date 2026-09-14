import { Module } from '@nestjs/common';
import { SystemModule } from '../system/system.module';
import { ExportsController } from './exports.controller';
import { ExportsService } from './exports.service';

/**
 * SELIM-ERP W3 — وحدة التصدير (Excel/Word). تستورد SystemModule
 * لأجل FactorySettingsService (ترويسة المصنع في الملفات المصدَّرة).
 */
@Module({
  imports: [SystemModule],
  providers: [ExportsService],
  controllers: [ExportsController],
  exports: [ExportsService],
})
export class ExportsModule {}
