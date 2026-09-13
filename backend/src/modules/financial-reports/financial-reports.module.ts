import { Module } from '@nestjs/common';
import { FinancialReportsService } from './financial-reports.service';
import { FinancialReportsController } from './financial-reports.controller';

/**
 * SELIM-ERP W1 — وحدة التقارير المالية: قائمة الدخل، الميزانية العمومية،
 * تقرير VAT، أعمار الذمم، والميزانيات مع تباينها — كلها تجميعات قراءة
 * فوق journal_lines (نفس أسلوب ميزان المراجعة) + CRUD الميزانيات.
 * PrismaModule عالمي (@Global) — لا حاجة لاستيراده هنا.
 */
@Module({
  providers: [FinancialReportsService],
  controllers: [FinancialReportsController],
  exports: [FinancialReportsService],
})
export class FinancialReportsModule {}
