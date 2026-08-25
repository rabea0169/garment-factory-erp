import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { InventoryService } from './inventory.service';
import { Roles } from '../auth/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AddStockDto } from './dto/add-stock.dto';
import { ReceiveStockDto } from './dto/receive-stock.dto';
import { IssueStockDto } from './dto/issue-stock.dto';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { WasteStockDto } from './dto/waste-stock.dto';
import { LedgerQueryDto } from './dto/ledger-query.dto';
import { PaginationDto } from '../../common/dto/pagination.dto';

/**
 * GF-0007 — مسارات المخزون على أساس الـ ledger:
 * - كل عمليات الكتابة مقيّدة بـ INVENTORY_MANAGER (وSUPER_ADMIN يتجاوز دائمًا).
 * - الهوية من الجلسة (@CurrentUser) — عمود createdById في الـ ledger.
 * - مفتاح Idempotency-Key اختياري في الترويسة: نفس المفتاح + نفس المحتوى =
 *   نفس الاستجابة بلا أثر مزدوج (مفيد لـ retry من الهاتف).
 */
@ApiTags('Inventory (المخزون)')
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get('raw-materials')
  @ApiOperation({ summary: 'الحصول على جميع المواد الخام' })
  async getRawMaterials(@Query() pagination: PaginationDto) {
    return this.inventoryService.getAllRawMaterials(pagination);
  }

  @Get('raw-materials/low-stock')
  @ApiOperation({ summary: 'المواد الخام التي قاربت على الانتهاء' })
  async getLowStockMaterials(@Query() pagination: PaginationDto) {
    return this.inventoryService.getLowStockMaterials(pagination);
  }

  @Post('raw-materials/:id/add-stock')
  @Roles(UserRole.INVENTORY_MANAGER)
  @ApiOperation({
    summary:
      'إضافة رصيد لمادة خام (مسار قديم — يمر عبر ledger في مخزن الخامات الافتراضي)',
  })
  async addStock(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AddStockDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.inventoryService.addRawMaterialStock(
      id,
      body.quantity,
      body.costPerUnit,
      userId,
    );
  }

  // ===================== GF-0007: WAREHOUSES / LEDGER / MOVEMENTS =====================

  @Get('warehouses')
  @ApiOperation({ summary: 'المخازن النشطة' })
  async getWarehouses(@Query() pagination: PaginationDto) {
    return this.inventoryService.getWarehouses(pagination);
  }

  @Get('ledger')
  @ApiOperation({
    summary: 'سجل حركات المخزون بمرشحات خامة/مخزن/نوع/فترة',
  })
  async getLedger(@Query() query: LedgerQueryDto) {
    return this.inventoryService.getLedgerEntries(query);
  }

  @Post('movements/receive')
  @Roles(UserRole.INVENTORY_MANAGER)
  @ApiOperation({
    summary: 'استلام خامات في مخزن — يعيد احتساب التكلفة بمتوسط مرجح',
  })
  async receive(
    @Body() body: ReceiveStockDto,
    @CurrentUser('id') userId: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.inventoryService.receive({ ...body, idempotencyKey }, userId);
  }

  @Post('movements/issue')
  @Roles(UserRole.INVENTORY_MANAGER)
  @ApiOperation({
    summary: 'صرف خامات من مخزن (للإنتاج/البيع) — يرفض تجاوز الرصيد',
  })
  async issue(
    @Body() body: IssueStockDto,
    @CurrentUser('id') userId: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.inventoryService.issue({ ...body, idempotencyKey }, userId);
  }

  @Post('movements/adjust')
  @Roles(UserRole.INVENTORY_MANAGER)
  @ApiOperation({
    summary: 'تسوية جرد (±) — السبب إلزامي، ولا تُظهر الرصيد سالبًا',
  })
  async adjust(
    @Body() body: AdjustStockDto,
    @CurrentUser('id') userId: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.inventoryService.adjust({ ...body, idempotencyKey }, userId);
  }

  @Post('movements/waste')
  @Roles(UserRole.INVENTORY_MANAGER)
  @ApiOperation({
    summary: 'تسجيل هدر/تالف — السبب إلزامي وبقيمة التكلفة الحالية',
  })
  async waste(
    @Body() body: WasteStockDto,
    @CurrentUser('id') userId: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.inventoryService.waste({ ...body, idempotencyKey }, userId);
  }

  // ===================== FINISHED GOODS / SUMMARY =====================

  @Get('finished-goods')
  @ApiOperation({ summary: 'الحصول على المنتجات التامة الصنع' })
  async getFinishedGoods(@Query() pagination: PaginationDto) {
    return this.inventoryService.getAllFinishedGoods(pagination);
  }

  @Get('summary')
  @ApiOperation({ summary: 'إحصائيات المخزون للوحة التحكم' })
  async getSummary() {
    return this.inventoryService.getDashboardSummary();
  }
}
