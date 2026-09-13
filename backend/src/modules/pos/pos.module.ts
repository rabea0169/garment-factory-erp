import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { FinancialModule } from '../../core/financial/financial.module';
import { PosController } from './pos.controller';
import { PosService } from './pos.service';

/**
 * SELIM-ERP W2 — وحدة نقطة البيع (بيع سريع + كتالوج + حل الباركود).
 *
 * تستورد InventoryModule (bulkIssueFinishedGoods) وFinancialModule
 * (postJournalEntryInTx) — نفس تبعيات مسار تأكيد المبيعات.
 */
@Module({
  imports: [InventoryModule, FinancialModule],
  providers: [PosService],
  controllers: [PosController],
  exports: [PosService],
})
export class PosModule {}
