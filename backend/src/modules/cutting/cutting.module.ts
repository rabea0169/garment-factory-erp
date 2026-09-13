import { Module } from '@nestjs/common';
import { SequenceModule } from '../../core/sequence/sequence.module';
import { InventoryModule } from '../inventory/inventory.module';
import { CuttingController } from './cutting.controller';
import { PackingController } from './packing.controller';
import { CuttingService } from './cutting.service';
import { PackingService } from './packing.service';

/**
 * SELIM-ERP W1 — وحدة القص والعبوات (تقلد Cutting + Packing في Selim ERP):
 * - الألوان ومجموعات المقاسات (مراجع القص).
 * - أوامر القص CUT-0001: DRAFT → ACTIVE (صرف/إدخال مخزون + أجر) → REVERSED.
 * - العبوات PACK-0001: تعريف + بناء/تفكيك بحركات مكونات موثقة بالتدقيق.
 *
 * تعتمد على InventoryService (issue/receiveFinishedGood بمعاملة خارجية)
 * — مستوردة من InventoryModule الجاهز بلا أي تعديل عليه.
 */
@Module({
  imports: [SequenceModule, InventoryModule],
  providers: [CuttingService, PackingService],
  controllers: [CuttingController, PackingController],
  exports: [CuttingService, PackingService],
})
export class CuttingModule {}
