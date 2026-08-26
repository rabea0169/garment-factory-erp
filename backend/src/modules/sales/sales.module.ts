import { Module } from '@nestjs/common';
import { SalesService } from './sales.service';
import { SalesController } from './sales.controller';
import { InventoryModule } from '../inventory/inventory.module';
import { FinancialModule } from '../../core/financial/financial.module';

@Module({
  imports: [InventoryModule, FinancialModule],
  providers: [SalesService],
  controllers: [SalesController],
})
export class SalesModule {}
