import { Module } from '@nestjs/common';
import { PrintingService } from './printing.service';
import { PrintingController } from './printing.controller';

/**
 * SELIM-ERP W1 — وحدة الطباعة: قوالب الطباعة لكل مستند × حجم ورق
 * (بواقع قالب افتراضي واحد لكل زوج) + سجل طباعة بلقطات للتدقيق.
 * PrismaModule عالمي (@Global) — لا حاجة لاستيراده هنا.
 */
@Module({
  providers: [PrintingService],
  controllers: [PrintingController],
  exports: [PrintingService],
})
export class PrintingModule {}
