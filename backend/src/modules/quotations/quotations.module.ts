import { Module } from '@nestjs/common';
import { SequenceModule } from '../../core/sequence/sequence.module';
import { FinancialModule } from '../../core/financial/financial.module';
import { QuotationsService } from './quotations.service';
import { QuotationsController } from './quotations.controller';

/**
 * SELIM-ERP W1 — وحدة عروض الأسعار: دورة حياة عرض سعر (مسودة → إرسال →
 * قبول → تحويل لأمر بيع) بترقيم تسلسلي QUO-0001.
 */
@Module({
  imports: [SequenceModule, FinancialModule],
  providers: [QuotationsService],
  controllers: [QuotationsController],
  exports: [QuotationsService],
})
export class QuotationsModule {}
