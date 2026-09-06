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
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { InventoryService } from './inventory.service';
import { Roles } from '../auth/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AddStockDto } from './dto/add-stock.dto';
import { ReceiveStockDto } from './dto/receive-stock.dto';
import { IssueStockDto } from './dto/issue-stock.dto';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { WasteStockDto } from './dto/waste-stock.dto';
import { ReturnStockDto } from './dto/return-stock.dto';
import { WasteFinishedGoodDto } from './dto/waste-finished-good.dto';
import { LedgerQueryDto } from './dto/ledger-query.dto';
import { PaginationDto } from '../../common/dto/pagination.dto';

/**
 * GF-0007 — مسارات المخزون على أساس الـ ledger:
 * - كل عمليات الكتابة مقيّدة بـ INVENTORY_MANAGER (وSUPER_ADMIN يتجاوز دائمًا).
 * - الهوية من الجلسة (@CurrentUser) — عمود createdById في الـ ledger.
 * - مفتاح Idempotency-Key اختياري في الترويسة: نفس المفتاح + نفس المحتوى =
 *   نفس الاستجابة بلا أثر مزدوج (مفيد لـ retry من الهاتف).
 * - INV-2 (قراءات مقسومة بالدور من الجلسة):
 *   • القراءات المادية (قوائم المواد/الأرصدة/المخازن/الملخص) متاحة لكل
 *     الأدوار الموثقة — بلا حقول التكلفة للمورد للأدوار غير المالية
 *     (الخدمة تسقطها بناءً على دور الجلسة المُمرر).
 *   • القراءة المالية (الدفتر بالتكاليف) مقيّدة بـ @Roles للأدوار المالية
 *     (INVENTORY_MANAGER / ACCOUNTANT / GENERAL_MANAGER — وSUPER_ADMIN
 *     يتجاوز في RolesGuard) — دور تشغيلي (PRODUCTION/CASHIER/...) → 403.
 */
@ApiTags('Inventory (المخزون)')
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get('raw-materials')
  @ApiOperation({ summary: 'الحصول على جميع المواد الخام' })
  async getRawMaterials(
    @Query() pagination: PaginationDto,
    @CurrentUser('role') viewerRole?: UserRole,
  ) {
    // INV-2: دور الجلسة يقرر ما إذا كانت التكلفة وبيانات المورد تعاد
    return this.inventoryService.getAllRawMaterials(pagination, viewerRole);
  }

  @Get('raw-materials/low-stock')
  @ApiOperation({ summary: 'المواد الخام التي قاربت على الانتهاء' })
  async getLowStockMaterials(@Query() pagination: PaginationDto) {
    return this.inventoryService.getLowStockMaterials(pagination);
  }

  @Post('raw-materials/:id/add-stock')
  @Roles(UserRole.INVENTORY_MANAGER)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description: 'RES-F02: مفتاح إعادة المحاولة الآمنة لإضافة رصيد خام',
  })
  @ApiOperation({
    summary:
      'إضافة رصيد لمادة خام (مسار قديم — يمر عبر ledger في مخزن الخامات الافتراضي)',
  })
  async addStock(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AddStockDto,
    @CurrentUser('id') userId: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.inventoryService.addRawMaterialStock(
      id,
      body.quantity,
      body.costPerUnit,
      userId,
      idempotencyKey,
    );
  }

  // ===================== GF-0007: WAREHOUSES / LEDGER / MOVEMENTS =====================

  @Get('warehouses')
  @ApiOperation({ summary: 'المخازن النشطة' })
  async getWarehouses(@Query() pagination: PaginationDto) {
    return this.inventoryService.getWarehouses(pagination);
  }

  // A6: رصيد المادة الخام لكل مستودع — aggregate من StockLedgerEntry.
  @Get('raw-materials/:id/balance-by-warehouse')
  @ApiOperation({
    summary: 'رصيد المادة الخام موزعاً على المستودعات (A6)',
  })
  async getMaterialBalanceByWarehouse(@Param('id', ParseUUIDPipe) id: string) {
    return this.inventoryService.getMaterialBalanceByWarehouse(id);
  }

  @Get('ledger')
  // INV-2: الدفتر قراءة مالية (unitCost/totalValue بكل صف) — للأدوار
  // المالية فقط (SUPER_ADMIN يتجاوز في RolesGuard)؛ الأدوار التشغيلية 403.
  @Roles(
    UserRole.INVENTORY_MANAGER,
    UserRole.ACCOUNTANT,
    UserRole.GENERAL_MANAGER,
  )
  @ApiOperation({
    summary: 'سجل حركات المخزون بمرشحات خامة/مخزن/نوع/فترة (مالي)',
  })
  async getLedger(
    @Query() query: LedgerQueryDto,
    @CurrentUser('role') viewerRole?: UserRole,
  ) {
    return this.inventoryService.getLedgerEntries(query, viewerRole);
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

  // INV-8 (أ) (GF-IMP-W3): مرتجع من الإنتاج — RETURN بلا قيد GL (ADR-0020).
  @Post('return')
  @Roles(UserRole.INVENTORY_MANAGER)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description: 'RES-F02: مفتاح إعادة المحاولة الآمنة لمرتجع الإنتاج',
  })
  @ApiOperation({
    summary:
      'إرجاع خامات من الإنتاج إلى المخزن (RETURN) — بلا قيد GL (مرتجع داخلي، ADR-0020)',
  })
  async returnStock(
    @Body() body: ReturnStockDto,
    @CurrentUser('id') userId: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.inventoryService.return({ ...body, idempotencyKey }, userId);
  }

  // INV-8 (ب) (GF-IMP-W3): هدر البضاعة الجاهزة — مسار موازٍ لهدر الخامات.
  @Post('movements/waste-finished-good')
  @Roles(UserRole.INVENTORY_MANAGER)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description: 'RES-F02: مفتاح إعادة المحاولة الآمنة لهدر المنتج التام',
  })
  @ApiOperation({
    summary:
      'تسجيل هدر بضاعة جاهزة (CAS على finished_good_stocks + Dr WASTE_EXPENSE / Cr FINISHED_GOOD_STOCK)',
  })
  async wasteFinishedGood(
    @Body() body: WasteFinishedGoodDto,
    @CurrentUser('id') userId: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.inventoryService.wasteFinishedGood(
      { ...body, idempotencyKey },
      userId,
    );
  }

  // ===================== FINISHED GOODS / SUMMARY =====================

  @Get('finished-goods')
  @ApiOperation({ summary: 'الحصول على المنتجات التامة الصنع' })
  async getFinishedGoods(
    @Query() pagination: PaginationDto,
    @CurrentUser('role') viewerRole?: UserRole,
  ) {
    // INV-2: الرصيد الكمي للجميع — unitCost للأدوار المالية فقط
    return this.inventoryService.getAllFinishedGoods(pagination, viewerRole);
  }

  @Get('summary')
  @ApiOperation({ summary: 'إحصائيات المخزون للوحة التحكم' })
  async getSummary() {
    return this.inventoryService.getDashboardSummary();
  }
}
