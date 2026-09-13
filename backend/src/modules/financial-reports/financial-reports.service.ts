import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CHART_OF_ACCOUNTS } from '../../core/financial/chart-of-accounts';
import { round2 } from '../../core/common/money.util';
import {
  ReportRangeQueryDto,
  AsOfQueryDto,
  AgingQueryDto,
} from './dto/report-query.dto';
import {
  CreateBudgetDto,
  UpdateBudgetDto,
  QueryBudgetDto,
  BUDGET_PERIODS,
} from './dto/budget.dto';

/**
 * SELIM-ERP W1 — خدمة التقارير المالية (تقلد financial-reports في Selim ERP):
 * قائمة الدخل، الميزانية العمومية، تقرير VAT، أعمار الذمم، الميزانيات.
 *
 * مبادئ البناء:
 * - التجميع من journal_lines مباشرة (نفس نهج ميزان المراجعة في
 *   AccountingService.getTrialBalance: groupBy على debitAccountId/
 *   creditAccountId مع _sum.amount) مع فلترة زمنية عبر علاقة القيد —
 *   لا نكرر ميزان المراجعة، بل نبني فوق نفس أسلوب التجميع.
 * - القيود المعكوسة وأعكاسها كلاهما موجود في الدفاتر ويتساوى أثرهما،
 *   فلا نستبعدها — التجميع الصافي صحيح محاسبيًا.
 * - لا معاملات كتابة (تقارير قراءة فقط) إلا في الميزانيات (CRUD بسيط).
 */

/** صف تقرير لحساب واحد (يُستخدم في كل التقارير التجميعية). */
export interface AccountReportRow {
  accountId: string;
  code: string;
  name: string;
  amount: number;
}

@Injectable()
export class FinancialReportsService {
  constructor(private readonly prisma: PrismaService) {}

  // ------------------------------------------------------------------
  // قائمة الدخل (Income Statement)
  // ------------------------------------------------------------------

  /**
   * قائمة الدخل لفترة: الإيرادات = Σ(دائن − مدين) على حسابات REVENUE،
   * والمصروفات = Σ(مدين − دائن) على حسابات EXPENSE، وصافي الربح =
   * الإيرادات − المصروفات. النطاق مطلوب — افتراضيًا الشهر الحالي.
   */
  async getIncomeStatement(query: ReportRangeQueryDto) {
    const { from, to } = this.resolveRange(query);

    const { accounts, debitByAccount, creditByAccount } =
      await this.loadAggregates(from, to);

    const revenues: AccountReportRow[] = [];
    const expenses: AccountReportRow[] = [];
    for (const account of accounts) {
      const debit = debitByAccount.get(account.id) ?? 0;
      const credit = creditByAccount.get(account.id) ?? 0;
      if (account.type === 'REVENUE') {
        const amount = round2(credit - debit);
        if (amount !== 0) {
          revenues.push({
            accountId: account.id,
            code: account.code,
            name: account.name,
            amount,
          });
        }
      } else if (account.type === 'EXPENSE') {
        const amount = round2(debit - credit);
        if (amount !== 0) {
          expenses.push({
            accountId: account.id,
            code: account.code,
            name: account.name,
            amount,
          });
        }
      }
    }

    const totalRevenues = round2(revenues.reduce((s, r) => s + r.amount, 0));
    const totalExpenses = round2(expenses.reduce((s, r) => s + r.amount, 0));
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      revenues,
      expenses,
      totalRevenues,
      totalExpenses,
      netIncome: round2(totalRevenues - totalExpenses),
    };
  }

  // ------------------------------------------------------------------
  // الميزانية العمومية (Balance Sheet)
  // ------------------------------------------------------------------

  /**
   * الميزانية العمومية لحظة asOf:
   * - الأصول = Σ(مدين − دائن) على حسابات ASSET.
   * - الالتزامات = Σ(دائن − مدين) على LIABILITY.
   * - حقوق الملكية = Σ(دائن − مدين) على EQUITY + صافي الربح التراكمي
   *   (الإيرادات − المصروفات) حتى asOf (أرباح محتجزة ضمن حقوق الملكية —
   *   نفس معادلة Selim).
   * - فحص التوازن: الأصول = الالتزامات + حقوق الملكية (مع الفرق إن
   *   انحرف — يكشف حركة علقت على حساب تجميعي/غير نشط).
   */
  async getBalanceSheet(query: AsOfQueryDto) {
    const asOf = this.resolveAsOf(query);

    // من بداية الدفاتر حتى asOf — كل الأرصدة لحظية لا حركة فترة.
    const { accounts, debitByAccount, creditByAccount } =
      await this.loadAggregates(null, asOf);

    const assets: AccountReportRow[] = [];
    const liabilities: AccountReportRow[] = [];
    const equity: AccountReportRow[] = [];
    let revenueTotal = 0;
    let expenseTotal = 0;
    for (const account of accounts) {
      const debit = debitByAccount.get(account.id) ?? 0;
      const credit = creditByAccount.get(account.id) ?? 0;
      const row = {
        accountId: account.id,
        code: account.code,
        name: account.name,
      };
      switch (account.type) {
        case 'ASSET': {
          const amount = round2(debit - credit);
          if (amount !== 0) assets.push({ ...row, amount });
          break;
        }
        case 'LIABILITY': {
          const amount = round2(credit - debit);
          if (amount !== 0) liabilities.push({ ...row, amount });
          break;
        }
        case 'EQUITY': {
          const amount = round2(credit - debit);
          if (amount !== 0) equity.push({ ...row, amount });
          break;
        }
        case 'REVENUE':
          revenueTotal += round2(credit - debit);
          break;
        case 'EXPENSE':
          expenseTotal += round2(debit - credit);
          break;
      }
    }

    const netIncome = round2(revenueTotal - expenseTotal);
    const totalAssets = round2(assets.reduce((s, r) => s + r.amount, 0));
    const totalLiabilities = round2(
      liabilities.reduce((s, r) => s + r.amount, 0),
    );
    const equityAccountsTotal = round2(
      equity.reduce((s, r) => s + r.amount, 0),
    );
    const totalEquity = round2(equityAccountsTotal + netIncome);

    return {
      asOf: asOf.toISOString(),
      assets,
      liabilities,
      equity,
      retainedEarnings: netIncome,
      totalAssets,
      totalLiabilities,
      totalEquity,
      netIncome,
      checkAssetsEqualLiabilitiesEquity:
        totalAssets === round2(totalLiabilities + totalEquity),
      difference: round2(totalAssets - (totalLiabilities + totalEquity)),
    };
  }

  // ------------------------------------------------------------------
  // تقرير ضريبة القيمة المضافة (VAT Report)
  // ------------------------------------------------------------------

  /**
   * تقرير VAT لفترة:
   * - حسابات الضريبة = VAT_PAYABLE من دليل الحسابات + أي حساب اسمه يحوي
   *   "ضريبة" أو كوده يحوي "1330" (كود ضريبة المشتريات في دليل Selim).
   *   ملاحظة خاصة بهذا المستودع: 1330 هنا = سلف العمال (WORKER_ADVANCES)
   *   وليس ضريبة — نستثنيه صراحة حتى لا يتلوث ضريبة المدخلات بحركة السلف.
   * - outputVat = Σ(دائن − مدين) على VAT_PAYABLE (ضريبة المخرجات المستحقة).
   * - inputVat = Σ(مدين − دائن) على حسابات ضريبة المدخلات الأخرى (أصل).
   * - netVat = outputVat − inputVat (المستحق للهيئة).
   * - vatableSales = Σ vatAmount لأوامر البيع المؤكدة/المشحونة في الفترة
   *   (ضريبة المبيعات المسجلة على الأوامر) + عدد وقيمة الأوامر.
   * - vatablePurchases = 0: أوامر الشراء في هذا النظام لا تحمل حقول ضريبة
   *   (PurchaseOrder/PurchaseOrderItem بلا vat/tax — راجع prisma schema) —
   *   تُضاف عند استحقاق ضريبة المدخلات مستقبلًا في وحدة المشتريات.
   */
  async getVatReport(query: ReportRangeQueryDto) {
    const { from, to } = this.resolveRange(query);

    // اكتشاف حسابات الضريبة (VAT_PAYABLE مضمون + المطابقة الاسمية/الكودية).
    const vatPatternAccounts = await this.prisma.account.findMany({
      where: {
        isActive: true,
        isGroup: false,
        OR: [
          { name: { contains: 'ضريبة', mode: 'insensitive' } },
          { code: { contains: '1330' } },
        ],
      },
      select: { id: true, code: true, name: true, type: true },
    });
    const excluded = new Set<string>([CHART_OF_ACCOUNTS.WORKER_ADVANCES]);
    const vatAccounts = [
      {
        id: CHART_OF_ACCOUNTS.VAT_PAYABLE,
        code: '2300',
        name: 'ضريبة القيمة المضافة المستحقة',
      },
      ...vatPatternAccounts
        .filter((a) => a.id !== CHART_OF_ACCOUNTS.VAT_PAYABLE)
        .filter((a) => !excluded.has(a.id))
        .map((a) => ({ id: a.id, code: a.code, name: a.name })),
    ];
    const vatIds = [...new Set(vatAccounts.map((a) => a.id))];

    const [debitGroups, creditGroups, salesAggregate] = await Promise.all([
      this.prisma.journalLine.groupBy({
        by: ['debitAccountId'],
        _sum: { amount: true },
        where: {
          debitAccountId: { in: vatIds },
          journalEntry: { date: { gte: from, lte: to } },
        },
      }),
      this.prisma.journalLine.groupBy({
        by: ['creditAccountId'],
        _sum: { amount: true },
        where: {
          creditAccountId: { in: vatIds },
          journalEntry: { date: { gte: from, lte: to } },
        },
      }),
      this.prisma.salesOrder.aggregate({
        where: {
          createdAt: { gte: from, lte: to },
          status: { in: ['CONFIRMED', 'SHIPPED'] },
        },
        _sum: { vatAmount: true, totalAmount: true },
        _count: true,
      }),
    ]);

    const debitByAccount = new Map(
      debitGroups.map((g) => [g.debitAccountId, Number(g._sum?.amount ?? 0)]),
    );
    const creditByAccount = new Map(
      creditGroups.map((g) => [g.creditAccountId, Number(g._sum?.amount ?? 0)]),
    );

    let outputVat = 0;
    let inputVat = 0;
    const details = vatAccounts.map((account) => {
      const debit = debitByAccount.get(account.id) ?? 0;
      const credit = creditByAccount.get(account.id) ?? 0;
      const isOutput = account.id === CHART_OF_ACCOUNTS.VAT_PAYABLE;
      const net = isOutput ? round2(credit - debit) : round2(debit - credit);
      if (isOutput) outputVat += net;
      else inputVat += net;
      return {
        accountId: account.id,
        code: account.code,
        name: account.name,
        role: isOutput ? ('output' as const) : ('input' as const),
        debit: round2(debit),
        credit: round2(credit),
        net: round2(net),
      };
    });

    const vatableSales = round2(Number(salesAggregate._sum.vatAmount ?? 0));

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      outputVat: round2(outputVat),
      inputVat: round2(inputVat),
      netVat: round2(round2(outputVat) - round2(inputVat)),
      vatableSales,
      // انظر التعليق أعلاه: المشتريات بلا ضريبة مسجلة في هذا النظام.
      vatablePurchases: 0,
      salesOrders: {
        count: salesAggregate._count,
        total: round2(Number(salesAggregate._sum.totalAmount ?? 0)),
      },
      details,
    };
  }

  // ------------------------------------------------------------------
  // أعمار الذمم (Aging: AR/AP)
  // ------------------------------------------------------------------

  /**
   * أعمار الذمم لحظة asOf — النسخة الأمينة من مسار Selim:
   * - رصيد الطرف المفتوح = Customer.balance (عملاء) أو Supplier.balance
   *   (موردون) — الرصيد يُدار فعليًا من محرك القيد المزدوج ومدفوعات
   *   العملاء/الموردين والمرتجعات، فهو مصدر الحقيقة.
   * - التأريخ: أقدم أمر مفتوح (باقٍ > 0) للطرف — نستخدم dueDate وإلا
   *   createdAt، ونضع الرصيد في دلو عمر الأيام من ذلك التاريخ:
   *   0-30 / 31-60 / 61-90 / 90+.
   * - أوامر البيع المفتوحة = CONFIRMED أو SHIPPED (المشحون غير المسدد
   *   يظل ذمة قائمة)؛ وأوامر الشراء المفتوحة = APPROVED أو RECEIVED.
   * - أرصدة بلا أمر مفتوح (تسويات يدوية/سلف قديمة) تظهر في "غير مخصص"
   *   منفصلًا حتى تبقى الدلاء الأربع نقية كما في استجابة Selim.
   */
  async getAging(query: AgingQueryDto) {
    const asOf = this.resolveAsOf(query);
    const type = (query.type ?? 'AR') === 'AR' ? 'AR' : 'AP';

    const parties = await (type === 'AR'
      ? this.prisma.customer.findMany({
          where: {
            balance: { gt: 0 },
            isActive: true,
            deletedAt: null,
          },
          select: { id: true, name: true, balance: true },
          orderBy: { balance: 'desc' },
        })
      : this.prisma.supplier.findMany({
          where: {
            balance: { gt: 0 },
            isActive: true,
            deletedAt: null,
          },
          select: { id: true, name: true, balance: true },
          orderBy: { balance: 'desc' },
        }));

    const partyIds = parties.map((p) => p.id);
    // توحيد الأوامر المفتوحة (بيع/شراء) في شكل واحد مع معرف الطرف —
    // يبسّط حساب أقدم أمر مفتوح بلا تفريق union.
    interface OpenOrder {
      partyId: string;
      orderDate: Date;
      totalAmount: unknown;
      paidAmount: unknown;
    }
    const openOrders: OpenOrder[] = partyIds.length
      ? type === 'AR'
        ? (
            await this.prisma.salesOrder.findMany({
              where: {
                customerId: { in: partyIds },
                status: { in: ['CONFIRMED', 'SHIPPED'] },
              },
              select: {
                customerId: true,
                dueDate: true,
                createdAt: true,
                totalAmount: true,
                paidAmount: true,
              },
            })
          ).map((order) => ({
            partyId: order.customerId,
            orderDate: order.dueDate ?? order.createdAt,
            totalAmount: order.totalAmount,
            paidAmount: order.paidAmount,
          }))
        : (
            await this.prisma.purchaseOrder.findMany({
              where: {
                supplierId: { in: partyIds },
                status: { in: ['APPROVED', 'RECEIVED'] },
              },
              select: {
                supplierId: true,
                dueDate: true,
                createdAt: true,
                totalAmount: true,
                paidAmount: true,
              },
            })
          ).map((order) => ({
            partyId: order.supplierId,
            orderDate: order.dueDate ?? order.createdAt,
            totalAmount: order.totalAmount,
            paidAmount: order.paidAmount,
          }))
      : [];

    // أقدم أمر مفتوح (باقٍ > 0) لكل طرف.
    const oldestOpen = new Map<string, Date>();
    for (const order of openOrders) {
      const remaining =
        Number(order.totalAmount) - Number(order.paidAmount ?? 0);
      if (remaining <= 0) continue;
      const current = oldestOpen.get(order.partyId);
      if (!current || order.orderDate < current) {
        oldestOpen.set(order.partyId, order.orderDate);
      }
    }

    const buckets: Record<string, number> = {
      '0-30': 0,
      '31-60': 0,
      '61-90': 0,
      '90+': 0,
    };
    let unallocated = 0;
    const rows = parties.map((party) => {
      const balance = round2(Number(party.balance));
      const oldestOpenDate = oldestOpen.get(party.id) ?? null;
      if (!oldestOpenDate) {
        // رصيد قائم بلا أمر مفتوح قابل للتأريخ — لا نفبرك عمرًا له.
        unallocated = round2(unallocated + balance);
        return {
          id: party.id,
          name: party.name,
          balance,
          oldestOpenDate: null,
          bucket: null,
        };
      }
      const days = Math.floor(
        (asOf.getTime() - oldestOpenDate.getTime()) / 86_400_000,
      );
      // أيام سالبة = أمر لم يستحق بعد → دلو 0-30 (المستحق حديثًا).
      const bucket =
        days <= 30
          ? '0-30'
          : days <= 60
            ? '31-60'
            : days <= 90
              ? '61-90'
              : '90+';
      buckets[bucket] = round2(buckets[bucket] + balance);
      return {
        id: party.id,
        name: party.name,
        balance,
        oldestOpenDate: oldestOpenDate.toISOString(),
        bucket,
      };
    });

    const total = round2(
      Object.values(buckets).reduce((s, v) => s + v, 0) + unallocated,
    );
    return {
      type,
      asOf: asOf.toISOString(),
      buckets,
      unallocated,
      ...(type === 'AR' ? { customers: rows } : { suppliers: rows }),
      total,
    };
  }

  // ------------------------------------------------------------------
  // الميزانيات (Budgets)
  // ------------------------------------------------------------------

  /** قائمة الميزانيات بفلترة سنة/حساب/فترة + ترقيم (مع الحساب). */
  async getBudgets(query: QueryBudgetDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.BudgetWhereInput = {};
    if (query.fiscalYear !== undefined) where.fiscalYear = query.fiscalYear;
    if (query.accountId) where.accountId = query.accountId;
    if (query.period) where.period = query.period;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.budget.findMany({
        where,
        include: {
          account: { select: { id: true, code: true, name: true, type: true } },
        },
        orderBy: [
          { fiscalYear: 'desc' },
          { accountId: 'asc' },
          { periodIndex: 'asc' },
        ],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.budget.count({ where }),
    ]);
    return { items, total, page, limit, pages: Math.ceil(total / limit) || 1 };
  }

  /**
   * إنشاء ميزانية — الحساب ورقة قائمة، ورقم الفترة ضمن نطاق نوعه،
   * والتفرد لكل (حساب، سنة، فترة، رقم فترة): فحص مسبق + التقاط P2002
   * (إن أُضيف قيد فريد لاحقًا في schema) بنفس الرسالة العربية.
   */
  async createBudget(dto: CreateBudgetDto) {
    this.assertBudgetPeriodBounds(dto.period, dto.periodIndex);

    const account = await this.prisma.account.findUnique({
      where: { id: dto.accountId },
      select: { id: true, isGroup: true },
    });
    if (!account || account.isGroup) {
      throw new BadRequestException('حساب الميزانية غير موجود أو حساب تجميعي');
    }
    if (dto.costCenterId) {
      const costCenter = await this.prisma.costCenter.findUnique({
        where: { id: dto.costCenterId },
        select: { id: true },
      });
      if (!costCenter) throw new NotFoundException('مركز التكلفة غير موجود');
    }

    const existing = await this.prisma.budget.findFirst({
      where: {
        accountId: dto.accountId,
        fiscalYear: dto.fiscalYear,
        period: dto.period,
        periodIndex: dto.periodIndex,
      },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('ميزانية موجودة لهذا الحساب والفترة');
    }

    try {
      return await this.prisma.budget.create({
        data: {
          accountId: dto.accountId,
          costCenterId: dto.costCenterId ?? null,
          fiscalYear: dto.fiscalYear,
          period: dto.period,
          periodIndex: dto.periodIndex,
          amount: new Prisma.Decimal(dto.amount),
        },
        include: {
          account: { select: { id: true, code: true, name: true, type: true } },
        },
      });
    } catch (error) {
      if ((error as { code?: string })?.code === 'P2002') {
        throw new ConflictException('ميزانية موجودة لهذا الحساب والفترة');
      }
      throw error;
    }
  }

  /** تعديل مبلغ/مركز تكلفة الميزانية — الهوية (حساب/سنة/فترة) ثابتة. */
  async updateBudget(id: string, dto: UpdateBudgetDto) {
    const existing = await this.prisma.budget.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('الميزانية غير موجودة');
    if (dto.costCenterId) {
      const costCenter = await this.prisma.costCenter.findUnique({
        where: { id: dto.costCenterId },
        select: { id: true },
      });
      if (!costCenter) throw new NotFoundException('مركز التكلفة غير موجود');
    }
    return this.prisma.budget.update({
      where: { id },
      data: {
        ...(dto.amount !== undefined
          ? { amount: new Prisma.Decimal(dto.amount) }
          : {}),
        ...(dto.costCenterId !== undefined
          ? { costCenterId: dto.costCenterId }
          : {}),
      },
      include: {
        account: { select: { id: true, code: true, name: true, type: true } },
      },
    });
  }

  /** حذف ميزانية (لا مرجع لها — الأصل/مركز التكلفة لا يتأثرون). */
  async removeBudget(id: string) {
    const existing = await this.prisma.budget.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('الميزانية غير موجودة');
    await this.prisma.budget.delete({ where: { id } });
    return { deleted: true, id };
  }

  /**
   * تباين الميزانية لسنة مالية: لكل صف ميزانية، الفعلي = Σ حركة القيود
   * على الحساب داخل نافذة فترة الميزانية (سنة كاملة للـ yearly، الشهر
   * للـ monthly، الربع للـ quarterly) بإشارة اتجاه نوع الحساب (مدين-دائن
   * للأصول/المصروفات، دائن-مدين للإيرادات/الالتزامات/حقوق الملكية)،
   * والتباين = المخطط − الفعلي (موجب = تحت الميزانية).
   */
  async getBudgetVariance(fiscalYear: number) {
    const budgets = await this.prisma.budget.findMany({
      where: { fiscalYear },
      include: {
        account: { select: { id: true, code: true, name: true, type: true } },
      },
      orderBy: [
        { period: 'asc' },
        { periodIndex: 'asc' },
        { accountId: 'asc' },
      ],
    });

    // تجميع واحد لكل نافذة زمنية مميزة (لا استعلام لكل صف).
    const windows = new Map<string, { from: Date; to: Date }>();
    for (const budget of budgets) {
      const key = `${budget.period}|${budget.periodIndex}`;
      if (!windows.has(key)) {
        windows.set(
          key,
          this.budgetWindow(budget.period, budget.periodIndex, fiscalYear),
        );
      }
    }

    // لكل نافذة: مجموع مدين/دائن لكل حساب من journal_lines.
    const windowAggregates = new Map<
      string,
      { debit: Map<string, number>; credit: Map<string, number> }
    >();
    for (const [key, window] of windows) {
      const [debitGroups, creditGroups] = await Promise.all([
        this.prisma.journalLine.groupBy({
          by: ['debitAccountId'],
          _sum: { amount: true },
          where: {
            journalEntry: {
              date: { gte: window.from, lte: window.to },
            },
          },
        }),
        this.prisma.journalLine.groupBy({
          by: ['creditAccountId'],
          _sum: { amount: true },
          where: {
            journalEntry: {
              date: { gte: window.from, lte: window.to },
            },
          },
        }),
      ]);
      windowAggregates.set(key, {
        debit: new Map(
          debitGroups.map((g) => [
            g.debitAccountId,
            Number(g._sum?.amount ?? 0),
          ]),
        ),
        credit: new Map(
          creditGroups.map((g) => [
            g.creditAccountId,
            Number(g._sum?.amount ?? 0),
          ]),
        ),
      });
    }

    const rows = budgets.map((budget) => {
      const key = `${budget.period}|${budget.periodIndex}`;
      const aggregate = windowAggregates.get(key)!;
      const debit = aggregate.debit.get(budget.accountId) ?? 0;
      const credit = aggregate.credit.get(budget.accountId) ?? 0;
      // اتجاه الرصيد حسب نوع الحساب (مصروف: المدين هو "الاستخدام").
      const actual =
        budget.account.type === 'REVENUE' ||
        budget.account.type === 'LIABILITY' ||
        budget.account.type === 'EQUITY'
          ? round2(credit - debit)
          : round2(debit - credit);
      const planned = round2(Number(budget.amount));
      return {
        budgetId: budget.id,
        accountId: budget.accountId,
        accountCode: budget.account.code,
        accountName: budget.account.name,
        accountType: budget.account.type,
        costCenterId: budget.costCenterId,
        fiscalYear: budget.fiscalYear,
        period: budget.period,
        periodIndex: budget.periodIndex,
        planned,
        actual,
        variance: round2(planned - actual),
      };
    });

    return {
      fiscalYear,
      rows,
      totalPlanned: round2(rows.reduce((s, r) => s + r.planned, 0)),
      totalActual: round2(rows.reduce((s, r) => s + r.actual, 0)),
      totalVariance: round2(rows.reduce((s, r) => s + r.variance, 0)),
    };
  }

  // ------------------------------------------------------------------
  // أدوات داخلية مشتركة
  // ------------------------------------------------------------------

  /**
   * تحميل تجميعات journal_lines لحسابات كل الدليل (نفس أسلوب ميزان
   * المراجعة: groupBy على عمودي الاتجاه) مع فلترة زمنية على تاريخ
   * القيد. from=null يعني من بداية الدفاتر.
   */
  private async loadAggregates(from: Date | null, to: Date) {
    const dateFilter: Prisma.DateTimeFilter = {
      ...(from ? { gte: from } : {}),
      lte: to,
    };
    const [debitGroups, creditGroups, accounts] = await Promise.all([
      this.prisma.journalLine.groupBy({
        by: ['debitAccountId'],
        _sum: { amount: true },
        where: { journalEntry: { date: dateFilter } },
      }),
      this.prisma.journalLine.groupBy({
        by: ['creditAccountId'],
        _sum: { amount: true },
        where: { journalEntry: { date: dateFilter } },
      }),
      this.prisma.account.findMany({
        where: { isActive: true, isGroup: false },
        select: { id: true, code: true, name: true, type: true },
        orderBy: { code: 'asc' },
      }),
    ]);
    return {
      accounts,
      debitByAccount: new Map(
        debitGroups.map((g) => [g.debitAccountId, Number(g._sum?.amount ?? 0)]),
      ),
      creditByAccount: new Map(
        creditGroups.map((g) => [
          g.creditAccountId,
          Number(g._sum?.amount ?? 0),
        ]),
      ),
    };
  }

  /**
   * حل نطاق التقرير: افتراضي الشهر الحالي (أوله → الآن)، ورفض النطاق
   * المعكوس — convention موحد لكل تقارير النطاق (نفس حارس Selim).
   */
  private resolveRange(query: { from?: string; to?: string }): {
    from: Date;
    to: Date;
  } {
    const now = new Date();
    const from = query.from
      ? new Date(query.from)
      : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const to = query.to ? new Date(query.to) : now;
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new BadRequestException('صيغة التاريخ غير صالحة');
    }
    if (from.getTime() > to.getTime()) {
      throw new BadRequestException(
        'تاريخ البداية يجب أن يكون قبل تاريخ النهاية',
      );
    }
    return { from, to };
  }

  /** تاريخ التقييم اللحظي (asOf) — افتراضيًا الآن. */
  private resolveAsOf(query: { asOf?: string }): Date {
    const asOf = query.asOf ? new Date(query.asOf) : new Date();
    if (Number.isNaN(asOf.getTime())) {
      throw new BadRequestException('صيغة تاريخ التقييم غير صالحة');
    }
    return asOf;
  }

  /** نطاق رقم الفترة حسب نوعها (monthly 1-12 / quarterly 1-4 / yearly 1). */
  private assertBudgetPeriodBounds(period: string, periodIndex: number) {
    if (!BUDGET_PERIODS.includes(period as never)) {
      throw new BadRequestException('نوع الفترة غير صالح');
    }
    if (period === 'monthly' && (periodIndex < 1 || periodIndex > 12)) {
      throw new BadRequestException('رقم الشهر يجب أن يكون بين 1 و 12');
    }
    if (period === 'quarterly' && (periodIndex < 1 || periodIndex > 4)) {
      throw new BadRequestException('رقم الربع يجب أن يكون بين 1 و 4');
    }
    if (period === 'yearly' && periodIndex !== 1) {
      throw new BadRequestException('ميزانية السنة تستخدم رقم فترة 1');
    }
  }

  /** نافذة زمنية لفترة ميزانية داخل سنتها المالية (UTC). */
  private budgetWindow(
    period: string,
    periodIndex: number,
    fiscalYear: number,
  ): { from: Date; to: Date } {
    if (period === 'monthly') {
      return {
        from: new Date(Date.UTC(fiscalYear, periodIndex - 1, 1)),
        to: new Date(Date.UTC(fiscalYear, periodIndex, 1).valueOf() - 1),
      };
    }
    if (period === 'quarterly') {
      return {
        from: new Date(Date.UTC(fiscalYear, (periodIndex - 1) * 3, 1)),
        to: new Date(Date.UTC(fiscalYear, periodIndex * 3, 1).valueOf() - 1),
      };
    }
    return {
      from: new Date(Date.UTC(fiscalYear, 0, 1)),
      to: new Date(Date.UTC(fiscalYear + 1, 0, 1).valueOf() - 1),
    };
  }
}
