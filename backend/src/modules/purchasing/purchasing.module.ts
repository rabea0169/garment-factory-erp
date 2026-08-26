import { Module } from '@nestjs/common';
import { PurchasingService } from './purchasing.service';
import { PurchasingController } from './purchasing.controller';
import { InventoryModule } from '../inventory/inventory.module';
import { FinancialModule } from '../../core/financial/financial.module';

@Module({
  imports: [InventoryModule, FinancialModule],
  providers: [PurchasingService],
  controllers: [PurchasingController],
})
export class PurchasingModule {}
