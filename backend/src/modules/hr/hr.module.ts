import { Module } from '@nestjs/common';
import { FinancialModule } from '../../core/financial/financial.module';
import { HrController } from './hr.controller';
import { HrService } from './hr.service';

@Module({
  imports: [FinancialModule],
  controllers: [HrController],
  providers: [HrService],
})
export class HrModule {}
