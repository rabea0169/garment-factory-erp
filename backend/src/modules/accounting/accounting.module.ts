import { Module } from '@nestjs/common';
import { AccountingController } from './accounting.controller';
import { AccountingService } from './accounting.service';
import { FinancialModule } from '../../core/financial/financial.module';

@Module({
  imports: [FinancialModule],
  controllers: [AccountingController],
  providers: [AccountingService],
})
export class AccountingModule {}
