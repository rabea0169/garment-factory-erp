import { Module } from '@nestjs/common';
import { DataImportController } from './data-import.controller';
import { DataImportService } from './data-import.service';

/**
 * SELIM-ERP W2 — وحدة الاستيراد (CSV/XLSX → معاينة → تنفيذ).
 *
 * تبعية exceljs مكتبة نقية (parse في الذاكرة) — لا تؤثر على المعاملات
 * ولا تحتاج تهيئة. Multer من platform-express موجودة بالفعل.
 */
@Module({
  providers: [DataImportService],
  controllers: [DataImportController],
  exports: [DataImportService],
})
export class DataImportModule {}
