import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PayrollStatus, Prisma } from '@prisma/client';
import {
  computeRequestHash,
  createIdempotencyKey,
  isIdempotencyUniqueViolation,
  storeIdempotencyResponse,
  tryReplayIdempotencyKey,
} from '../../core/common/idempotency.util';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { PaginatedResult } from '../../common/dto/paginated-result.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { FinancialPostingService } from '../../core/financial/financial-posting.service';
import { CHART_OF_ACCOUNTS } from '../../core/financial/chart-of-accounts';

export interface PayrollInput {
  workerId: string;
  periodStart: Date;
  periodEnd: Date;
  notes?: string;
}

export interface PayrollPaymentInput {
  treasuryId: string;
  paymentDate?: Date;
  notes?: string;
}

type PayrollResponse = {
  id: string;
  workerId: string;
  periodStart: Date;
  periodEnd: Date;
  grossAmount: number;
  advanceDeduct: number;
  absenceDeduct: number;
  netAmount: number;
  status: PayrollStatus;
  isPaid: boolean;
  paidAt: Date | null;
  notes: string | null;
  createdById: string | null;
  approvedById: string | null;
  approvedAt: Date | null;
};

function getPeriodEndExclusive(periodEnd: Date): Date {
  const endExclusive = new Date(periodEnd);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
  return endExclusive;
}

function isPayrollPeriodUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { code?: unknown; meta?: unknown };
  if (candidate.code !== 'P2002') return false;
  const target = JSON.stringify(candidate.meta ?? {});
  return (
    target.includes('worker_period') ||
    (target.includes('workerId') &&
      target.includes('periodStart') &&
      target.includes('periodEnd'))
  );
}

@Injectable()
export class HrService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly financial: FinancialPostingService,
  ) {}

  async getAllWorkers(pagination: PaginationDto = new PaginationDto()) {
    const page = pagination.page ?? 1;
    const pageSize = pagination.limit ?? 20;
    const skip = (page - 1) * pageSize;
    const options = {
      orderBy: { createdAt: 'desc' } as const,
      skip,
      take: pageSize,
    };

    const [data, total] = await Promise.all([
      this.prisma.worker.findMany(options),
      this.prisma.worker.count(),
    ]);

    return new PaginatedResult(data, total, page, pageSize);
  }

  async getWorkerDetails(id: string) {
    const worker = await this.prisma.worker.findUnique({
      where: { id },
      include: {
        dailyProduction: {
          take: 10,
          orderBy: { date: 'desc' },
        },
        advances: {
          take: 5,
          orderBy: { date: 'desc' },
        },
      },
    });
    if (!worker) throw new NotFoundException('العامل غير موجود');
    return worker;
  }

  async recordAttendance(data: {
    workerId: string;
    date: Date;
    isPresent: boolean;
    notes?: string;
  }) {
    const worker = await this.prisma.worker.findUnique({
      where: { id: data.workerId },
      select: { id: true },
    });
    if (!worker) throw new NotFoundException('العامل غير موجود');

    try {
      return await this.prisma.attendance.create({
        data: {
          workerId: data.workerId,
          date: new Date(data.date),
          isPresent: data.isPresent,
          notes: data.notes,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'يوجد سجل حضور للعامل في هذا التاريخ بالفعل',
        );
      }
      throw error;
    }
  }

  async recordDailyProduction(data: {
    workerId: string;
    workOrderId?: string;
    date: Date;
    piecesCount: number;
  }) {
    const worker = await this.prisma.worker.findUnique({
      where: { id: data.workerId },
    });
    if (!worker) throw new NotFoundException('العامل غير موجود');

    const totalAmount = data.piecesCount * Number(worker.pieceRate);

    return this.prisma.dailyProduction.create({
      data: {
        workerId: data.workerId,
        workOrderId: data.workOrderId,
        date: new Date(data.date),
        piecesCount: data.piecesCount,
        pieceRate: worker.pieceRate,
        totalAmount,
      },
    });
  }

  async recordAdvance(data: {
    workerId: string;
    amount: number;
    notes?: string;
  }) {
    return this.prisma.workerAdvance.create({
      data: {
        workerId: data.workerId,
        amount: data.amount,
        notes: data.notes,
      },
    });
  }

  async createPayroll(
    input: PayrollInput,
    actorId: string,
    idempotencyKey?: string,
  ): Promise<PayrollResponse | (PayrollResponse & { replayed: true })> {
    this.validatePayrollPeriod(input.periodStart, input.periodEnd);
    const periodEndExclusive = getPeriodEndExclusive(input.periodEnd);
    const requestHash = computeRequestHash({
      workerId: input.workerId,
      periodStart: input.periodStart.toISOString(),
      periodEnd: input.periodEnd.toISOString(),
      notes: input.notes ?? null,
      actorId,
    });
    const scope = 'hr-payroll-create';

    try {
      return await this.prisma.$transaction(async (tx) => {
        const replay = await tryReplayIdempotencyKey(
          tx,
          idempotencyKey,
          scope,
          requestHash,
        );
        if (replay) {
          return replay as PayrollResponse & { replayed: true };
        }

        const worker = await tx.worker.findUnique({
          where: { id: input.workerId },
          select: { id: true },
        });
        if (!worker) throw new NotFoundException('العامل غير موجود');

        const existing = await tx.payroll.findFirst({
          where: {
            workerId: input.workerId,
            periodStart: input.periodStart,
            periodEnd: input.periodEnd,
          },
          select: { id: true },
        });
        if (existing) {
          throw new ConflictException(
            'يوجد كشف راتب للعامل في هذه الفترة بالفعل',
          );
        }

        const [production, advances] = await Promise.all([
          tx.dailyProduction.aggregate({
            where: {
              workerId: input.workerId,
              date: { gte: input.periodStart, lt: periodEndExclusive },
            },
            _sum: { totalAmount: true },
          }),
          tx.workerAdvance.aggregate({
            where: {
              workerId: input.workerId,
              date: { gte: input.periodStart, lt: periodEndExclusive },
            },
            _sum: { amount: true },
          }),
        ]);
        const grossAmount =
          production._sum.totalAmount ?? new Prisma.Decimal(0);
        const advanceTotal = advances._sum.amount ?? new Prisma.Decimal(0);
        const advanceDeduct = advanceTotal.gt(grossAmount)
          ? grossAmount
          : advanceTotal;
        const absenceDeduct = new Prisma.Decimal(0);
        const netAmount = grossAmount.minus(advanceDeduct).minus(absenceDeduct);
        const payrollIdempotencyKeyId = await createIdempotencyKey(
          tx,
          idempotencyKey,
          scope,
          requestHash,
        );
        const created = await tx.payroll.create({
          data: {
            workerId: input.workerId,
            periodStart: input.periodStart,
            periodEnd: input.periodEnd,
            grossAmount,
            advanceDeduct,
            absenceDeduct,
            netAmount,
            status: PayrollStatus.DRAFT,
            notes: input.notes,
            createdById: actorId,
            idempotencyKeyId: payrollIdempotencyKeyId,
          },
        });
        const response = this.toPayrollResponse(created);
        await tx.activityLog.create({
          data: {
            userId: actorId,
            action: 'PAYROLL_CREATED',
            module: 'HR',
            details: {
              payrollId: response.id,
              workerId: response.workerId,
              grossAmount: response.grossAmount,
              advanceDeduct: response.advanceDeduct,
              netAmount: response.netAmount,
            },
          },
        });
        await storeIdempotencyResponse(tx, idempotencyKey, response);
        return response;
      });
    } catch (error) {
      if (isPayrollPeriodUniqueViolation(error)) {
        throw new ConflictException(
          'يوجد كشف راتب للعامل في هذه الفترة بالفعل',
        );
      }
      if (isIdempotencyUniqueViolation(error) && idempotencyKey) {
        const replay = await tryReplayIdempotencyKey(
          this.prisma,
          idempotencyKey,
          scope,
          requestHash,
        );
        if (replay) return replay as PayrollResponse & { replayed: true };
      }
      throw error;
    }
  }

  async approvePayroll(
    payrollId: string,
    actorId: string,
    idempotencyKey?: string,
  ): Promise<PayrollResponse | (PayrollResponse & { replayed: true })> {
    const requestHash = computeRequestHash({ payrollId, actorId });
    const scope = 'hr-payroll-approve';

    try {
      return await this.prisma.$transaction(async (tx) => {
        const replay = await tryReplayIdempotencyKey(
          tx,
          idempotencyKey,
          scope,
          requestHash,
        );
        if (replay) {
          return replay as PayrollResponse & { replayed: true };
        }
        const payroll = await tx.payroll.findUnique({
          where: { id: payrollId },
        });
        if (!payroll) throw new NotFoundException('كشف الراتب غير موجود');
        if (payroll.status !== PayrollStatus.DRAFT) {
          throw new ConflictException('كشف الراتب معتمد ولا يمكن تعديله');
        }

        await createIdempotencyKey(tx, idempotencyKey, scope, requestHash);
        const updated = await tx.payroll.updateMany({
          where: { id: payrollId, status: PayrollStatus.DRAFT },
          data: {
            status: PayrollStatus.APPROVED,
            approvedById: actorId,
            approvedAt: new Date(),
          },
        });
        if (updated.count !== 1) {
          throw new ConflictException('تعذر اعتماد كشف الراتب؛ حالته تغيرت');
        }
        const approved = await tx.payroll.findUnique({
          where: { id: payrollId },
        });
        if (!approved) throw new NotFoundException('كشف الراتب غير موجود');

        // COMM-F03: ترحيل قيد اعتماد الأجور (Dr Salaries Expense / Cr Salaries Payable)
        // على المبلغ الإجمالي عند الانتقال من DRAFT إلى APPROVED. القيد ذري داخل نفس
        // tx فأي فشل في postJournalEntryInTx يرجع تحديث الحالة كله. يُتخطى القيد
        // عند gross === 0 (لا قيمة للاستحقاق). postingKey ثابت لمنع الترحيل المزدوج
        // عند إعادة محاولة الطلب بنفس المفتاح (idempotency على مستوى القيد نفسه).
        const gross = approved.grossAmount.toNumber();
        if (Number.isFinite(gross) && gross > 0) {
          const worker = await tx.worker.findUnique({
            where: { id: approved.workerId },
            select: { id: true, name: true },
          });
          const workerLabel = worker?.name ?? approved.workerId;
          const periodLabel = `${approved.periodStart.toISOString().slice(0, 10)}..${approved.periodEnd.toISOString().slice(0, 10)}`;
          await this.financial.postJournalEntryInTx(
            tx,
            {
              description: `اعتماد كشف راتب ${periodLabel} - موظف ${workerLabel}`,
              reference: `PAYROLL:${approved.id}`,
              postingKey: `payroll-approval:${approved.id}`,
              isAuto: true,
              lines: [
                {
                  debitAccountId: CHART_OF_ACCOUNTS.SALARIES_EXPENSE,
                  creditAccountId: CHART_OF_ACCOUNTS.SALARIES_PAYABLE,
                  amount: gross,
                  description: `استحقاق أجر عامل ${workerLabel}`,
                },
              ],
              metadata: {
                source: 'payroll.approval',
                payrollId: approved.id,
                workerId: approved.workerId,
                period: {
                  start: approved.periodStart.toISOString(),
                  end: approved.periodEnd.toISOString(),
                },
              },
            },
            actorId,
          );
        }

        const response = this.toPayrollResponse(approved);
        await tx.activityLog.create({
          data: {
            userId: actorId,
            action: 'PAYROLL_APPROVED',
            module: 'HR',
            details: { payrollId: response.id, approvedById: actorId },
          },
        });
        await storeIdempotencyResponse(tx, idempotencyKey, response);
        return response;
      });
    } catch (error) {
      if (isIdempotencyUniqueViolation(error) && idempotencyKey) {
        const replay = await tryReplayIdempotencyKey(
          this.prisma,
          idempotencyKey,
          scope,
          requestHash,
        );
        if (replay) return replay as PayrollResponse & { replayed: true };
      }
      throw error;
    }
  }

  async payPayroll(
    payrollId: string,
    input: PayrollPaymentInput,
    actorId: string,
    idempotencyKey?: string,
  ): Promise<PayrollResponse | (PayrollResponse & { replayed: true })> {
    const paymentDate = input.paymentDate ?? new Date();
    if (!Number.isFinite(paymentDate.getTime())) {
      throw new BadRequestException('تاريخ دفع الراتب غير صالح');
    }

    const requestHash = computeRequestHash({
      payrollId,
      treasuryId: input.treasuryId,
      paymentDate: paymentDate.toISOString(),
      notes: input.notes ?? null,
      actorId,
    });
    const scope = 'hr-payroll-pay';

    try {
      return await this.prisma.$transaction(async (tx) => {
        const replay = await tryReplayIdempotencyKey(
          tx,
          idempotencyKey,
          scope,
          requestHash,
        );
        if (replay) {
          return replay as PayrollResponse & { replayed: true };
        }

        const payroll = await tx.payroll.findUnique({
          where: { id: payrollId },
        });
        if (!payroll) throw new NotFoundException('كشف الراتب غير موجود');
        if (payroll.status !== PayrollStatus.APPROVED) {
          throw new ConflictException('لا يمكن دفع كشف راتب غير معتمد');
        }
        if (payroll.isPaid) {
          throw new ConflictException('كشف الراتب مدفوع بالفعل');
        }

        const amount = payroll.netAmount.toNumber();
        const advanceDeduct = payroll.advanceDeduct.toNumber();
        if (!Number.isFinite(amount) || amount <= 0) {
          throw new BadRequestException(
            'لا يمكن دفع كشف راتب بصافي مبلغ غير موجب',
          );
        }
        if (!Number.isFinite(advanceDeduct) || advanceDeduct < 0) {
          throw new BadRequestException('خصم السلفة في كشف الراتب غير صالح');
        }

        const treasury = await tx.treasury.findUnique({
          where: { id: input.treasuryId },
          select: { id: true, isActive: true },
        });
        if (!treasury || !treasury.isActive) {
          throw new NotFoundException('الخزينة غير موجودة أو غير نشطة');
        }

        await createIdempotencyKey(tx, idempotencyKey, scope, requestHash);
        // COMM-F04 (service part): move status to PAID (not just isPaid=true).
        // Previously the payPayroll method only flipped `isPaid` and left status
        // at APPROVED — conflating "approved" and "paid" in the same enum value.
        // With the new PAID enum value (added by migration
        // 20260831130000_wave2_v2_add_payroll_paid_status), the state machine
        // is DRAFT → APPROVED → PAID. The WHERE clause still filters by
        // APPROVED + isPaid=false so only approved-and-unpaid payrolls can be
        // paid (concurrent-safe via updateMany's optimistic lock).
        const updated = await tx.payroll.updateMany({
          where: {
            id: payrollId,
            status: PayrollStatus.APPROVED,
            isPaid: false,
          },
          data: {
            status: PayrollStatus.PAID,
            isPaid: true,
            paidAt: paymentDate,
          },
        });
        if (updated.count !== 1) {
          throw new ConflictException('تعذر دفع الراتب؛ حالته تغيرت بالتزامن');
        }

        await this.financial.postJournalEntryInTx(
          tx,
          {
            description: `دفع راتب ${payrollId}`,
            reference: `PAYROLL:${payrollId}`,
            postingKey: `hr-payroll-pay:${payrollId}`,
            isAuto: true,
            lines: [
              {
                // Payment settles the liability recognized at approval; it must not
                // recognize a second expense.
                debitAccountId: CHART_OF_ACCOUNTS.SALARIES_PAYABLE,
                creditAccountId: CHART_OF_ACCOUNTS.CASH,
                amount,
                description:
                  input.notes ?? `دفع صافي راتب العامل ${payroll.workerId}`,
              },
              ...(advanceDeduct > 0
                ? [
                    {
                      // Clear the worker advance that was deducted from gross
                      // salary without creating another expense.
                      debitAccountId: CHART_OF_ACCOUNTS.SALARIES_PAYABLE,
                      creditAccountId: CHART_OF_ACCOUNTS.WORKER_ADVANCES,
                      amount: advanceDeduct,
                      description: `تسوية سلفة العامل ${payroll.workerId}`,
                    },
                  ]
                : []),
            ],
            treasuryUpdates: [{ treasuryId: input.treasuryId, delta: -amount }],
            metadata: {
              source: 'HR_PAYROLL_PAYMENT',
              payrollId,
              workerId: payroll.workerId,
              treasuryId: input.treasuryId,
              paymentDate: paymentDate.toISOString(),
            },
            date: paymentDate,
          },
          actorId,
        );

        const paid = await tx.payroll.findUnique({ where: { id: payrollId } });
        if (!paid) throw new NotFoundException('كشف الراتب غير موجود');
        const response = this.toPayrollResponse(paid);
        await tx.activityLog.create({
          data: {
            userId: actorId,
            action: 'PAYROLL_PAID',
            module: 'HR',
            details: {
              payrollId,
              workerId: payroll.workerId,
              amount,
              treasuryId: input.treasuryId,
            },
          },
        });
        await storeIdempotencyResponse(tx, idempotencyKey, response);
        return response;
      });
    } catch (error) {
      if (isIdempotencyUniqueViolation(error) && idempotencyKey) {
        const replay = await tryReplayIdempotencyKey(
          this.prisma,
          idempotencyKey,
          scope,
          requestHash,
        );
        if (replay) return replay as PayrollResponse & { replayed: true };
      }
      throw error;
    }
  }

  private validatePayrollPeriod(periodStart: Date, periodEnd: Date): void {
    if (
      Number.isNaN(periodStart.getTime()) ||
      Number.isNaN(periodEnd.getTime())
    ) {
      throw new BadRequestException('فترة الراتب تحتوي على تاريخ غير صالح');
    }
    if (periodStart > periodEnd) {
      throw new BadRequestException(
        'بداية فترة الراتب لا يمكن أن تتجاوز نهايتها',
      );
    }
  }

  private toPayrollResponse(row: {
    id: string;
    workerId: string;
    periodStart: Date;
    periodEnd: Date;
    grossAmount: Prisma.Decimal;
    advanceDeduct: Prisma.Decimal;
    absenceDeduct: Prisma.Decimal;
    netAmount: Prisma.Decimal;
    status: PayrollStatus;
    isPaid: boolean;
    paidAt: Date | null;
    notes: string | null;
    createdById: string | null;
    approvedById: string | null;
    approvedAt: Date | null;
  }): PayrollResponse {
    return {
      id: row.id,
      workerId: row.workerId,
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      grossAmount: row.grossAmount.toNumber(),
      advanceDeduct: row.advanceDeduct.toNumber(),
      absenceDeduct: row.absenceDeduct.toNumber(),
      netAmount: row.netAmount.toNumber(),
      status: row.status,
      isPaid: row.isPaid,
      paidAt: row.paidAt,
      notes: row.notes,
      createdById: row.createdById,
      approvedById: row.approvedById,
      approvedAt: row.approvedAt,
    };
  }
}
