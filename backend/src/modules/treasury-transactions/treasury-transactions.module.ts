import { Module } from '@nestjs/common';
import { SequenceModule } from '../../core/sequence/sequence.module';
import { FinancialModule } from '../../core/financial/financial.module';
import { TreasuryTransactionsService } from './treasury-transactions.service';
import { TreasuryTransactionsController } from './treasury-transactions.controller';

/**
 * SELIM-ERP W1 — وحدة حركات الخزينة: إيداع/سحب/تحويل بترقيم TRT-0001
 * وتحديث أرصدة وقيد مالي ذرّي داخل معاملة واحدة (التحويل الداخلي بلا
 * قيد GL — حركة بين حسابات نقدية).
 */
@Module({
  imports: [SequenceModule, FinancialModule],
  providers: [TreasuryTransactionsService],
  controllers: [TreasuryTransactionsController],
  exports: [TreasuryTransactionsService],
})
export class TreasuryTransactionsModule {}
