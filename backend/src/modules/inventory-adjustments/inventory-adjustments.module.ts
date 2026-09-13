import { Module } from '@nestjs/common';
import { SequenceModule } from '../../core/sequence/sequence.module';
import { FinancialModule } from '../../core/financial/financial.module';
import { InventoryModule } from '../inventory/inventory.module';
import { InventoryAdjustmentsService } from './inventory-adjustments.service';
import { InventoryAdjustmentsController } from './inventory-adjustments.controller';

/**
 * SELIM-ERP W1 — وحدة تسويات الجرد: جرد فعلي مقابل رصيد النظام بمسودة
 * → اعتماد/رفض، بترقيم ADJ-0001 وتطبيق الفروق عبر محرك المخزون الموحد
 * مع ترحيل قيود GL لكل بند.
 */
@Module({
  imports: [SequenceModule, FinancialModule, InventoryModule],
  providers: [InventoryAdjustmentsService],
  controllers: [InventoryAdjustmentsController],
  exports: [InventoryAdjustmentsService],
})
export class InventoryAdjustmentsModule {}
