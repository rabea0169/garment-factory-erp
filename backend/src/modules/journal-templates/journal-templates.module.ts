import { Module } from '@nestjs/common';
import { FinancialModule } from '../../core/financial/financial.module';
import { JournalTemplatesService } from './journal-templates.service';
import { JournalTemplatesController } from './journal-templates.controller';

/**
 * SELIM-ERP W1 — وحدة قوالب القيود المتكررة: قيود جاهزة (إيجار/رواتب/
 * عمولات...) تُرحَّل بنقرة واحدة عبر محرك القيد المزدوج الموحد
 * (FinancialPostingService) — لا مسار ترحيل موازٍ.
 */
@Module({
  imports: [FinancialModule],
  providers: [JournalTemplatesService],
  controllers: [JournalTemplatesController],
  exports: [JournalTemplatesService],
})
export class JournalTemplatesModule {}
