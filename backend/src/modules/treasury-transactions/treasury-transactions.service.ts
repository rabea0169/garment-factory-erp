import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, TreasuryTransactionType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SequenceService } from '../../core/sequence/sequence.service';
import { FinancialPostingService } from '../../core/financial/financial-posting.service';
import { CHART_OF_ACCOUNTS } from '../../core/financial/chart-of-accounts';
import { round2 } from '../../core/common/money.util';
import {
  CreateTreasuryTransactionDto,
  QueryTreasuryTransactionDto,
} from './dto/create-treasury-transaction.dto';

/**
 * SELIM-ERP W1 — خدمة حركات الخزينة (تقلد /api/treasury-transactions في
 * Selim ERP): إيداع / سحب / تحويل بين خزينتين.
 *
 * القواعد (من المرجع Selim وتُنفَّذ حرفيًا):
 * - الترقيم TRT-0001 عبر SequenceService داخل معاملة الإنشاء نفسها.
 * - الأرصدة تتغير داخل نفس المعاملة:
 *     • DEPOSIT  → treasuryId +amount.
 *     • WITHDRAWAL → treasuryId −amount بتحديث شرطي ذري (balance ≥ amount)
 *       — إن لم يجتز: 400 «رصيد الخزينة غير كاف» (نمط CAS: لا سباق ولا
 *       رصيد سالب أبدًا).
 *     • TRANSFER → المصدر −amount (بنفس الحراسة) والهدف +amount، ويشترط
 *       أن تكون الخزينتان بنفس العملة (أو كلتاهما بلا عملة) وإلا 400
 *       «لا يمكن التحويل بين خزائن بعملات مختلفة»، وبأن تختلف الخزينة
 *       المستهدفة عن المصدر.
 * - القيود المالية (الإيداع/السحب فقط — التحويل حركة داخلية بين حسابات
 *   النقدية فلا قيد GL، المرجع التوثيقي في notes):
 *     • DEPOSIT → Dr CASH / Cr (رأس مال: OWNERS_EQUITY؛ مبيعات:
 *       ACCOUNTS_RECEIVABLE تحصيل ذمم؛ غير ذلك: OWNERS_EQUITY).
 *     • WITHDRAWAL → Dr (مشتريات: INVENTORY؛ غير ذلك: GENERAL_EXPENSE)
 *       / Cr CASH.
 * - كل حركة تحمل journalEntryId عند ترحيلها (لا حركة مالية بلا قيد —
 *   إلا التحويل الداخلي الموثق).
 * - الحذف: للحركات اليدوية فقط (بلا referenceId — الحركات الناتجة عن
 *   مستندات تُحذف من مستندها)، ويعكس القيد ويعيد الأرصدة داخل معاملة
 *   واحدة.
 */
@Injectable()
export class TreasuryTransactionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequence: SequenceService,
    private readonly financial: FinancialPostingService,
  ) {}

  /** إنشاء حركة خزينة بترقيم TRT وتحديث أرصدة وقيد داخل معاملة واحدة. */
  async create(dto: CreateTreasuryTransactionDto, userId: string) {
    const type = dto.type as TreasuryTransactionType;
    const amount = round2(dto.amount);

    return this.prisma.$transaction(async (tx) => {
      // (1) ترقيم تسلسلي داخل المعاملة — يتراجع مع أي فشل.
      const code = await this.sequence.nextNumber('TREASURY_TRANSACTION', tx);

      // (2) الخزينة المصدر — موجودة ونشطة.
      const treasury = await tx.treasury.findUnique({
        where: { id: dto.treasuryId },
      });
      if (!treasury) throw new NotFoundException('الخزينة غير موجودة');
      if (!treasury.isActive || treasury.deletedAt) {
        throw new BadRequestException('الخزينة غير نشطة');
      }

      // (3) التحقق من التحويل: مستهدف مختلف + نفس العملة.
      let toTreasury: {
        id: string;
        name: string;
        currencyId: string | null;
      } | null = null;
      if (type === TreasuryTransactionType.TRANSFER) {
        if (!dto.toTreasuryId) {
          throw new BadRequestException('التحويل يتطلب خزينة مستهدفة');
        }
        if (dto.toTreasuryId === dto.treasuryId) {
          throw new BadRequestException('لا يمكن التحويل إلى نفس الخزينة');
        }
        const target = await tx.treasury.findUnique({
          where: { id: dto.toTreasuryId },
        });
        if (!target) {
          throw new NotFoundException('الخزينة المستهدفة غير موجودة');
        }
        if (!target.isActive || target.deletedAt) {
          throw new BadRequestException('الخزينة المستهدفة غير نشطة');
        }
        toTreasury = {
          id: target.id,
          name: target.name,
          currencyId: target.currencyId,
        };
        if ((treasury.currencyId ?? null) !== (toTreasury.currencyId ?? null)) {
          throw new BadRequestException(
            'لا يمكن التحويل بين خزائن بعملات مختلفة',
          );
        }
      } else if (dto.toTreasuryId) {
        throw new BadRequestException('الخزينة المستهدفة تُحدد للتحويل فقط');
      }

      // (4) تحديث الأرصدة داخل المعاملة — السحب/التحويل بحراسة كافية.
      if (type === TreasuryTransactionType.DEPOSIT) {
        await tx.treasury.update({
          where: { id: treasury.id },
          data: { balance: { increment: amount } },
        });
      } else if (type === TreasuryTransactionType.WITHDRAWAL) {
        const charged = await tx.treasury.updateMany({
          where: { id: treasury.id, balance: { gte: amount } },
          data: { balance: { decrement: amount } },
        });
        if (charged.count !== 1) {
          throw new BadRequestException('رصيد الخزينة غير كاف');
        }
      } else {
        const charged = await tx.treasury.updateMany({
          where: { id: treasury.id, balance: { gte: amount } },
          data: { balance: { decrement: amount } },
        });
        if (charged.count !== 1) {
          throw new BadRequestException('رصيد الخزينة غير كاف');
        }
        await tx.treasury.update({
          where: { id: toTreasury!.id },
          data: { balance: { increment: amount } },
        });
      }

      // (5) القيد المالي (إيداع/سحب) — التحويل الداخلي بلا قيد GL.
      let journalEntryId: string | undefined;
      if (type !== TreasuryTransactionType.TRANSFER) {
        const journal = await this.financial.postJournalEntryInTx(
          tx,
          {
            description: `${type === TreasuryTransactionType.DEPOSIT ? 'إيداع' : 'سحب'} خزينة ${treasury.name} — ${dto.description}`,
            reference: code,
            isAuto: true,
            lines: [
              type === TreasuryTransactionType.DEPOSIT
                ? {
                    debitAccountId: CHART_OF_ACCOUNTS.CASH,
                    creditAccountId:
                      dto.category === 'رأس مال'
                        ? CHART_OF_ACCOUNTS.OWNERS_EQUITY
                        : dto.category === 'مبيعات'
                          ? CHART_OF_ACCOUNTS.ACCOUNTS_RECEIVABLE
                          : CHART_OF_ACCOUNTS.OWNERS_EQUITY,
                    amount,
                    description: `إيداع ${dto.category ?? 'أخرى'} — ${dto.description}`,
                  }
                : {
                    debitAccountId:
                      dto.category === 'مشتريات'
                        ? CHART_OF_ACCOUNTS.INVENTORY
                        : CHART_OF_ACCOUNTS.GENERAL_EXPENSE,
                    creditAccountId: CHART_OF_ACCOUNTS.CASH,
                    amount,
                    description: `سحب ${dto.category ?? 'أخرى'} — ${dto.description}`,
                  },
            ],
            metadata: {
              source: 'TREASURY_TRANSACTION',
              transactionId: code,
              treasuryId: treasury.id,
              toTreasuryId: dto.toTreasuryId ?? null,
              type,
              category: dto.category ?? null,
              amount,
            },
            postingKey: `treasury-transaction:${code}`,
          },
          userId,
        );
        journalEntryId = journal.entryId;
      }

      // (6) إنشاء سجل الحركة بكل روابطه.
      return tx.treasuryTransaction.create({
        data: {
          code,
          treasuryId: treasury.id,
          toTreasuryId: dto.toTreasuryId ?? null,
          type,
          amount: new Prisma.Decimal(amount),
          date: dto.date ?? undefined,
          description: dto.description,
          category: dto.category,
          notes:
            dto.notes ??
            (type === TreasuryTransactionType.TRANSFER
              ? // التحويل الداخلي بلا قيد GL — المرجع التوثيقي هنا.
                'تحويل داخلي بين خزائن النقدية — بلا قيد GL (حركة بين حسابات نقدية)'
              : undefined),
          journalEntryId: journalEntryId ?? null,
          createdById: userId,
        },
        include: {
          treasury: { select: { id: true, name: true, type: true } },
          toTreasury: { select: { id: true, name: true, type: true } },
          journalEntry: { select: { id: true, code: true } },
        },
      });
    });
  }

  /** قائمة الحركات بفلترة خزينة/نوع/تاريخ + ترقيم صفحات. */
  async findAll(query: QueryTreasuryTransactionDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.TreasuryTransactionWhereInput = {};
    if (query.treasuryId) {
      // فلترة الخزينة تشمل حركاتها كمصدر أو كهدف (تحويل وارد).
      where.OR = [
        { treasuryId: query.treasuryId },
        { toTreasuryId: query.treasuryId },
      ];
    }
    if (query.type) {
      where.type = query.type as TreasuryTransactionType;
    }
    if (query.from || query.to) {
      where.date = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }
    const [items, total] = await this.prisma.$transaction([
      this.prisma.treasuryTransaction.findMany({
        where,
        include: {
          treasury: { select: { id: true, name: true, type: true } },
          toTreasury: { select: { id: true, name: true, type: true } },
          journalEntry: { select: { id: true, code: true } },
          createdBy: { select: { id: true, name: true } },
        },
        orderBy: { date: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.treasuryTransaction.count({ where }),
    ]);
    return { items, total, page, limit, pages: Math.ceil(total / limit) };
  }

  /** ملخص الخزائن: الرصيد الحالي لكل خزينة + المجاميع حسب نوع الحركة. */
  async getSummary() {
    const [treasuries, byType] = await Promise.all([
      this.prisma.treasury.findMany({
        where: { deletedAt: null },
        select: {
          id: true,
          name: true,
          type: true,
          balance: true,
          currencyId: true,
          isActive: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.treasuryTransaction.groupBy({
        by: ['type'],
        _count: true,
        _sum: { amount: true },
      }),
    ]);
    const typeTotals: Record<string, { count: number; totalAmount: number }> = {
      DEPOSIT: { count: 0, totalAmount: 0 },
      WITHDRAWAL: { count: 0, totalAmount: 0 },
      TRANSFER: { count: 0, totalAmount: 0 },
    };
    for (const group of byType) {
      typeTotals[group.type] = {
        count: group._count,
        totalAmount: round2(Number(group._sum.amount ?? 0)),
      };
    }
    return {
      treasuries: treasuries.map((treasury) => ({
        id: treasury.id,
        name: treasury.name,
        type: treasury.type,
        currencyId: treasury.currencyId,
        isActive: treasury.isActive,
        balance: round2(Number(treasury.balance)),
      })),
      totalActiveBalance: round2(
        treasuries
          .filter((treasury) => treasury.isActive)
          .reduce((sum, treasury) => sum + Number(treasury.balance), 0),
      ),
      byType: typeTotals,
    };
  }

  /** تفاصيل حركة واحدة بروابطها (القيد/الخزينتان/الفاعل). */
  async findOne(id: string) {
    const transaction = await this.prisma.treasuryTransaction.findUnique({
      where: { id },
      include: {
        treasury: { select: { id: true, name: true, type: true } },
        toTreasury: { select: { id: true, name: true, type: true } },
        journalEntry: { select: { id: true, code: true, isReversed: true } },
        createdBy: { select: { id: true, name: true } },
      },
    });
    if (!transaction) throw new NotFoundException('حركة الخزينة غير موجودة');
    return transaction;
  }

  /**
   * حذف حركة يدوية (بلا referenceId — الحركات الناتجة عن مستندات
   * «مصروف/سند/سلفة» تُحذف من مستندها الأصل): عكس القيد إن وُجد ثم
   * إعادة الأرصدة (عكس اتجاه الحركة) داخل معاملة واحدة.
   */
  async remove(id: string, userId: string) {
    const existing = await this.prisma.treasuryTransaction.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('حركة الخزينة غير موجودة');
    if (existing.referenceId) {
      throw new BadRequestException(
        'لا يمكن حذف حركة مرتبطة بمستند آخر — احذف المستند الأصل بدلًا منها',
      );
    }

    const amount = Number(existing.amount);
    await this.prisma.$transaction(async (tx) => {
      // (1) عكس القيد إن وُجد (يعيد حساب CASH من لقطات ACC-2).
      if (existing.journalEntryId) {
        await this.financial.reverseJournalEntryInTx(
          tx,
          existing.journalEntryId,
          userId,
          `حذف حركة خزينة ${existing.code} — عكس القيد`,
        );
      }

      // (2) إعادة الأرصدة — عكس اتجاه الحركة الأصلي.
      if (existing.type === TreasuryTransactionType.DEPOSIT) {
        // الإيداع أضاف للرصيد — الحذف يسحبه (بحراسة كافية).
        const reverted = await tx.treasury.updateMany({
          where: { id: existing.treasuryId, balance: { gte: amount } },
          data: { balance: { decrement: amount } },
        });
        if (reverted.count !== 1) {
          throw new BadRequestException('رصيد الخزينة غير كاف');
        }
      } else if (existing.type === TreasuryTransactionType.WITHDRAWAL) {
        await tx.treasury.update({
          where: { id: existing.treasuryId },
          data: { balance: { increment: amount } },
        });
      } else {
        await tx.treasury.update({
          where: { id: existing.treasuryId },
          data: { balance: { increment: amount } },
        });
        if (existing.toTreasuryId) {
          const reverted = await tx.treasury.updateMany({
            where: { id: existing.toTreasuryId, balance: { gte: amount } },
            data: { balance: { decrement: amount } },
          });
          if (reverted.count !== 1) {
            throw new BadRequestException('رصيد الخزينة المستهدفة غير كاف');
          }
        }
      }

      await tx.treasuryTransaction.delete({ where: { id } });
    });
    return { deleted: true };
  }
}
