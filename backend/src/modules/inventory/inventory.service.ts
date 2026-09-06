import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  Prisma,
  StockMovementType,
  UserRole,
  WarehouseType,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { FinancialPostingService } from '../../core/financial/financial-posting.service';
import { CHART_OF_ACCOUNTS } from '../../core/financial/chart-of-accounts';
import { EVENTS, EventName } from '../../events/event-types';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { round2, round4 } from '../../core/common/money.util';
import { PaginatedResult } from '../../common/dto/paginated-result.dto';

/**
 * GF-0007 — Domain Foundation: Inventory Application Service (مبدئي).
 *
 * القاعدة المركزية (معيار القبول 2): لا تحديث مباشر لـ RawMaterial.currentStock
 * من أي مكان خارج هذه الخدمة، وداخلها لا يحدث التحديث إلا عبر حركة
 * StockLedgerEntry واحدة داخل prisma.$transaction واحدة:
 *
 *   1. (اختياري) إنشاء سجل IdempotencyKey — نقطة التسلسل ضد التكرار.
 *   2. UPDATE ذري واحد للرصيد الإجمالي { increment: delta } — وهو نقطة التسلسل
 *      ضد السباقات على نفس الخامة.
 *   3. تجميع ledger داخل نفس المعاملة لحساب رصيد المستودع بعد الحركة؛ وبذلك
 *      لا يسمح الصرف بتجاوز رصيد مستودع بعينه حتى لو كان الإجمالي موجبًا.
 *   4. فحص الرصيد السالب الإجمالي ورصيد المستودع (ADR-0007): الاستثناء يعيد
 *      المعاملة كلها.
 *   5. (RECEIVE فقط) إعادة احتساب التكلفة بمتوسط مرجح (ADR-0008).
 *   6. إنشاء سطر الـ ledger بلقطة رصيد المستودع بعد الحركة.
 *   7. (اختياري) تخزين الاستجابة في سجل الـ idempotency لإعادة تشغيلها لاحقًا.
 *
 * الأحداث (STOCK_ADDED/STOCK_DEDUCTED/STOCK_LOW) إشعارات in-process غير مالية
 * تُطلق بعد نجاح الـ transaction فقط (وفق اتجاه ADR-0003-ج) — لا اعتماد
 * ذرّيًا عليها. INV-1: عندما تُنفّذ الحركة داخل معاملة خارجية (externalTx
 * يمرّره المستدعي الأعلى) لا تُبث الأحداث هنا إطلاقًا؛ بل تُجمع في
 * eventsCollector يملؤه المستدعي ليبثها بعد نجاح معاملته هو — فشل المعاملة
 * الخارجية = لا أحداث لحركة رُجعت (rollback).
 */

export interface ReceiveStockInput {
  rawMaterialId?: string;
  productVariantId?: string;
  warehouseId: string;
  quantity: number;
  unitCost: number;
  reference?: string;
  notes?: string;
  idempotencyKey?: string;
}

export interface IssueStockInput {
  rawMaterialId?: string;
  productVariantId?: string;
  warehouseId: string;
  quantity: number;
  reference?: string;
  notes?: string;
  idempotencyKey?: string;
}

export interface AdjustStockInput {
  rawMaterialId?: string;
  productVariantId?: string;
  warehouseId: string;
  quantityDelta: number;
  reason: string;
  reference?: string;
  idempotencyKey?: string;
}

export interface WasteStockInput {
  rawMaterialId: string;
  warehouseId: string;
  quantity: number;
  reason: string;
  reference?: string;
  idempotencyKey?: string;
}

/**
 * INV-8 (ب) (P2 — GF-IMP-W3): هدر البضاعة الجاهزة — الخامات فقط كانت تدعم
 * الهدر (WasteStockInput يفرض rawMaterialId)؛ هذا المسار الموازي يخفض
 * رصيد finished_good_stocks بـ CAS ويرحّل Dr WASTE_EXPENSE / Cr
 * FINISHED_GOOD_STOCK بنمط هدر الخامات (WASTE/INVENTORY).
 */
export interface WasteFinishedGoodInput {
  finishedGoodVariantId: string;
  quantity: number;
  /** إلزامي كالخامات — الهدر بلا سبب = ثغرة تدقيق. */
  reason: string;
  reference?: string;
  idempotencyKey?: string;
}

/**
 * INV-8 (أ) (P2 — GF-IMP-W3): حركة إرجاع خامات من الإنتاج — RETURN.
 * الدلالة (ADR-0020): مرتجع داخلي من خط الإنتاج إلى المخزن بلا طرف خارجي
 * ولا قيد GL — الاستهلاك الأصلي قيّد WIP من consumeMaterial، والإرجاع
 * يزيد رصيد المخزون بقيمة التكلفة الحالية (لا يُعاد احتساب متوسط مرجح
 * — راجع ADR-0020 للتفصيل والبدائل المرفوضة).
 * warehouseId اختياري (نص التكليف يعدّد rawMaterialId/quantity/reason/
 * reference وحدها): عند غيابه يُختار مخزن الخامات الافتراضي حتميًا
 * (نمط INV-6 — أول مخزن خامات نشط بترتيب createdAt)؛ تحديده صراحةً
 * يبقى متاحًا للمستدعى الذي يعرف مخزن الإرجاع الفعلي.
 */
export interface ReturnStockInput {
  rawMaterialId: string;
  warehouseId?: string;
  quantity: number;
  reason: string;
  reference?: string;
  idempotencyKey?: string;
}

export interface StockMovementResult {
  replayed: boolean;
  entryCode: string;
  type: StockMovementType;
  rawMaterialId: string;
  warehouseId: string;
  quantityDelta: number;
  /** الرصيد بعد الحركة في المستودع المحدد، وليس الإجمالي عبر كل المستودعات. */
  balanceAfter: number;
  unitCost: number | null;
  totalValue: number | null;
  costPerUnitAfter: number | null;
  createdAt: string;
}

/** سياق الحركة اللازم لبناء أحداث المخزون (INV-1). */
interface StockEventContext {
  materialId: string;
  warehouseId: string;
  quantity: number;
  newBalance: number;
  minStockLevel: number;
  /** CC-8: منفذ الحركة — فاعل تنبيه النقص في ActivityLog إن هبط الرصيد. */
  actorId?: string;
}

/**
 * INV-1: حدث مخزون مؤجل البث. عندما يعمل مسار الحركة داخل معاملة خارجية
 * (externalTx من المستدعي الأعلى مثل consumeMaterial في الإنتاج) تُجمع
 * الأحداث هنا بدل بثها قبل commit — ثم يبثها مالك المعاملة بعد نجاحها
 * فقط، فلا تظهر أحداث وهمية لحركة رُجعت (rollback).
 */
export interface StockEvent {
  /** اسم الحدث من EVENTS (مثل inventory.stock.deducted). */
  name: EventName;
  /** حمولة الحدث كما تُمرّر لـ emitAsync. */
  payload: Record<string, unknown>;
}

export interface LedgerFilter {
  rawMaterialId?: string;
  /** INV-9: تصفية البضاعة الجاهزة بالمتغير (الفهرس المركب قائم). */
  productVariantId?: string;
  warehouseId?: string;
  type?: StockMovementType;
  from?: string;
  to?: string;
}

/** نطاقات idempotency — مفتاح واحد لا يُستخدم عبر عمليات مختلفة. */
const IDEMPOTENCY_SCOPES: Record<StockMovementType, string> = {
  [StockMovementType.RECEIVE]: 'inventory.receive',
  [StockMovementType.ISSUE]: 'inventory.issue',
  [StockMovementType.ADJUSTMENT]: 'inventory.adjustment',
  [StockMovementType.WASTE]: 'inventory.waste',
  // INV-8 (أ): مفعّل الآن مع مرتجعات الإنتاج (كان محجوزًا لمستقبل
  // المشتريات — الدلالة الجديدة موثقة في ADR-0020).
  [StockMovementType.RETURN]: 'inventory.return',
};

/**
 * INV-7 (P2 — GF-IMP-W3): أفعال سجل التدقيق لكل نوع حركة مخزون — تُكتب
 * داخل نفس معاملة الحركة عند توفر الفاعل (userId) مع الرصيد قبل/بعد.
 */
const MOVEMENT_AUDIT_ACTIONS: Record<StockMovementType, string> = {
  [StockMovementType.RECEIVE]: 'STOCK_RECEIVED',
  [StockMovementType.ISSUE]: 'STOCK_ISSUED',
  [StockMovementType.ADJUSTMENT]: 'STOCK_ADJUSTED',
  [StockMovementType.WASTE]: 'STOCK_WASTED',
  [StockMovementType.RETURN]: 'STOCK_RETURNED',
};

interface MovementExecutionInput {
  type: StockMovementType;
  rawMaterialId: string;
  warehouseId: string;
  /** موقّع: موجب دخول / سالب خروج */
  delta: number;
  /** الكمية الفعلية قبل التوقيع (للأحداث والتكلفة) */
  unsignedQuantity: number;
  unitCost?: number;
  reference?: string;
  notes?: string;
  idempotencyKey?: string;
  userId?: string;
}

/** خطأ Prisma معروف (P2002/P2025…) بشكل duck-typing — يعمل مع نسخ runtime المختلفة. */
interface PrismaKnownErrorLike {
  code: string;
  meta?: unknown;
}

function asPrismaKnownError(err: unknown): PrismaKnownErrorLike | null {
  if (typeof err !== 'object' || err === null) return null;
  const candidate = err as Partial<PrismaKnownErrorLike>;
  if (typeof candidate.code !== 'string') return null;
  return { code: candidate.code, meta: candidate.meta };
}

/** هل الخطأ تعارض فريد على مفتاح idempotency (وليس أي unique آخر)؟ */
function isIdempotencyUniqueViolation(err: unknown): boolean {
  const known = asPrismaKnownError(err);
  if (!known || known.code !== 'P2002') return false;
  return JSON.stringify(known.meta ?? {}).includes('idempotency');
}

function isRecordNotFound(err: unknown): boolean {
  const known = asPrismaKnownError(err);
  return known !== null && known.code === 'P2025';
}

/** كود حركة فريد قابل للقراءة: SLE-YYYYMMDD-XXXXXXXX (تاريخ UTC + عشوائية). */
function generateEntryCode(): string {
  const now = new Date();
  const ymd = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    String(now.getUTCDate()).padStart(2, '0'),
  ].join('');
  return `SLE-${ymd}-${randomBytes(4).toString('hex').toUpperCase()}`;
}

/**
 * INV-2: الأدوار المالية المسموح لها برؤية بيانات التكلفة (costPerUnit /
 * unitCost / totalValue) وبيانات المورد في قراءات المخزون.
 * القرار التصميمي الموثق: القراءات المادية (قوائم المواد والأرصدة) متاحة
 * لكل الأدوار الموثقة لكن بلا تكلفة للأدوار غير المالية، والقراءة المالية
 * (الدفتر بالتكاليف) مقيّدة في المتحكم بـ @Roles لنفس هذه الأدوار
 * (SUPER_ADMIN يتجاوز قيود الأدوار في RolesGuard أصلًا). الدور غير المعروف
 * (استدعاء برمجي بلا دور) يُعامل غير مالي — fail-closed على التكلفة.
 */
const COST_VISIBLE_ROLES: ReadonlySet<UserRole> = new Set([
  UserRole.INVENTORY_MANAGER,
  UserRole.ACCOUNTANT,
  UserRole.GENERAL_MANAGER,
  UserRole.SUPER_ADMIN,
]);

function isCostVisibleRole(viewerRole?: UserRole): boolean {
  return viewerRole !== undefined && COST_VISIBLE_ROLES.has(viewerRole);
}

/**
 * INV-2: الحقول العامة للمادة الخام — كل الحقول التشغيلية بدون costPerUnit
 * وبدون علاقة المورد (select صريح فلا تعود التكلفة من القاعدة أصلًا).
 */
const RAW_MATERIAL_PUBLIC_SELECT = {
  id: true,
  code: true,
  name: true,
  unit: true,
  currentStock: true,
  minStockLevel: true,
  supplierId: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.RawMaterialSelect;

/** بصمة الطلب — نفس المفتاح بمحتوى مختلف = تعارض يُرفض بـ 409 لا إعادة تنفيذ. */
function computeRequestHash(payload: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

type TxClient = Prisma.TransactionClient;

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly financialPosting: FinancialPostingService,
  ) {}

  // ===================== RAW MATERIALS (reads) =====================

  /**
   * INV-2: قائمة المواد الخام. للأدوار المالية (isCostVisibleRole) تعاد
   * الصفوف كاملة مع costPerUnit وعلاقة المورد؛ وللأدوار التشغيلية/غير
   * المالية تُستعلم بـ RAW_MATERIAL_PUBLIC_SELECT — لا تكلفة ولا مورد من
   * القاعدة أصلًا (select صريح، فلا تُنقل حقول حساسة إلى التطبيق).
   */
  async getAllRawMaterials(pagination: PaginationDto, viewerRole?: UserRole) {
    const page = pagination.page || 1;
    const limit = pagination.limit || 20;
    const skip = (page - 1) * limit;
    const costVisible = isCostVisibleRole(viewerRole);

    const [data, total] = await Promise.all([
      costVisible
        ? this.prisma.rawMaterial.findMany({
            skip,
            take: limit,
            include: { supplier: true },
            orderBy: { name: 'asc' },
          })
        : this.prisma.rawMaterial.findMany({
            skip,
            take: limit,
            select: RAW_MATERIAL_PUBLIC_SELECT,
            orderBy: { name: 'asc' },
          }),
      this.prisma.rawMaterial.count(),
    ]);

    return new PaginatedResult(data, total, page, limit);
  }

  async getLowStockMaterials(pagination: PaginationDto) {
    // B2: نستخدم $queryRaw SQL بدلاً من findMany + in-memory filter.
    // الفلاتر في الـ SQL تقلل نقل البيانات وتسمح للـ DB بـ index scans.
    // D7 (partial): لا نُرجع costPerUnit — بيانات التكلفة role-restricted.
    const page = pagination.page || 1;
    const limit = pagination.limit || 20;
    const offset = (page - 1) * limit;

    // PostgreSQL syntax — `currentStock` و `minStockLevel` columns من نوع Decimal
    // نُرجعها كـ numeric، نُحوّلها لـ number في TS.
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        code: string;
        name: string;
        currentStock: import('@prisma/client').Prisma.Decimal;
        minStockLevel: import('@prisma/client').Prisma.Decimal;
        unit: string | null;
        supplierId: string | null;
      }>
    >`
      SELECT id, code, name, "currentStock", "minStockLevel", unit, "supplierId"
      FROM raw_materials
      WHERE "currentStock" <= "minStockLevel"
      ORDER BY (("minStockLevel" - "currentStock")) DESC, name ASC
      LIMIT ${limit} OFFSET ${offset}
    `;

    // عدّ الإجمالي للـ pagination meta
    const totalRows = await this.prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM raw_materials
      WHERE "currentStock" <= "minStockLevel"
    `;
    const total = Number(totalRows[0]?.count ?? 0);

    // نُنظّف الـ rows من Big number إلى plain JS objects
    const data = rows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      // D7: costPerUnit غائب عمداً — لا يُرجع من هنا.
      currentStock: Number(r.currentStock),
      minStockLevel: Number(r.minStockLevel),
      unit: r.unit,
      supplierId: r.supplierId,
    }));

    return new PaginatedResult(data, total, page, limit);
  }

  /**
   * GF-REMAINING-002: يجلب رصيد المادة الخام لكل مستودع من مجموع الحركات.
   *
   * RawMaterial.currentStock هو الإجمالي الكلي (snapshot للقراءة السريعة)،
   * أما الرصيد التشغيلي لكل مستودع فيُستخرج من SUM(quantityDelta) في الـ ledger.
   * لا نستخدم balanceAfter هنا لأنه لقطة تدقيق لا مصدر تجميع، وقد تكون قديمة
   * أو كُتبت في إصدار سابق بدلالة إجمالي الخامة.
   *
   * @param rawMaterialId المادة الخام المطلوبة
   * @returns مصفوفة لكل مستودع يحوي الكمية الحالية + آخر تحديث
   */
  async getMaterialBalanceByWarehouse(rawMaterialId: string) {
    const rows = await this.prisma.$queryRaw<
      Array<{
        warehouseId: string;
        warehouseCode: string;
        warehouseName: string;
        balance: import('@prisma/client').Prisma.Decimal;
        lastUpdate: Date;
      }>
    >`
      SELECT
        sle."warehouseId",
        w.code AS "warehouseCode",
        w.name AS "warehouseName",
        COALESCE(SUM(sle."quantityDelta"), 0) AS balance,
        MAX(sle."createdAt") AS "lastUpdate"
      FROM stock_ledger_entries sle
      JOIN warehouses w ON w.id = sle."warehouseId"
      WHERE sle."rawMaterialId" = ${rawMaterialId}
      GROUP BY sle."warehouseId", w.code, w.name
      ORDER BY w.code ASC
    `;

    return rows.map((r) => ({
      warehouseId: r.warehouseId,
      warehouseCode: r.warehouseCode,
      warehouseName: r.warehouseName,
      balance: Number(r.balance),
      lastUpdate: r.lastUpdate,
    }));
  }

  // ===================== WAREHOUSES (GF-0007) =====================

  async getWarehouses(pagination: PaginationDto) {
    const page = pagination.page || 1;
    const limit = pagination.limit || 20;
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.warehouse.findMany({
        where: { isActive: true },
        skip,
        take: limit,
        orderBy: { code: 'asc' },
      }),
      this.prisma.warehouse.count({ where: { isActive: true } }),
    ]);

    return new PaginatedResult(data, total, page, limit);
  }

  // ===================== STOCK LEDGER (GF-0007) =====================

  /**
   * INV-2: الدفتر قراءة مالية — المتحكم يقيدها بـ @Roles للأدوار المالية،
   * وهنا دفاع عمقي إضافي: استدعاء برمجي (أو دور غير مالي) يعيد الصفوف
   * بلا unitCost/totalValue. الأعمدة الكمية (quantityDelta/balanceAfter)
   * تبقى للجميع — سلسلة التدقيق التشغيلية.
   */
  async getLedgerEntries(
    filter: LedgerFilter & PaginationDto,
    viewerRole?: UserRole,
  ) {
    const page = filter.page || 1;
    const limit = filter.limit || 20;
    const skip = (page - 1) * limit;
    const costVisible = isCostVisibleRole(viewerRole);

    const where: Prisma.StockLedgerEntryWhereInput = {};
    if (filter.rawMaterialId) where.rawMaterialId = filter.rawMaterialId;
    // INV-9: تصفية البضاعة الجاهزة بالمتغير — يستفيد من الفهرس المركب
    // (productVariantId, createdAt) القائم في المخطط.
    if (filter.productVariantId)
      where.productVariantId = filter.productVariantId;
    if (filter.warehouseId) where.warehouseId = filter.warehouseId;
    if (filter.type) where.type = filter.type;
    if (filter.from || filter.to) {
      where.createdAt = {
        ...(filter.from ? { gte: new Date(filter.from) } : {}),
        ...(filter.to ? { lte: new Date(filter.to) } : {}),
      };
    }
    const [rows, total] = await Promise.all([
      this.prisma.stockLedgerEntry.findMany({
        where,
        skip,
        take: limit,
        include: {
          warehouse: { select: { code: true, name: true } },
          rawMaterial: { select: { code: true, name: true, unit: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.stockLedgerEntry.count({ where }),
    ]);
    const data = costVisible
      ? rows
      : rows.map(
          ({ unitCost: _unitCost, totalValue: _totalValue, ...rest }) => rest,
        );

    return new PaginatedResult(data, total, page, limit);
  }

  // ===================== MOVEMENT OPERATIONS (GF-0007) =====================

  async receive(
    input: ReceiveStockInput,
    userId?: string,
    tx?: TxClient,
    eventsCollector?: StockEvent[],
  ): Promise<StockMovementResult> {
    await this.assertMaterialWarehouse(input.warehouseId);
    return this.executeMovement(
      {
        type: StockMovementType.RECEIVE,
        rawMaterialId: this.requireRawMaterialId(input.rawMaterialId),
        warehouseId: input.warehouseId,
        delta: input.quantity,
        unsignedQuantity: input.quantity,
        unitCost: input.unitCost,
        reference: input.reference,
        notes: input.notes,
        idempotencyKey: input.idempotencyKey,
        userId,
      },
      tx,
      eventsCollector,
    );
  }

  async issue(
    input: IssueStockInput,
    userId?: string,
    tx?: TxClient,
    eventsCollector?: StockEvent[],
  ): Promise<StockMovementResult> {
    await this.assertMaterialWarehouse(input.warehouseId);
    return this.executeMovement(
      {
        type: StockMovementType.ISSUE,
        rawMaterialId: this.requireRawMaterialId(input.rawMaterialId),
        warehouseId: input.warehouseId,
        delta: -input.quantity,
        unsignedQuantity: input.quantity,
        reference: input.reference,
        notes: input.notes,
        idempotencyKey: input.idempotencyKey,
        userId,
      },
      tx,
      eventsCollector,
    );
  }

  async adjust(
    input: AdjustStockInput,
    userId?: string,
    eventsCollector?: StockEvent[],
  ): Promise<StockMovementResult> {
    await this.assertMaterialWarehouse(input.warehouseId);
    return this.executeMovement(
      {
        type: StockMovementType.ADJUSTMENT,
        rawMaterialId: this.requireRawMaterialId(input.rawMaterialId),
        warehouseId: input.warehouseId,
        delta: input.quantityDelta,
        unsignedQuantity: Math.abs(input.quantityDelta),
        reference: input.reference,
        notes: `تسوية جرد — السبب: ${input.reason}`,
        idempotencyKey: input.idempotencyKey,
        userId,
      },
      undefined,
      eventsCollector,
    );
  }

  async waste(
    input: WasteStockInput,
    userId?: string,
    eventsCollector?: StockEvent[],
  ): Promise<StockMovementResult> {
    await this.assertMaterialWarehouse(input.warehouseId);
    return this.executeMovement(
      {
        type: StockMovementType.WASTE,
        rawMaterialId: input.rawMaterialId,
        warehouseId: input.warehouseId,
        delta: -input.quantity,
        unsignedQuantity: input.quantity,
        reference: input.reference,
        notes: `هدر — السبب: ${input.reason}`,
        idempotencyKey: input.idempotencyKey,
        userId,
      },
      undefined,
      eventsCollector,
    );
  }

  /**
   * INV-8 (أ) (P2 — GF-IMP-W3): إرجاع خامات من الإنتاج — يزيد الرصيد
   * (كالاستلام) بقيده في الدفتر بنوع RETURN وبلا قيد GL (ADR-0020:
   * مرتجع داخلي بلا طرف خارجي؛ الاستهلاك الأصلي هو الذي قيّد WIP).
   * لا يُعاد احتساب متوسط التكلفة المرجح — الحركة تُقيَّم بتكلفة الخامة
   * الحالية كما في الصرف (التفصيل والبدائل في ADR-0020).
   * warehouseId اختياري: الغياب يُحلّ لمخزن الخامات الافتراضي الحتمي
   * (INV-6) قبل تنفيذ الحركة — نفس المخزن دائمًا لنفس الحالة.
   */
  async return(
    input: ReturnStockInput,
    userId?: string,
    tx?: TxClient,
    eventsCollector?: StockEvent[],
  ): Promise<StockMovementResult> {
    // INV-8 (أ): مخزن الإرجاع — المحدد صراحةً أو الافتراضي الحتمي (INV-6).
    // القرار قبل تنفيذ الحركة (لا داخلها): اختيار المخزن لا يعتمد على حالة
    // تُكتب داخل المعاملة (نفس توثيق addRawMaterialStock/INV-6).
    const warehouseId =
      input.warehouseId ?? (await this.resolveDefaultMaterialWarehouse()).id;
    await this.assertMaterialWarehouse(warehouseId);
    return this.executeMovement(
      {
        type: StockMovementType.RETURN,
        rawMaterialId: input.rawMaterialId,
        warehouseId,
        delta: input.quantity,
        unsignedQuantity: input.quantity,
        reference: input.reference,
        notes: `مرتجع من الإنتاج — السبب: ${input.reason}`,
        idempotencyKey: input.idempotencyKey,
        userId,
      },
      tx,
      eventsCollector,
    );
  }

  /**
   * INV-8 (ب) (P2 — GF-IMP-W3): هدر البضاعة الجاهزة — المسار الموازي
   * لهدر الخامات: يخفض finished_good_stocks بـ CAS (تحديث شرطي
   * quantity >= المطلوب)، يسجل حركة WASTE في الدفتر موصولة بالمتغير
   * (productVariantId)، ويرحّل قيد GL: Dr WASTE_EXPENSE / Cr
   * FINISHED_GOOD_STOCK بمبلغ quantity × unitCost الرصيد — نمط
   * هدر الخامات (WASTE/INVENTORY) معبّرًا عن مخزون التام.
   * المخزن: افتراضي حتمي (أول مخزن FINISHED_GOODS نشط بترتيب createdAt
   * — نمط INV-6) لأن الهدر المكتشف في المستودع لا يحدد المستدعي مخزنه.
   */
  async wasteFinishedGood(
    input: WasteFinishedGoodInput,
    userId?: string,
  ): Promise<StockMovementResult> {
    if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
      throw new BadRequestException(
        'كمية هدر المنتج التام يجب أن تكون عددًا صحيحًا موجبًا',
      );
    }

    const warehouse = await this.resolveDefaultFinishedGoodsWarehouse();
    const scope = 'inventory.finished_good_waste';
    const requestHash = computeRequestHash({
      operation: scope,
      productVariantId: input.finishedGoodVariantId,
      quantity: input.quantity,
      reason: input.reason,
      reference: input.reference ?? null,
    });
    if (input.idempotencyKey) {
      const replay = await this.tryReplay(
        input.idempotencyKey,
        scope,
        requestHash,
      );
      if (replay) return replay;
    }

    const execute = async (tx: TxClient): Promise<StockMovementResult> => {
      let idempotencyKeyId: string | undefined;
      if (input.idempotencyKey) {
        idempotencyKeyId = (
          await tx.idempotencyKey.create({
            data: { key: input.idempotencyKey, scope, requestHash },
            select: { id: true },
          })
        ).id;
      }

      const stock = await tx.finishedGoodStock.findUnique({
        where: {
          warehouseId_productVariantId: {
            warehouseId: warehouse.id,
            productVariantId: input.finishedGoodVariantId,
          },
        },
        select: { id: true, quantity: true, unitCost: true },
      });
      if (!stock) {
        throw new NotFoundException(
          'رصيد المنتج التام غير موجود في مخزن المنتج التام الافتراضي',
        );
      }

      // INV-8 (ب): CAS — تحديث شرطي واحد يمنع السباق والسالب
      const updated = await tx.finishedGoodStock.updateMany({
        where: { id: stock.id, quantity: { gte: input.quantity } },
        data: { quantity: { decrement: input.quantity } },
      });
      if (updated.count !== 1) {
        throw new ConflictException(
          'رصيد المنتج التام غير كافٍ للهدر أو تغير بالتزامن',
        );
      }

      const balanceAfter = Number(stock.quantity) - input.quantity;
      const unitCost = stock.unitCost;
      const totalValue = unitCost.mul(input.quantity).toDecimalPlaces(2);

      const entry = await tx.stockLedgerEntry.create({
        data: {
          entryCode: generateEntryCode(),
          type: StockMovementType.WASTE,
          warehouseId: warehouse.id,
          productVariantId: input.finishedGoodVariantId,
          quantityDelta: -input.quantity,
          balanceAfter,
          unitCost,
          totalValue,
          reference: input.reference,
          notes: `هدر بضاعة جاهزة — السبب: ${input.reason}`,
          idempotencyKeyId,
          createdById: userId,
        },
        select: { entryCode: true, createdAt: true },
      });

      // INV-8 (ب): قيد GL بنمط هدر الخامات — Dr WASTE_EXPENSE / Cr
      // FINISHED_GOOD_STOCK (بلا إعادة تقييم للمتوسط — الهدر يخرج
      // بتكلفة الرصيد الحالية).
      if (totalValue.gt(0)) {
        await this.financialPosting.postJournalEntryInTx(
          tx,
          {
            description: `ترحيل هدر بضاعة جاهزة — ${
              input.reference ?? entry.entryCode
            }`,
            reference: input.reference ?? entry.entryCode,
            postingKey: 'inventory-fg-waste:' + entry.entryCode,
            isAuto: true,
            lines: [
              {
                debitAccountId: CHART_OF_ACCOUNTS.WASTE_EXPENSE,
                creditAccountId: CHART_OF_ACCOUNTS.FINISHED_GOOD_STOCK,
                amount: totalValue,
                description:
                  input.reason ??
                  `هدر بضاعة جاهزة — ${input.finishedGoodVariantId}`,
              },
            ],
            userId,
            metadata: {
              source: 'inventory.fg-waste',
              productVariantId: input.finishedGoodVariantId,
              warehouseId: warehouse.id,
              quantity: input.quantity,
              unitCost: unitCost.toNumber(),
              entryCode: entry.entryCode,
            },
          },
          userId,
        );
      }

      // INV-7: سجل التدقيق داخل نفس المعاملة عند توفر الفاعل
      if (userId) {
        await tx.activityLog.create({
          data: {
            userId,
            action: MOVEMENT_AUDIT_ACTIONS[StockMovementType.WASTE],
            module: 'inventory',
            details: {
              entryCode: entry.entryCode,
              productVariantId: input.finishedGoodVariantId,
              warehouseId: warehouse.id,
              quantityDelta: -input.quantity,
              balanceBefore: Number(stock.quantity),
              balanceAfter,
              reason: input.reason,
            },
          },
        });
      }

      const response = {
        replayed: false,
        entryCode: entry.entryCode,
        type: StockMovementType.WASTE,
        rawMaterialId: '',
        warehouseId: warehouse.id,
        quantityDelta: -input.quantity,
        balanceAfter,
        unitCost: unitCost.toNumber(),
        totalValue: totalValue.toNumber(),
        costPerUnitAfter: null,
        createdAt: entry.createdAt.toISOString(),
      } satisfies StockMovementResult;
      if (input.idempotencyKey) {
        await tx.idempotencyKey.update({
          where: { key: input.idempotencyKey },
          data: { response },
        });
      }
      return response;
    };

    try {
      return await this.prisma.$transaction(execute);
    } catch (error) {
      if (input.idempotencyKey && isIdempotencyUniqueViolation(error)) {
        const replay = await this.tryReplay(
          input.idempotencyKey,
          scope,
          requestHash,
        );
        if (replay) return replay;
      }
      throw error;
    }
  }

  /**
   * مسار قديم متوافق (POST /inventory/raw-materials/:id/add-stock) —
   * يوجَّه داخليًا عبر receive() في مخزن الخامات الافتراضي، فيمر عبر الـ ledger
   * مثل أي حركة أخرى (معيار القبول 2 بلا استثناءات).
   */
  async addRawMaterialStock(
    materialId: string,
    quantity: number,
    costPerUnit: number,
    userId?: string,
    idempotencyKey?: string,
  ): Promise<StockMovementResult> {
    const warehouse = await this.resolveDefaultMaterialWarehouse();
    return this.receive(
      {
        rawMaterialId: materialId,
        warehouseId: warehouse.id,
        quantity,
        unitCost: costPerUnit,
        reference: 'إضافة مخزون يدوية (مسار add-stock)',
        idempotencyKey,
      },
      userId,
    );
  }

  // ===================== FINISHED GOODS =====================

  async receiveFinishedGood(
    input: {
      productVariantId: string;
      warehouseId: string;
      quantity: number;
      unitCost: number;
      reference?: string;
      notes?: string;
      idempotencyKey?: string;
    },
    userId?: string,
    externalTx?: TxClient,
  ): Promise<StockMovementResult> {
    if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
      throw new BadRequestException(
        'كمية المنتج التام يجب أن تكون عددًا صحيحًا موجبًا',
      );
    }
    if (!Number.isFinite(input.unitCost) || input.unitCost < 0) {
      throw new BadRequestException(
        'تكلفة وحدة المنتج التام يجب أن تكون رقمًا غير سالب',
      );
    }

    const client = externalTx ?? this.prisma;
    const warehouse = await client.warehouse.findUnique({
      where: { id: input.warehouseId },
    });
    if (!warehouse) throw new NotFoundException('المخزن غير موجود');
    if (
      !warehouse.isActive ||
      warehouse.type !== WarehouseType.FINISHED_GOODS
    ) {
      throw new BadRequestException('الحركة تتطلب مخزن منتج تام نشط');
    }

    const scope = 'inventory.finished_good_receive';
    const requestHash = computeRequestHash({
      operation: scope,
      productVariantId: input.productVariantId,
      warehouseId: input.warehouseId,
      quantity: input.quantity,
      unitCost: input.unitCost,
      reference: input.reference ?? null,
      notes: input.notes ?? null,
    });
    if (input.idempotencyKey) {
      const replay = await this.tryReplay(
        input.idempotencyKey,
        scope,
        requestHash,
      );
      if (replay) return replay;
    }

    const execute = async (tx: TxClient): Promise<StockMovementResult> => {
      let idempotencyKeyId: string | undefined;
      if (input.idempotencyKey) {
        idempotencyKeyId = (
          await tx.idempotencyKey.create({
            data: { key: input.idempotencyKey, scope, requestHash },
            select: { id: true },
          })
        ).id;
      }

      await tx.$executeRaw(
        Prisma.sql`INSERT INTO "finished_good_stocks"
          ("id", "warehouseId", "productVariantId", "quantity", "unitCost", "createdAt", "updatedAt")
        VALUES (${randomUUID()}, ${input.warehouseId}, ${input.productVariantId}, ${input.quantity}, ${input.unitCost}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT ("warehouseId", "productVariantId") DO UPDATE SET
          "unitCost" = CASE
            WHEN "finished_good_stocks"."quantity" + EXCLUDED."quantity" = 0 THEN 0
            ELSE (("finished_good_stocks"."quantity" * "finished_good_stocks"."unitCost") + (EXCLUDED."quantity" * EXCLUDED."unitCost"))
              / ("finished_good_stocks"."quantity" + EXCLUDED."quantity")
          END,
          "quantity" = "finished_good_stocks"."quantity" + EXCLUDED."quantity",
          "updatedAt" = CURRENT_TIMESTAMP`,
      );

      const stock = await tx.finishedGoodStock.findUniqueOrThrow({
        where: {
          warehouseId_productVariantId: {
            warehouseId: input.warehouseId,
            productVariantId: input.productVariantId,
          },
        },
      });
      const entry = await tx.stockLedgerEntry.create({
        data: {
          entryCode: generateEntryCode(),
          type: StockMovementType.RECEIVE,
          warehouseId: input.warehouseId,
          productVariantId: input.productVariantId,
          quantityDelta: input.quantity,
          balanceAfter: stock.quantity,
          unitCost: input.unitCost,
          totalValue: new Prisma.Decimal(input.unitCost).mul(input.quantity),
          reference: input.reference,
          notes: input.notes,
          idempotencyKeyId,
          createdById: userId,
        },
        select: { entryCode: true, createdAt: true },
      });
      const response = {
        replayed: false,
        entryCode: entry.entryCode,
        type: StockMovementType.RECEIVE,
        rawMaterialId: '',
        warehouseId: input.warehouseId,
        quantityDelta: input.quantity,
        balanceAfter: stock.quantity,
        unitCost: input.unitCost,
        totalValue: new Prisma.Decimal(input.unitCost)
          .mul(input.quantity)
          .toNumber(),
        costPerUnitAfter: stock.unitCost.toNumber(),
        createdAt: entry.createdAt.toISOString(),
      } satisfies StockMovementResult;
      if (input.idempotencyKey) {
        await tx.idempotencyKey.update({
          where: { key: input.idempotencyKey },
          data: { response },
        });
      }
      return response;
    };

    try {
      return await (externalTx
        ? execute(externalTx)
        : this.prisma.$transaction(execute));
    } catch (error) {
      if (input.idempotencyKey && isIdempotencyUniqueViolation(error)) {
        const replay = await this.tryReplay(
          input.idempotencyKey,
          scope,
          requestHash,
        );
        if (replay) return replay;
      }
      throw error;
    }
  }

  async issueFinishedGood(
    input: {
      productVariantId: string;
      warehouseId: string;
      quantity: number;
      reference?: string;
      notes?: string;
      idempotencyKey?: string;
    },
    userId?: string,
    externalTx?: TxClient,
  ): Promise<StockMovementResult> {
    if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
      throw new BadRequestException(
        'كمية المنتج التام يجب أن تكون عددًا صحيحًا موجبًا',
      );
    }
    const client = externalTx ?? this.prisma;
    const warehouse = await client.warehouse.findUnique({
      where: { id: input.warehouseId },
    });
    if (!warehouse) throw new NotFoundException('المخزن غير موجود');
    if (
      !warehouse.isActive ||
      warehouse.type !== WarehouseType.FINISHED_GOODS
    ) {
      throw new BadRequestException('الحركة تتطلب مخزن منتج تام نشط');
    }

    const scope = 'inventory.finished_good_issue';
    const requestHash = computeRequestHash({
      operation: scope,
      productVariantId: input.productVariantId,
      warehouseId: input.warehouseId,
      quantity: input.quantity,
      reference: input.reference ?? null,
      notes: input.notes ?? null,
    });
    if (input.idempotencyKey) {
      const existing = await client.idempotencyKey.findUnique({
        where: { key: input.idempotencyKey },
      });
      if (existing) {
        if (existing.scope !== scope || existing.requestHash !== requestHash) {
          throw new ConflictException('Idempotency-Key مستخدم مع عملية مختلفة');
        }
        if (!existing.response)
          throw new ConflictException('العملية السابقة لم تكتمل بعد');
        return {
          ...(existing.response as unknown as Omit<
            StockMovementResult,
            'replayed'
          >),
          replayed: true,
        };
      }
    }

    const execute = async (tx: TxClient): Promise<StockMovementResult> => {
      const idempotencyKeyId = input.idempotencyKey
        ? (
            await tx.idempotencyKey.create({
              data: { key: input.idempotencyKey, scope, requestHash },
              select: { id: true },
            })
          ).id
        : undefined;
      const stock = await tx.finishedGoodStock.findUnique({
        where: {
          warehouseId_productVariantId: {
            warehouseId: input.warehouseId,
            productVariantId: input.productVariantId,
          },
        },
        select: { id: true, quantity: true, unitCost: true },
      });
      if (!stock)
        throw new NotFoundException(
          'رصيد المنتج التام غير موجود في المخزن المحدد',
        );
      const updated = await tx.finishedGoodStock.updateMany({
        where: { id: stock.id, quantity: { gte: input.quantity } },
        data: { quantity: { decrement: input.quantity } },
      });
      if (updated.count !== 1) {
        throw new ConflictException('المخزون التام غير كافٍ أو تغير بالتزامن');
      }
      const balanceAfter = stock.quantity - input.quantity;
      const entry = await tx.stockLedgerEntry.create({
        data: {
          entryCode: generateEntryCode(),
          type: StockMovementType.ISSUE,
          warehouseId: input.warehouseId,
          productVariantId: input.productVariantId,
          quantityDelta: -input.quantity,
          balanceAfter,
          unitCost: stock.unitCost,
          totalValue: stock.unitCost.mul(input.quantity),
          reference: input.reference,
          notes: input.notes,
          idempotencyKeyId,
          createdById: userId,
        },
        select: { entryCode: true, createdAt: true },
      });
      const response = {
        replayed: false,
        entryCode: entry.entryCode,
        type: StockMovementType.ISSUE,
        rawMaterialId: '',
        warehouseId: input.warehouseId,
        quantityDelta: -input.quantity,
        balanceAfter,
        unitCost: stock.unitCost.toNumber(),
        totalValue: stock.unitCost.mul(input.quantity).toNumber(),
        costPerUnitAfter: null,
        createdAt: entry.createdAt.toISOString(),
      } satisfies StockMovementResult;
      if (input.idempotencyKey) {
        await tx.idempotencyKey.update({
          where: { key: input.idempotencyKey },
          data: { response },
        });
      }
      return response;
    };

    try {
      return await (externalTx
        ? execute(externalTx)
        : this.prisma.$transaction(execute));
    } catch (error) {
      if (input.idempotencyKey && isIdempotencyUniqueViolation(error)) {
        const replay = await this.tryReplay(
          input.idempotencyKey,
          scope,
          requestHash,
        );
        if (replay) return replay;
      }
      throw error;
    }
  }

  /**
   * PERF-F02: إصدار جماعي لمنتجات تامة الصنع لأمر بيع متعدد البنود.
   *
   * يعتمد على نمط bulk:
   *   1. findMany واحد لجلب كل أرصدة FG للمستودع + المنتجات في استعلام واحد
   *   2. تحقق من الكميات في الذاكرة — يرفض الكل لو أي بنفة لا يكفيها الرصيد
   *   3. (INV-3) تحديثات CAS تسلسلية — حلقة await واحدة تلو الأخرى داخل
   *      المعاملة التفاعلية (كل updateMany شرطي quantity >= المطلوب)؛
   *      لا Promise.all داخل interactive transaction: الاتصال واحد
   *      والتنفيذ المتوازي استعلامات متشابكة يصعب تتبعها وتقتل إمكانية
   *      إعادة المحاولة، والتسلسل لا يضيف جولات شبكة (نفس العدد من
   *      الاستعلامات على نفس الاتصال).
   *   4. createMany واحد لكل قيود الـ StockLedgerEntry — استعلام إدخال واحد
   *   5. (INV-3/INV-1) أحداث STOCK_DEDUCTED لكل بند تُجمع وتُعاد للمستدعي
   *      (مالك المعاملة) ليبثها بعد commit فقط — لا بث هنا إطلاقًا.
   *
   * النتيجة: من 3N+1 استعلام → 3 استعلامات فقط (findMany + N×updateMany
   * تسلسلية + createMany واحد). للأمر بـ 10 بنود، من 31 استعلام إلى ~12.
   *
   * ملاحظات:
   *   - لا يستخدم idempotencyKey لكل بندة — يُتوقع أن الـ parent يلفّ كل
   *     العملية في idempotencyKey خاص به (confirmOrder يفعل ذلك).
   *   - يحتاج externalTx مُمرر — لا يفتح معاملة جديدة (الـ parent يديرها)،
   *     لذلك لا يبث الأحداث بنفسه أبدًا (INV-1: مالك المعاملة يبث بعد
   *     نجاحها) — يعبّئ eventsCollector إن مُرر، ويعيد الأحداث في النتيجة
   *     للمستدعين الذين لم يعتمدوا المجمع بعد.
   *   - يرمي BadRequestException لو أي كمية غير صالحة، NotFoundException لو
   *     بنفة لا تملك رصيدًا، ConflictException لو نقص بعد التحديث الذري.
   */
  async bulkIssueFinishedGoods(
    items: Array<{
      productVariantId: string;
      quantity: number;
      reference?: string;
      notes?: string;
    }>,
    warehouseId: string,
    externalTx: TxClient,
    userId?: string,
    eventsCollector?: StockEvent[],
  ): Promise<{
    movements: StockMovementResult[];
    totalValue: number;
    /** INV-3: أحداث STOCK_DEDUCTED مؤجلة — للمستدعي بثها بعد commit فقط. */
    events: StockEvent[];
  }> {
    if (items.length === 0) {
      return { movements: [], totalValue: 0, events: [] };
    }
    // 1) تحقق من الكميات
    for (const item of items) {
      if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
        throw new BadRequestException(
          'كمية المنتج التام يجب أن تكون عددًا صحيحًا موجبًا',
        );
      }
    }

    // 2) findMany واحد لكل الأرصدة
    const variantIds = items.map((i) => i.productVariantId);
    const stocks = await externalTx.finishedGoodStock.findMany({
      where: {
        warehouseId,
        productVariantId: { in: variantIds },
      },
      select: {
        id: true,
        productVariantId: true,
        quantity: true,
        unitCost: true,
      },
    });
    const stockByVariant = new Map(stocks.map((s) => [s.productVariantId, s]));

    // تحقق أن كل بندة لها رصيد موجود وكافٍ
    const missing: string[] = [];
    const insufficient: string[] = [];
    for (const item of items) {
      const stock = stockByVariant.get(item.productVariantId);
      if (!stock) {
        missing.push(item.productVariantId);
        continue;
      }
      if (Number(stock.quantity) < item.quantity) {
        insufficient.push(item.productVariantId);
      }
    }
    if (missing.length > 0) {
      throw new NotFoundException(
        `رصيد المنتج التام غير موجود في المخزن للمتغيرات: ${missing.join(', ')}`,
      );
    }
    if (insufficient.length > 0) {
      throw new ConflictException(
        `المخزون التام غير كافٍ للمتغيرات: ${insufficient.join(', ')}`,
      );
    }

    // 3) INV-3: تحديثات CAS تسلسلية — حلقة await واحدة تلو الأخرى داخل
    //    المعاملة التفاعلية (لا Promise.all). كل updateMany شرطي
    //    (quantity >= المطلوب) فيمنع السباقات، وفشل أي بند يرجع المعاملة
    //    كلها مع بقية أثر المسار (الـ ledger لا يُكتب بعدها).
    const updateResults: Array<{
      item: (typeof items)[number];
      stock: (typeof stocks)[number];
      updated: { count: number };
    }> = [];
    for (const item of items) {
      const stock = stockByVariant.get(item.productVariantId)!;
      const updated = await externalTx.finishedGoodStock.updateMany({
        where: { id: stock.id, quantity: { gte: item.quantity } },
        data: { quantity: { decrement: item.quantity } },
      });
      updateResults.push({ item, stock, updated });
    }

    // تحقق أن كل التحديثات أثرت على صف واحد (atomic CAS guard)
    const conflictVariants = updateResults
      .filter((r) => r.updated.count !== 1)
      .map((r) => r.item.productVariantId);
    if (conflictVariants.length > 0) {
      throw new ConflictException(
        `المخزون التام تغير بالتزامن للمتغيرات: ${conflictVariants.join(', ')}`,
      );
    }

    // 4) createMany واحد لكل قيود الـ StockLedgerEntry
    const now = new Date();
    const ledgerData = items.map((item) => {
      const stock = stockByVariant.get(item.productVariantId)!;
      const balanceAfter = Number(stock.quantity) - item.quantity;
      const unitCost = stock.unitCost.toNumber();
      const totalValue = unitCost * item.quantity;
      return {
        entryCode: generateEntryCode(),
        type: StockMovementType.ISSUE,
        warehouseId,
        productVariantId: item.productVariantId,
        quantityDelta: -item.quantity,
        balanceAfter,
        unitCost,
        totalValue,
        reference: item.reference ?? null,
        notes: item.notes ?? null,
        createdById: userId ?? null,
        createdAt: now,
      };
    });
    await externalTx.stockLedgerEntry.createMany({
      data: ledgerData,
    });

    // تجهيز النتائج بنفس شكل StockMovementResult لكل بنفة
    const movements: StockMovementResult[] = items.map((item) => {
      const stock = stockByVariant.get(item.productVariantId)!;
      const balanceAfter = Number(stock.quantity) - item.quantity;
      const unitCost = stock.unitCost.toNumber();
      const totalValue = unitCost * item.quantity;
      return {
        replayed: false,
        entryCode: ledgerData.find(
          (d) =>
            d.productVariantId === item.productVariantId &&
            d.quantityDelta === -item.quantity,
        )!.entryCode,
        type: StockMovementType.ISSUE,
        rawMaterialId: '',
        warehouseId,
        quantityDelta: -item.quantity,
        balanceAfter,
        unitCost,
        totalValue,
        costPerUnitAfter: null,
        createdAt: now.toISOString(),
      } satisfies StockMovementResult;
    });

    const totalValue = round2(
      movements.reduce((sum, m) => sum + (m.totalValue ?? 0), 0),
    );

    // 5) INV-3/INV-1: أحداث STOCK_DEDUCTED لكل بند — تُبنى هنا بعد نجاح كل
    //    الكتابات (فشل أي خطوة يرمي قبل الوصول هنا = لا أحداث لحركة رُجعت)،
    //    لكن لا تُبث: المسار يعمل دائمًا داخل معاملة خارجية فيملك القرار
    //    المستدعي الأعلى. تُعبّئ المجمع إن مُرر (نمط INV-1) وتُعاد في النتيجة
    //    معًا ليعتمد عليها المستدعون الذين لم يمرروا مجمعًا — البث بعد commit
    //    فقط. (منتجات التام لا تملك عتبة إعادة طلب — لا STOCK_LOW هنا.)
    const events: StockEvent[] = items.map((item) => ({
      name: EVENTS.STOCK_DEDUCTED,
      payload: {
        productVariantId: item.productVariantId,
        warehouseId,
        quantity: item.quantity,
        newStock:
          Number(stockByVariant.get(item.productVariantId)!.quantity) -
          item.quantity,
      },
    }));
    if (eventsCollector) {
      eventsCollector.push(...events);
    }

    return { movements, totalValue, events };
  }

  /**
   * INV-2: أرصدة المنتج التام — الرصيد الكمي للجميع (تشغيلي)، وunitCost
   * تُسقط في الـ mapping للأدوار غير المالية (الصف يخلط أعمدة تشغيلية
   * وتكلفة فلا يفصلها select واحد دون فقدان الباقي).
   */
  async getAllFinishedGoods(pagination: PaginationDto, viewerRole?: UserRole) {
    const page = pagination.page || 1;
    const limit = pagination.limit || 20;
    const skip = (page - 1) * limit;
    const costVisible = isCostVisibleRole(viewerRole);

    const where: Prisma.FinishedGoodStockWhereInput = {
      quantity: { gt: 0 },
    };
    const [rows, total] = await Promise.all([
      this.prisma.finishedGoodStock.findMany({
        skip,
        take: limit,
        where,
        include: {
          productVariant: {
            include: { product: true },
          },
          warehouse: true,
        },
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.finishedGoodStock.count({ where }),
    ]);
    const data = rows.map(({ productVariant, unitCost, ...stock }) =>
      costVisible
        ? { ...stock, unitCost, variant: productVariant }
        : { ...stock, variant: productVariant },
    );

    return new PaginatedResult(data, total, page, limit);
  }

  async getDashboardSummary() {
    const materials = await this.prisma.rawMaterial.count();
    // INV-5: نقرأ العدد الإجمالي من استجابة getLowStockMaterials بحد صف واحد
    // (meta.total من استعلام COUNT(*) مستقل) — لا جلب 10000 صف لعدّها في
    // الذاكرة (كانت LIMIT 10000 + data.length: نقل بيانات بلا داعٍ + عدّ
    // مقصوص عند تجاوز الـ 10000).
    const lowStock = (await this.getLowStockMaterials({ page: 1, limit: 1 }))
      .meta.total;
    const finishedGoods = await this.prisma.finishedGoodStock.count({
      where: { quantity: { gt: 0 } },
    });

    return {
      totalMaterials: materials,
      lowStockMaterials: lowStock,
      totalFinishedGoodsTypes: finishedGoods,
    };
  }

  // ===================== CORE (private) =====================

  /** حركات الخامات تُقبل في مخازن خامات أو عامة فقط — لا في مخازن التام. */
  private async assertMaterialWarehouse(warehouseId: string): Promise<void> {
    const warehouse = await this.prisma.warehouse.findUnique({
      where: { id: warehouseId },
    });
    if (!warehouse) {
      throw new NotFoundException('المخزن غير موجود');
    }
    if (!warehouse.isActive) {
      throw new BadRequestException('المخزن غير نشط — لا تُقبل فيه حركات');
    }
    if (
      warehouse.type !== WarehouseType.RAW_MATERIAL &&
      warehouse.type !== WarehouseType.GENERAL
    ) {
      throw new BadRequestException(
        'حركات الخامات تُقبل في مخازن خامات أو عامة فقط — ليس في مخازن المنتج التام',
      );
    }
  }

  /**
   * INV-6 (P2 — GF-IMP-W3): المخزن الافتراضي حتمي — أول مخزن خامات نشط
   * بترتيب createdAt صاعد، فإن لم يوجد أول مخزن عام نشط بالترتيب نفسه.
   * الحتمية (نفس المدخلات → نفس المخزن دائمًا) تمنع تشتت المخزون بين
   * مستودعات متعددة حسب ترتيب الاستعلام العشوائي.
   * معامل tx اختياري: المستدعى الخارجي الذي يملك معاملة يمكنه القراءة
   * داخلها (بلا فتح اتصال جديد)؛ الاستدعاء الوحيد الحالي (addRawMaterialStock
   * — مسار add-stock غير معاملاتي: الحركة نفسها تفتح معاملتها في receive)
   * يقرأ خارج المعاملة عمدًا — توثيق القرار: القراءة قبل الحركة آمنة هنا
   * لأن اختيار المخزن لا يعتمد على أي حالة تُكتب داخل المعاملة.
   */
  private async resolveDefaultMaterialWarehouse(tx?: TxClient) {
    const db = tx ?? this.prisma;
    const rawWarehouse = await db.warehouse.findFirst({
      where: { type: WarehouseType.RAW_MATERIAL, isActive: true },
      orderBy: { createdAt: 'asc' },
    });
    const warehouse =
      rawWarehouse ??
      (await db.warehouse.findFirst({
        where: { type: WarehouseType.GENERAL, isActive: true },
        orderBy: { createdAt: 'asc' },
      }));
    if (!warehouse) {
      throw new ConflictException(
        'لا يوجد مخزن خامات نشط — شغّل seed لإنشاء WH-RAW أو أنشئ مخزنًا أولًا',
      );
    }
    return warehouse;
  }

  /**
   * INV-8 (ب): المخزن الافتراضي للبضاعة الجاهزة — نفس نمط حتمية INV-6:
   * أول مخزن FINISHED_GOODS نشط بترتيب createdAt صاعد (في القاعدة
   * المزروعة: WH-FG).
   */
  private async resolveDefaultFinishedGoodsWarehouse() {
    const warehouse = await this.prisma.warehouse.findFirst({
      where: { type: WarehouseType.FINISHED_GOODS, isActive: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!warehouse) {
      throw new ConflictException(
        'لا يوجد مخزن منتج تام نشط — شغّل seed لإنشاء WH-FG أو أنشئ مخزنًا أولًا',
      );
    }
    return warehouse;
  }

  private requireRawMaterialId(rawMaterialId?: string): string {
    if (!rawMaterialId) {
      throw new BadRequestException('rawMaterialId مطلوب لهذه الحركة');
    }
    return rawMaterialId;
  }

  private async executeMovement(
    input: MovementExecutionInput,
    externalTx?: TxClient,
    eventsCollector?: StockEvent[],
  ): Promise<StockMovementResult> {
    const scope = IDEMPOTENCY_SCOPES[input.type];
    const requestPayload: Record<string, unknown> = {
      operation: scope,
      rawMaterialId: input.rawMaterialId,
      warehouseId: input.warehouseId,
      quantityDelta: input.delta,
      ...(input.unitCost !== undefined ? { unitCost: input.unitCost } : {}),
      ...(input.reference !== undefined ? { reference: input.reference } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    };
    const requestHash = computeRequestHash(requestPayload);

    // (1) إعادة تشغيل idempotent: نفس المفتاح + نفس المحتوى → نفس الاستجابة بلا أثر جديد.
    if (input.idempotencyKey) {
      const replay = await this.tryReplay(
        input.idempotencyKey,
        scope,
        requestHash,
      );
      if (replay) return replay;
    }

    // (2) التنفيذ الذري: كل الكتابات عبر tx فقط.
    let eventContext: StockEventContext | undefined;

    const executeLogic = async (tx: TxClient) => {
      let idempotencyKeyId: string | undefined;
      if (input.idempotencyKey) {
        const idem = await tx.idempotencyKey.create({
          data: {
            key: input.idempotencyKey,
            scope,
            requestHash,
          },
          select: { id: true },
        });
        idempotencyKeyId = idem.id;
      }

      // UPDATE ذري واحد = نقطة التسلسل: القيمة الراجعة هي الرصيد بعد التطبيق،
      // وأي عملية متزامنة على نفس الخامة تنتظر قفل الصف ثم ترى أثر هذه.
      let material: {
        currentStock: Prisma.Decimal | number;
        costPerUnit: Prisma.Decimal | number;
        minStockLevel: Prisma.Decimal | number;
      };
      try {
        material = await tx.rawMaterial.update({
          where: { id: input.rawMaterialId },
          data: { currentStock: { increment: input.delta } },
          select: {
            currentStock: true,
            costPerUnit: true,
            minStockLevel: true,
          },
        });
      } catch (err) {
        if (isRecordNotFound(err)) {
          throw new NotFoundException('المادة الخام غير موجودة');
        }
        throw err;
      }

      const newBalance = Number(material.currentStock);
      const currentCost = Number(material.costPerUnit);
      const minStockLevel = Number(material.minStockLevel);
      const warehouseAggregate = await tx.stockLedgerEntry.aggregate({
        where: {
          rawMaterialId: input.rawMaterialId,
          warehouseId: input.warehouseId,
        },
        _sum: { quantityDelta: true },
      });
      const warehouseBalanceBefore = Number(
        warehouseAggregate._sum.quantityDelta ?? 0,
      );
      const warehouseBalanceAfter = round4(
        warehouseBalanceBefore + input.delta,
      );

      // ADR-0007: الرصيد السالب ممنوع — الإجمالي والمستودع كلاهما يُفحصان،
      // والاستثناء يُرجع الـ transaction كلها.
      if (newBalance < 0) {
        throw new BadRequestException(
          `العملية تُظهر رصيد الخامة إلى ${newBalance} — الرصيد السالب ممنوع (ADR-0007). ` +
            'تحقق من الكمية أو سجّل تسوية جرد أولًا.',
        );
      }
      if (warehouseBalanceAfter < 0) {
        throw new BadRequestException(
          `العملية تُظهر رصيد المستودع إلى ${warehouseBalanceAfter} — الرصيد السالب ممنوع (ADR-0007). ` +
            'تحقق من المستودع أو سجّل تسوية جرد أولًا.',
        );
      }

      // التكلفة المطبقة وتقييم الحركة.
      let appliedUnitCost: number;
      let totalValue: number;
      let costPerUnitAfter: number | null = null;
      if (input.type === StockMovementType.RECEIVE) {
        const unitCost = input.unitCost as number;
        const oldQuantity = newBalance - input.unsignedQuantity;
        // ADR-0008 — متوسط مرجح: تكلفة الوحدة الجديدة = (كمية×تكلفة قديمة + كمية×تكلفة الشحنة) / الرصيد الجديد.
        const newCost =
          oldQuantity <= 0
            ? unitCost
            : round2(
                (oldQuantity * currentCost +
                  input.unsignedQuantity * unitCost) /
                  newBalance,
              );
        costPerUnitAfter = newCost;
        await tx.rawMaterial.update({
          where: { id: input.rawMaterialId },
          data: { costPerUnit: newCost },
        });
        appliedUnitCost = unitCost;
        totalValue = round2(input.unsignedQuantity * unitCost);
      } else {
        appliedUnitCost = currentCost;
        totalValue = round2(input.unsignedQuantity * currentCost);
      }

      const entry = await tx.stockLedgerEntry.create({
        data: {
          entryCode: generateEntryCode(),
          type: input.type,
          warehouseId: input.warehouseId,
          rawMaterialId: input.rawMaterialId,
          quantityDelta: input.delta,
          balanceAfter: warehouseBalanceAfter,
          unitCost: appliedUnitCost,
          totalValue,
          reference: input.reference,
          notes: input.notes,
          idempotencyKeyId,
          createdById: input.userId,
        },
        select: { entryCode: true, createdAt: true },
      });

      // OPS-F01 / OPS-F11: قيد GL لهدر/تسوية المخزون داخل نفس الـ transaction.
      // postingKey مستقر على شكل '<scope>:<entryCode>' فيربط القيد بسجل الـ ledger
      // واحد-لواحد، فيمنع الترحيل المزدوج حتى لو أُعيد تنفيذ الـ executeLogic
      // ضمن نفس الـ tx لأي سبب. لا قيد للـ RECEIVE/ISSUE هنا — استلام الخامات
      // يُرحَّل من المستدعي (مثلاً purchasing.createReceipt)، والصرف يُرحَّل من
      // consumeMaterial في production-workflow عبر قيد WIP/INVENTORY مستقل.
      const glAmount = round2(Math.abs(totalValue));
      if (glAmount > 0 && input.type === StockMovementType.WASTE) {
        await this.financialPosting.postJournalEntryInTx(
          tx,
          {
            description: `ترحيل هدر خامات — ${input.reference ?? entry.entryCode}`,
            reference: input.reference ?? entry.entryCode,
            postingKey: 'inventory-waste:' + entry.entryCode,
            isAuto: true,
            lines: [
              {
                debitAccountId: CHART_OF_ACCOUNTS.WASTE_EXPENSE,
                creditAccountId: CHART_OF_ACCOUNTS.INVENTORY,
                amount: glAmount,
                description:
                  input.notes ?? `هدر خامات — ${input.rawMaterialId}`,
              },
            ],
            userId: input.userId,
            metadata: {
              source: 'inventory.waste',
              rawMaterialId: input.rawMaterialId,
              warehouseId: input.warehouseId,
              quantity: input.unsignedQuantity,
              unitCost: appliedUnitCost,
              entryCode: entry.entryCode,
            },
          },
          input.userId,
        );
      } else if (glAmount > 0 && input.type === StockMovementType.ADJUSTMENT) {
        const isPositiveAdjust = input.delta > 0;
        await this.financialPosting.postJournalEntryInTx(
          tx,
          {
            description: `ترحيل تسوية جرد مخزون — ${
              input.reference ?? entry.entryCode
            }`,
            reference: input.reference ?? entry.entryCode,
            postingKey: 'inventory-adjustment:' + entry.entryCode,
            isAuto: true,
            lines: [
              isPositiveAdjust
                ? {
                    debitAccountId: CHART_OF_ACCOUNTS.INVENTORY,
                    creditAccountId:
                      CHART_OF_ACCOUNTS.INVENTORY_ADJUSTMENT_INCOME,
                    amount: glAmount,
                    description:
                      input.notes ?? `عجز جرد موجب — ${input.rawMaterialId}`,
                  }
                : {
                    debitAccountId:
                      CHART_OF_ACCOUNTS.INVENTORY_ADJUSTMENT_EXPENSE,
                    creditAccountId: CHART_OF_ACCOUNTS.INVENTORY,
                    amount: glAmount,
                    description:
                      input.notes ?? `عجز جرد سالب — ${input.rawMaterialId}`,
                  },
            ],
            userId: input.userId,
            metadata: {
              source: 'inventory.adjustment',
              rawMaterialId: input.rawMaterialId,
              warehouseId: input.warehouseId,
              delta: input.delta,
              unitCost: appliedUnitCost,
              entryCode: entry.entryCode,
            },
          },
          input.userId,
        );
      }

      // INV-7 (P2 — GF-IMP-W3): سجل تدقيق الحركة داخل نفس المعاملة —
      // الفاعل من الجلسة (userId من المدخلات) والقيم الجوهرية مع الرصيد
      // قبل/بعد للمستودع (من حساب الدفتر أعلاه). userId إلزامي في
      // ActivityLog ولا يوجد مستخدم نظام — غيابه (استدعاء برمجي قديم
      // بلا جلسة) = لا سجل تدقيق هنا؛ الحركة نفسها تبقى موثقة بالكامل
      // في StockLedgerEntry (createdById nullable) — القرار موثق أعلاه
      // في PROD-6 بنفس النمط.
      if (input.userId) {
        await tx.activityLog.create({
          data: {
            userId: input.userId,
            action: MOVEMENT_AUDIT_ACTIONS[input.type],
            module: 'inventory',
            details: {
              entryCode: entry.entryCode,
              type: input.type,
              rawMaterialId: input.rawMaterialId,
              warehouseId: input.warehouseId,
              quantityDelta: input.delta,
              balanceBefore: warehouseBalanceBefore,
              balanceAfter: warehouseBalanceAfter,
              totalValue,
              ...(input.reference ? { reference: input.reference } : {}),
            },
          },
        });
      }

      const response: Omit<StockMovementResult, 'replayed'> = {
        entryCode: entry.entryCode,
        type: input.type,
        rawMaterialId: input.rawMaterialId,
        warehouseId: input.warehouseId,
        quantityDelta: input.delta,
        balanceAfter: warehouseBalanceAfter,
        unitCost: appliedUnitCost,
        totalValue,
        costPerUnitAfter,
        createdAt: entry.createdAt.toISOString(),
      };

      if (input.idempotencyKey) {
        await tx.idempotencyKey.update({
          where: { key: input.idempotencyKey },
          data: { response: response },
        });
      }

      eventContext = {
        materialId: input.rawMaterialId,
        warehouseId: input.warehouseId,
        quantity: input.unsignedQuantity,
        newBalance: warehouseBalanceAfter,
        minStockLevel,
        // CC-8: منفذ الحركة يرافق حدث النقص ليكون فاعل سجل التنبيه
        ...(input.userId ? { actorId: input.userId } : {}),
      };

      return { ...response, replayed: false };
    };

    try {
      const result = externalTx
        ? await executeLogic(externalTx)
        : await this.prisma.$transaction(executeLogic);

      if (eventContext) {
        const events = this.buildStockEvents(input.type, eventContext);
        if (externalTx) {
          // INV-1: داخل معاملة خارجية ممنوع البث قبل commit — المستدعي الأعلى
          // يملك القرار. نملأ المجمع ليبثه بعد نجاح معاملته هو؛ وبدون مجمع
          // تُهمل الأحداث عمدًا (إشعارات غير مالية — إهمالها أسلم من بثها
          // وهمية لحركة قد تُرجع بـ rollback).
          if (eventsCollector) {
            eventsCollector.push(...events);
          }
        } else {
          // (3) إشعارات بعد نجاح الـ transaction فقط (غير مالية — ADR-0003-ج).
          for (const event of events) {
            void this.eventEmitter.emitAsync(event.name, event.payload);
          }
        }
      }

      return result;
    } catch (err) {
      // (4) سباق idempotency: عملية أخرى بنفس المفتاح التزمت قبلك — استرجع استجابتها.
      if (isIdempotencyUniqueViolation(err) && input.idempotencyKey) {
        const replay = await this.tryReplay(
          input.idempotencyKey,
          scope,
          requestHash,
        );
        if (replay) return replay;
        throw new ConflictException(
          'العملية بنفس المفتاح قيد التنفيذ أو فشلت قبل الاكتمال — أعد المحاولة بعد لحظات',
        );
      }
      throw err;
    }
  }

  /**
   * INV-1: بناء أحداث المخزون للحركة — STOCK_ADDED/STOCK_DEDUCTED حسب
   * الاتجاه + STOCK_LOW عند الهبوط لحد الطلب. تُستخدم مرة واحدة بعد نجاح
   * المسار: بثًا مباشرًا (معاملة داخلية) أو تعبئةً للمجمع (معاملة خارجية).
   */
  private buildStockEvents(
    type: StockMovementType,
    ctx: StockEventContext,
  ): StockEvent[] {
    const isInbound =
      type === StockMovementType.RECEIVE || type === StockMovementType.RETURN;
    const events: StockEvent[] = [
      {
        name: isInbound ? EVENTS.STOCK_ADDED : EVENTS.STOCK_DEDUCTED,
        payload: {
          materialId: ctx.materialId,
          warehouseId: ctx.warehouseId,
          quantity: ctx.quantity,
          newStock: ctx.newBalance,
        },
      },
    ];
    if (ctx.newBalance <= ctx.minStockLevel && ctx.minStockLevel > 0) {
      events.push({
        name: EVENTS.STOCK_LOW,
        payload: {
          materialId: ctx.materialId,
          warehouseId: ctx.warehouseId,
          currentStock: ctx.newBalance,
          minStockLevel: ctx.minStockLevel,
          // CC-8: فاعل التنبيه لسجل ActivityLog (userId إلزامي في المخطط)
          ...(ctx.actorId ? { actorId: ctx.actorId } : {}),
        },
      });
    }
    return events;
  }

  /** إعادة استجابة مخزنة لمفتاح مكتمل — أو رفض واضح عند تعارض المحتوى/النطاق. */
  private async tryReplay(
    key: string,
    scope: string,
    requestHash: string,
  ): Promise<StockMovementResult | null> {
    const existing = await this.prisma.idempotencyKey.findUnique({
      where: { key },
    });
    if (!existing) return null;

    if (existing.scope !== scope) {
      throw new ConflictException(
        `المفتاح مستخدم مسبقًا في نطاق مختلف (${existing.scope}) — استخدم مفتاحًا جديدًا`,
      );
    }
    if (existing.requestHash !== requestHash) {
      throw new ConflictException(
        'نفس مفتاح idempotency مع محتوى طلب مختلف — ممنوع (استخدم مفتاحًا جديدًا للمحتوى الجديد)',
      );
    }
    if (!existing.response) {
      throw new ConflictException(
        'توجد محاولة سابقة غير مكتملة بنفس المفتاح — أعد المحاولة بمفتاح جديد',
      );
    }
    return {
      ...(existing.response as unknown as Omit<
        StockMovementResult,
        'replayed'
      >),
      replayed: true,
    };
  }
}
