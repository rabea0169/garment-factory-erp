import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma, AccountType, VoucherType } from '@prisma/client';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { PaginatedResult } from '../../common/dto/paginated-result.dto';
import { VoucherQueryDto } from './dto/voucher-query.dto';
import { JournalEntryQueryDto } from './dto/journal-entry-query.dto';
import { AccountStatementQueryDto } from './dto/account-statement-query.dto';
import { CHART_OF_ACCOUNTS } from '../../core/financial/chart-of-accounts';
import { FinancialPostingService } from '../../core/financial/financial-posting.service';
import {
  computeRequestHash,
  storeIdempotencyResponse,
  tryReplayIdempotencyKey,
} from '../../core/common/idempotency.util';
import { round2 } from '../../core/common/money.util';

/**
 * ACC-1 (P0 — GF-IMP-W1): مصفوفة حساب الطرف المقابل في السندات — صريحة
 * لكل نوع طرف بدل التخمين الثنائي (مورد؟ AP : AR) الذي كان يوجّه سندات
 * العمال وسندات بلا طرف إلى ذمم التحصيل خطأً:
 *   SUPPLIER → ACCOUNTS_PAYABLE (ذمم الموردين)
 *   CUSTOMER → ACCOUNTS_RECEIVABLE (ذمم العملاء)
 *   WORKER   → WORKER_ADVANCES (أصل سلف العمال)
 * لا تغيّر اتجاه المدين/الدائن لنوع السند — فقط توجيه الحساب المقابل.
 */
const VOUCHER_COUNTERPARTY_ACCOUNTS: Record<
  'CUSTOMER' | 'SUPPLIER' | 'WORKER',
  string
> = {
  SUPPLIER: CHART_OF_ACCOUNTS.ACCOUNTS_PAYABLE,
  CUSTOMER: CHART_OF_ACCOUNTS.ACCOUNTS_RECEIVABLE,
  WORKER: CHART_OF_ACCOUNTS.WORKER_ADVANCES,
};

@Injectable()
export class AccountingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly financial: FinancialPostingService,
  ) {}

  async getChartOfAccounts(pagination: PaginationDto = new PaginationDto()) {
    const page = pagination.page ?? 1;
    const pageSize = pagination.limit ?? 20;
    const skip = (page - 1) * pageSize;
    const options = { orderBy: { code: 'asc' } as const, skip, take: pageSize };

    const [data, total] = await Promise.all([
      this.prisma.account.findMany(options),
      this.prisma.account.count(),
    ]);

    return new PaginatedResult(data, total, page, pageSize);
  }

  async createAccount(
    data: {
      code: string;
      name: string;
      type: AccountType;
      parentId?: string;
      isGroup?: boolean;
    },
    idempotencyKey?: string,
  ) {
    // RES-F02: replay-safe retry via Idempotency-Key header.
    const requestHash = computeRequestHash({
      code: data.code,
      name: data.name,
      type: data.type,
      parentId: data.parentId ?? null,
      isGroup: data.isGroup ?? false,
    });
    const scope = 'account-create';
    return this.prisma.$transaction(async (tx) => {
      const replay = await tryReplayIdempotencyKey(
        tx,
        idempotencyKey,
        scope,
        requestHash,
      );
      if (replay)
        return replay as Awaited<ReturnType<typeof tx.account.create>> & {
          replayed: true;
        };
      const created = await tx.account.create({
        data: {
          code: data.code,
          name: data.name,
          type: data.type,
          parentId: data.parentId,
          isGroup: data.isGroup || false,
        },
      });
      await storeIdempotencyResponse(tx, idempotencyKey, created);
      return created;
    });
  }

  async getTreasuries(pagination: PaginationDto = new PaginationDto()) {
    const page = pagination.page ?? 1;
    const pageSize = pagination.limit ?? 20;
    const skip = (page - 1) * pageSize;
    const where = { isActive: true, deletedAt: null };
    const [data, total] = await Promise.all([
      this.prisma.treasury.findMany({
        where,
        orderBy: { name: 'asc' },
        skip,
        take: pageSize,
        select: { id: true, name: true, type: true, balance: true },
      }),
      this.prisma.treasury.count({ where }),
    ]);
    return new PaginatedResult(data, total, page, pageSize);
  }

  async getVouchers(query: VoucherQueryDto = new VoucherQueryDto()) {
    const page = query.page ?? 1;
    const pageSize = query.limit ?? 20;
    const skip = (page - 1) * pageSize;
    // ACC-6 (P2 — GF-IMP-W3): فلاتر اختيارية على قائمة السندات — النوع /
    // الخزينة / الطرف المقابل / نطاق تاريخ السند. الشروط الغائبة لا تدخل
    // where (لا undefined keys) والفهارس القائمة (type, date) و
    // (counterpartyId) تغطي الاستعلام المرشّح.
    const where: Prisma.VoucherWhereInput = {};
    if (query.type) where.type = query.type;
    if (query.treasuryId) where.treasuryId = query.treasuryId;
    if (query.counterpartyId) where.counterpartyId = query.counterpartyId;
    if (query.from || query.to) {
      where.date = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }
    const options = {
      where,
      include: {
        createdBy: { select: { name: true } },
        journalEntry: { select: { code: true, id: true } },
        treasury: { select: { id: true, name: true } },
      },
      orderBy: { date: 'desc' } as const,
      skip,
      take: pageSize,
    };

    const [data, total] = await Promise.all([
      this.prisma.voucher.findMany(options),
      this.prisma.voucher.count({ where }),
    ]);

    return new PaginatedResult(data, total, page, pageSize);
  }

  async createFiscalPeriod(
    data: { name: string; startDate: string; endDate: string },
    createdById: string,
    idempotencyKey?: string,
  ) {
    // RES-F02: replay-safe retry via Idempotency-Key header.
    const requestHash = computeRequestHash({
      name: data.name,
      startDate: data.startDate,
      endDate: data.endDate,
      createdById,
    });
    const scope = 'fiscal-period-create';
    const startDate = new Date(data.startDate);
    const endDate = new Date(data.endDate);
    if (
      !Number.isFinite(startDate.getTime()) ||
      !Number.isFinite(endDate.getTime()) ||
      startDate > endDate
    ) {
      throw new BadRequestException('نطاق الفترة المالية غير صالح');
    }
    return this.prisma.$transaction(async (tx) => {
      const replay = await tryReplayIdempotencyKey(
        tx,
        idempotencyKey,
        scope,
        requestHash,
      );
      if (replay)
        return replay as Awaited<ReturnType<typeof tx.fiscalPeriod.create>> & {
          replayed: true;
        };
      // ACC-4 (P2 — GF-IMP-W3): فحص التداخل داخل المعاملة نفسها — كان
      // يجري قبل $transaction (TOCTOU) فكانت فترتان متزامنتان تجتازان
      // الفحص على لقطة قاعدة قديمة ثم تلتزمان معًا متداخلتين. إعادته
      // داخل المعاملة تجعل الفحص والإنشاء ذريين على نفس اللقطة (القراء
      // المتزامنون على committed rows لا يزالون محكومين بترتيب الالتزام).
      const overlap = await tx.fiscalPeriod.findFirst({
        where: {
          startDate: { lte: endDate },
          endDate: { gte: startDate },
        },
        select: { id: true },
      });
      if (overlap) {
        throw new ConflictException('الفترة المالية تتداخل مع فترة موجودة');
      }
      const created = await tx.fiscalPeriod.create({
        data: { ...data, startDate, endDate, createdById },
      });
      await storeIdempotencyResponse(tx, idempotencyKey, created);
      return created;
    });
  }

  async closeFiscalPeriod(id: string, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.fiscalPeriod.updateMany({
        where: { id, status: 'OPEN' },
        data: { status: 'CLOSED' },
      });
      if (result.count !== 1) {
        throw new ConflictException('الفترة غير موجودة أو مغلقة بالفعل');
      }
      const period = await tx.fiscalPeriod.findUnique({ where: { id } });
      if (!period) throw new ConflictException('الفترة المالية غير موجودة');
      await tx.activityLog.create({
        data: {
          userId: actorId,
          action: 'FISCAL_PERIOD_CLOSED',
          module: 'ACCOUNTING',
          details: { fiscalPeriodId: id },
        },
      });
      return period;
    });
  }

  async createJournalEntry(
    data: {
      description: string;
      reference?: string;
      fiscalPeriodId: string;
      date?: string;
      lines: {
        debitAccountId: string;
        creditAccountId: string;
        amount: number;
        description?: string;
      }[];
    },
    userId: string,
    idempotencyKey?: string,
  ) {
    const date = data.date ? new Date(data.date) : new Date();
    if (!Number.isFinite(date.getTime())) {
      throw new BadRequestException('تاريخ القيد غير صالح');
    }
    // RES-F02: forward the idempotency key as postingKey — the financial
    // posting service already uses it to detect and return replays.
    return this.financial.postJournalEntry(
      {
        description: data.description,
        reference: data.reference,
        fiscalPeriodId: data.fiscalPeriodId,
        date,
        lines: data.lines,
        userId,
        postingKey: idempotencyKey ? `journal:${idempotencyKey}` : undefined,
      },
      userId,
    );
  }

  /**
   * A3: إنشاء سند مالي مرتبط بقيد مزدوج ذري.
   *
   * النمط المحاسبي:
   *  - RECEIPT (سند قبض): الخزينة تستلم نقدًا من طرف مقابل (عميل عادة).
   *    مدين: CASH/BANK، دائن: ACCOUNTS_RECEIVABLE (لو من عميل آجل).
   *  - PAYMENT (سند صرف): الخزينة تدفع نقدًا لطرف مقابل (مورد عادة).
   *    مدين: ACCOUNTS_PAYABLE (لو لمورد آجل)، دائن: CASH/BANK.
   *
   * كل قيد يُنشئ JournalEntry + JournalLines + تحديث Treasury.balance ذريًّا.
   * Voucher.journalEntryId يربطه بالقيد — لا سند بلا أثر مالي حقيقي (A3).
   */
  async createVoucher(
    data: {
      type: VoucherType;
      amount: number;
      description: string;
      reference?: string;
      treasuryId: string;
      counterpartyType?: 'CUSTOMER' | 'SUPPLIER' | 'WORKER';
      counterpartyId?: string;
    },
    createdById: string,
    idempotencyKey?: string,
  ) {
    if (!Number.isFinite(data.amount) || data.amount <= 0) {
      throw new BadRequestException('مبلغ السند يجب أن يكون موجبًا');
    }

    // ACC-1 (P1 — audit-BE2): الطرف المقابل يتطلب معرفًا — سند بنوع طرف بلا
    // معرف كان يُقيّد على حساب التحكم (AR/AP/WORKER_ADVANCES) دون تحديد
    // الكيان، فلا يمكن مطابقة الرصيد لاحقًا ولا التدقيق.
    if (data.counterpartyType && !data.counterpartyId) {
      throw new BadRequestException(
        'معرف الطرف المقابل (counterpartyId) مطلوب عند تحديد نوع الطرف',
      );
    }
    // WORKER (P1 — audit-BE2): سند الصرف للعامل يُنشئ سجل WorkerAdvance داخل
    // نفس المعاملة (رصيد GL يخصم من رواتب العامل فعليًا عبر createPayroll)،
    // وسند القبض من العامل يسوّي السلف غير المسوّاة FIFO (محاسبة GL ↔
    // السجلات متطابقة دائمًا). قبل هذا الإصلاح كان السند يقيد
    // WORKER_ADVANCES بلا أي صف سلف → السلفة لا تُخصم من الرواتب أبدًا.
    if (data.counterpartyType === 'WORKER') {
      if (data.type === VoucherType.RECEIPT) {
        // القبض من العامل = رد سلفة: نسوّي السلف القائمة (المسار المحاسبي
        // للسلف اليدوية عبر /hr/advances). رصيد غير مسوّى صفر → رفض.
        const unsettled = await this.prisma.workerAdvance.findMany({
          where: { workerId: data.counterpartyId },
          orderBy: [{ date: 'asc' }, { id: 'asc' }],
        });
        const unsettledTotal = unsettled
          .filter((a) => a.amount.gt(a.settledAmount))
          .reduce(
            (sum, a) => sum.plus(a.amount.minus(a.settledAmount)),
            new Prisma.Decimal(0),
          );
        if (new Prisma.Decimal(data.amount).gt(unsettledTotal)) {
          throw new BadRequestException(
            `مبلغ السند (${data.amount}) يتجاوز إجمالي السلف غير المسوّاة للعامل (${unsettledTotal.toString()}) — ` +
              'سند القبض من عامل يسوّي سلفًا قائمة فقط',
          );
        }
      }
    }

    const cashAccount = CHART_OF_ACCOUNTS.CASH;
    // ACC-1: الطرف المقابل من المصفوفة الصريحة أعلاه، والسند بلا طرف
    // مقابل (undefined/فارغ) يُقيّ على GENERAL_EXPENSE — حساب المصروفات
    // النثرية (5000) كما يوثّق تعليقه في شجرة الحسابات.
    const counterpartyAccount = data.counterpartyType
      ? VOUCHER_COUNTERPARTY_ACCOUNTS[data.counterpartyType]
      : CHART_OF_ACCOUNTS.GENERAL_EXPENSE;
    const lines =
      data.type === VoucherType.RECEIPT
        ? [
            {
              debitAccountId: cashAccount,
              creditAccountId: counterpartyAccount,
              amount: data.amount,
              description: data.description,
            },
          ]
        : [
            {
              debitAccountId: counterpartyAccount,
              creditAccountId: cashAccount,
              amount: data.amount,
              description: data.description,
            },
          ];
    const treasuryDelta =
      data.type === VoucherType.RECEIPT ? data.amount : -data.amount;

    return this.prisma.$transaction(async (tx) => {
      // WORKER (P1 — audit-BE2): تحقق وجود العامل داخل المعاملة (404) —
      // counterpartyId غير الموجود كان يُقبل بصمت.
      if (data.counterpartyType === 'WORKER' && data.counterpartyId) {
        const worker = await tx.worker.findUnique({
          where: { id: data.counterpartyId },
          select: { id: true, name: true },
        });
        if (!worker) {
          throw new NotFoundException(
            `العامل ${data.counterpartyId} غير موجود`,
          );
        }
      }
      const entry = await this.financial.postJournalEntryInTx(
        tx,
        {
          description: `سند ${
            data.type === VoucherType.RECEIPT ? 'قبض' : 'صرف'
          }: ${data.description}`,
          reference: data.reference,
          postingKey: idempotencyKey ? `voucher:${idempotencyKey}` : undefined,
          isAuto: true,
          lines,
          userId: createdById,
          metadata: {
            source: 'accounting.voucher',
            ...(data.counterpartyType && data.counterpartyId
              ? {
                  counterpartyType: data.counterpartyType,
                  counterpartyId: data.counterpartyId,
                }
              : {}),
          },
          treasuryUpdates: [
            { treasuryId: data.treasuryId, delta: treasuryDelta },
          ],
          ...(data.counterpartyType === 'CUSTOMER' && data.counterpartyId
            ? {
                customerUpdates: [
                  {
                    customerId: data.counterpartyId,
                    delta:
                      data.type === VoucherType.RECEIPT
                        ? -data.amount
                        : data.amount,
                  },
                ],
              }
            : {}),
          ...(data.counterpartyType === 'SUPPLIER' && data.counterpartyId
            ? {
                supplierUpdates: [
                  {
                    supplierId: data.counterpartyId,
                    delta:
                      data.type === VoucherType.PAYMENT
                        ? -data.amount
                        : data.amount,
                  },
                ],
              }
            : {}),
        },
        createdById,
      );

      const existingVoucher = idempotencyKey
        ? await tx.voucher.findFirst({
            where: { journalEntryId: entry.entryId },
            include: {
              journalEntry: { select: { code: true, id: true } },
              treasury: { select: { id: true, name: true } },
            },
          })
        : null;
      if (existingVoucher) return existingVoucher;

      const voucherCode = `VCH-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${randomBytes(4).toString('hex').toUpperCase()}`;
      // WORKER (P1 — audit-BE2) — بعد نجاح الترحيل وقبل إنشاء السند (مسار
      // غير الـ replay فقط): سند الصرف للعامل يُنشئ صف WorkerAdvance حتى
      // يُخصم من كشوف رواتبه اللاحقة (الخصم يقرأ صفوف worker_advances فقط)،
      // وسند القبض منه يسوّي السلف غير المسوّاة FIFO بالمبلغ نفسه —
      // فتبقى أرصدة GL والحسابات التشغيلية متطابقة دائمًا.
      if (data.counterpartyType === 'WORKER' && data.counterpartyId) {
        if (data.type === VoucherType.PAYMENT) {
          await tx.workerAdvance.create({
            data: {
              workerId: data.counterpartyId,
              amount: new Prisma.Decimal(round2(data.amount)),
              notes: `سند صرف ${voucherCode}: ${data.description}`,
            },
          });
        } else {
          // RECEIPT: تسوية FIFO بمقدار السند (تحقق الرصيد أعلاه ضمنيًا —
          // المبلغ ≤ غير المسوّى)، بنفس توزيع خصم الرواتب.
          const advances = await tx.workerAdvance.findMany({
            where: { workerId: data.counterpartyId },
            orderBy: [{ date: 'asc' }, { id: 'asc' }],
          });
          let remaining = new Prisma.Decimal(round2(data.amount));
          for (const advance of advances) {
            if (remaining.lte(0)) break;
            const outstanding = advance.amount.minus(advance.settledAmount);
            if (outstanding.lte(0)) continue;
            const allocation = outstanding.lt(remaining)
              ? outstanding
              : remaining;
            await tx.workerAdvance.update({
              where: { id: advance.id },
              data: { settledAmount: { increment: allocation } },
            });
            remaining = remaining.minus(allocation);
          }
        }
      }
      return tx.voucher.create({
        data: {
          code: voucherCode,
          type: data.type,
          amount: data.amount,
          description: data.description,
          reference: data.reference,
          createdById,
          journalEntryId: entry.entryId,
          treasuryId: data.treasuryId,
          counterpartyType: data.counterpartyType ?? null,
          counterpartyId: data.counterpartyId ?? null,
        },
        include: {
          journalEntry: { select: { code: true, id: true } },
          treasury: { select: { id: true, name: true } },
        },
      });
    });
  }

  /**
   * A9: عكس قيد مالي موجود. ينشئ قيدًا عكسيًا مرتبطًا بالأصلي (غير تدميري).
   *
   * الـ endpoint يُعطّل الكتابة على القيد الأصلي (isReversed=true) ويُنشئ قيدًا
   * جديدًا بنفس البنود لكن بمدين/دائن مقلوبين. القيد الجديد يربط بالأصلي عبر
   * reversalOfId لحفظ سلسلة المراجعة.
   *
   * ملاحظة: لا يعكس تلقائيًا أثر الـ treasury/customer/supplier. لتعقبه،
   * استدعِ reverseVoucher بدلًا من ذلك (ميزة مستقبلية).
   */
  async reverseJournalEntry(
    originalEntryId: string,
    userId: string,
    description?: string,
    idempotencyKey?: string,
  ) {
    // RES-F02: forward idempotencyKey as postingKey for the reversal entry;
    // financial.postJournalEntry already detects replay via postingKey.
    return this.financial.reverseJournalEntry(
      originalEntryId,
      userId,
      description,
      idempotencyKey,
    );
  }

  // ===================== ACC-8 (P2 — GF-IMP-W3): سطح القراءة المحاسبي =====================

  /**
   * ACC-8: قائمة قيود اليومية ببنودها — مرقمة بفلاتر (نطاق تاريخ القيد،
   * حالة العكس، مرجع يحتوي نصًا). القراءة فقط من journal_entries/lines
   * بلا أي أثر جانبي. الترتيب: الأحدث أولًا.
   */
  async getJournalEntries(
    query: JournalEntryQueryDto = new JournalEntryQueryDto(),
  ) {
    const page = query.page ?? 1;
    const pageSize = query.limit ?? 20;
    const skip = (page - 1) * pageSize;
    const where: Prisma.JournalEntryWhereInput = {};
    if (query.from || query.to) {
      where.date = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }
    if (query.isReversed !== undefined) {
      where.isReversed = query.isReversed;
    }
    if (query.reference) {
      where.reference = { contains: query.reference };
    }
    const [data, total] = await Promise.all([
      this.prisma.journalEntry.findMany({
        where,
        include: {
          lines: true,
          createdBy: { select: { name: true } },
        },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: pageSize,
      }),
      this.prisma.journalEntry.count({ where }),
    ]);
    return new PaginatedResult(data, total, page, pageSize);
  }

  /**
   * ACC-8: كشف حساب — بنود القيود المفهرسة للحساب (مدين/دائن/الرصيد
   * الجاري التراكمي) محسوبة من journal_lines مع فلتر تاريخ وترقيم.
   *
   * الدلالات:
   *  - البنود ترتيبًا زمنيًا (تاريخ القيد، ثم وقت إنشائه، ثم معرف البند
   *    كفاصل حتمي للترتيب).
   *  - الرصيد الافتتاحي: عند توفير from يُحسب من مجموع حركات الحساب قبل
   *    from (مدين − دائن)؛ بدونه يبدأ الكشف من الصفر (كشف كامل).
   *  - الرصيد الجاري يتراكم على كامل مجموعة البنود المرشحة (لا على صفحة
   *    العرض وحدها) — لذلك نُجلب البنود المرشحة كاملة ثم نرقّم في الذاكرة.
   *    مقايضة موثقة: كشوف الحساب الشائعة قابلة لهذا الحجم بسهولة، وفي
   *    المقابل تبقى أرقام الرصيد الجاري صحيحة عبر الصفحات.
   */
  async getAccountStatement(
    accountId: string,
    query: AccountStatementQueryDto = new AccountStatementQueryDto(),
  ) {
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: { id: true, code: true, name: true },
    });
    if (!account) throw new NotFoundException('الحساب المحاسبي غير موجود');

    const page = query.page ?? 1;
    const pageSize = query.limit ?? 20;

    const lineFilter: Prisma.JournalLineWhereInput = {
      OR: [{ debitAccountId: accountId }, { creditAccountId: accountId }],
    };
    // فلتر تاريخ القيد (علاقة journalEntry) — DateTimeFilter وليس WhereInput.
    const entryDateFilter: Prisma.DateTimeFilter<'JournalEntry'> = {};
    if (query.from) entryDateFilter.gte = new Date(query.from);
    if (query.to) entryDateFilter.lte = new Date(query.to);
    if (query.from || query.to) {
      lineFilter.journalEntry = { date: entryDateFilter };
    }

    // الرصيد الافتتاحي (قبل from) — حركتان مجمّعتان: مدين ثم دائن.
    let openingBalance = 0;
    if (query.from) {
      const before: Prisma.DateTimeFilter<'JournalEntry'> = {
        lt: new Date(query.from),
      };
      const [debitBefore, creditBefore] = await Promise.all([
        this.prisma.journalLine.aggregate({
          where: { debitAccountId: accountId, journalEntry: { date: before } },
          _sum: { amount: true },
        }),
        this.prisma.journalLine.aggregate({
          where: { creditAccountId: accountId, journalEntry: { date: before } },
          _sum: { amount: true },
        }),
      ]);
      openingBalance =
        Number(debitBefore._sum.amount ?? 0) -
        Number(creditBefore._sum.amount ?? 0);
    }

    // كامل البنود المرشحة — مطلوبة لحساب الرصيد الجاري الصحيح عبر الصفحات.
    const allLines = await this.prisma.journalLine.findMany({
      where: lineFilter,
      include: {
        journalEntry: { select: { id: true, code: true, date: true } },
      },
      orderBy: [
        { journalEntry: { date: 'asc' } },
        { journalEntry: { createdAt: 'asc' } },
        { id: 'asc' },
      ],
    });

    let running = openingBalance;
    const rows = allLines.map((line) => {
      const amount = Number(line.amount);
      const debit = line.debitAccountId === accountId ? amount : 0;
      const credit = line.creditAccountId === accountId ? amount : 0;
      running += debit - credit;
      return {
        id: line.id,
        entryId: line.journalEntry.id,
        entryCode: line.journalEntry.code,
        date: line.journalEntry.date,
        description: line.description,
        debit,
        credit,
        amount,
        runningBalance: round2(running),
      };
    });

    const total = rows.length;
    const data = rows.slice(
      (page - 1) * pageSize,
      (page - 1) * pageSize + pageSize,
    );
    return {
      account,
      openingBalance: round2(openingBalance),
      closingBalance: round2(running),
      ...new PaginatedResult(data, total, page, pageSize),
    };
  }

  /**
   * ACC-8: ميزان المراجعة — لكل حساب نشط (ورقة) {code, name, totalDebit,
   * totalCredit, balance} من تجميع journal_lines، مع تحقق التوازن
   * الكلي (مجموع المدين = مجموع الدائن) في الاستجابة (balanced: true).
   */
  async getTrialBalance() {
    const [debitGroups, creditGroups, accounts] = await Promise.all([
      this.prisma.journalLine.groupBy({
        by: ['debitAccountId'],
        _sum: { amount: true },
      }),
      this.prisma.journalLine.groupBy({
        by: ['creditAccountId'],
        _sum: { amount: true },
      }),
      this.prisma.account.findMany({
        where: { isActive: true, isGroup: false },
        select: { id: true, code: true, name: true, type: true },
        orderBy: { code: 'asc' },
      }),
    ]);

    const debitByAccount = new Map(
      debitGroups.map((g) => [g.debitAccountId, Number(g._sum.amount ?? 0)]),
    );
    const creditByAccount = new Map(
      creditGroups.map((g) => [g.creditAccountId, Number(g._sum.amount ?? 0)]),
    );

    const data = accounts.map((account) => {
      const totalDebit = debitByAccount.get(account.id) ?? 0;
      const totalCredit = creditByAccount.get(account.id) ?? 0;
      return {
        code: account.code,
        name: account.name,
        totalDebit: round2(totalDebit),
        totalCredit: round2(totalCredit),
        balance: round2(totalDebit - totalCredit),
      };
    });

    const totalDebit = round2(
      data.reduce((sum, row) => sum + row.totalDebit, 0),
    );
    const totalCredit = round2(
      data.reduce((sum, row) => sum + row.totalCredit, 0),
    );
    return {
      data,
      totalDebit,
      totalCredit,
      balanced: totalDebit === totalCredit,
    };
  }
}
