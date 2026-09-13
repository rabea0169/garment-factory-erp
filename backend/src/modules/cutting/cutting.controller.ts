import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.guard';
import { CreateColorDto, UpdateColorDto } from './dto/color.dto';
import { CreateSizeGroupDto, UpdateSizeGroupDto } from './dto/size-group.dto';
import { CreateCuttingOrderDto } from './dto/create-cutting-order.dto';
import { QueryCuttingOrderDto } from './dto/query-cutting-order.dto';
import { ActivateCuttingOrderDto } from './dto/activate-cutting-order.dto';
import { CuttingService } from './cutting.service';

/**
 * SELIM-ERP W1 — كنترولر القص (يقلد /api/cutting في Selim ERP):
 * الألوان + مجموعات المقاسات + أوامر القص (DRAFT → ACTIVE → REVERSED).
 *
 * الأدوار: إنتاج (صاحب العملية) + مخازن (حركات الرصيد) + إدارة عامة.
 * السوبر أدمن يتجاوز دائمًا (سلوك RolesGuard العام).
 */
@ApiTags('Cutting (القص: ألوان/مقاسات/أوامر)')
@Controller('cutting')
export class CuttingController {
  constructor(private readonly cuttingService: CuttingService) {}

  // ---------------- الألوان ----------------

  @Get('colors')
  @Roles(
    UserRole.PRODUCTION_MANAGER,
    UserRole.INVENTORY_MANAGER,
    UserRole.GENERAL_MANAGER,
  )
  @ApiOperation({ summary: 'قائمة الألوان النشطة (مع المعطلة اختياريًا)' })
  async listColors(@Query('includeInactive') includeInactive?: string) {
    return this.cuttingService.listColors(includeInactive === 'true');
  }

  @Post('colors')
  @Roles(
    UserRole.PRODUCTION_MANAGER,
    UserRole.INVENTORY_MANAGER,
    UserRole.GENERAL_MANAGER,
  )
  @ApiOperation({ summary: 'إنشاء لون — الاسم فريد وhex بصيغة #RRGGBB' })
  async createColor(@Body() dto: CreateColorDto) {
    return this.cuttingService.createColor(dto);
  }

  @Patch('colors/:id')
  @Roles(
    UserRole.PRODUCTION_MANAGER,
    UserRole.INVENTORY_MANAGER,
    UserRole.GENERAL_MANAGER,
  )
  @ApiOperation({ summary: 'تعديل لون' })
  async updateColor(@Param('id') id: string, @Body() dto: UpdateColorDto) {
    return this.cuttingService.updateColor(id, dto);
  }

  @Delete('colors/:id')
  @Roles(
    UserRole.PRODUCTION_MANAGER,
    UserRole.INVENTORY_MANAGER,
    UserRole.GENERAL_MANAGER,
  )
  @ApiOperation({ summary: 'حذف لون — منطقي (isActive=false)' })
  async removeColor(@Param('id') id: string) {
    return this.cuttingService.removeColor(id);
  }

  // ---------------- مجموعات المقاسات ----------------

  @Get('size-groups')
  @Roles(
    UserRole.PRODUCTION_MANAGER,
    UserRole.INVENTORY_MANAGER,
    UserRole.GENERAL_MANAGER,
  )
  @ApiOperation({ summary: 'قائمة مجموعات المقاسات النشطة' })
  async listSizeGroups(@Query('includeInactive') includeInactive?: string) {
    return this.cuttingService.listSizeGroups(includeInactive === 'true');
  }

  @Post('size-groups')
  @Roles(
    UserRole.PRODUCTION_MANAGER,
    UserRole.INVENTORY_MANAGER,
    UserRole.GENERAL_MANAGER,
  )
  @ApiOperation({
    summary: 'إنشاء مجموعة مقاسات — الاسم فريد ومقاس واحد على الأقل',
  })
  async createSizeGroup(@Body() dto: CreateSizeGroupDto) {
    return this.cuttingService.createSizeGroup(dto);
  }

  @Patch('size-groups/:id')
  @Roles(
    UserRole.PRODUCTION_MANAGER,
    UserRole.INVENTORY_MANAGER,
    UserRole.GENERAL_MANAGER,
  )
  @ApiOperation({ summary: 'تعديل مجموعة مقاسات' })
  async updateSizeGroup(
    @Param('id') id: string,
    @Body() dto: UpdateSizeGroupDto,
  ) {
    return this.cuttingService.updateSizeGroup(id, dto);
  }

  @Delete('size-groups/:id')
  @Roles(
    UserRole.PRODUCTION_MANAGER,
    UserRole.INVENTORY_MANAGER,
    UserRole.GENERAL_MANAGER,
  )
  @ApiOperation({ summary: 'حذف مجموعة مقاسات — منطقي' })
  async removeSizeGroup(@Param('id') id: string) {
    return this.cuttingService.removeSizeGroup(id);
  }

  // ---------------- أوامر القص ----------------

  @Post('orders')
  @Roles(
    UserRole.PRODUCTION_MANAGER,
    UserRole.INVENTORY_MANAGER,
    UserRole.GENERAL_MANAGER,
  )
  @ApiOperation({
    summary:
      'إنشاء أمر قص مسودة — الكميات والإجماليات تُحسب على الخادم (لا حركات مخزون)',
  })
  async create(
    @Body() dto: CreateCuttingOrderDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.cuttingService.create(dto, user.id);
  }

  @Get('orders')
  @Roles(
    UserRole.PRODUCTION_MANAGER,
    UserRole.INVENTORY_MANAGER,
    UserRole.GENERAL_MANAGER,
  )
  @ApiOperation({
    summary: 'قائمة أوامر القص بمرشحات الحالة/المنتج/العامل/التاريخ',
  })
  async findAll(
    @Query() query: QueryCuttingOrderDto = new QueryCuttingOrderDto(),
  ) {
    return this.cuttingService.findAll(query);
  }

  @Get('orders/:id')
  @Roles(
    UserRole.PRODUCTION_MANAGER,
    UserRole.INVENTORY_MANAGER,
    UserRole.GENERAL_MANAGER,
  )
  @ApiOperation({ summary: 'تفاصيل أمر قص ببنوده وروابطه' })
  async findOne(@Param('id') id: string) {
    return this.cuttingService.findOne(id);
  }

  @Post('orders/:id/activate')
  @Roles(
    UserRole.PRODUCTION_MANAGER,
    UserRole.INVENTORY_MANAGER,
    UserRole.GENERAL_MANAGER,
  )
  @ApiOperation({
    summary:
      'تفعيل أمر القص — صرف رصيد الموديل وإدخال التوليفات وأجر العامل في معاملة واحدة',
  })
  async activate(
    @Param('id') id: string,
    @Body() dto: ActivateCuttingOrderDto = new ActivateCuttingOrderDto(),
    @CurrentUser() user: { id: string },
  ) {
    return this.cuttingService.activate(id, dto, user.id);
  }

  @Post('orders/:id/reverse')
  @Roles(
    UserRole.PRODUCTION_MANAGER,
    UserRole.INVENTORY_MANAGER,
    UserRole.GENERAL_MANAGER,
  )
  @ApiOperation({
    summary: 'عكس أمر قص مفعّل — رد كل الحركات من دفتر المخزون وحذف سجل الأجر',
  })
  async reverse(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.cuttingService.reverse(id, user.id);
  }
}
