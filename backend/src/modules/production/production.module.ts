import { Module } from '@nestjs/common';
import { ProductionController } from './production.controller';
import { ProductionService } from './production.service';
import { ProductionWorkflowService } from './production-workflow.service';
import { InventoryModule } from '../inventory/inventory.module';

@Module({
  imports: [InventoryModule],
  controllers: [ProductionController],
  providers: [ProductionService, ProductionWorkflowService],
  exports: [ProductionWorkflowService],
})
export class ProductionModule {}
