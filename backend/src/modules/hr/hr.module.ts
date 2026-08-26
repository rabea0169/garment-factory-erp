import { Module } from '@nestjs/common';
import { HrController } from './hr.controller';
import { HrService } from './hr.service';
import { FinancialModule } from '../../core/financial/financial.module';

// COMM-F03/F04: HrModule now depends on FinancialModule so HrService can
// inject FinancialPostingService for payroll accrual + cash settlement GL
// postings. Without this dependency, NestJS would fail to resolve the
// FinancialPostingService provider at HrModule bootstrap.
@Module({
  imports: [FinancialModule],
  controllers: [HrController],
  providers: [HrService],
})
export class HrModule {}
