import { Module } from '@nestjs/common';
import { SequenceModule } from '../../core/sequence/sequence.module';
import { ShiftsController } from './shifts.controller';
import { ShiftsService } from './shifts.service';

/**
 * SELIM-ERP W1 — وحدة الورديات: جلسات رقابة نقدية POS بترقيم SHF-0001
 * (فتح → إغلاق بفرق محسوب على الخادم — بلا قيود مالية كما في Selim).
 */
@Module({
  imports: [SequenceModule],
  providers: [ShiftsService],
  controllers: [ShiftsController],
  exports: [ShiftsService],
})
export class ShiftsModule {}
