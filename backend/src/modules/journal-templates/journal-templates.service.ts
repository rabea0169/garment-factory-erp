import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { FinancialPostingService } from '../../core/financial/financial-posting.service';
import { round2 } from '../../core/common/money.util';
import {
  CreateJournalTemplateDto,
  JournalTemplateLineDto,
} from './dto/create-journal-template.dto';
import { UpdateJournalTemplateDto } from './dto/update-journal-template.dto';
import { PostJournalTemplateDto } from './dto/post-journal-template.dto';
import { QueryJournalTemplateDto } from './dto/query-journal-template.dto';

/**
 * SELIM-ERP W1 — خدمة قوالب القيود المتكررة (تقلد JournalTemplate في Selim ERP).
 *
 * قواعد المجال (نفس مسار Selim):
 * - القالب بنودًا اتجاهية ({accountId, debit, credit}) لا أزواجًا جاهزة —
 *   المحاسب يحرّر القالب والاقتران يحدث عند الترحيل.
 * - التوازن إلزامي: بندين على الأقل، كل سطر مدين أو دائن (لا الاثنين ولا
 *   أحدهما صفر)، Σالمدين = Σالدائن.
 * - الحسابات يجب أن تكون حسابات ورقة (isGroup=false) قائمة فعلًا.
 * - الترحيل (post) يُنشئ قيدًا حقيقيًا عبر FinancialPostingService —
 *   نفس محرك القيد المزدوج الموحد — بمرجع JRT:{اسم القالب}، ثم يحدّث
 *   lastUsedAt. لا مسار ترحيل موازٍ أبدًا (كل القيود من بوابة واحدة).
 */

/** شكل بند القالب كما يُخزَّن في عمود Json lines. */
interface TemplateLine {
  accountId: string;
  debit: number;
  credit: number;
  description?: string;
}

@Injectable()
export class JournalTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly financial: FinancialPostingService,
  ) {}

  /** قائمة القوالب بفلترة isRecurring + بحث في الاسم + ترقيم. */
  async findAll(query: QueryJournalTemplateDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.JournalTemplateWhereInput = {};
    if (query.isRecurring !== undefined) where.isRecurring = query.isRecurring;
    if (query.search) {
      where.name = { contains: query.search.trim(), mode: 'insensitive' };
    }
    const [items, total] = await this.prisma.$transaction([
      this.prisma.journalTemplate.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.journalTemplate.count({ where }),
    ]);
    return { items, total, page, limit, pages: Math.ceil(total / limit) || 1 };
  }

  /** تفاصيل قالب واحد. */
  async findOne(id: string) {
    const template = await this.prisma.journalTemplate.findUnique({
      where: { id },
    });
    if (!template) throw new NotFoundException('قالب القيد غير موجود');
    return template;
  }

  /** إنشاء قالب بعد كل تحققات التوازن والحسابات. */
  async create(dto: CreateJournalTemplateDto) {
    await this.validateLines(dto.lines);
    try {
      return await this.prisma.journalTemplate.create({
        data: {
          name: dto.name,
          description: dto.description ?? null,
          // البنود تُخزَّن أرقامًا قياسية (debit/credit صفر للاتجاه الآخر).
          lines: this.normalizeLines(
            dto.lines,
          ) as unknown as Prisma.InputJsonValue,
          isRecurring: dto.isRecurring ?? false,
          recurrencePattern: dto.recurrencePattern ?? null,
        },
      });
    } catch (error) {
      // name فريد على مستوى الجدول — تعارض الأسماء برسالة عربية.
      if ((error as { code?: string })?.code === 'P2002') {
        throw new ConflictException('اسم القالب مستخدم بالفعل');
      }
      throw error;
    }
  }

  /**
   * تعديل قالب — عند إرسال بنود جديدة تُستبدل بالكامل بعد نفس
   * التحققات (سلوك استبدال كامل مثل تعديل بنود عروض الأسعار).
   */
  async update(id: string, dto: UpdateJournalTemplateDto) {
    const existing = await this.prisma.journalTemplate.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('قالب القيد غير موجود');

    if (dto.lines) {
      await this.validateLines(dto.lines);
    }
    try {
      return await this.prisma.journalTemplate.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.description !== undefined
            ? { description: dto.description }
            : {}),
          ...(dto.lines !== undefined
            ? {
                lines: this.normalizeLines(
                  dto.lines,
                ) as unknown as Prisma.InputJsonValue,
              }
            : {}),
          ...(dto.isRecurring !== undefined
            ? { isRecurring: dto.isRecurring }
            : {}),
          ...(dto.recurrencePattern !== undefined
            ? { recurrencePattern: dto.recurrencePattern }
            : {}),
        },
      });
    } catch (error) {
      if ((error as { code?: string })?.code === 'P2002') {
        throw new ConflictException('اسم القالب مستخدم بالفعل');
      }
      throw error;
    }
  }

  /**
   * حذف قالب — دلالة Restrict بلا أبناء (لا FK يشير للقالب)؛ نحذف
   * فعليًا. القيود المرحّلة سابقًا منه قيود مستقلة قائمة بذاتها.
   */
  async remove(id: string) {
    const existing = await this.prisma.journalTemplate.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('قالب القيد غير موجود');
    await this.prisma.journalTemplate.delete({ where: { id } });
    return { deleted: true, id };
  }

  /**
   * معاينة القالب: البنود مع أسماء الحسابات وأرصدتها الحالية — تُعرض
   * للمحاسب قبل الترحيل (نفس preview في Selim).
   */
  async preview(id: string) {
    const template = await this.findOne(id);
    const lines = this.parseLines(template.lines);
    const accountIds = [...new Set(lines.map((l) => l.accountId))];
    const accounts = accountIds.length
      ? await this.prisma.account.findMany({
          where: { id: { in: accountIds } },
          select: {
            id: true,
            code: true,
            name: true,
            type: true,
            balance: true,
          },
        })
      : [];
    const byId = new Map(accounts.map((a) => [a.id, a]));
    return {
      id: template.id,
      name: template.name,
      description: template.description,
      isRecurring: template.isRecurring,
      recurrencePattern: template.recurrencePattern,
      lastUsedAt: template.lastUsedAt,
      lines: lines.map((line, index) => {
        const account = byId.get(line.accountId);
        return {
          index: index + 1,
          accountId: line.accountId,
          accountCode: account?.code ?? null,
          accountName: account?.name ?? null,
          accountType: account?.type ?? null,
          accountBalance: account ? round2(Number(account.balance)) : null,
          debit: round2(line.debit),
          credit: round2(line.credit),
          description: line.description ?? null,
        };
      }),
      totalDebit: round2(lines.reduce((sum, l) => sum + l.debit, 0)),
      totalCredit: round2(lines.reduce((sum, l) => sum + l.credit, 0)),
    };
  }

  /**
   * ترحيل القالب إلى قيد حقيقي (يقلد post في Selim ERP):
   * - يعيد التحقق من الحسابات (قد تُحذف بعد إنشاء القالب) والتوازن.
   * - يقترن كل سطر مدين بسطر دائن (تخصيص متسلسل) لبنود أزواج جاهزة
   *   لمحرك القيد: {debitAccountId, creditAccountId, amount}.
   * - يمررها لـ FinancialPostingService.postJournalEntry (معاملته
   *   الذاتية) بمرجع JRT:{اسم القالب} ثم يحدّث lastUsedAt=now.
   */
  async post(id: string, dto: PostJournalTemplateDto, userId: string) {
    const template = await this.findOne(id);
    const lines = this.parseLines(template.lines);

    // إعادة التحقق لحظة الترحيل — القالب قد يتقادم (حساب محذوف أو
    // بنود غير متوازنة من تعديل خارجي لعمود Json).
    await this.validateLines(
      lines.map((l) => ({
        accountId: l.accountId,
        debit: l.debit,
        credit: l.credit,
        description: l.description,
      })),
    );

    const postingLines = this.pairLines(lines);
    const entry = await this.financial.postJournalEntry(
      {
        description: dto.notes?.trim() || `قيد من القالب «${template.name}»`,
        reference: `JRT:${template.name}`,
        isAuto: true,
        ...(dto.date ? { date: new Date(dto.date) } : {}),
        lines: postingLines,
        userId,
      },
      userId,
    );

    const updated = await this.prisma.journalTemplate.update({
      where: { id },
      data: { lastUsedAt: new Date() },
      select: { id: true, name: true, lastUsedAt: true },
    });

    return { entry, template: updated };
  }

  /**
   * تحققات المجال للبنود (تُستدعى في الإنشاء/التعديل/الترحيل):
   * 1) بندين على الأقل.
   * 2) كل سطر مدين أو دائن — لا الاثنين معًا ولا صفر.
   * 3) Σالمدين = Σالدائن (توازن القيد المزدوج).
   * 4) كل الحسابات موجودة وغير تجميعية.
   */
  private async validateLines(lines: JournalTemplateLineDto[]) {
    if (!lines || lines.length < 2) {
      throw new BadRequestException('القالب يجب أن يحتوي على بندين على الأقل');
    }

    let totalDebit = 0;
    let totalCredit = 0;
    for (const line of lines) {
      const debit = round2(line.debit ?? 0);
      const credit = round2(line.credit ?? 0);
      if (debit < 0 || credit < 0) {
        throw new BadRequestException('مبالغ البنود لا يمكن أن تكون سالبة');
      }
      const isDebit = debit > 0;
      const isCredit = credit > 0;
      if (isDebit === isCredit) {
        // isDebit === isCredit يعني: كلاهما موجب (الاثنين) أو كلاهما صفر
        // (لا شيء) — كلاهما مخالف لقاعدة الاتجاه الواحد للسطر.
        throw new BadRequestException(
          'كل سطر يجب أن يكون مدينًا أو دائنًا وليس الاثنين',
        );
      }
      totalDebit += debit;
      totalCredit += credit;
    }

    if (round2(totalDebit) !== round2(totalCredit)) {
      throw new BadRequestException(
        'القالب غير متوازن — مجموع المدين يجب أن يساوي الدائن',
      );
    }

    const accountIds = [...new Set(lines.map((l) => l.accountId))];
    const found = await this.prisma.account.findMany({
      where: { id: { in: accountIds }, isGroup: false },
      select: { id: true },
    });
    if (found.length !== accountIds.length) {
      throw new BadRequestException(
        'حساب في بنود القالب غير موجود أو حساب تجميعي',
      );
    }
  }

  /** تطبيع البنود قبل التخزين (أصفار صريحة للاتجاه غير المستخدم). */
  private normalizeLines(lines: JournalTemplateLineDto[]): TemplateLine[] {
    return lines.map((line) => ({
      accountId: line.accountId,
      debit: round2(line.debit ?? 0),
      credit: round2(line.credit ?? 0),
      ...(line.description ? { description: line.description } : {}),
    }));
  }

  /** قراءة عمود Json كبنود قالب (دفاعيًا — القيمة الخارجية غير مضمونة). */
  private parseLines(raw: Prisma.JsonValue): TemplateLine[] {
    if (!Array.isArray(raw)) return [];
    const lines: TemplateLine[] = [];
    for (const item of raw) {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) {
        continue;
      }
      const record: Prisma.JsonObject = item;
      // accountId يجب أن يكون نص UUID — ما عداه بيانات فاسدة تُتخطى.
      const accountId = record.accountId;
      if (typeof accountId !== 'string') continue;
      lines.push({
        accountId,
        debit: round2(Number(record.debit ?? 0) || 0),
        credit: round2(Number(record.credit ?? 0) || 0),
        ...(typeof record.description === 'string'
          ? { description: record.description }
          : {}),
      });
    }
    return lines;
  }

  /**
   * اقتران البنود الاتجاهية في أزواج مدين/دائن جاهزة لمحرك القيد:
   * طابور دائن يُستهلك بالتسلسل من البنود المدينة (تخصيص جزئي عند
   * عدم تساوي أعداد البنود) — يحافظ على المبالغ الأصلية بالضبط
   * لأن القالب متوازن (مجموع المدين = مجموع الدائن).
   */
  private pairLines(lines: TemplateLine[]): {
    debitAccountId: string;
    creditAccountId: string;
    amount: number;
    description?: string;
  }[] {
    const debits = lines
      .filter((l) => l.debit > 0)
      .map((l) => ({
        accountId: l.accountId,
        amount: l.debit,
        description: l.description,
      }));
    const credits = lines
      .filter((l) => l.credit > 0)
      .map((l) => ({
        accountId: l.accountId,
        remaining: l.credit,
        description: l.description,
      }));

    const pairs: {
      debitAccountId: string;
      creditAccountId: string;
      amount: number;
      description?: string;
    }[] = [];
    for (const debit of debits) {
      let remaining = round2(debit.amount);
      while (remaining > 0.005) {
        const credit = credits[0];
        if (!credit) {
          // القالب متوازن (مُتحقق أعلاه) — لا يصل إليها إلا بيانات فاسدة.
          throw new BadRequestException(
            'القالب غير متوازن — مجموع المدين يجب أن يساوي الدائن',
          );
        }
        const take = round2(Math.min(remaining, credit.remaining));
        pairs.push({
          debitAccountId: debit.accountId,
          creditAccountId: credit.accountId,
          amount: take,
          ...((debit.description ?? credit.description)
            ? { description: debit.description ?? credit.description }
            : {}),
        });
        credit.remaining = round2(credit.remaining - take);
        remaining = round2(remaining - take);
        if (credit.remaining <= 0.005) credits.shift();
      }
    }
    return pairs;
  }
}
