import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

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
  amount: number;
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
    // (1) تحققات مدخلية صارمة.
    if (!input.lines || input.lines.length === 0) {
      throw new BadRequestException(
        'القيد المالي يجب أن يحتوي على بند واحد على الأقل',
      );
    }

    // E4: مجموع المدين = مجموع الدائن. كل بند يحوي debitAccount + creditAccount
    // بمبلغ واحد فمتوازن ذاتيًا، لكن المجموع الإجمالي عبر البنود يُتحقق منه هنا.
    let totalDebit = 0;
    let totalCredit = 0;
    const accountIds = new Set<string>();
    for (const [i, line] of input.lines.entries()) {
      if (line.amount <= 0) {
        throw new BadRequestException(
          `بند القيد رقم ${i + 1}: المبلغ يجب أن يكون موجبًا`,
        );
      }
      if (line.debitAccountId === line.creditAccountId) {
        throw new BadRequestException(
          `بند القيد رقم ${i + 1}: الحساب المدين والحساب الدائن لا يمكن أن يكونا نفس الحساب`,
        );
      }
      totalDebit += line.amount;
      totalCredit += line.amount;
      accountIds.add(line.debitAccountId);
      accountIds.add(line.creditAccountId);
    }

    // E4: نظرًا لأن كل بند متوازن ذاتيًا (debit=credit=amount)، فإن مجموع المدين
    // = مجموع الدائن دائمًا هنا. هذا تأكيد دفاعي بدل قيد CHECK على مستوى DB
    // (محدود بسبب تصميم JournalLine columnar). إضافة لاحقة بمستوى الـ trigger
    // قابلة للتفعيل لاحقًا كدفاع ثانٍ على مستوى DB.

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
      const ts = await tx.treasury.findMany({
        where: { id: { in: input.treasuryUpdates.map((u) => u.treasuryId) } },
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
      const cs = await tx.customer.findMany({
        where: { id: { in: input.customerUpdates.map((u) => u.customerId) } },
        select: { id: true },
      });
      for (const u of input.customerUpdates) {
        if (!cs.some((c) => c.id === u.customerId)) {
          throw new NotFoundException(`العميل ${u.customerId} غير موجود`);
        }
      }
    }
    if (input.supplierUpdates?.length) {
      const ss = await tx.supplier.findMany({
        where: { id: { in: input.supplierUpdates.map((u) => u.supplierId) } },
        select: { id: true },
      });
      for (const u of input.supplierUpdates) {
        if (!ss.some((s) => s.id === u.supplierId)) {
          throw new NotFoundException(`المورد ${u.supplierId} غير موجود`);
        }
      }
    }

    // (4) إنشاء JournalEntry + JournalLines + تحديثات الأرصدة كلها في نفس tx.
    const entryCode = generateJournalEntryCode();
    const entry = await tx.journalEntry.create({
      data: {
        code: entryCode,
        description: input.description,
        reference: input.reference ?? null,
        isAuto: input.isAuto ?? false,
        createdById: userId ?? null,
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
    const deltaMap = new Map<string, number>();
    for (const line of input.lines) {
      deltaMap.set(
        line.debitAccountId,
        (deltaMap.get(line.debitAccountId) ?? 0) + line.amount,
      );
      deltaMap.set(
        line.creditAccountId,
        (deltaMap.get(line.creditAccountId) ?? 0) - line.amount,
      );
    }
    for (const [accountId, delta] of deltaMap.entries()) {
      await tx.account.update({
        where: { id: accountId },
        data: { balance: { increment: delta } },
      });
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
      totalDebit,
      totalCredit,
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
   * ملاحظة: العكس لا يتعقب بشكل تلقائي الـ side-effects على treasury/customer/
   * supplier. لكل قيد عكسي، يجب على المستدعي تمرير treasuryUpdates/customerUpdates
   * بقيم معكوسة. يمكن لاحقًا بناء دالة عكسية كاملة تُقلب الـ side-effects تلقائيًا.
   *
   * A9 (enhanced): يرفض عكس قيد معكوس بالفعل، يُعلِّم الأصلي isReversed=true،
   * ويربط القيد العكسي بالأصلي عبر reversalOfId.
   */
  async reverseJournalEntry(
    originalEntryId: string,
    userId?: string,
    reversalDescription?: string,
  ): Promise<ReversalResult> {
    // جلب القيد الأصلي + بنوده.
    const original = await this.prisma.journalEntry.findUnique({
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
    // A9: رفض عكس قيد معكوس بالفعل — يمنع العكس المزدوج (Double reversal).
    if (original.isReversed) {
      throw new BadRequestException(
        `القيد ${original.code} معكوس بالفعل — لا يمكن عكسه مرتين. ` +
          `راجع القيد العكسي المرتبط عبر reversalOfId.`,
      );
    }

    const reversedLines: JournalLineInput[] = reverseLines(
      original.lines.map((l) => ({
        debitAccountId: l.debitAccountId,
        creditAccountId: l.creditAccountId,
        amount: Number(l.amount),
        description: l.description ?? undefined,
      })),
    );

    const reversalEntry = await this.postJournalEntry(
      {
        description: reversalDescription ?? `عكس قيد ${original.code}`,
        reference: `REVERSAL-OF-${original.code}`,
        isAuto: true,
        lines: reversedLines,
        userId,
      },
      userId,
    );

    // A9: ربط القيد العكسي بالأصلي + تعليم الأصلي كمعكوس.
    // ملاحظة: هذه تحديثات منفصلة عن $transaction الخاص بـ postJournalEntry.
    // فشلها يترك القيد العكسي موجودًا لكن بلا ربط — يُكتشف لاحقًا عبر
    // journal_entries WHERE reversalOfId IS NULL AND reference LIKE 'REVERSAL-OF-%'.
    await this.prisma.journalEntry.update({
      where: { id: reversalEntry.entryId },
      data: { reversalOfId: original.id },
    });

    await this.prisma.journalEntry.update({
      where: { id: original.id },
      data: {
        isReversed: true,
        reversedById: userId,
        reversedAt: new Date(),
      },
    });

    return {
      ...reversalEntry,
      reversedEntryId: original.id,
      reversedEntryCode: original.code,
    };
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

// Helper: عكس بنود القيد الأصلي بقلب debit/credit.
function reverseLines(original: JournalLineInput[]): JournalLineInput[] {
  return original.map((line) => ({
    debitAccountId: line.creditAccountId,
    creditAccountId: line.debitAccountId,
    amount: line.amount,
    description: line.description ? `عكس: ${line.description}` : 'عكس قيد',
  }));
}
