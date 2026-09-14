import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { FactorySettingsService } from './factory-settings.service';

/**
 * SELIM-ERP W2 — النسخ الاحتياطي/الاستعادة من الواجهة (تقلد Backup.tsx
 * في Selim ERP: زر تنزيل نسخة JSON + رفع ملف استعادة بتأكيد كتابي).
 *
 * التصميم (نسخة منطقية JSON — تعمل على Railway بلا pg_dump):
 * - **التصدير**: قراءة كل الجداول بترتيب FK ثابت (الآباء أولًا) في ملف
 *   JSON واحد { meta, data } — الدشردة تعمل عبر HTTP عادي والجوال يحفظ
 *   الملف. أحجام UAT تناسب الذاكرة (الوثائق تحدد نسخ pg_dump الفعلية
 *   للاستخدام المؤسسي — راجع docs/runbooks/BACKUP_RESTORE.md).
 * - **الاستعادة**: TRUNCATE كل جداول public (باستثناء _prisma_migrations)
 *   بـ CASCADE داخل معاملة واحدة ثم إدراج الصفوف بترتيب FK نفسه —
 *   أي فشل يرجع الحالة الأصلية بالكامل.
 * - الأمان: SUPER_ADMIN فقط + عبارة تأكيد مكتوبة + ActivityLog للعمليتين
 *   + رفض استعادة ملف بلا مستخدمين (سيقفل الجميع خارج النظام).
 *
 * التواريخ ISO strings والـ Decimal strings — Prisma يقبل كليهما في
 * الإدراج كما هما (لا تحويل مطلوب).
 */

/** نسخة صيغة ملف النسخة الاحتياطية — ترتفع عند تغيّر الشكل. */
const BACKUP_FORMAT_VERSION = 1;

/** عبارة التأكيد المكتوبة المطلوبة للاستعادة (زر تدميري). */
export const RESTORE_CONFIRM_PHRASE = 'استعادة';

/** مواصفة جدول واحد في ترتيب النسخ/الاستعادة. */
interface BackupModelSpec {
  /** اسم موديل Prisma في schema (PascalCase — تُقارن به بوابة التغطية). */
  model: string;
  /** فرز صفوف الإدراج (مراجع ذاتية: الأب قبل الابن). */
  insertSortBy?: 'createdAt' | 'code';
  /** استبعاد من ملف النسخة (جداول مشتقة/زائلة). */
  skip?: boolean;
}

/** اسم المندوب على prisma/tx — camelCase مشتق من اسم الموديل. */
function delegateNameOf(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
}

/** مفتاح فرز آمن — النص/الرقم/التاريخ فقط (بلا [object Object]). */
function sortKey(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (value instanceof Date) return value.toISOString();
  return '';
}

/**
 * ترتيب الجداول الكامل — الآباء قبل الأبناء (FK-safe):
 * 75 موديلًا. بوابة اختبار backup-coverage.spec تتحقق أن كل موديل في
 * schema.prisma موجود هنا مرة واحدة بالضبط — إضافة موديل جديد دون
 * إضافته هنا تفشل الاختبار (حارس انحراف صامت).
 */
export const BACKUP_ORDER: BackupModelSpec[] = [
  // 0 — جذور بلا تبعيات
  { model: 'Season' },
  { model: 'Warehouse' },
  { model: 'Currency' },
  { model: 'CostCenter' },
  { model: 'FiscalPeriod' },
  { model: 'Customer' },
  { model: 'Supplier' },
  { model: 'ShippingCompany' },
  { model: 'Treasury' },
  { model: 'ExpenseCategory' },
  { model: 'Color' },
  { model: 'SizeGroup' },
  { model: 'Sequence' },
  { model: 'IdempotencyKey' },
  { model: 'JournalTemplate' },
  { model: 'PrintTemplate' },
  { model: 'FactorySettings' },
  // 1 — تعتمد على الجذور
  { model: 'User', insertSortBy: 'createdAt' },
  { model: 'Device' },
  { model: 'Account', insertSortBy: 'code' },
  { model: 'ActivityLog' },
  { model: 'Worker' },
  { model: 'Product' },
  { model: 'Budget' },
  // 2
  { model: 'ProductVariant' },
  { model: 'RawMaterial' },
  { model: 'RefreshToken' },
  { model: 'Voucher' },
  { model: 'JournalEntry' },
  { model: 'TreasuryTransaction' },
  { model: 'ShiftSession' },
  { model: 'Expense' },
  { model: 'PayrollStatement' },
  // 3
  { model: 'BomVersion' },
  { model: 'FinishedGood' },
  { model: 'WorkOrder' },
  { model: 'Quotation' },
  { model: 'SalesOrder' },
  { model: 'PurchaseOrder' },
  { model: 'WorkerReceipt' },
  { model: 'WorkerAdvance' },
  // 4
  { model: 'BomLine' },
  { model: 'FinishedGoodStock' },
  { model: 'SalesOrderItem' },
  { model: 'PurchaseOrderItem' },
  { model: 'QuotationItem' },
  { model: 'WorkOrderStage' },
  { model: 'JournalLine' },
  { model: 'CuttingOrder' },
  { model: 'Pack' },
  // 5
  { model: 'StockLedgerEntry' },
  { model: 'RawMaterialTransaction' },
  { model: 'ProductionStageRun' },
  { model: 'CustomerPayment' },
  { model: 'SalesReturn' },
  { model: 'PurchaseReceipt' },
  { model: 'SupplierPayment' },
  { model: 'Shipment' },
  { model: 'PurchaseReturn' },
  { model: 'InventoryAdjustment' },
  { model: 'CuttingLine' },
  { model: 'PackComponent' },
  { model: 'PrintLog' },
  // 6
  { model: 'WorkOrderStageTransition' },
  { model: 'ProductionMaterialConsumption' },
  { model: 'ProductionCostSnapshot' },
  { model: 'MaterialConsumption' },
  { model: 'QualityCheck' },
  { model: 'Attendance' },
  { model: 'DailyProduction' },
  { model: 'Payroll' },
  { model: 'SalesReturnItem' },
  { model: 'PurchaseReceiptItem' },
  { model: 'PurchaseReturnItem' },
  { model: 'InventoryAdjustmentItem' },
];

type AnyDelegate = {
  findMany: (args?: {
    orderBy?: unknown;
    take?: number;
  }) => Promise<Record<string, unknown>[]>;
  count: (args?: Record<string, unknown>) => Promise<number>;
  createMany: (args: { data: unknown[] }) => Promise<{ count: number }>;
};

/** الوصول الديناميكي لمندوب موديل على prisma أو tx (مكتوب بأمان). */
function delegateOf(
  client: Prisma.TransactionClient | PrismaService,
  delegateName: string,
): AnyDelegate {
  const candidate = (client as unknown as Record<string, unknown>)[
    delegateName
  ];
  if (!candidate || typeof candidate !== 'object') {
    throw new BadRequestException(
      `موديل غير معروف في النسخ الاحتياطي: ${delegateName}`,
    );
  }
  return candidate as AnyDelegate;
}

@Injectable()
export class BackupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly factorySettings: FactorySettingsService,
  ) {}

  /** تصدير كامل — { meta, data } بترتيب BACKUP_ORDER. */
  async createBackup(userId: string) {
    const data: Record<string, Record<string, unknown>[]> = {};
    const counts: Record<string, number> = {};
    for (const spec of BACKUP_ORDER) {
      if (spec.skip) continue;
      const delegate = delegateNameOf(spec.model);
      const rows = await delegateOf(this.prisma, delegate).findMany();
      data[spec.model] = rows;
      counts[spec.model] = rows.length;
    }
    const meta = {
      formatVersion: BACKUP_FORMAT_VERSION,
      appVersion: process.env.npm_package_version ?? 'unknown',
      exportedAt: new Date().toISOString(),
      exportedById: userId,
      totalRows: Object.values(counts).reduce((a, b) => a + b, 0),
      counts,
    };

    await this.prisma.activityLog.create({
      data: {
        userId,
        action: 'SYSTEM_BACKUP_CREATED',
        module: 'SYSTEM',
        details: {
          totalRows: meta.totalRows,
          tables: Object.keys(counts).length,
        },
      },
    });

    // SELIM-ERP W3: سجّل آخر نسخة ناجحة — يغذي تنبيه «مر أسبوع بلا
    // نسخة» من الخادم (المرجع يقرأها من localStorage فيضيع مع الكاش).
    // فشل التحديث لا يفشل التصدير نفسه (تحسين تدريجي فقط).
    try {
      await this.factorySettings.markBackupDone();
    } catch {
      // تجاهل مقصود — النسخة نفسها نُزّلت بنجاح.
    }

    return { meta, data };
  }

  /** ملخص سريع: عدد صفوف كل جدول (شاشة النسخ الاحتياطي). */
  async summary() {
    const counts: Record<string, number> = {};
    for (const spec of BACKUP_ORDER) {
      if (spec.skip) continue;
      counts[spec.model] = await delegateOf(
        this.prisma,
        delegateNameOf(spec.model),
      ).count();
    }
    return {
      tables: Object.keys(counts).length,
      totalRows: Object.values(counts).reduce((a, b) => a + b, 0),
      counts,
      formatVersion: BACKUP_FORMAT_VERSION,
    };
  }

  /**
   * استعادة كاملة — TRUNCATE + إدراج داخل معاملة واحدة:
   * أي فشل يعيد كل شيء كما كان.
   */
  async restore(
    fileBuffer: Buffer,
    confirmPhrase: string | undefined,
    userId: string,
  ) {
    if ((confirmPhrase ?? '').trim() !== RESTORE_CONFIRM_PHRASE) {
      throw new ForbiddenException(
        `اكتب عبارة التأكيد "${RESTORE_CONFIRM_PHRASE}" لتنفيذ الاستعادة`,
      );
    }

    let parsed: { meta?: unknown; data?: unknown };
    try {
      parsed = JSON.parse(fileBuffer.toString('utf8')) as typeof parsed;
    } catch {
      throw new BadRequestException('ملف النسخة الاحتياطية ليس JSON صالحًا');
    }
    const { meta, data } = parsed;
    if (
      typeof meta !== 'object' ||
      meta === null ||
      typeof data !== 'object' ||
      data === null ||
      Array.isArray(data)
    ) {
      throw new BadRequestException('بنية ملف النسخة الاحتياطية غير صحيحة');
    }
    const formatVersion = (meta as { formatVersion?: unknown }).formatVersion;
    if (formatVersion !== BACKUP_FORMAT_VERSION) {
      throw new BadRequestException(
        `إصدار صيغة الملف ${String(formatVersion)} غير مدعوم (المتوقع ${BACKUP_FORMAT_VERSION})`,
      );
    }
    const rowsByModel = data as Record<string, unknown[]>;

    // حارس القفل الخارج: بلا مستخدمين = استعادة تقفل الجميع.
    const users = rowsByModel['User'];
    if (!Array.isArray(users) || users.length === 0) {
      throw new BadRequestException(
        'الملف لا يحتوي مستخدمين — رفض الاستعادة (ستفقد الوصول للنظام)',
      );
    }

    const inserted: Record<string, number> = {};
    await this.prisma.$transaction(async (tx) => {
      // 1) مسح كل جداول public (عدا هجرات prisma) — CASCADE.
      const tables = (
        await tx.$queryRaw<{ tablename: string }[]>(
          Prisma.sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`,
        )
      ).map((row) => row.tablename);
      if (tables.length > 0) {
        await tx.$executeRawUnsafe(
          `TRUNCATE TABLE ${tables.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
        );
      }

      // 2) الإدراج بترتيب FK — صفوف User/Account مرتبة (مراجع ذاتية).
      for (const spec of BACKUP_ORDER) {
        if (spec.skip) continue;
        const rows = rowsByModel[spec.model];
        if (!Array.isArray(rows) || rows.length === 0) continue;
        let ordered = rows;
        if (spec.insertSortBy === 'createdAt') {
          ordered = [...rows].sort((a, b) =>
            sortKey((a as Record<string, unknown>).createdAt).localeCompare(
              sortKey((b as Record<string, unknown>).createdAt),
            ),
          );
        } else if (spec.insertSortBy === 'code') {
          // شجرة الحسابات: الكود الأب أقصر وأصغر معجميًا قبل الابن.
          ordered = [...rows].sort((a, b) =>
            sortKey((a as Record<string, unknown>).code).localeCompare(
              sortKey((b as Record<string, unknown>).code),
            ),
          );
        }
        const result = await delegateOf(
          tx,
          delegateNameOf(spec.model),
        ).createMany({
          data: ordered,
        });
        inserted[spec.model] = result.count;
      }

      // 3) سجل التدقيق — بعد نجاح الإدراج داخل نفس المعاملة.
      await tx.activityLog.create({
        data: {
          userId,
          action: 'SYSTEM_RESTORED',
          module: 'SYSTEM',
          details: {
            tables: Object.keys(inserted).length,
            totalRows: Object.values(inserted).reduce((a, b) => a + b, 0),
            backupExportedAt:
              (meta as { exportedAt?: unknown }).exportedAt ?? null,
          },
        },
      });
    });

    return {
      restored: true,
      tables: Object.keys(inserted).length,
      totalRows: Object.values(inserted).reduce((a, b) => a + b, 0),
      inserted,
    };
  }
}
