import { Module } from '@nestjs/common';
import { PurchasingService } from './purchasing.service';
import { PurchasingController } from './purchasing.controller';
import { SuppliersController } from './suppliers.controller';
import { SuppliersService } from './suppliers.service';
import { InventoryModule } from '../inventory/inventory.module';
import { FinancialModule } from '../../core/financial/financial.module';

@Module({
  imports: [InventoryModule, FinancialModule],
  providers: [PurchasingService, SuppliersService],
  controllers: [PurchasingController, SuppliersController],
})
export class PurchasingModule {}
