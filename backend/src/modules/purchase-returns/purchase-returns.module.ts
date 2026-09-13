import { Module } from '@nestjs/common';
import { SequenceModule } from '../../core/sequence/sequence.module';
import { FinancialModule } from '../../core/financial/financial.module';
import { InventoryModule } from '../inventory/inventory.module';
import { PurchaseReturnsService } from './purchase-returns.service';
import { PurchaseReturnsController } from './purchase-returns.controller';

/**
 * SELIM-ERP W1 — وحدة مرتجع المشتريات: إرجاع خامات للمورد بخصم رصيد
 * المورد (credit) أو استرداد نقدي (cash)، بترقيم PRR-0001 وقيد عكسي
 * وحركة مخزون ذرّية داخل معاملة الإنشاء.
 */
@Module({
  imports: [SequenceModule, FinancialModule, InventoryModule],
  providers: [PurchaseReturnsService],
  controllers: [PurchaseReturnsController],
  exports: [PurchaseReturnsService],
})
export class PurchaseReturnsModule {}
