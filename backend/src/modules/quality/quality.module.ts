import { Module } from '@nestjs/common';
import { FinancialModule } from '../../core/financial/financial.module';
import { QualityController } from './quality.controller';
import { QualityService } from './quality.service';

@Module({
  // QLT-1 (P0 — GF-IMP-W1): ترحيل تكلفة هدر الجودة إلى الدفتر العام يتطلب
  // FinancialPostingService (Dr WASTE_EXPENSE / Cr WIP داخل نفس المعاملة).
  imports: [FinancialModule],
  controllers: [QualityController],
  providers: [QualityService],
})
export class QualityModule {}
