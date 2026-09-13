import { Module } from '@nestjs/common';
import { SequenceModule } from '../../core/sequence/sequence.module';
import { FinancialModule } from '../../core/financial/financial.module';
import { WorkerReceiptsController } from './worker-receipts.controller';
import { WorkerReceiptsService } from './worker-receipts.service';

/**
 * SELIM-ERP W1 — وحدة سندات قبض العمال: WRC-0001 + قيد استرداد سلف
 * (مدين نقدية / دائن سلف العمال) + حرس رصيد الخزينة الشرطي.
 */
@Module({
  imports: [SequenceModule, FinancialModule],
  providers: [WorkerReceiptsService],
  controllers: [WorkerReceiptsController],
  exports: [WorkerReceiptsService],
})
export class WorkerReceiptsModule {}
