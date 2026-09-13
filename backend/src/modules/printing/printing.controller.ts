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
import {
  CreatePrintTemplateDto,
  QueryPrintTemplateDto,
} from './dto/create-print-template.dto';
import { UpdatePrintTemplateDto } from './dto/update-print-template.dto';
import { LogPrintDto, QueryPrintLogDto } from './dto/log-print.dto';
import { PrintingService } from './printing.service';

/**
 * SELIM-ERP W1 — كنترولر الطباعة (يقلد /api/printing في Selim ERP).
 *
 * الأدوار (اتساقًا مع تفويض المشروع — الحارس العام يفرض المصادقة):
 * - قراءة القوالب + تحديد الافتراضي + تسجيل الطباعة: كل الأدوار المصادقة
 *   (الطباعة وظيفة تشغيلية يومية لكل مستخدم — الكاشير والمخزن والإنتاج
 *   يطبعون مستنداتهم). لا @Roles → أي مستخدم موثّق (سلوك RolesGuard).
 * - إدارة القوالب (إنشاء/تعديل/حذف/بذرة): محاسبة + مدير عام (+SUPER_ADMIN
 *   يتجاوز في RolesGuard أصلًا — يُصرَّح به للوثائق).
 * - سجل الطباعة (تدقيق): محاسبة + مدير عام (+SUPER_ADMIN) — عرض إداري.
 */
@ApiTags('Printing (الطباعة)')
@Controller('printing')
export class PrintingController {
  constructor(private readonly printingService: PrintingService) {}

  @Get('templates')
  @ApiOperation({
    summary: 'قائمة قوالب الطباعة بفلترة مستند/ورق/حالة — لكل المستخدمين',
  })
  async findAll(
    @Query() query: QueryPrintTemplateDto = new QueryPrintTemplateDto(),
  ) {
    return this.printingService.findAll(query);
  }

  @Get('templates/default/:documentType/:paperSize')
  @ApiOperation({
    summary: 'القالب الافتراضي لمستند × حجم ورق (404 إن لم يوجد)',
  })
  async resolveDefault(
    @Param('documentType') documentType: string,
    @Param('paperSize') paperSize: string,
  ) {
    return this.printingService.resolveDefault(documentType, paperSize);
  }

  @Get('templates/:id')
  @ApiOperation({ summary: 'تفاصيل قالب طباعة' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.printingService.findOne(id);
  }

  @Post('templates')
  @Roles(UserRole.ACCOUNTANT, UserRole.GENERAL_MANAGER, UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary:
      'إنشاء قالب — الافتراضي الواحد لكل مستند × ورق يُفرض داخل المعاملة',
  })
  async create(@Body() dto: CreatePrintTemplateDto) {
    return this.printingService.create(dto);
  }

  @Patch('templates/:id')
  @Roles(UserRole.ACCOUNTANT, UserRole.GENERAL_MANAGER, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'تعديل قالب (تعيين الافتراضية يزيل غيرها)' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePrintTemplateDto,
  ) {
    return this.printingService.update(id, dto);
  }

  @Delete('templates/:id')
  @Roles(UserRole.ACCOUNTANT, UserRole.GENERAL_MANAGER, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'حذف ناعم لقالب (isActive=false)' })
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.printingService.remove(id);
  }

  @Post('templates/seed')
  @Roles(UserRole.ACCOUNTANT, UserRole.GENERAL_MANAGER, UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'بذرة idempotent للقوالب العربية الافتراضية (كل مستند × ورق)',
  })
  async seed() {
    return this.printingService.seed();
  }

  @Post('log')
  @ApiOperation({
    summary: 'تسجيل عملية طباعة بلقطات اسم المستخدم والقالب — لكل المستخدمين',
  })
  async logPrint(
    @Body() dto: LogPrintDto,
    @CurrentUser() user: { id: string; name?: string },
  ) {
    return this.printingService.logPrint(dto, user);
  }

  @Get('log')
  @Roles(UserRole.ACCOUNTANT, UserRole.GENERAL_MANAGER, UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'سجل الطباعة (تدقيق) بفلترة مستند/مستخدم/نطاق زمني + ترقيم',
  })
  async findLogs(@Query() query: QueryPrintLogDto = new QueryPrintLogDto()) {
    return this.printingService.findLogs(query);
  }
}
