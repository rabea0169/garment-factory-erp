import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { FinancialPostingService } from '../../core/financial/financial-posting.service';
import { CHART_OF_ACCOUNTS } from '../../core/financial/chart-of-accounts';
import { round2 } from '../../core/common/money.util';
import {
  CreateExpenseCategoryDto,
  CreateExpenseDto,
  QueryExpenseDto,
  UpdateExpenseCategoryDto,
  UpdateExpenseDto,
} from './dto/expense.dto';

/**
 * بنود المصاريف الافتراضية (نفس بنود Selim ERP) — تُزرع عند أول استخدام
 * إن كان جدول البنود فارغًا (seed-on-first-use).
 */
export const DEFAULT_EXPENSE_CATEGORIES = [
  'رواتب',
  'إيجار',
  'مرافق',
  'نقل',
  'صيانة',
  'تسويق',
  'أخرى',
] as const;

/**
 * SELIM-ERP W1 — خدمة المصاريف وبنودها (تقلد /api/expenses و
 * /api/expense-categories في Selim ERP).
 *
 * القواعد المحاسبية (من المرجع Selim وتُنفَّذ حرفيًا):
 * - المصروف بلا خزينة = سجل بسيط بلا قيد مالي (لا استحقاق وهمي — القيد
 *   في Selim يصاحب السحب النقدي فقط).
 * - المصروف مع خزينة = عملية ذرّية واحدة داخل $transaction:
 *     1. خصم رصيد الخزينة بتحديث شرطي ذري (balance ≥ المبلغ) — إن لم
 *        يجتز → 400 «رصيد الخزينة غير كاف» (لا سباق ولا رصيد سالب).
 *     2. قيد مالي: Dr GENERAL_EXPENSE / Cr CASH.
 *     3. ربط القيد بالمصروف (journalEntryId) — لا مصروف نقدي بلا قيد.
 * - اسم البند لقطة على المصروف (categoryName) — يبقى مقروءًا حتى لو
 *   حُذف/غيّر البند لاحقًا (نفس فلسفة لقطات Selim).
 * - لا ترقيم للمصروف نفسه (المخطط بلا حقل code) — الترقيم لحركات
 *   الخزينة/المستندات ذات الأثر المالي الأوسع.
 * - التعديل مسموح للمصروفات غير المقيدة فقط (بلا journalEntryId) —
 *   المقيد له قيد ورصيد متأثران فتعديله يكسر الذاتية المحاسبية.
 * - الحذف: عكس القيد عبر reverseJournalEntryInTx + إعادة رصيد الخزينة
 *   (increment) داخل معاملة واحدة.
 * - حذف بند مستخدم في مصروفات ممنوع (Restrict على مستوى الخدمة كما في
 *   قاعدة البيانات).
 */
@Injectable()
export class ExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly financial: FinancialPostingService,
  ) {}

  // ===================== Categories (EXC) =====================

  /**
   * قائمة البنود — تزرع بنود Selim الافتراضية عند أول استدعاء إن كان
   * الجدول فارغًا (يضمن أن أي بيئة نظيفة تبدأ بنفس البنود المرجعية).
   */
  async listCategories() {
    await this.ensureDefaultCategories();
    return this.prisma.expenseCategory.findMany({
      where: { isActive: true },
      include: { _count: { select: { expenses: true } } },
      orderBy: { name: 'asc' },
    });
  }

  /** إنشاء بند مصروف — الاسم فريد (ازدواج → 400). */
  async createCategory(dto: CreateExpenseCategoryDto) {
    const existing = await this.prisma.expenseCategory.findFirst({
      where: { name: dto.name },
      select: { id: true },
    });
    if (existing) {
      throw new BadRequestException('اسم بند المصروف موجود بالفعل');
    }
    return this.prisma.expenseCategory.create({
      data: { name: dto.name, notes: dto.notes },
    });
  }

  /** تعديل بند — الاسم الجديد يظل فريدًا (بلا الازدواج). */
  async updateCategory(id: string, dto: UpdateExpenseCategoryDto) {
    const existing = await this.prisma.expenseCategory.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('بند المصروف غير موجود');
    if (dto.name && dto.name !== existing.name) {
      const duplicate = await this.prisma.expenseCategory.findFirst({
        where: { name: dto.name, id: { not: id } },
        select: { id: true },
      });
      if (duplicate) {
        throw new BadRequestException('اسم بند المصروف موجود بالفعل');
      }
    }
    return this.prisma.expenseCategory.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
      },
    });
  }

  /** حذف بند — ممنوع إن استُخدم في مصروفات (Restrict). */
  async removeCategory(id: string) {
    const existing = await this.prisma.expenseCategory.findUnique({
      where: { id },
      include: { _count: { select: { expenses: true } } },
    });
    if (!existing) throw new NotFoundException('بند المصروف غير موجود');
    if (existing._count.expenses > 0) {
      throw new BadRequestException(
        `لا يمكن حذف بند "${existing.name}" — مستخدم في ${existing._count.expenses} مصروف`,
      );
    }
    await this.prisma.expenseCategory.delete({ where: { id } });
    return { deleted: true };
  }

  // ===================== Expenses (EXP) =====================

  /**
   * إنشاء مصروف — بلا خزينة: سجل بسيط؛ مع خزينة: خصم رصيد + قيد مالي
   * داخل معاملة واحدة ذرّية.
   */
  async create(dto: CreateExpenseDto, userId: string) {
    const amount = round2(dto.amount);
    return this.prisma.$transaction(async (tx) => {
      // (1) البند — مصدر الحقيقة لاسم البند (لقطة على المصروف).
      const category = await tx.expenseCategory.findUnique({
        where: { id: dto.categoryId },
      });
      if (!category) throw new NotFoundException('بند المصروف غير موجود');

      // (2) إنشاء المصروف أولًا — القيد يرتبط به عبر postingKey مستقر.
      const expense = await tx.expense.create({
        data: {
          categoryId: category.id,
          categoryName: category.name,
          amount: new Prisma.Decimal(amount),
          date: dto.date ?? undefined,
          notes: dto.notes,
          treasuryId: dto.treasuryId ?? null,
          createdById: userId,
        },
      });

      // (3) مسار الخزينة: خصم شرطي ذري + قيد مالي — كلاهما أو لا شيء.
      if (dto.treasuryId) {
        const treasury = await tx.treasury.findUnique({
          where: { id: dto.treasuryId },
        });
        if (!treasury) throw new NotFoundException('الخزينة غير موجودة');
        if (!treasury.isActive || treasury.deletedAt) {
          throw new BadRequestException('الخزينة غير نشطة');
        }

        // CAS: التحديث الشرطي يقفل الصف ويخصم فقط إذا الرصيد كافٍ —
        // أي سباق متزامن يفشل هنا بلا رصيد سالب أبدًا.
        const charged = await tx.treasury.updateMany({
          where: { id: dto.treasuryId, balance: { gte: amount } },
          data: { balance: { decrement: amount } },
        });
        if (charged.count !== 1) {
          throw new BadRequestException('رصيد الخزينة غير كاف');
        }

        const journal = await this.financial.postJournalEntryInTx(
          tx,
          {
            description: `مصروف ${category.name} من الخزينة ${treasury.name}`,
            isAuto: true,
            lines: [
              {
                debitAccountId: CHART_OF_ACCOUNTS.GENERAL_EXPENSE,
                creditAccountId: CHART_OF_ACCOUNTS.CASH,
                amount,
                description: `مصروف ${category.name}`,
              },
            ],
            metadata: {
              source: 'EXPENSE',
              expenseId: expense.id,
              categoryId: category.id,
              categoryName: category.name,
              treasuryId: dto.treasuryId,
              amount,
            },
            postingKey: `expense:${expense.id}`,
          },
          userId,
        );

        return tx.expense.update({
          where: { id: expense.id },
          data: { journalEntryId: journal.entryId },
          include: {
            category: { select: { id: true, name: true } },
            treasury: { select: { id: true, name: true } },
            journalEntry: { select: { id: true, code: true } },
          },
        });
      }

      // (4) مسار بلا خزينة: سجل فقط — لا قيد (نفس سلوك Selim).
      return tx.expense.findUnique({
        where: { id: expense.id },
        include: {
          category: { select: { id: true, name: true } },
          treasury: { select: { id: true, name: true } },
        },
      });
    });
  }

  /** قائمة المصروفات ببحث/بند/تاريخ + ترقيم + إجماليات النطاق. */
  async findAll(query: QueryExpenseDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where = this.buildWhere(query);
    const [items, total, aggregate] = await this.prisma.$transaction([
      this.prisma.expense.findMany({
        where,
        include: {
          category: { select: { id: true, name: true } },
          treasury: { select: { id: true, name: true } },
        },
        orderBy: { date: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.expense.count({ where }),
      this.prisma.expense.aggregate({
        where,
        _count: true,
        _sum: { amount: true },
      }),
    ]);
    return {
      items,
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
      totals: {
        count: aggregate._count,
        amount: round2(Number(aggregate._sum.amount ?? 0)),
      },
    };
  }

  /** ملخص المصروفات حسب البند (بنفس مرشحات القائمة). */
  async getSummary(query: QueryExpenseDto) {
    const where = this.buildWhere(query);
    const [overall, byCategory] = await Promise.all([
      this.prisma.expense.aggregate({
        where,
        _count: true,
        _sum: { amount: true },
      }),
      this.prisma.expense.groupBy({
        by: ['categoryId', 'categoryName'],
        where,
        _count: true,
        _sum: { amount: true },
      }),
    ]);
    return {
      totalCount: overall._count,
      totalAmount: round2(Number(overall._sum.amount ?? 0)),
      byCategory: byCategory
        .map((group) => ({
          categoryId: group.categoryId,
          categoryName: group.categoryName,
          count: group._count,
          totalAmount: round2(Number(group._sum.amount ?? 0)),
        }))
        .sort((a, b) => b.totalAmount - a.totalAmount),
    };
  }

  /** تفاصيل مصروف واحد. */
  async findOne(id: string) {
    const expense = await this.prisma.expense.findUnique({
      where: { id },
      include: {
        category: { select: { id: true, name: true } },
        treasury: { select: { id: true, name: true, balance: true } },
        journalEntry: { select: { id: true, code: true, isReversed: true } },
        createdBy: { select: { id: true, name: true } },
      },
    });
    if (!expense) throw new NotFoundException('المصروف غير موجود');
    return expense;
  }

  /**
   * تعديل مصروف — مسموح للمصروفات غير المقيدة ماليًا فقط (بلا
   * journalEntryId): المقيد له قيد ورصيد خزينة متأثران فتعديله يكسر
   * الذاتية المحاسبية (احذفه وأعد إنشاءه بدلًا منه — نفس رسالة Selim).
   */
  async update(id: string, dto: UpdateExpenseDto) {
    const existing = await this.prisma.expense.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('المصروف غير موجود');
    if (existing.journalEntryId) {
      throw new BadRequestException(
        'لا يمكن تعديل مصروف مقيد ماليًا — احذفه وأنشئ مصروفًا جديدًا بدلًا منه',
      );
    }

    const data: Prisma.ExpenseUpdateInput = {};
    if (dto.categoryId !== undefined) {
      const category = await this.prisma.expenseCategory.findUnique({
        where: { id: dto.categoryId },
      });
      if (!category) throw new NotFoundException('بند المصروف غير موجود');
      data.category = { connect: { id: category.id } };
      data.categoryName = category.name;
    }
    if (dto.amount !== undefined) {
      data.amount = new Prisma.Decimal(round2(dto.amount));
    }
    if (dto.date !== undefined) data.date = dto.date;
    if (dto.notes !== undefined) data.notes = dto.notes;

    return this.prisma.expense.update({
      where: { id },
      data,
      include: {
        category: { select: { id: true, name: true } },
        treasury: { select: { id: true, name: true } },
      },
    });
  }

  /**
   * حذف مصروف — داخل معاملة واحدة: عكس القيد إن وُجد (reverseJournal-
   * EntryInTx يعيد حساب CASH من لقطات ACC-2) ثم إعادة رصيد الخزينة
   * (increment) إن سُحب منه، ثم الحذف.
   */
  async remove(id: string, userId: string) {
    const existing = await this.prisma.expense.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('المصروف غير موجود');

    await this.prisma.$transaction(async (tx) => {
      if (existing.journalEntryId) {
        await this.financial.reverseJournalEntryInTx(
          tx,
          existing.journalEntryId,
          userId,
          `حذف مصروف ${existing.categoryName} — عكس القيد`,
        );
      }
      if (existing.treasuryId) {
        await tx.treasury.update({
          where: { id: existing.treasuryId },
          data: { balance: { increment: Number(existing.amount) } },
        });
      }
      await tx.expense.delete({ where: { id } });
    });
    return { deleted: true };
  }

  /** زرع البنود الافتراضية عند أول استخدام إن كان الجدول فارغًا. */
  private async ensureDefaultCategories() {
    const count = await this.prisma.expenseCategory.count();
    if (count > 0) return;
    await this.prisma.expenseCategory.createMany({
      data: DEFAULT_EXPENSE_CATEGORIES.map((name) => ({
        name,
        notes: 'بند افتراضي من Selim ERP',
      })),
      skipDuplicates: true,
    });
  }

  /** بناء مرشحات الاستعلام المشتركة بين القائمة والملخص. */
  private buildWhere(query: QueryExpenseDto): Prisma.ExpenseWhereInput {
    const where: Prisma.ExpenseWhereInput = {};
    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.from || query.to) {
      where.date = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }
    if (query.search) {
      const search = query.search.trim();
      where.OR = [
        { notes: { contains: search, mode: 'insensitive' } },
        { categoryName: { contains: search, mode: 'insensitive' } },
      ];
    }
    return where;
  }
}
