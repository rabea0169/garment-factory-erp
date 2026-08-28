import { Module } from '@nestjs/common';
import { ShippingController } from './shipping.controller';
import { ShippingService } from './shipping.service';
import { InventoryModule } from '../inventory/inventory.module';
import { FinancialModule } from '../../core/financial/financial.module';

@Module({
  imports: [InventoryModule, FinancialModule],
  controllers: [ShippingController],
  providers: [ShippingService],
})
export class ShippingModule {}
