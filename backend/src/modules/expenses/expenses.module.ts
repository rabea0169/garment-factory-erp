import { Module } from '@nestjs/common';
import { FinancialModule } from '../../core/financial/financial.module';
import { ExpensesService } from './expenses.service';
import { ExpensesController } from './expenses.controller';

/**
 * SELIM-ERP W1 — وحدة المصاريف وبنودها: مصروف ببند (EXC) ولقطة اسم،
 * مع مسار خزينة ذرّي (خصم رصيد + قيد Dr GENERAL_EXPENSE / Cr CASH في
 * معاملة واحدة) أو سجل بسيط بلا قيد — نفس سلوك Selim ERP.
 */
@Module({
  imports: [FinancialModule],
  providers: [ExpensesService],
  controllers: [ExpensesController],
  exports: [ExpensesService],
})
export class ExpensesModule {}
