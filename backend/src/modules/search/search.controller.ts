import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/current-user.decorator';
import { SearchService } from './search.service';

/**
 * SELIM-ERP W2 — كنترولر البحث الشامل (Ctrl+K في Selim ERP).
 *
 * لا @Roles — أي مستخدم موثّق يبحث؛ الخدمة تصفي المجموعات بحسب دور
 * المستخدم (نفس أدوار قراءة كل وحدة أصل — انظر search.service.ts).
 */
@ApiTags('Search (البحث الشامل)')
@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  @ApiOperation({
    summary: 'بحث شامل عابر للأقسام — نتائج مجمعة بحسب النوع (5 لكل نوع)',
  })
  async search(
    @Query('q') q: string = '',
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    return this.searchService.search(q, user.role);
  }
}
