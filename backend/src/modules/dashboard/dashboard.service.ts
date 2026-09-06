import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { round2 } from '../../core/common/money.util';
import { DashboardQueryDto } from './dto/dashboard-query.dto';

/**
 * شكل استجابة getStats — معلن صراحة كي لا يلتبس الاستدلال النوعي بالاختزال.
 * مُصدَّر عمدًا: DashboardController يعيده من مساره العام، وTypeScript يطلب
 * تسمية النوع المعاد عند المستهلكين عبر الحدود (TS4053) فوجب تصديره.
 */
export interface DashboardStats {
  filters: { from: string; to: string };
  generatedAt: string;
  sales: Array<{ period: string; amount: number; netOfTax: number }>;
  production: Array<{ period: string; pieces: number }>;
  topWorkers: Array<{ workerId: string; name: string; pieces: number }>;
  inventory: {
    totalMaterials: number;
    lowStockMaterials: number;
    totalFinishedGoodsTypes: number;
  };
  definitions: Record<string, string>;
}

type DashboardDateRange = {
  from: Date;
  to: Date;
  /** DSH-4: الحد الأعلى الحصري الموحّد (نهاية اليوم عندما يكون to منتصف الليل) */
  toExclusive: Date;
  fromIso: string;
  toIso: string;
};

/** DSH-3: مدة اختزال نتائج getStats بالميلي ثانية (60 ثانية). */
const STATS_CACHE_TTL_MS = 60_000;
/** DSH-3: سقف مدخلات الاختزال — تنظيف خامل عند بلوغه يمنع النمو بلا حدود. */
const STATS_CACHE_MAX_ENTRIES = 128;

function parseDateRange(query: DashboardQueryDto): DashboardDateRange {
  const now = new Date();
  const defaultFrom = new Date(now);
  defaultFrom.setUTCMonth(defaultFrom.getUTCMonth() - 6);
  defaultFrom.setUTCHours(0, 0, 0, 0);

  const from = query.from ? new Date(query.from) : defaultFrom;
  const to = query.to ? new Date(query.to) : now;
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new BadRequestException('Dashboard dates must be valid ISO dates');
  }
  if (from > to) {
    throw new BadRequestException(
      'Dashboard start date cannot be after end date',
    );
  }
  return {
    from,
    to,
    toExclusive: endOfRange(to),
    fromIso: from.toISOString(),
    toIso: to.toISOString(),
  };
}

/**
 * DSH-4: نهاية فترة حصرية — عندما يأتي "to" بلا مركب زمني (منتصف الليل
 * 00:00:00.000) كان الشرط createdAt <= to يبتلع بيانات اليوم الأخير كاملة
 * بصمت (من يختار "إلى اليوم" يفقد يومه). النمط ذاته الذي تعتمده الرواتب
 * لنهاية الفترة: الطرف بلا مركب زمني يُقيَّد إلى نهاية اليوم نفسه (to + يوم
 * واحد، حصريًا)؛ وإن حمل مركبًا زمنيًا نضيف 1ms فقط فيكافئ الشرط الحصري
 * `<= to` بدقة المللي ثانية. كل استعلامات الطوابع الزمنية (createdAt)
 * تستعمل الحد الحصري؛ أما حقول التاريخ الصرف (date في daily_production)
 * فتقارن باليوم أصلًا فيغطّي `date <= to` اليوم الأخير كاملًا بلا تعديل.
 */
function endOfRange(to: Date): Date {
  const hasTimeComponent =
    to.getUTCHours() !== 0 ||
    to.getUTCMinutes() !== 0 ||
    to.getUTCSeconds() !== 0 ||
    to.getUTCMilliseconds() !== 0;
  return hasTimeComponent
    ? new Date(to.getTime() + 1)
    : new Date(to.getTime() + 24 * 60 * 60 * 1000);
}

function numberValue(value: unknown): number {
  if (value instanceof Prisma.Decimal) return value.toNumber();
  return Number(value ?? 0);
}

@Injectable()
export class DashboardService {
  /**
   * DSH-3: اختزال مؤقت لنتائج getStats (60 ثانية) بمفتاح المجال الزمني
   * (from|to) — الشاشتان الأكثر فتحًا في الجوال تستدعيانها دوريًا فكان كل
   * نداء يعيد التجميع من الصفر (أربع تجميعات + عدادات).
   *
   * مبدأ الشفافية (موثق): البيانات لحظية بدقة 60 ثانية — generatedAt في
   * الاستجابة يعكس لحظة التجميع الفعلية لا لحظة الطلب، فيعرف العميل عمر
   * ما يراه. النطاق الافتراضي (بلا to) يولّد مفتاحًا مختلفًا كل مرة
   * (to=now) فلا يُختزل أصلًا — مقصود كي لا تُقدَّم «الآن» من نسخة دقيقة.
   */
  private readonly statsCache = new Map<
    string,
    { expiresAt: number; data: DashboardStats }
  >();

  constructor(private readonly prisma: PrismaService) {}

  async getStats(
    query: DashboardQueryDto = new DashboardQueryDto(),
  ): Promise<DashboardStats> {
    const range = parseDateRange(query);

    // DSH-3: إصابة اختزال ضمن المدة → إعادة النتيجة كما جُمعت لحظتها
    const cacheKey = `${range.fromIso}|${range.toIso}`;
    const cached = this.statsCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    const [sales, production, topWorkers, inventory] = await Promise.all([
      this.getSalesSeries(range),
      this.getProductionSeries(range),
      this.getTopWorkers(range),
      this.getInventorySummary(),
    ]);

    const stats: DashboardStats = {
      filters: {
        from: range.fromIso,
        to: range.toIso,
      },
      generatedAt: new Date().toISOString(),
      sales,
      production,
      topWorkers,
      inventory,
      definitions: {
        sales:
          'الإيراد الشهري المعروض (amount) = SUM(totalAmount) لأوامر البيع غير الملغاة مطروحًا منها مرتجعات البيع المؤكدة في الشهر نفسه (sales_returns المُرحّلة عند الإنشاء)؛ netOfTax = SUM(totalAmount) - SUM(vatAmount) — القيمة قبل ضريبة القيمة المضافة بجانب الإجمالي. النطاق الأعلى حصري حتى نهاية اليوم الأخير (DSH-4).',
        production:
          'مجموع piecesCount من DailyProduction حسب تاريخ الإنتاج داخل الفترة (مقارنة باليوم فتشمل اليوم الأخير كاملًا).',
        topWorkers:
          'أعلى خمسة عمال حسب مجموع piecesCount في DailyProduction داخل الفترة.',
        inventory:
          'الخامات تُعد من جدول raw_materials مباشرة (مواد مميزة لا صفوف رصيد)، النقص من currentStock <= minStockLevel، وأنواع المنتج التام = COUNT(DISTINCT productVariantId) من أرصدة finished_good_stocks الموجبة — عد الأنواع بتمييز المتغير لا بصفوف الأرصدة (DSH-5).',
      },
    };

    this.storeInStatsCache(cacheKey, stats);
    return stats;
  }

  /**
   * DSH-3: إبطال يدوي بسيط — يمسح كل مدخلات الاختزال فيُعاد التجميع في
   * النداء التالي. تستدعيه الاختبارات، ويمكن للتشغيل استدعاؤه بعد كتابة
   * بيانات حرجة حين تكون دقة أقل من 60 ثانية مطلوبة.
   */
  invalidateStatsCache(): void {
    this.statsCache.clear();
  }

  private storeInStatsCache(key: string, data: DashboardStats): void {
    // تنظيف خامل للمدخلات المنتهية عند امتلاء الاختزال — أقصى عدد مدخلات
    // محدود فلا ينمو بلا حدود مع نطاقات مختلفة (كل نطاق مدخل واحد).
    if (this.statsCache.size >= STATS_CACHE_MAX_ENTRIES) {
      const now = Date.now();
      for (const [k, entry] of this.statsCache) {
        if (entry.expiresAt <= now) {
          this.statsCache.delete(k);
        }
      }
      // ما زال ممتلئًا بعد التنظيف (نطاقات حية أكثر من السقف)؟ نُفرغه
      // كاملًا — أبسط سياسة إخلاء آمنة (إعادة تجميع لا فقد بيانات).
      if (this.statsCache.size >= STATS_CACHE_MAX_ENTRIES) {
        this.statsCache.clear();
      }
    }
    this.statsCache.set(key, {
      expiresAt: Date.now() + STATS_CACHE_TTL_MS,
      data,
    });
  }

  private async getSalesSeries(range: DashboardDateRange) {
    // DSH-5: المجموع الخام + الضريبة من sales_orders، ومرتجعات الشهر من
    // sales_returns — كلها ضمن النطاق الحصري الموحّد (DSH-4).
    // مرتجعات البيع تُنشأ وتُرحّل قيدها داخل معاملة الإنشاء نفسها
    // (sales.service.createSalesReturn) فكل صف قائم = مرتجع مؤكد مرحّل.
    const [rows, returnRows] = await Promise.all([
      this.prisma.$queryRaw<
        Array<{
          period: string;
          amount: Prisma.Decimal;
          taxAmount: Prisma.Decimal;
        }>
      >`
        SELECT to_char(date_trunc('month', "createdAt"), 'YYYY-MM') AS period,
               COALESCE(SUM("totalAmount"), 0) AS amount,
               COALESCE(SUM("vatAmount"), 0) AS "taxAmount"
        FROM sales_orders
        WHERE "createdAt" >= ${range.from}
          AND "createdAt" < ${range.toExclusive}
          AND status <> 'CANCELLED'
        GROUP BY date_trunc('month', "createdAt")
        ORDER BY date_trunc('month', "createdAt") ASC
      `,
      this.prisma.$queryRaw<Array<{ period: string; amount: Prisma.Decimal }>>`
        SELECT to_char(date_trunc('month', "createdAt"), 'YYYY-MM') AS period,
               COALESCE(SUM("totalAmount"), 0) AS amount
        FROM sales_returns
        WHERE "createdAt" >= ${range.from}
          AND "createdAt" < ${range.toExclusive}
        GROUP BY date_trunc('month', "createdAt")
      `,
    ]);

    const returnsByPeriod = new Map(
      returnRows.map((row) => [row.period, numberValue(row.amount)]),
    );

    return rows.map((row) => {
      const grossAmount = numberValue(row.amount);
      const taxAmount = numberValue(row.taxAmount);
      const returnsAmount = returnsByPeriod.get(row.period) ?? 0;
      return {
        period: row.period,
        // DSH-5(ب): الإيراد المعروض = الإجمالي (شامل الضريبة) - مرتجعات
        // البيع المؤكدة للشهر نفسه — الإيراد الصافي لا إجمالي الفواتير.
        amount: round2(grossAmount - returnsAmount),
        // DSH-5(أ): حقل إضافي واحد بجانب الإجمالي (بلا كسر العملاء القائمين
        // على amount) — القيمة قبل الضريبة.
        netOfTax: round2(grossAmount - taxAmount),
      };
    });
  }

  private async getProductionSeries(range: DashboardDateRange) {
    const rows = await this.prisma.$queryRaw<
      Array<{ period: string; pieces: bigint }>
    >`
      SELECT to_char("date", 'YYYY-MM-DD') AS period,
             COALESCE(SUM("piecesCount"), 0)::bigint AS pieces
      FROM daily_production
      WHERE "date" >= ${range.from.toISOString().slice(0, 10)}::date
        AND "date" <= ${range.to.toISOString().slice(0, 10)}::date
      GROUP BY "date"
      ORDER BY "date" ASC
    `;
    return rows.map((row) => ({
      period: row.period,
      pieces: Number(row.pieces ?? 0),
    }));
  }

  private async getTopWorkers(range: DashboardDateRange) {
    const rows = await this.prisma.$queryRaw<
      Array<{ workerId: string; name: string; pieces: bigint }>
    >`
      SELECT w.id AS "workerId",
             w.name,
             COALESCE(SUM(dp."piecesCount"), 0)::bigint AS pieces
      FROM daily_production dp
      JOIN workers w ON w.id = dp."workerId"
      WHERE dp."date" >= ${range.from.toISOString().slice(0, 10)}::date
        AND dp."date" <= ${range.to.toISOString().slice(0, 10)}::date
      GROUP BY w.id, w.name
      ORDER BY pieces DESC, w.name ASC
      LIMIT 5
    `;
    return rows.map((row) => ({
      workerId: row.workerId,
      name: row.name,
      pieces: Number(row.pieces ?? 0),
    }));
  }

  private async getInventorySummary() {
    const [totalMaterials, lowStockRows, finishedGoodsTypesRows] =
      await Promise.all([
        // DSH-5(ج): المواد المميزة من جدول الخامات مباشرة (الأنظف) — لا
        // صفوف ledger ولا أرصدة مستودعات.
        this.prisma.rawMaterial.count(),
        this.prisma.$queryRaw<Array<{ count: bigint }>>`
          SELECT COUNT(*)::bigint AS count
          FROM raw_materials
          WHERE "currentStock" <= "minStockLevel"
        `,
        // DSH-5(ج): أنواع المنتج التام بتمييز المتغير — عد صفوف أرصدة
        // finished_good_stocks كان يعد المستودع الواحد للمتغير نفسه مرات
        // (المتغير في مخزنين = «نوعان»!)؛ COUNT DISTINCT يعد النوع مرة.
        this.prisma.$queryRaw<Array<{ count: bigint }>>`
          SELECT COUNT(DISTINCT "productVariantId")::bigint AS count
          FROM finished_good_stocks
          WHERE quantity > 0
        `,
      ]);

    return {
      totalMaterials,
      lowStockMaterials: Number(lowStockRows[0]?.count ?? 0),
      totalFinishedGoodsTypes: Number(finishedGoodsTypesRows[0]?.count ?? 0),
    };
  }
}
