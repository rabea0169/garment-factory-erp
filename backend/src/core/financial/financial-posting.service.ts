import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  computeRequestHash,
  storeIdempotencyResponse,
  tryReplayIdempotencyKey,
} from '../common/idempotency.util';

/**
 * A1/A2/A3 + E4/E1 — FinancialPostingService: محرك القيد المزدوج الموحد.
 *
 * يُستدعى من كل خدمة تُحدّث الحالة المالية (SalesService / AccountingService /
 * المشتريات المستقبلية). كل قيد يمر من هنا فقط، فيصبح:
 *   1. مُدقَّقًا: لا قيد بلا مجموع مدين = مجموع دائن (E4 على مستوى الخدمة).
 *   2. موثوقًا: JournalEntry + JournalLines + Account.balance تحديث واحد ذري.
 *   3. مُلزمًا لأثر الكيانات: treasury/customer/supplier balances تتغير بنفس
 *      الـ transaction مع القيد — لا انفصال ممكن (A2).
 *
 * النمط:
 *   - postJournalEntry(input): يلف الكل في $transaction.
 *   - postJournalEntryInTx(tx, input): للمستدعي الذي يُدير tx خاصته (مثل
 *     createSalesOrder الذي يفحص المخزون وينقصه ويُنشئ الـ A/R posting كلها
 *     في نفس المعاملة — لا يمكن تفكيكها على معاملتين).
 */

export interface JournalLineInput {
  debitAccountId: string;
  creditAccountId: string;
  /**
   * PRD-5 (W2-3): يقبل Prisma.Decimal إضافة إلى number — المتصلون
   * الماليون الدقيقون (مسار إنتاج أمر التشغيل) يمررون Decimal من مصدره
   * فيصل إلى journal_lines وأرصدة الحسابات بلا تحلل عائم (toNumber).
   */
  amount: number | Prisma.Decimal;
  description?: string;
}

export interface PostJournalEntryInput {
  description: string;
  reference?: string;
  isAuto?: boolean;
  lines: JournalLineInput[];
  userId?: string;
  // A2: تحديثات الكيانات المتزامنة (اختياري) — تُطبَّق داخل نفس tx.
  treasuryUpdates?: { treasuryId: string; delta: number }[];
  customerUpdates?: { customerId: string; delta: number }[];
  supplierUpdates?: { supplierId: string; delta: number }[];
  metadata?: Prisma.InputJsonValue;
  postingKey?: string;
  date?: Date;
  fiscalPeriodId?: string;
}

export interface JournalEntryResult {
  entryId: string;
  entryCode: string;
  totalDebit: number;
  totalCredit: number;
  linesCount: number;
  createdAt: Date;
}

type TxClient = Prisma.TransactionClient;

@Injectable()
export class FinancialPostingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * قيد مستقل (يلف الكل في $transaction). استخدمه عندما لا يوجد tx خارجي.
   */
  async postJournalEntry(
    input: PostJournalEntryInput,
    userId?: string,
  ): Promise<JournalEntryResult> {
    return this.prisma.$transaction(async (tx: TxClient) =>
      this.postJournalEntryInTx(tx, input, userId),
    );
  }

  /**
   * قيد داخل tx موجود — للاستخدام من خدمات تملك معاملتها (مثل createSalesOrder).
   */
  async postJournalEntryInTx(
    tx: TxClient,
    input: PostJournalEntryInput,
    userId?: string,
  ): Promise<JournalEntryResult> {
    const postingHash = input.postingKey
      ? createHash('sha256')
          .update(
            JSON.stringify({
              description: input.description,
              reference: input.reference ?? null,
              isAuto: input.isAuto ?? false,
              lines: input.lines,
              treasuryUpdates: input.treasuryUpdates ?? [],
              customerUpdates: input.customerUpdates ?? [],
              supplierUpdates: input.supplierUpdates ?? [],
              metadata: input.metadata ?? null,
              date: input.date?.toISOString() ?? null,
              fiscalPeriodId: input.fiscalPeriodId ?? null,
            }),
          )
          .digest('hex')
      : undefined;

    if (input.postingKey) {
      const existing = await tx.journalEntry.findUnique({
        where: { postingKey: input.postingKey },
        include: { lines: true },
      });
      if (existing) {
        if (existing.postingHash !== postingHash) {
          throw new ConflictException('posting key مستخدم مع محتوى مالي مختلف');
        }
        return {
          entryId: existing.id,
          entryCode: existing.code,
          totalDebit: existing.lines.reduce(
            (sum, line) => sum + Number(line.amount),
            0,
          ),
          totalCredit: existing.lines.reduce(
            (sum, line) => sum + Number(line.amount),
            0,
          ),
          linesCount: existing.lines.length,
          createdAt: existing.createdAt,
        };
      }
    }

    // (1) تحققات مدخلية صارمة.
    if (!input.lines || input.lines.length === 0) {
      throw new BadRequestException(
        'القيد المالي يجب أن يحتوي على بند واحد على الأقل',
      );
    }

    // PRD-5: تطبيع مبالغ البنود إلى Prisma.Decimal مرة واحدة — كل الحسابات
    // (فحص الإيجابية، المجاميع، وتحديثات أرصدة الحسابات) تجري على Decimal
    // فلا يتحلل أي مبلغ إلى float داخل سلسلة الترحيل. المتصلون القدامى
    // بـ number يُحوَّلون عبر المنشئ بدقة (نفس تحويل Prisma عند الكتابة)،
    // والقيمة الأصلية تُكتب في journal_lines كما وردت.
    const lineAmounts = input.lines.map((line) =>
      line.amount instanceof Prisma.Decimal
        ? line.amount
        : new Prisma.Decimal(line.amount),
    );

    // E4: مجموع المدين = مجموع الدائن. كل بند يحوي debitAccount + creditAccount
    // بمبلغ واحد فمتوازن ذاتيًا، لكن المجموع الإجمالي عبر البنود يُتحقق منه هنا.
    let totalDebit = new Prisma.Decimal(0);
    let totalCredit = new Prisma.Decimal(0);
    const accountIds = new Set<string>();
    for (const [i, line] of input.lines.entries()) {
      const amount = lineAmounts[i];
      if (amount.lte(0)) {
        throw new BadRequestException(
          `بند القيد رقم ${i + 1}: المبلغ يجب أن يكون موجبًا`,
        );
      }
      if (line.debitAccountId === line.creditAccountId) {
        throw new BadRequestException(
          `بند القيد رقم ${i + 1}: الحساب المدين والحساب الدائن لا يمكن أن يكونا نفس الحساب`,
        );
      }
      totalDebit = totalDebit.plus(amount);
      totalCredit = totalCredit.plus(amount);
      accountIds.add(line.debitAccountId);
      accountIds.add(line.creditAccountId);
    }

    // E4: نظرًا لأن كل بند متوازن ذاتيًا (debit=credit=amount)، فإن مجموع المدين
    // = مجموع الدائن دائمًا هنا. هذا تأكيد دفاعي بدل قيد CHECK على مستوى DB
    // (محدود بسبب تصميم JournalLine columnar). إضافة لاحقة بمستوى الـ trigger
    // قابلة للتفعيل لاحقًا كدفاع ثانٍ على مستوى DB.

    // ACC-3 (P1 — GF-IMP-W2): الترحيل الآلي لم يعد يتجاوز إقفال الفترات.
    // سابقًا فحص حالة الفترة كان يجري فقط عند تمرير fiscalPeriodId — أي
    // القيود اليدوية حصرًا — فكانت كل الترحيلات الآلية (مبيعات/مشتريات/
    // رواتب/مخزون/جودة/شحن) تُرحّل خارج أي فترة وبلا أي فحص، ويصبح إقفال
    // الفترة غير فعّال. الآن: عندما لا يمرر المستدعي fiscalPeriodId نحلّ
    // الفترة المفتوحة النشطة التي تضم تاريخ القيد الفعلي (حقل date —
    // وتاريخه الافتراضي عند غياب الإدخال هو الآن، مثل Prisma default)
    // ونربط القيد بها، مع تطبيق نفس فحوص الفترات الممررة يدويًا. لا توجد
    // فترة مفتوحة شاملة التاريخ → رفض 400 عربي واضح.
    //
    // ملاحظة النطاق الزمني: نطاق اليوم الختامي للفترة شامل لكامل اليوم
    // (endDate حتى نهاية يومه) — متوافق مع الفحص القائم للفترات الممررة.
    const postingDate = input.date ?? new Date();
    let effectiveFiscalPeriodId = input.fiscalPeriodId ?? null;
    if (input.fiscalPeriodId) {
      const period = await tx.fiscalPeriod.findUnique({
        where: { id: input.fiscalPeriodId },
      });
      if (!period) {
        throw new NotFoundException(
          `الفترة المالية ${input.fiscalPeriodId} غير موجودة`,
        );
      }
      if (period.status !== 'OPEN') {
        throw new BadRequestException('لا يمكن الترحيل في فترة مالية مغلقة');
      }
      if (
        postingDate < period.startDate ||
        postingDate >
          new Date(period.endDate.getTime() + 24 * 60 * 60 * 1000 - 1)
      ) {
        throw new BadRequestException('تاريخ القيد خارج نطاق الفترة المالية');
      }
    } else {
      // ACC-3: حلّ الفترة المفتوحة الشاملة لتاريخ القيد. endDate عمود
      // تاريخ (منتصف الليل) فتُقارن بمنتصف ليل يوم القيد — اليوم الختامي
      // للفترة يظل شاملًا كاملًا مثل الفحص اليدوي أعلاه.
      const startOfPostingDay = new Date(postingDate);
      startOfPostingDay.setUTCHours(0, 0, 0, 0);
      const openPeriod = await tx.fiscalPeriod.findFirst({
        where: {
          status: 'OPEN',
          startDate: { lte: postingDate },
          endDate: { gte: startOfPostingDay },
        },
        orderBy: { startDate: 'desc' },
        select: { id: true },
      });
      if (!openPeriod) {
        throw new BadRequestException(
          'لا يمكن الترحيل خارج فترة مالية مفتوحة — أنشئ فترة مفتوحة شاملة لتاريخ القيد أولًا',
        );
      }
      effectiveFiscalPeriodId = openPeriod.id;
    }

    // (2) تحقق وجود كل الحسابات المُشار إليها في قاعدة البيانات.
    const accounts = await tx.account.findMany({
      where: { id: { in: [...accountIds] } },
      select: { id: true, isActive: true, isGroup: true },
    });
    const found = new Map(accounts.map((a) => [a.id, a]));
    for (const id of accountIds) {
      const a = found.get(id);
      if (!a) {
        throw new NotFoundException(`الحساب المحاسبي ${id} غير موجود`);
      }
      if (!a.isActive) {
        throw new BadRequestException(`الحساب المحاسبي ${id} غير نشط`);
      }
      if (a.isGroup) {
        throw new BadRequestException(
          `الحساب المحاسبي ${id} حساب مجموعة — لا يُقبل التقييد عليه مباشرة`,
        );
      }
    }

    // (3) تحقق وجود الكيانات المُحدَّثة (Treasury/Customer/Supplier).
    if (input.treasuryUpdates?.length) {
      const treasuryIds = input.treasuryUpdates.map((u) => u.treasuryId);
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM treasuries WHERE id IN (${Prisma.join(treasuryIds)}) FOR UPDATE`,
      );
      const ts = await tx.treasury.findMany({
        where: { id: { in: treasuryIds } },
        select: { id: true, isActive: true, balance: true },
      });
      for (const u of input.treasuryUpdates) {
        const t = ts.find((x) => x.id === u.treasuryId);
        if (!t) {
          throw new NotFoundException(`الخزينة ${u.treasuryId} غير موجودة`);
        }
        if (!t.isActive) {
          throw new BadRequestException(`الخزينة ${u.treasuryId} غير نشطة`);
        }
        // E3 (جزئي): رصيد الخزينة لا يصير سالبًا أبدًا.
        const newBalance = Number(t.balance) + u.delta;
        if (newBalance < 0) {
          throw new BadRequestException(
            `العملية تُظهر رصيد الخزينة إلى ${newBalance} — الرصيد السالب للخزينة ممنوع (E3)`,
          );
        }
      }
    }
    if (input.customerUpdates?.length) {
      const customerIds = input.customerUpdates.map((u) => u.customerId);
      // SAL-1 (P0): قفل صفوف العملاء بـ SELECT ... FOR UPDATE قبل قراءتها —
      // نفس نمط الخزائن/الموردين أعلاه. بدون هذا القفل يمكن لطلبي بيع آجل
      // متزامنين لنفس العميل أن يجتازا فحص الحد الائتماني على نفس الرصيد
      // القديم ثم يزيد كل منهما الرصيد → تجاوز الحد (race على customer.balance).
      // توحيد القفل هنا يستفيد منه تأكيد البيع والمرتجعات والدفعات دفعة واحدة.
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM customers WHERE id IN (${Prisma.join(customerIds)}) FOR UPDATE`,
      );
      const cs = await tx.customer.findMany({
        where: { id: { in: customerIds } },
        select: { id: true },
      });
      for (const u of input.customerUpdates) {
        if (!cs.some((c) => c.id === u.customerId)) {
          throw new NotFoundException(`العميل ${u.customerId} غير موجود`);
        }
      }
    }
    if (input.supplierUpdates?.length) {
      const supplierIds = input.supplierUpdates.map((u) => u.supplierId);
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM suppliers WHERE id IN (${Prisma.join(supplierIds)}) FOR UPDATE`,
      );
      const ss = await tx.supplier.findMany({
        where: { id: { in: supplierIds } },
        select: { id: true, balance: true },
      });
      for (const u of input.supplierUpdates) {
        const supplier = ss.find((s) => s.id === u.supplierId);
        if (!supplier) {
          throw new NotFoundException(`المورد ${u.supplierId} غير موجود`);
        }
        const newBalance = Number(supplier.balance) + u.delta;
        if (newBalance < 0) {
          throw new BadRequestException(
            `العملية تُظهر رصيد المورد إلى ${newBalance} — الرصيد السالب للمورد ممنوع`,
          );
        }
      }
    }

    // (4) إنشاء JournalEntry + JournalLines + تحديثات الأرصدة كلها في نفس tx.
    //
    // ACC-2 (P1 — GF-IMP-W2): نكتب في journalEntry.metadata نسخة موثقة من
    // التأثيرات الجانبية الفعلية المطبقة (treasuryUpdates / customerUpdates /
    // supplierUpdates / accountDeltas) كلما لم يوثّقها المستدعي بنفسه —
    // المسارات التي كانت تخزّن نوع الطرف فقط (السندات، مرتجع المشتريات)
    // لم تكن تترك ما يسمح لـ reverseJournalEntry بعكس الأرصدة فتتقادم
    // أرصدة الخزائن/العملاء/الموردين بعد العكس. المفاتيح الخاصة الممررة من
    // المستدعي (source/reference وغيرها) تبقى كما هي — ندمج بجانبها فقط
    // ولا نستبدل قيمًا وثّقها المستدعي صراحةً.
    // PRD-5 (W2-3): الحساب على Prisma.Decimal — زيادات/نقصان أرصدة الحسابات
    // تُطبَّق بدقة عشرية كاملة (لا تحلل عائم في أي نقطة من سلسلة الترحيل)،
    // ولقطة metadata تُخرج أرقامًا JSON-friendly بنفس القيم (توافق ACC-2).
    const deltaMap = new Map<string, Prisma.Decimal>();
    for (const [i, line] of input.lines.entries()) {
      const amount = lineAmounts[i];
      deltaMap.set(
        line.debitAccountId,
        (deltaMap.get(line.debitAccountId) ?? new Prisma.Decimal(0)).plus(
          amount,
        ),
      );
      deltaMap.set(
        line.creditAccountId,
        (deltaMap.get(line.creditAccountId) ?? new Prisma.Decimal(0)).minus(
          amount,
        ),
      );
    }
    const entryMetadata = withSideEffectSnapshot(input.metadata, {
      treasuryUpdates: input.treasuryUpdates ?? [],
      customerUpdates: input.customerUpdates ?? [],
      supplierUpdates: input.supplierUpdates ?? [],
      accountDeltas: new Map(
        [...deltaMap].map(([id, delta]) => [id, delta.toNumber()] as const),
      ),
    });
    const entryCode = generateJournalEntryCode();
    const entry = await tx.journalEntry.create({
      data: {
        code: entryCode,
        description: input.description,
        reference: input.reference ?? null,
        date: input.date ?? undefined,
        isAuto: input.isAuto ?? false,
        metadata: entryMetadata,
        createdById: userId ?? null,
        postingKey: input.postingKey ?? null,
        postingHash: postingHash ?? null,
        fiscalPeriodId: effectiveFiscalPeriodId,
        lines: {
          create: input.lines.map((line) => ({
            debitAccountId: line.debitAccountId,
            creditAccountId: line.creditAccountId,
            amount: line.amount,
            description: line.description ?? null,
          })),
        },
      },
      select: { id: true, code: true, createdAt: true },
    });

    // E1 + A2: تحديث رصيد كل حساب مُشار إليه.
    // لكل بند: debitAccount.balance += amount، creditAccount.balance -= amount.
    // لاحظ: هذا يطابق محاسبة الأصول/المصاريع (مدين=زيادة) والمطلوبات/حقوق
    // الملكية/الإيراد (دائن=زيادة) دون تمييز نوع الحساب، لأن القيد المزدوج
    // يفرض ذلك تلقائيًا عند التقييد الصحيح من العميل.
    // (deltaMap حُسب أعلاه قبل إنشاء القيد لأن ACC-2 يحتاجه للقطة metadata.)
    //
    // ACC-7 (P2 — GF-IMP-W3): دفعة خام واحدة بدل حلقة await متتابعة على
    // خريطة الدلتا — القيد بـ k حسابات مختلفة كان يدفع k استعلامات
    // تسلسلية داخل المعاملة (كل round-trip يطيل نافذة القفل). الآن بيان
    // واحد (نص البند حرفيًا):
    //   UPDATE accounts SET balance = balance + t.d
    //   FROM (VALUES ...) AS t(id, d) WHERE accounts.id = t.id::text
    // عمود accounts.id في القاعدة TEXT (UUID مخزّن نصًا — هجرة init)، لذا
    // يُمرَّر المعرف بصراحة ::uuid داخل VALUES ثم يُحوَّل راجعًا t.id::text
    // في شرط المطابقة — بدون التحويل الراجع يرمي PostgreSQL
    // «operator does not exist: text = uuid» (تحقق فعلي على PostgreSQL 16).
    // الزيادة/الخصم يبقيان ذريين داخل نفس المعاملة، والدلتات تُمرَّر
    // Prisma.Decimal كمعاملات (لا تحلل عائم). الحسابات المشار إليها
    // وُجدت جميعها في فحص (2) أعلاه فلا صف يفلت من المطابقة، والحساب
    // المشترك بين بنود عدة يظهر مرة واحدة بدلتاه الصافية (deltaMap).
    if (deltaMap.size > 0) {
      const batchRows = [...deltaMap.entries()].map(
        ([accountId, delta]) =>
          Prisma.sql`(${accountId}::uuid, ${delta}::numeric)`,
      );
      await tx.$executeRaw(
        Prisma.sql`UPDATE accounts SET balance = balance + t.d FROM (VALUES ${Prisma.join(batchRows)}) AS t(id, d) WHERE accounts.id = t.id::text`,
      );
    }

    // A2: تحديث أرصدة الكيانات المرتبطة (treasury/customer/supplier).
    if (input.treasuryUpdates) {
      for (const u of input.treasuryUpdates) {
        await tx.treasury.update({
          where: { id: u.treasuryId },
          data: { balance: { increment: u.delta } },
        });
      }
    }
    if (input.customerUpdates) {
      for (const u of input.customerUpdates) {
        await tx.customer.update({
          where: { id: u.customerId },
          data: { balance: { increment: u.delta } },
        });
      }
    }
    if (input.supplierUpdates) {
      for (const u of input.supplierUpdates) {
        await tx.supplier.update({
          where: { id: u.supplierId },
          data: { balance: { increment: u.delta } },
        });
      }
    }

    return {
      entryId: entry.id,
      entryCode: entry.code,
      // PRD-5: المجاميع تُخزن Decimal أثناء الحساب وتُخرج number للاستجابة
      // فقط (الاستجابة عرضٌ لا يُخزَّن — الدقة الكاملة محفوظة في القاعدة).
      totalDebit: totalDebit.toNumber(),
      totalCredit: totalCredit.toNumber(),
      linesCount: input.lines.length,
      createdAt: entry.createdAt,
    };
  }

  /**
   * A9: عكس قيد سابق. يجلب بنود القيد الأصلي، يقلب المدين/الدائن، وينشئ قيدًا
   * عكسيًا جديدًا (غير تدميري للأصلي — يدقّق السجل).
   *
   * النمط: قيد عكسي = نفس المبلغ + طرفين مقلوبين. كل تحققات التوازن والوجود
   * تُطبَّق على القيد العكسي كأي قيد جديد.
   *
   * العكس يقلب تلقائيًا آثار treasury/customer/supplier المحفوظة في metadata
   * داخل نفس transaction (عبر postJournalEntryInTx الذي يقفل صفوف
   * الخزائن/العملاء/الموردين بـ SELECT ... FOR UPDATE قبل التحديث — نفس
   * القفل المستخدم في الترحيل الأمامي)، مع تعليم القيد الأصلي وربط القيد
   * العكسي به.
   *
   * A9 (enhanced): يرفض عكس قيد معكوس بالفعل، يُعلِّم الأصلي isReversed=true،
   * ويربط القيد العكسي بالأصلي عبر reversalOfId.
   *
   * ACC-2 (P1 — GF-IMP-W2): يرفض عكس قيد لا يوثّق metadata تأثيراته
   * الجانبية (خزائن/عملاء/موردون/أرصدة حسابات) — عكسُ GL وحده سيترك تلك
   * الأرصدة تتقادم. كل قيد يُرحّل عبر postJournalEntryInTx بعد ACC-2 يحمل
   * اللقطة تلقائيًا، فالرفض يقع عمليًا على القيود التاريخية المنشأة قبلها
   * أو المكتوبة خارج المحرك.
   */
  async reverseJournalEntry(
    originalEntryId: string,
    userId?: string,
    reversalDescription?: string,
    idempotencyKey?: string,
  ): Promise<ReversalResult> {
    return this.prisma.$transaction((tx: Prisma.TransactionClient) =>
      this.reverseJournalEntryInTx(
        tx,
        originalEntryId,
        userId,
        reversalDescription,
        idempotencyKey,
      ),
    );
  }

  /**
   * GF-IMP-W2 / SHP-3(أ): نسخة تقبل معاملة خارجية — يستدعيها إلغاء شحنة
   * PREPARING داخل معاملته نفسها كي يكون عكس قيد تكلفة الشحن وتحديث حالة
   * الشحنة وأمر البيع ذريين معًا (لا نافذة يكون فيها القيد معكوسًا والشحنة
   * ما زالت PREPARING أو العكس). نفس منطق النسخة العامة حرفيًا.
   */
  async reverseJournalEntryInTx(
    tx: Prisma.TransactionClient,
    originalEntryId: string,
    userId?: string,
    reversalDescription?: string,
    idempotencyKey?: string,
  ): Promise<ReversalResult> {
    const original = await tx.journalEntry.findUnique({
      where: { id: originalEntryId },
      include: { lines: true },
    });
    if (!original) {
      throw new NotFoundException(`القيد ${originalEntryId} غير موجود`);
    }
    if (original.lines.length === 0) {
      throw new BadRequestException(
        `القيد ${originalEntryId} لا يحوي بنودًا — لا يمكن عكسه`,
      );
    }

    // RES-F02: If the caller supplied an Idempotency-Key and the original
    // is already reversed, replay the cached response — this handles the
    // "request succeeded, but client never got the response" case.
    if (original.isReversed && idempotencyKey) {
      const replay = await tryReplayIdempotencyKey(
        tx,
        idempotencyKey,
        'journal-entry-reverse',
        computeRequestHash({
          originalEntryId,
          userId: userId ?? null,
          reversalDescription: reversalDescription ?? null,
        }),
      );
      if (replay) {
        return replay as unknown as ReversalResult;
      }
      throw new ConflictException(
        `القيد ${original.code} معكوس بالفعل — استخدم نفس Idempotency-Key لإعادة الاستجابة، أو مفتاحًا جديدًا لقيد آخر.`,
      );
    }

    // ACC-2 (P1 — GF-IMP-W2): باب الحظر — قيد بلا أثر جانبي موثق لا يُعكس.
    // عكس GL فقط (بنود مقلوبة) كان يترك أرصدة الخزائن/العملاء/الموردين
    // التي طبّقها القيد الأصلي كما هي فتتقادم للأبد. القيود المُرحّلة عبر
    // postJournalEntryInTx بعد ACC-2 تحمل اللقطة تلقائيًا؛ القيود الأقدم
    // (قبل اللقطة أو المكتوبة خارج المحرك) تُرفض حتى تُوثّق أو تُعالج
    // يدويًا — قرار واعٍ لصالح سلامة الأرصدة على حساب راحة العكس الأعمى.
    if (!hasDocumentedSideEffects(original.metadata)) {
      throw new ConflictException(
        `لا يمكن عكس قيد ${original.code} بلا أثر جانبي موثق — metadata القيد لا تحمل لقطة تأثيراته على الخزائن/العملاء/الموردين/الأرصدة`,
      );
    }

    const claim = await tx.journalEntry.updateMany({
      where: { id: original.id, isReversed: false },
      data: {
        isReversed: true,
        reversedById: userId,
        reversedAt: new Date(),
      },
    });
    if (claim.count !== 1) {
      throw new BadRequestException(
        `القيد ${original.code} معكوس بالفعل — لا يمكن عكسه مرتين.`,
      );
    }

    const metadata = asPostingMetadata(original.metadata);
    const reversedLines = reverseLines(
      original.lines.map((l) => ({
        debitAccountId: l.debitAccountId,
        creditAccountId: l.creditAccountId,
        amount: Number(l.amount),
        description: l.description ?? undefined,
      })),
    );
    const reversalEntry = await this.postJournalEntryInTx(
      tx,
      {
        description: reversalDescription ?? `عكس قيد ${original.code}`,
        reference: `REVERSAL-OF-${original.code}`,
        isAuto: true,
        lines: reversedLines,
        userId,
        // ACC-2: نُجرد metadata الأصلي من مفاتيح التأثيرات الجانبية قبل
        // دمجها في القيد العكسي — القيد العكسي له تأثيراته الفعلية الخاصة
        // (المقلوبة)، وسيتولى postJournalEntryInTx توثيقها تلقائيًا في
        // لقطة metadata خاصة به. لو نُشرت مفاتيح الأصل كما هي لتوثّق القيد
        // العكسي اتجاهًا معاكسًا لما طبّقه فعليًا (خطر عند عكس العكس).
        metadata: {
          source: 'accounting.reversal',
          reversalOfId: original.id,
          ...stripSideEffectMetadata(metadata),
        },
        // عكس أرصدة الكيانات داخل نفس معاملة العكس — يمر عبر
        // postJournalEntryInTx الذي يقفل الصفوف FOR UPDATE قبل تحديثها.
        treasuryUpdates: invertUpdates(metadata?.treasuryUpdates),
        customerUpdates: invertUpdates(metadata?.customerUpdates),
        supplierUpdates: invertUpdates(metadata?.supplierUpdates),
      },
      userId,
    );

    await tx.journalEntry.update({
      where: { id: reversalEntry.entryId },
      data: { reversalOfId: original.id },
    });

    const result: ReversalResult = {
      ...reversalEntry,
      reversedEntryId: original.id,
      reversedEntryCode: original.code,
    };
    // RES-F02: persist the response so a retry with the same key replays it
    // instead of throwing "already reversed".
    await storeIdempotencyResponse(tx, idempotencyKey, result);
    return result;
  }
}

/**
 * كود قيد فريد قابل للقراءة: JE-YYYYMMDD-XXXXXXXX (تاريخ UTC + عشوائية).
 * A7/D10: بلا Date.now() — العشوائية تمنع التوقع والتصادم وتُسهّل القراءة.
 */
function generateJournalEntryCode(): string {
  const now = new Date();
  const ymd = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    String(now.getUTCDate()).padStart(2, '0'),
  ].join('');
  return `JE-${ymd}-${randomBytes(4).toString('hex').toUpperCase()}`;
}

/**
 * A9: Reverse a posted journal entry by creating a mirror entry.
 *
 * النمط: قيد عكسي يُقلب طرفي القيد الأصلي (مدين ↔ دائن) لنفس المبلغ، مع
 * ربطه للقيد الأصلي في حقل reference. مثلاً قيد بيع آجل 1000 EGP:
 *   الأصلي: مدين=AR، دائن=إيراد، amount=1000
 *   العكسي: مدين=إيراد، دائن=AR، amount=1000
 *
 * النتيجة: صافي الرصيد على كلا الحسابين يرجع كما كان قبل القيد الأصلي.
 * القيد العكسي هو نفسه قيد مزدوج كامل (يخضع لكل تحققات postJournalEntry).
 */
export interface ReversalResult extends JournalEntryResult {
  reversedEntryId: string;
  reversedEntryCode: string;
}

type PostingMetadata = {
  treasuryUpdates?: { treasuryId: string; delta: number }[];
  customerUpdates?: { customerId: string; delta: number }[];
  supplierUpdates?: { supplierId: string; delta: number }[];
  // ACC-2: لقطة أرصدة الحسابات المطبقة (حساب → دلتا) — توثيق كامل للتأثير
  // الجانبي للقيد إلى جانب أرصدة الكيانات. عكسها يجري عبر قلب البنود نفسها
  // (reverseLines) فتوثّق هنا للمراجعة واكتمال اللقطة فقط.
  accountDeltas?: Record<string, number>;
};

function asPostingMetadata(
  metadata: Prisma.JsonValue | null,
): PostingMetadata | undefined {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata))
    return undefined;
  return metadata;
}

/**
 * ACC-2 (P1 — GF-IMP-W2): هل يوثّق metadata القيد تأثيراته الجانبية؟
 * معيار التوثيق: وجود أي من مفاتيح treasuryUpdates / customerUpdates /
 * supplierUpdates / accountDeltas. كل قيد مُرحّل عبر postJournalEntryInTx
 * بعد ACC-2 يحمل المفاتيح الأربعة تلقائيًا (حتى لو كانت مصفوفات فارغة).
 */
const SIDE_EFFECT_METADATA_KEYS = [
  'treasuryUpdates',
  'customerUpdates',
  'supplierUpdates',
  'accountDeltas',
] as const;

function hasDocumentedSideEffects(metadata: Prisma.JsonValue | null): boolean {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata))
    return false;
  return SIDE_EFFECT_METADATA_KEYS.some(
    (key) => (metadata as Record<string, unknown>)[key] !== undefined,
  );
}

/**
 * ACC-2: لقطة التأثيرات الجانبية الفعلية — تُدمج في metadata القيد عند
 * إنشائه كلما لم يوثّق المستدعي المفتاح بنفسه. مفاتيح المستدعي الخاصة
 * (source وغيرها) تُحفظ كما هي بجانب اللقطة.
 */
function withSideEffectSnapshot(
  metadata: Prisma.InputJsonValue | undefined,
  snapshot: {
    treasuryUpdates: { treasuryId: string; delta: number }[];
    customerUpdates: { customerId: string; delta: number }[];
    supplierUpdates: { supplierId: string; delta: number }[];
    accountDeltas: Map<string, number>;
  },
): Prisma.InputJsonValue {
  const base: Record<string, unknown> =
    metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? { ...(metadata as Record<string, unknown>) }
      : {};
  const merged: Record<string, unknown> = { ...base };
  if (merged.treasuryUpdates === undefined) {
    merged.treasuryUpdates = snapshot.treasuryUpdates;
  }
  if (merged.customerUpdates === undefined) {
    merged.customerUpdates = snapshot.customerUpdates;
  }
  if (merged.supplierUpdates === undefined) {
    merged.supplierUpdates = snapshot.supplierUpdates;
  }
  if (merged.accountDeltas === undefined) {
    merged.accountDeltas = Object.fromEntries(snapshot.accountDeltas);
  }
  return merged as Prisma.InputJsonValue;
}

/**
 * ACC-2: يُجرد نسخة من metadata من مفاتيح التأثيرات الجانبية — يستخدمه
 * reverseJournalEntry كي لا يرث القيد العكسي لقطة الأصل بينما تأثيره
 * الفعلي مقلوب (القيد العكسي سيوثّق لقطته الخاصة عبر withSideEffectSnapshot).
 * الناتج مفاتيح المستدعي الخاصة فقط (source وغيرها) ككائن JSON عادي.
 */
function stripSideEffectMetadata(
  metadata: PostingMetadata | undefined,
): Record<string, unknown> {
  if (!metadata) return {};
  const copy: Record<string, unknown> = { ...metadata };
  for (const key of SIDE_EFFECT_METADATA_KEYS) {
    delete copy[key];
  }
  return copy;
}

function invertUpdates<T extends { delta: number }>(
  updates: T[] | undefined,
): T[] | undefined {
  return updates?.map((update) => ({ ...update, delta: -update.delta }));
}

// Helper: عكس بنود القيد الأصلي بقلب debit/credit.
function reverseLines(original: JournalLineInput[]): JournalLineInput[] {
  return original.map((line) => ({
    debitAccountId: line.creditAccountId,
    creditAccountId: line.debitAccountId,
    amount: line.amount,
    description: line.description ? `عكس: ${line.description}` : 'عكس قيد',
  }));
}
