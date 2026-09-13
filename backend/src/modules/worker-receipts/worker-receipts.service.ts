import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SequenceService } from '../../core/sequence/sequence.service';
import { FinancialPostingService } from '../../core/financial/financial-posting.service';
import { CHART_OF_ACCOUNTS } from '../../core/financial/chart-of-accounts';
import { CreateWorkerReceiptDto } from './dto/create-worker-receipt.dto';
import { QueryWorkerReceiptDto } from './dto/query-worker-receipt.dto';
import { round2 } from '../../core/common/money.util';

/**
 * SELIM-ERP W1 — خدمة سندات قبض العمال (تقلد WorkerReceipt في Selim ERP).
 *
 * السند = مبلغ يُقبض من العامل (تسوية سلفة/مديونية). القواعد (نفس Selim):
 * - ترقيم WRC-0001 داخل معاملة الإنشاء.
 * - العامل يجب أن يكون موجودًا ونشطًا.
 * - إن ذُكرت خزينة: حرس رصيد شرطي (UPDATE ... WHERE balance >= amount)
 *   داخل نفس المعاملة — نفس نمط المخزون في inventory.service — فلا سحب
 *   يتجاوز رصيد الخزينة حتى تحت التزامن. الخصم هنا لا يمر عبر
 *   treasuryUpdates في القيد (المحرك يخصم بلا حرس) — الحرس مسؤوليتنا
 *   والعكس عند الحذف يعيد الرصيد يدويًا داخل نفس معاملة العكس.
 * - القيد المالي (داخل نفس المعاملة): مدين النقدية / دائن سلف العمال —
 *   «قبض من عامل» = استرداد نقد يخفض أصل السلف (نفس منطق COMM-F05
 *   المعكوس). journalEntryId يُخزَّن على السند للعكس لاحقًا.
 */
@Injectable()
export class WorkerReceiptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequence: SequenceService,
    private readonly financial: FinancialPostingService,
  ) {}

  /** إنشاء سند قبض عامل: ترقيم + حرس خزينة + قيد في معاملة واحدة. */
  async create(dto: CreateWorkerReceiptDto, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const worker = await tx.worker.findUnique({
        where: { id: dto.workerId },
        select: { id: true, name: true, isActive: true },
      });
      if (!worker) throw new NotFoundException('العامل غير موجود');
      if (!worker.isActive) {
        throw new BadRequestException('العامل غير نشط — لا تُسجَّل له سندات');
      }

      const code = await this.sequence.nextNumber('WORKER_RECEIPT', tx);

      // حرس الخزينة الشرطي + الخصم في بيان واحد ذري: لا يمر التحديث إلا
      // إذا كان الرصيد كافيًا، وإلا نقرأ الرصيد الحالي لرسالة دقيقة.
      if (dto.treasuryId) {
        const treasury = await tx.treasury.findUnique({
          where: { id: dto.treasuryId },
          select: { id: true, isActive: true, balance: true },
        });
        if (!treasury || !treasury.isActive) {
          throw new NotFoundException('الخزينة غير موجودة أو غير نشطة');
        }
        const claimed = await tx.treasury.updateMany({
          where: {
            id: dto.treasuryId,
            isActive: true,
            balance: { gte: dto.amount },
          },
          data: { balance: { decrement: dto.amount } },
        });
        if (claimed.count !== 1) {
          throw new BadRequestException(
            `رصيد الخزينة لا يكفي — المتاح: ${round2(
              Number(treasury.balance),
            )} والمطلوب: ${round2(dto.amount)}`,
          );
        }
      }

      // قيد الاسترداد: Dr CASH / Cr WORKER_ADVANCES (نفس معاملة السند).
      const entry = await this.financial.postJournalEntryInTx(
        tx,
        {
          description: `قبض من العامل ${worker.name} — سند ${code}`,
          reference: `WORKER_RECEIPT:${code}`,
          isAuto: true,
          lines: [
            {
              debitAccountId: CHART_OF_ACCOUNTS.CASH,
              creditAccountId: CHART_OF_ACCOUNTS.WORKER_ADVANCES,
              amount: dto.amount,
              description: `سند قبض عامل ${worker.name}`,
            },
          ],
        },
        userId,
      );

      return tx.workerReceipt.create({
        data: {
          code,
          workerId: dto.workerId,
          amount: new Prisma.Decimal(round2(dto.amount)),
          date: dto.date ? new Date(dto.date) : new Date(),
          notes: dto.notes,
          treasuryId: dto.treasuryId,
          journalEntryId: entry.entryId,
          createdById: userId,
        },
        include: {
          worker: { select: { id: true, name: true, code: true } },
          treasury: { select: { id: true, name: true } },
        },
      });
    });
  }

  /**
   * قائمة السندات + مجاميع لكل عامل داخل نفس المرشحات (تقرير التسويات).
   */
  async findAll(query: QueryWorkerReceiptDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.WorkerReceiptWhereInput = {};
    if (query.workerId) {
      where.workerId = query.workerId;
    }
    if (query.from || query.to) {
      where.date = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }
    // قراءات متوازية بلا معاملة (نفس نمط ملخص المصروفات — Promise.all
    // أخف من $transaction للقراءة فقط، وgroupBy عبر $transaction يوسّع
    // استدلال أنواع Prisma فيطلب orderBy بلا داعٍ).
    const [items, total, byWorker] = await Promise.all([
      this.prisma.workerReceipt.findMany({
        where,
        include: {
          worker: { select: { id: true, name: true, code: true } },
          treasury: { select: { id: true, name: true } },
        },
        orderBy: { date: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.workerReceipt.count({ where }),
      // مجاميع المقبوض لكل عامل داخل نفس المرشحات (لا الترقيم).
      this.prisma.workerReceipt.groupBy({
        by: ['workerId'],
        where,
        _sum: { amount: true },
        _count: true,
      }),
    ]);
    return {
      items,
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
      workerTotals: byWorker.map((row) => ({
        workerId: row.workerId,
        count: row._count,
        total: Number(row._sum?.amount ?? 0),
      })),
    };
  }

  /** تفاصيل سند واحد (مع العامل والخزينة والقيد المرتبط). */
  async findOne(id: string) {
    const receipt = await this.prisma.workerReceipt.findUnique({
      where: { id },
      include: {
        worker: { select: { id: true, name: true, code: true, phone: true } },
        treasury: { select: { id: true, name: true, type: true } },
        journalEntry: { select: { id: true, code: true, isReversed: true } },
        createdBy: { select: { id: true, name: true } },
      },
    });
    if (!receipt) throw new NotFoundException('سند القبض غير موجود');
    return receipt;
  }

  /**
   * حذف سند: عكس القيد المالي + إعادة رصيد الخزينة إن وُجدت — كلها داخل
   * معاملة واحدة (فشل أي خطوة يعيد الكل).
   */
  async remove(id: string, userId: string) {
    const receipt = await this.prisma.workerReceipt.findUnique({
      where: { id },
      select: {
        id: true,
        code: true,
        amount: true,
        treasuryId: true,
        journalEntryId: true,
      },
    });
    if (!receipt) throw new NotFoundException('سند القبض غير موجود');

    return this.prisma.$transaction(async (tx) => {
      if (receipt.journalEntryId) {
        await this.financial.reverseJournalEntryInTx(
          tx,
          receipt.journalEntryId,
          userId,
          `عكس سند قبض عامل ${receipt.code}`,
        );
      }
      // إعادة رصيد الخزينة إن كان السند مرتبطًا بخزينة (القيد العكسي
      // يعيد الحسابات فقط — رصيد الخزينة أثر جانبي خُصم بحرسنا الخاص).
      if (receipt.treasuryId) {
        await tx.treasury.update({
          where: { id: receipt.treasuryId },
          data: { balance: { increment: Number(receipt.amount) } },
        });
      }
      await tx.workerReceipt.delete({ where: { id } });
      return { deleted: true, code: receipt.code };
    });
  }
}
