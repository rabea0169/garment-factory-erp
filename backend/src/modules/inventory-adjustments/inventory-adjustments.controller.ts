import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.guard';
import {
  CreateInventoryAdjustmentDto,
  RejectAdjustmentDto,
} from './dto/create-inventory-adjustment.dto';
import { QueryInventoryAdjustmentDto } from './dto/query-inventory-adjustment.dto';
import { InventoryAdjustmentsService } from './inventory-adjustments.service';

/**
 * SELIM-ERP W1 — كنترولر تسويات الجرد (يقلد /api/inventory-adjustments
 * في Selim ERP).
 *
 * الأدوار (اتباع تفويض المخزون في المشروع الحالي):
 * - القراءة: مخزون + إدارة عامة + محاسبة (القيم المالية في بنود التسوية).
 * - الإنشاء (مسودة بلا أثر): مخزون + إدارة عامة.
 * - الاعتماد/الرفض (يحرك المخزون والقيود): مخزون + إدارة عامة.
 * - الحذف (مسودة فقط): مخزون + إدارة عامة.
 */
@ApiTags('Inventory Adjustments (تسويات الجرد)')
@Controller('inventory-adjustments')
export class InventoryAdjustmentsController {
  constructor(
    private readonly inventoryAdjustmentsService: InventoryAdjustmentsService,
  ) {}

  @Get()
  @Roles(
    UserRole.INVENTORY_MANAGER,
    UserRole.GENERAL_MANAGER,
    UserRole.ACCOUNTANT,
    UserRole.SUPER_ADMIN,
  )
  @ApiOperation({
    summary: 'قائمة تسويات الجرد بفلترة حالة/مخزن/تاريخ + ترقيم',
  })
  async findAll(
    @Query()
    query: QueryInventoryAdjustmentDto = new QueryInventoryAdjustmentDto(),
  ) {
    return this.inventoryAdjustmentsService.findAll(query);
  }

  @Get(':id')
  @Roles(
    UserRole.INVENTORY_MANAGER,
    UserRole.GENERAL_MANAGER,
    UserRole.ACCOUNTANT,
    UserRole.SUPER_ADMIN,
  )
  @ApiOperation({ summary: 'تفاصيل تسوية ببنودها وفروقها المحسوبة' })
  async findOne(@Param('id') id: string) {
    return this.inventoryAdjustmentsService.findOne(id);
  }

  @Post()
  @Roles(
    UserRole.INVENTORY_MANAGER,
    UserRole.GENERAL_MANAGER,
    UserRole.SUPER_ADMIN,
  )
  @ApiOperation({
    summary:
      'إنشاء مسودة تسوية جرد — الفروق والقيم تُحسب على الخادم من رصيد النظام',
  })
  async create(
    @Body() dto: CreateInventoryAdjustmentDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.inventoryAdjustmentsService.create(dto, user.id);
  }

  @Post(':id/approve')
  @Roles(
    UserRole.INVENTORY_MANAGER,
    UserRole.GENERAL_MANAGER,
    UserRole.SUPER_ADMIN,
  )
  @ApiOperation({
    summary: 'اعتماد تسوية (DRAFT فقط): تطبيق الفروق على المخزون وترحيل القيود',
  })
  async approve(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.inventoryAdjustmentsService.approve(id, user.id);
  }

  @Post(':id/reject')
  @Roles(
    UserRole.INVENTORY_MANAGER,
    UserRole.GENERAL_MANAGER,
    UserRole.SUPER_ADMIN,
  )
  @ApiOperation({
    summary: 'رفض تسوية (DRAFT فقط) بسبب إلزامي — بلا أثر مخزوني',
  })
  async reject(@Param('id') id: string, @Body() dto: RejectAdjustmentDto) {
    return this.inventoryAdjustmentsService.reject(id, dto.reason);
  }

  @Delete(':id')
  @Roles(
    UserRole.INVENTORY_MANAGER,
    UserRole.GENERAL_MANAGER,
    UserRole.SUPER_ADMIN,
  )
  @ApiOperation({ summary: 'حذف مسودة تسوية — DRAFT فقط' })
  async remove(@Param('id') id: string) {
    return this.inventoryAdjustmentsService.remove(id);
  }
}
