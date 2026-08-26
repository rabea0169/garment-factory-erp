import { Module } from '@nestjs/common';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { FinancialModule } from '../../core/financial/financial.module';

@Module({
  imports: [FinancialModule],
  controllers: [InventoryController],
  providers: [InventoryService],
  exports: [InventoryService, FinancialModule],
})
export class InventoryModule {}
