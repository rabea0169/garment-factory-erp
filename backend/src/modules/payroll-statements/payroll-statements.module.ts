import { Module } from '@nestjs/common';
import { SequenceModule } from '../../core/sequence/sequence.module';
import { FinancialModule } from '../../core/financial/financial.module';
import { PayrollStatementsController } from './payroll-statements.controller';
import { PayrollStatementsService } from './payroll-statements.service';

/**
 * SELIM-ERP W1 — وحدة كشوف الرواتب المجمدة: PSM-0001، تجميع كشوف الشهر
 * في لقطة JSON، وترحيل بقيد واحد يعلمها مدفوعة (دورة DRAFT → POSTED).
 */
@Module({
  imports: [SequenceModule, FinancialModule],
  providers: [PayrollStatementsService],
  controllers: [PayrollStatementsController],
  exports: [PayrollStatementsService],
})
export class PayrollStatementsModule {}
