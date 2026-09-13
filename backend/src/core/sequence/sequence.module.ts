import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { SequenceService } from './sequence.service';

/**
 * SELIM-ERP W1 — وحدة الترقيم التسلسلي: تصدّر SequenceService لكل
 * وحدات Selim الجديدة (عروض الأسعار، مرتجع المشتريات، التسويات، ...).
 * وحدة صغيرة عمدًا بلا كنترولر — خدمة داخلية بحتة.
 */
@Module({
  imports: [PrismaModule],
  providers: [SequenceService],
  exports: [SequenceService],
})
export class SequenceModule {}
