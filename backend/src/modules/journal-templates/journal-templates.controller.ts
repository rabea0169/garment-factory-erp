import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.guard';
import { CreateJournalTemplateDto } from './dto/create-journal-template.dto';
import { UpdateJournalTemplateDto } from './dto/update-journal-template.dto';
import { PostJournalTemplateDto } from './dto/post-journal-template.dto';
import { QueryJournalTemplateDto } from './dto/query-journal-template.dto';
import { JournalTemplatesService } from './journal-templates.service';

/**
 * SELIM-ERP W1 — كنترولر قوالب القيود المتكررة (يقلد /api/journal-templates
 * في Selim ERP).
 *
 * الأدوار (الميزة محاسبية بالكامل):
 * - كل المسارات: محاسبة + مدير عام (+SUPER_ADMIN يتجاوز في RolesGuard
 *   أصلًا — يُصرَّح به للوثائق).
 * - الترحيل (post) يُنشئ قيدًا ماليًا حقيقيًا — نفس أدوار إنشاء القيود
 *   اليدوية في accounting (محاسبة/مدير عام) اتساقًا.
 */
@ApiTags('Journal Templates (قوالب القيود المتكررة)')
@Controller('journal-templates')
export class JournalTemplatesController {
  constructor(
    private readonly journalTemplatesService: JournalTemplatesService,
  ) {}

  @Get()
  @Roles(UserRole.ACCOUNTANT, UserRole.GENERAL_MANAGER, UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'قائمة قوالب القيود بفلترة isRecurring + بحث في الاسم',
  })
  async findAll(
    @Query() query: QueryJournalTemplateDto = new QueryJournalTemplateDto(),
  ) {
    return this.journalTemplatesService.findAll(query);
  }

  @Get(':id/preview')
  @Roles(UserRole.ACCOUNTANT, UserRole.GENERAL_MANAGER, UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'معاينة القالب: البنود بأسماء الحسابات وأرصدتها الحالية',
  })
  async preview(@Param('id', ParseUUIDPipe) id: string) {
    return this.journalTemplatesService.preview(id);
  }

  @Get(':id')
  @Roles(UserRole.ACCOUNTANT, UserRole.GENERAL_MANAGER, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'تفاصيل قالب قيد' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.journalTemplatesService.findOne(id);
  }

  @Post()
  @Roles(UserRole.ACCOUNTANT, UserRole.GENERAL_MANAGER, UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'إنشاء قالب قيد — إلزام التوازن (Σمدين = Σدائن)',
  })
  async create(@Body() dto: CreateJournalTemplateDto) {
    return this.journalTemplatesService.create(dto);
  }

  @Post(':id/post')
  @Roles(UserRole.ACCOUNTANT, UserRole.GENERAL_MANAGER, UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary:
      'ترحيل القالب إلى قيد حقيقي عبر محرك القيد المزدوج + تحديث lastUsedAt',
  })
  async post(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PostJournalTemplateDto = new PostJournalTemplateDto(),
    @CurrentUser('id') userId: string,
  ) {
    return this.journalTemplatesService.post(id, dto, userId);
  }

  @Patch(':id')
  @Roles(UserRole.ACCOUNTANT, UserRole.GENERAL_MANAGER, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'تعديل قالب قيد — البنود تُستبدل بالكامل' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateJournalTemplateDto,
  ) {
    return this.journalTemplatesService.update(id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.ACCOUNTANT, UserRole.GENERAL_MANAGER, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'حذف قالب قيد (القيود المرحّلة سابقًا تبقى)' })
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.journalTemplatesService.remove(id);
  }
}
