import { Module } from '@nestjs/common';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

/**
 * SELIM-ERP W2 — وحدة البحث الشامل (تقلد global search + command palette
 * في Selim ERP: Ctrl+K يبحث عبر كل الأقسام وينتقل للكيان).
 *
 * وحدة قراءة صرفة: لا معاملات، لا قيود، لا أحداث — استعلامات LIMIT محدودة
 * لكل نوع كيان مع تصفية الأدوار (نفس أدوار قراءة كل وحدة أصلها).
 */
@Module({
  providers: [SearchService],
  controllers: [SearchController],
  exports: [SearchService],
})
export class SearchModule {}
