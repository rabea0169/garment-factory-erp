import { Module } from '@nestjs/common';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { StockAlertListener } from './stock-alert.listener';
import { FinancialModule } from '../../core/financial/financial.module';

@Module({
  imports: [FinancialModule],
  controllers: [InventoryController],
  // StockAlertListener (CC-8): مستمع STOCK_LOW بعد commit — يكتب ActivityLog،
  // EventSubscribersLoader (EventEmitterModule العام في AppModule) يكتشفه
  // تلقائيًا بين providers.
  providers: [InventoryService, StockAlertListener],
  exports: [InventoryService],
})
export class InventoryModule {}
