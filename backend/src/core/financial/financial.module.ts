import { Module } from '@nestjs/common';
import { FinancialPostingService } from './financial-posting.service';

/**
 * A1/A2/A3 + E4/E1: الوحدة المحورية للقيد المزدوج.
 * تُستورد من أي موديول يُحرّك الحالة المالية (المبيعات، المحاسبة، المشتريات).
 */
@Module({
  providers: [FinancialPostingService],
  exports: [FinancialPostingService],
})
export class FinancialModule {}
