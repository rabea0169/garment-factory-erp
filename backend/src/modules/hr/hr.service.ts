import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  PayrollStatus,
  Prisma,
  UserRole,
  WorkerSpecialty,
} from '@prisma/client';
import {
  computeRequestHash,
  createIdempotencyKey,
  isIdempotencyUniqueViolation,
  storeIdempotencyResponse,
  tryReplayIdempotencyKey,
} from '../../core/common/idempotency.util';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { PaginatedResult } from '../../common/dto/paginated-result.dto';
// HR-6 (GF-IMP-W3): عقد الاستجابة الكنوني للقوائم — { items, total,
// page, limit } (نص التكليف حرفيًا — وكيل الجوال يبني عليه) عبر
// ListResponseDto المشترك مع حقلي توافق انتقاليين (data/meta).
import { ListResponseDto } from '../../common/dto/list-response.dto';
import { PrismaService } from '../../prisma/prisma.service';
import {
  FinancialPostingService,
  JournalLineInput,
} from '../../core/financial/financial-posting.service';
import { CHART_OF_ACCOUNTS } from '../../core/financial/chart-of-accounts';
import {
  DocumentCodePrefix,
  generateDocumentCode,
} from '../../core/common/codes.util';
import { PayrollQueryDto } from './dto/payroll-query.dto';
import { WorkerPeriodQueryDto } from './dto/worker-period-query.dto';
type CreateWorkerInput = {
  name: string;
  phone?: string;
  nationalId?: string;
  specialty: WorkerSpecialty;
  pieceRate?: number;
  hireDate?: Date;
};

export interface PayrollInput {
  workerId: string;
  periodStart: Date;
  periodEnd: Date;
  notes?: string;
}

export interface PayrollPaymentInput {
  // HR-4 (P2 — GF-IMP-W3): الخزينة اختيارية لمسار التسوية بلا نقد —
  // عندما netAmount = 0 (السلف غطت الإجمالي) لا حركة خزينة أصلًا فلا
  // معنى لاشتراط خزينة نشطة. الصافي الموجب يظل يتطلب خزينة (تحقق 400).
  treasuryId?: string;
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

/**
 * HR-8 (P2 — GF-IMP-W3): الأدوار التي تُعامل كأدوار HR لحقول الهوية
 * (nationalId وphone) في قراءات العامل — نمط INV-2 المطبق في المخزون:
 * select مختلف حسب دور المستدعي، والدور غير المعروف (استدعاء برمجي
 * بلا دور) يُعامل غير HR — fail-closed على بيانات الهوية.
 */
const HR_IDENTITY_ROLES: ReadonlySet<UserRole> = new Set([
  UserRole.HR_MANAGER,
  UserRole.GENERAL_MANAGER,
  UserRole.SUPER_ADMIN,
]);

function isHrIdentityRole(viewerRole?: UserRole): boolean {
  return viewerRole !== undefined && HR_IDENTITY_ROLES.has(viewerRole);
}

@Injectable()
export class HrService {
  private readonly logger = new Logger(HrService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly financial: FinancialPostingService,
  ) {}

  async getAllWorkers(
    pagination: PaginationDto = new PaginationDto(),
    viewerRole?: UserRole,
  ) {
    const page = pagination.page ?? 1;
    const pageSize = pagination.limit ?? 20;
    const skip = (page - 1) * pageSize;
    // HR-8 (ب): قائمة العمال لأدوار HR تعاد بحقول الهوية (nationalId/
    // phone)؛ لغيرها (وللاستدعاء بلا دور) استعلام بselect صريح بلا الحقلين
    // الحساسين — لا يُنقلان من القاعدة أصلًا (نمط INV-2 fail-closed).
    const identityVisible = isHrIdentityRole(viewerRole);
    const options = {
      ...(identityVisible
        ? {}
        : {
            select: {
              id: true,
              code: true,
              name: true,
              specialty: true,
              pieceRate: true,
              isActive: true,
              hireDate: true,
              createdAt: true,
            },
          }),
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

  async createWorker(input: CreateWorkerInput, idempotencyKey?: string) {
    // RES-F02: replay-safe retry via Idempotency-Key header.
    const requestHash = computeRequestHash({
      name: input.name,
      phone: input.phone ?? null,
      nationalId: input.nationalId ?? null,
      specialty: input.specialty,
      pieceRate: input.pieceRate ?? null,
      hireDate: input.hireDate?.toISOString() ?? null,
    });
    const scope = 'hr-worker-create';
    try {
      return await this.prisma.$transaction(async (tx) => {
        const replay = await tryReplayIdempotencyKey(
          tx,
          idempotencyKey,
          scope,
          requestHash,
        );
        if (replay)
          return replay as Awaited<ReturnType<typeof tx.worker.create>> & {
            replayed: true;
          };

        const created = await tx.worker.create({
          data: {
            code: generateDocumentCode(DocumentCodePrefix.WORKER),
            name: input.name.trim(),
            phone: input.phone?.trim() || undefined,
            nationalId: input.nationalId?.trim() || undefined,
            specialty: input.specialty,
            pieceRate: input.pieceRate ?? 0,
            hireDate: input.hireDate,
          },
        });
        await storeIdempotencyResponse(tx, idempotencyKey, created);
        return created;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        !isIdempotencyUniqueViolation(error)
      ) {
        throw new ConflictException('بيانات العامل مستخدمة بالفعل');
      }
      throw error;
    }
  }

  async getWorkerDetails(id: string, viewerRole?: UserRole) {
    // HR-8 (ب): تفاصيل العامل — حقول الهوية (nationalId/phone) لأدوار HR
    // فقط (select صريح لغيرها — نمط INV-2). العلاقات (آخر إنتاج/سلف)
    // متاحة للجميع كما كانت.
    const identityVisible = isHrIdentityRole(viewerRole);
    const args: Prisma.WorkerFindUniqueArgs = identityVisible
      ? {
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
        }
      : {
          where: { id },
          select: {
            id: true,
            code: true,
            name: true,
            specialty: true,
            pieceRate: true,
            isActive: true,
            hireDate: true,
            createdAt: true,
            dailyProduction: {
              take: 10,
              orderBy: { date: 'desc' },
            },
            advances: {
              take: 5,
              orderBy: { date: 'desc' },
            },
          },
        };
    const worker = await this.prisma.worker.findUnique(args);
    if (!worker) throw new NotFoundException('العامل غير موجود');
    return worker;
  }

  async recordAttendance(
    data: {
      workerId: string;
      date: Date;
      isPresent: boolean;
      notes?: string;
    },
    idempotencyKey?: string,
  ) {
    // RES-F02: replay-safe retry via Idempotency-Key header.
    const requestHash = computeRequestHash({
      workerId: data.workerId,
      date: data.date.toISOString(),
      isPresent: data.isPresent,
      notes: data.notes ?? null,
    });
    const scope = 'hr-attendance';
    try {
      return await this.prisma.$transaction(async (tx) => {
        const replay = await tryReplayIdempotencyKey(
          tx,
          idempotencyKey,
          scope,
          requestHash,
        );
        if (replay)
          return replay as Awaited<ReturnType<typeof tx.attendance.create>> & {
            replayed: true;
          };

        const worker = await tx.worker.findUnique({
          where: { id: data.workerId },
          select: { id: true },
        });
        if (!worker) throw new NotFoundException('العامل غير موجود');

        const created = await tx.attendance.create({
          data: {
            workerId: data.workerId,
            date: new Date(data.date),
            isPresent: data.isPresent,
            notes: data.notes,
          },
        });
        await storeIdempotencyResponse(tx, idempotencyKey, created);
        return created;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        !isIdempotencyUniqueViolation(error)
      ) {
        throw new ConflictException(
          'يوجد سجل حضور للعامل في هذا التاريخ بالفعل',
        );
      }
      throw error;
    }
  }

  async recordDailyProduction(
    data: {
      workerId: string;
      workOrderId?: string;
      date: Date;
      piecesCount: number;
    },
    idempotencyKey?: string,
  ) {
    // RES-F02: replay-safe retry via Idempotency-Key header.
    const requestHash = computeRequestHash({
      workerId: data.workerId,
      workOrderId: data.workOrderId ?? null,
      date: data.date.toISOString(),
      piecesCount: data.piecesCount,
    });
    const scope = 'hr-production';
    return this.prisma.$transaction(async (tx) => {
      const replay = await tryReplayIdempotencyKey(
        tx,
        idempotencyKey,
        scope,
        requestHash,
      );
      if (replay)
        return replay as Awaited<
          ReturnType<typeof tx.dailyProduction.create>
        > & { replayed: true };

      const worker = await tx.worker.findUnique({
        where: { id: data.workerId },
      });
      if (!worker) throw new NotFoundException('العامل غير موجود');

      // HR-8 (أ) (GF-IMP-W3): تحقق ناعم من الحضور — إذا لم يوجد أي سجل
      // حضور أو إنتاج سابق للعامل في نفس اليوم نُحذّر عبر Logger.warning
      // ولا نرفض (سياسة الربط الإلزامي معلقة — ADR-15). البحث داخل نفس
      // المعاملة على نفس اللقطة، والحذير تشغيلي بحت (لا أثر على البيانات).
      const [sameDayAttendance, sameDayProduction] = await Promise.all([
        tx.attendance.findFirst({
          where: { workerId: data.workerId, date: data.date },
          select: { id: true },
        }),
        tx.dailyProduction.findFirst({
          where: { workerId: data.workerId, date: data.date },
          select: { id: true },
        }),
      ]);
      if (!sameDayAttendance && !sameDayProduction) {
        this.logger.warn(
          `تسجيل إنتاج للعامل ${data.workerId} بتاريخ ${data.date.toISOString().slice(0, 10)} بلا سجل حضور أو إنتاج سابق في نفس اليوم — تحقق ناعم (ADR-15: سياسة الربط معلقة)`,
        );
      }

      // HR-7 (GF-IMP-W3): الضرب على Prisma.Decimal — العامل بالقطعة عائم
      // ثنائي في JS (0.1 × 3 = 0.30000000000000004) فيتسرب الفرق الفلسي
      // إلى totalAmount المخزّن. Decimal يضرب بدقة كاملة، والتقريب إلى
      // منزلتين يجري عند التخزين فقط (مطابقة Decimal(10,2) في العمود).
      const totalAmount = new Prisma.Decimal(data.piecesCount)
        .mul(worker.pieceRate)
        .toDecimalPlaces(2);
      const created = await tx.dailyProduction.create({
        data: {
          workerId: data.workerId,
          workOrderId: data.workOrderId,
          date: new Date(data.date),
          piecesCount: data.piecesCount,
          pieceRate: worker.pieceRate,
          totalAmount,
        },
      });
      await storeIdempotencyResponse(tx, idempotencyKey, created);
      return created;
    });
  }

  async recordAdvance(
    data: {
      workerId: string;
      amount: number;
      notes?: string;
      treasuryId?: string;
    },
    actorId: string,
    idempotencyKey?: string,
  ) {
    // RES-F02: replay-safe retry via Idempotency-Key header — advances
    // have no natural unique constraint so we MUST rely on explicit replay.
    const requestHash = computeRequestHash({
      workerId: data.workerId,
      amount: data.amount,
      notes: data.notes ?? null,
      treasuryId: data.treasuryId ?? null,
      actorId: actorId ?? null,
    });
    const scope = 'hr-advance';
    return this.prisma.$transaction(async (tx) => {
      const replay = await tryReplayIdempotencyKey(
        tx,
        idempotencyKey,
        scope,
        requestHash,
      );
      if (replay)
        return replay as Awaited<ReturnType<typeof tx.workerAdvance.create>> & {
          replayed: true;
        };

      // GF-IMP-W1 / W1-A: أنشئ صف مفتاح idempotency داخل المعاملة قبل التأثير —
      // بدونه يفشل storeIdempotencyResponse لاحقًا بـ P2025 على أي قاعدة حقيقية
      // (كان الكامن ينجو في الـ mocks فقط). نمط موازٍ لمساري الاعتماد والدفع.
      await createIdempotencyKey(tx, idempotencyKey, scope, requestHash);

      // COMM-F05 / ACC-F02: validate worker exists + treasury (if provided) is
      // active BEFORE we touch money. We do this inside the tx so a partial
      // failure (e.g., treasury frozen mid-flight) rolls back the advance too.
      const worker = await tx.worker.findUnique({
        where: { id: data.workerId },
        select: { id: true, name: true, code: true },
      });
      if (!worker) throw new NotFoundException('العامل غير موجود');

      if (data.treasuryId) {
        const treasury = await tx.treasury.findUnique({
          where: { id: data.treasuryId },
          select: { id: true, isActive: true },
        });
        if (!treasury || !treasury.isActive) {
          throw new NotFoundException('الخزينة غير موجودة أو غير نشطة');
        }
      }

      const created = await tx.workerAdvance.create({
        data: {
          workerId: data.workerId,
          amount: data.amount,
          notes: data.notes,
        },
      });

      // COMM-F05 / ACC-F02: GL posting — Dr Worker Advances (asset) / Cr Cash
      // (if treasury provided). Posting is INSIDE the tx so the GL entry and
      // the treasury balance update commit atomically with the advance record.
      // When no treasury is provided, the advance is recorded as an outstanding
      // receivable without a cash-side entry (the worker may collect later).
      // postingKey is stable per advance id so retry with the same key is safe.
      if (data.treasuryId) {
        const workerLabel = worker.name ?? worker.code ?? worker.id;
        await this.financial.postJournalEntryInTx(
          tx,
          {
            description: `سلفة عامل ${workerLabel} (${created.id.slice(0, 8)})`,
            reference: `WORKER_ADVANCE:${created.id}`,
            postingKey: `hr-worker-advance:${created.id}`,
            isAuto: true,
            lines: [
              {
                debitAccountId: CHART_OF_ACCOUNTS.WORKER_ADVANCES,
                creditAccountId: CHART_OF_ACCOUNTS.CASH,
                amount: data.amount,
                description: `سلفة عامل ${workerLabel}`,
              },
            ],
            treasuryUpdates: [
              { treasuryId: data.treasuryId, delta: -data.amount },
            ],
            metadata: {
              source: 'HR_WORKER_ADVANCE',
              workerAdvanceId: created.id,
              workerId: data.workerId,
              treasuryId: data.treasuryId,
            },
          },
          actorId,
        );
      }

      await tx.activityLog.create({
        data: {
          userId: actorId,
          action: 'WORKER_ADVANCE_RECORDED',
          module: 'HR',
          details: {
            workerAdvanceId: created.id,
            workerId: data.workerId,
            amount: data.amount,
            treasuryId: data.treasuryId ?? null,
            postedToGL: data.treasuryId ? true : false,
          },
        },
      });
      await storeIdempotencyResponse(tx, idempotencyKey, created);
      return created;
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

        // HR-3 (P1 — GF-IMP-W2): رفض تداخل فترات الرواتب. الفحص القائم كان
        // مطابقة تامة على (periodStart, periodEnd) فكانت الكشوف المتداخلة
        // جزئيًا تمر — يُنشأ كشف ثانٍ يخصم نفس السلف والإنتاج مرة أخرى.
        // الآن نرفض أي تقاطع نطاقات لنفس العامل: كشف قائم يبدأ قبل نهاية
        // الفترة المطلوبة وينتهي بعد بدايتها.
        //
        // PayrollStatus الفعلي في schema: DRAFT / APPROVED / PAID — لا
        // توجد حالة CANCELLED، ولا توجد أي حالة "منتهية يمكن تجاهلها":
        // كل صف payrolls لجميع حالاته يمثل كشفًا حيًا يخصم سلفًا وإنتاجًا،
        // فالفحص يشمل كل الحالات بلا استثناء.
        //
        // ملاحظة DB: قيد استثناء نطاقي على مستوى القاعدة (EXCLUDE USING
        // btree_gist على workerId مع periodStart/periodEnd) كان يمكن أن
        // يكون خط دفاع أخير ضد السباقات، لكنه مؤجل بقرار لتجنب مخاطر
        // الامتدادات (btree_gist) على Railway — الفحص داخل $transaction
        // + القيد الفريد القائم على (workerId, periodStart, periodEnd)
        // يغطيان الحالات العملية.
        const overlapping = await tx.payroll.findFirst({
          where: {
            workerId: input.workerId,
            // periodStart <= input.periodEnd AND periodEnd >= input.periodStart
            periodStart: { lte: input.periodEnd },
            periodEnd: { gte: input.periodStart },
          },
          select: { id: true },
        });
        if (overlapping) {
          throw new ConflictException(
            'تتداخل فترة كشف الراتب مع كشف قائم لنفس العامل — لا يُسمح بتداخل فترات الرواتب',
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
          // HR-2 (P1 — GF-IMP-W2): نجلب صفوف السلف (لا مجموعها الأعمى) —
          // الخصم يُحسب من المتبقي غير المسى فقط (amount - settledAmount)،
          // والترتيب الزمني يجهّز للتوزيع FIFO عند الدفع. سلفة بلغت
          // settledAmount == amount مسوية بالكامل ولا تدخل الحساب أبدًا.
          tx.workerAdvance.findMany({
            where: {
              workerId: input.workerId,
              date: { gte: input.periodStart, lt: periodEndExclusive },
            },
            select: { id: true, amount: true, settledAmount: true },
            orderBy: [{ date: 'asc' }, { id: 'asc' }],
          }),
        ]);
        const grossAmount =
          production._sum.totalAmount ?? new Prisma.Decimal(0);
        // HR-2: الخصم = مجموع المتبقي غير المسى (amount - settledAmount)
        // لسلف الفترة. السلوك القديم كان يجمع السلف كاملة كل مرة — بلا
        // ذاكرة لما خُصم فعليًا — فتُخصم السلفة الواحدة مرات متعددة.
        const unsettledAdvanceTotal = advances.reduce(
          (sum, advance) =>
            sum.plus(advance.amount.minus(advance.settledAmount)),
          new Prisma.Decimal(0),
        );
        const advanceDeduct = unsettledAdvanceTotal.gt(grossAmount)
          ? grossAmount
          : unsettledAdvanceTotal;
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
        // HR-3: القيد الفريد القائم (workerId, periodStart, periodEnd) خط
        // الدفاع الأخير ضد السباقات — نفس رسالة رفض التداخل للاتساق.
        throw new ConflictException(
          'تتداخل فترة كشف الراتب مع كشف قائم لنفس العامل — لا يُسمح بتداخل فترات الرواتب',
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

        // COMM-F02 (regression fix): Separation of Duties (SoD) — the user who
        // created a payroll must NOT approve it themselves. This blocks the
        // insider threat where a single HR_MANAGER creates + approves a fake
        // payroll without oversight. Two distinct actors are required. The
        // check happens INSIDE the tx so the replay path returns first (an
        // already-replayed approval does not need to re-check SoD — the
        // original approval that was already committed was vetted).
        if (payroll.createdById && payroll.createdById === actorId) {
          throw new ConflictException(
            'لا يمكن لمنشئ كشف الراتب اعتماده بنفسه (فصل الواجبات)',
          );
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
      treasuryId: input.treasuryId ?? null,
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

        // HR-5 (P2 — GF-IMP-W3): فصل الواجبات على الدفع — نفس نمط SoD
        // القائم في الاعتماد (COMM-F02): من اعتمد كشف الراتب لا يدفعه
        // بنفسه. مع إضافة ACCOUNTANT وCASHIER لأدوار الدفع (في المتحكم)
        // صار هذا الفحص ضروريًا لئلا يجمع محاسب واحد الاعتماد والصرف.
        // الفحص داخل المعاملة بعد مسار الـ replay (إعادة تشغيل استجابة
        // سبق فحصها لا يُعاد فحصها) — نفس ترتيب approvePayroll.
        if (payroll.approvedById && payroll.approvedById === actorId) {
          throw new ConflictException(
            'لا يمكن لمعتمد كشف الراتب دفعه بنفسه (فصل الواجبات)',
          );
        }

        // HR-1 (P0 — GF-IMP-W1): صافٍ = صفر حالة مشروعة (كل الإجمالي سلف
        // استُرد بالخصومات) — يُسمح بالدفع ويُرحَّل قيد الخصومات فقط. المرفوض
        // هو الصافي السالب فقط.
        //
        // HR-4 (P2 — GF-IMP-W3): مسار التسوية بلا نقد — الخزينة مطلوبة
        // (ونشطة) فقط عند صافٍ موجب فعليًا يخرج نقدًا. عند صافٍ = صفر
        // (السلف غطت الإجمالي) لا حركة خزينة أصلًا، فلا نشترط خزينة ولا
        // نبحث عنها — الدفع بلا treasuryId ينجح كتسوية خصومات صرفة.
        const net = payroll.netAmount.toNumber();
        // إجمالي الخصومات (سلف + غياب) = الجزء المدين من SALARIES_PAYABLE
        // الذي لا يخرج نقدًا بل يُسترد من أصل سلف العامل.
        const deductions = payroll.advanceDeduct
          .plus(payroll.absenceDeduct)
          .toNumber();
        if (
          !Number.isFinite(net) ||
          !Number.isFinite(deductions) ||
          net < 0 ||
          deductions < 0
        ) {
          throw new BadRequestException('لا يمكن دفع كشف راتب بصافي مبلغ سالب');
        }
        if (net > 0 && !input.treasuryId) {
          throw new BadRequestException(
            'الخزينة مطلوبة لدفع كشف راتب بصافٍ أكبر من صفر',
          );
        }

        if (net > 0) {
          const treasury = await tx.treasury.findUnique({
            where: { id: input.treasuryId },
            select: { id: true, isActive: true },
          });
          if (!treasury || !treasury.isActive) {
            throw new NotFoundException('الخزينة غير موجودة أو غير نشطة');
          }
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

        // HR-2 (P1 — GF-IMP-W2): وزّع خصم السلف فعليًا على سلف الفترة FIFO
        // داخل نفس معاملة الدفع — حدّث settledAmount لكل سلفة تُغطى جزئيًا
        // أو كليًا (settledAmount += المخصص، بحد amount). هذا يمنح الخصم
        // ذاكرة دائمة: الكشف التالي لنفس العامل يرى المتبقي غير المسى فقط
        // فلا يُعاد خصم ما سُدد. القيد GL (Cr WORKER_ADVANCES بالخصومات)
        // يبقى كما أصلحته الموجة الأولى — التوزيع هنا يطابق سجلات السلف
        // مع القيد نفسه داخل المعاملة الواحدة.
        if (payroll.advanceDeduct.gt(0)) {
          await this.settleWorkerAdvancesFifoInTx(tx, {
            workerId: payroll.workerId,
            periodStart: payroll.periodStart,
            periodEnd: payroll.periodEnd,
            allocation: payroll.advanceDeduct,
          });
        }

        // HR-1 (P0 — GF-IMP-W1): قيد الدفع يصفّي الالتزام المتراكم من قيد
        // الاعتماد (Dr SALARIES_EXPENSE / Cr SALARIES_PAYABLE بالإجمالي) بدل
        // تسجيل المصروف مرة ثانية. القيد الصحيح:
        //   Dr SALARIES_PAYABLE بالإجمالي (صافٍ + خصومات)
        //   Cr CASH بالصافِ المدفوع فعليًا من الخزينة
        //   Cr WORKER_ADVANCES بإجمالي الخصومات (استرداد السلف)
        // النتيجة: SALARIES_PAYABLE يعود صفرًا، المصروف يبقى مقيّدًا مرة واحدة
        // فقط (من الاعتماد)، وWORKER_ADVANCES يُخفَّض بقيمة الخصومات.
        // حالة صافٍ = صفر: قيد خصومات فقط (Dr SALARIES_PAYABLE /
        // Cr WORKER_ADVANCES) بلا بند نقدية ولا تحديث خزينة.
        // حالة صافٍ = خصومات = 0 (إجمالي صفري): لا قيد مالي أصلًا.
        const paymentLines: JournalLineInput[] = [];
        if (net > 0) {
          paymentLines.push({
            debitAccountId: CHART_OF_ACCOUNTS.SALARIES_PAYABLE,
            creditAccountId: CHART_OF_ACCOUNTS.CASH,
            amount: net,
            description:
              input.notes ?? `دفع صافي راتب العامل ${payroll.workerId}`,
          });
        }
        if (deductions > 0) {
          paymentLines.push({
            debitAccountId: CHART_OF_ACCOUNTS.SALARIES_PAYABLE,
            creditAccountId: CHART_OF_ACCOUNTS.WORKER_ADVANCES,
            amount: deductions,
            description: `استرداد سلف العامل ${payroll.workerId} من كشف الراتب`,
          });
        }
        if (paymentLines.length > 0) {
          await this.financial.postJournalEntryInTx(
            tx,
            {
              description: `دفع راتب ${payrollId}`,
              reference: `PAYROLL:${payrollId}`,
              postingKey: `hr-payroll-pay:${payrollId}`,
              isAuto: true,
              lines: paymentLines,
              treasuryUpdates:
                net > 0 && input.treasuryId
                  ? [{ treasuryId: input.treasuryId, delta: -net }]
                  : undefined,
              metadata: {
                source: 'HR_PAYROLL_PAYMENT',
                payrollId,
                workerId: payroll.workerId,
                treasuryId: input.treasuryId ?? null,
                paymentDate: paymentDate.toISOString(),
                net,
                deductions,
              },
              date: paymentDate,
            },
            actorId,
          );
        }

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
              amount: net,
              treasuryId: input.treasuryId ?? null,
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

  // ===================== HR-6 (P2 — GF-IMP-W3): واجهة قراءة الرواتب =====================

  /**
   * HR-6 (أ): قائمة كشوف الرواتب — مرقمة بفلاتر (status وworkerId ونطاق
   * فترة بالتقاطع: from → periodEnd ≥ from و to → periodStart ≤ to)،
   * بإسقاط آمن صريح (select بلا أي حقول خارج القائمة — لا هاش ولا
   * idempotencyKeyId) مع اسم العامل، والمبالغ أرقامًا JSON-friendly.
   * عقد الاستجابة حرفيًا: { items, total, page, limit }.
   */
  async getPayrolls(query: PayrollQueryDto = new PayrollQueryDto()) {
    const page = query.page ?? 1;
    const pageSize = query.limit ?? 20;
    const skip = (page - 1) * pageSize;
    // فترة التقاطع يجب أن تكون منطقية (from ≤ to) قبل أي استعلام.
    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;
    if (from && to && from > to) {
      throw new BadRequestException(
        'تاريخ بداية فترة البحث لا يمكن أن يكون بعد تاريخ النهاية',
      );
    }
    const where: Prisma.PayrollWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.workerId) where.workerId = query.workerId;
    if (from) where.periodEnd = { gte: from };
    if (to) where.periodStart = { lte: to };

    const [rows, total] = await Promise.all([
      this.prisma.payroll.findMany({
        where,
        select: {
          id: true,
          workerId: true,
          periodStart: true,
          periodEnd: true,
          grossAmount: true,
          advanceDeduct: true,
          absenceDeduct: true,
          netAmount: true,
          status: true,
          isPaid: true,
          paidAt: true,
          notes: true,
          createdById: true,
          approvedById: true,
          approvedAt: true,
          createdAt: true,
          worker: { select: { id: true, name: true, code: true } },
        },
        orderBy: { periodStart: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.payroll.count({ where }),
    ]);

    const data = rows.map((row) => ({
      ...this.toPayrollResponse(row),
      createdAt: row.createdAt,
      worker: row.worker,
    }));
    // HR-6: العقد الحرفي { items, total, page, limit } (حقلا data/meta
    // توافق انتقالي لكل مستهلك قديم — القوائم الجديدة تعتمد items فقط).
    return new ListResponseDto(data, total, page, pageSize);
  }

  /**
   * HR-6 (ب): إبطال مسودة كشف راتب — مقصور على DRAFT (400 لغيرها) بـ CAS
   * + ActivityLog + idempotency كامل النمط (scope: hr-payroll-cancel).
   *
   * ملاحظة تمثيلية موثقة: PayrollStatus (schema مجمّد — لا تغيير) لا يملك
   * قيمة CANCELLED، والمسودة بلا أي أثر مالي أو مخزوني (لا قيد قبل
   * الاعتماد، ولا FIFO، ولا خصم سلف فعلي). الإبطال إذن = إزالة صف
   * المسودة بdeleteMany مشروط بحالة DRAFT (CAS) داخل المعاملة، مع لقطة
   * كاملة في ActivityLog وفي الاستجابة المخزنة على مفتاح idempotency —
   * الأثر التدقيقي محفوظ والفترة تتحرر لإنشاء كشف بديل.
   */
  async cancelPayroll(
    payrollId: string,
    actorId: string,
    idempotencyKey?: string,
  ): Promise<
    | (PayrollResponse & { cancelled: true; cancelledAt?: Date })
    | ({
        replayed: true;
      } & (PayrollResponse & { cancelled: true }))
  > {
    const requestHash = computeRequestHash({ payrollId, actorId });
    const scope = 'hr-payroll-cancel';

    return this.prisma.$transaction(async (tx) => {
      const replay = await tryReplayIdempotencyKey(
        tx,
        idempotencyKey,
        scope,
        requestHash,
      );
      if (replay) {
        return replay as PayrollResponse & { cancelled: true } & {
          replayed: true;
        };
      }

      const payroll = await tx.payroll.findUnique({
        where: { id: payrollId },
      });
      if (!payroll) throw new NotFoundException('كشف الراتب غير موجود');
      if (payroll.status !== PayrollStatus.DRAFT) {
        throw new BadRequestException(
          'لا يمكن إبطال إلا كشف راتب في حالة المسودة (DRAFT)',
        );
      }

      // CAS: الإزالة مشروطة ببقاء الحالة DRAFT — أي تغيير متزامن (اعتماد
      // أو دفع) يجعل count ≠ 1 ويُرفض بـ 409 بلا أثر.
      const removed = await tx.payroll.deleteMany({
        where: { id: payrollId, status: PayrollStatus.DRAFT },
      });
      if (removed.count !== 1) {
        throw new ConflictException(
          'تعذر إبطال كشف الراتب؛ حالته تغيرت بالتزامن',
        );
      }

      const response = {
        ...this.toPayrollResponse(payroll),
        cancelled: true as const,
        cancelledAt: new Date(),
      };
      // HR-6 (ب): سجل تدقيق داخل نفس المعاملة — لقطة المسودة الملغاة
      // (المجاميع والحالة والعامل) تبقى قابلة للمراجعة بعد الإزالة.
      await tx.activityLog.create({
        data: {
          userId: actorId,
          action: 'PAYROLL_CANCELLED',
          module: 'HR',
          details: {
            payrollId,
            workerId: payroll.workerId,
            periodStart: payroll.periodStart.toISOString(),
            periodEnd: payroll.periodEnd.toISOString(),
            grossAmount: payroll.grossAmount.toNumber(),
            advanceDeduct: payroll.advanceDeduct.toNumber(),
            absenceDeduct: payroll.absenceDeduct.toNumber(),
            netAmount: payroll.netAmount.toNumber(),
            reason: 'draft-cancelled',
          },
        },
      });
      await storeIdempotencyResponse(tx, idempotencyKey, response);
      return response;
    });
  }

  // ===================== HR-6 (ج): قراءات الجوال (سلف + إنتاج) =====================

  /**
   * HR-6 (ج): قائمة سلف العمال — مرقمة بفلاتر workerId/from/to، بإسقاط
   * آمن صريح (لا حقول خارج القائمة) مع اسم العامل، والمبالغ أرقامًا.
   */
  async getWorkerAdvances(
    query: WorkerPeriodQueryDto = new WorkerPeriodQueryDto(),
  ) {
    const page = query.page ?? 1;
    const pageSize = query.limit ?? 20;
    const skip = (page - 1) * pageSize;
    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;
    if (from && to && from > to) {
      throw new BadRequestException(
        'تاريخ بداية فترة البحث لا يمكن أن يكون بعد تاريخ النهاية',
      );
    }
    const where: Prisma.WorkerAdvanceWhereInput = {};
    if (query.workerId) where.workerId = query.workerId;
    if (from || to) {
      where.date = {
        ...(from ? { gte: from } : {}),
        ...(to ? { lte: to } : {}),
      };
    }

    const [rows, total] = await Promise.all([
      this.prisma.workerAdvance.findMany({
        where,
        select: {
          id: true,
          workerId: true,
          amount: true,
          settledAmount: true,
          date: true,
          notes: true,
          worker: { select: { id: true, name: true, code: true } },
        },
        orderBy: { date: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.workerAdvance.count({ where }),
    ]);

    const data = rows.map((row) => ({
      id: row.id,
      workerId: row.workerId,
      amount: row.amount.toNumber(),
      settledAmount: row.settledAmount.toNumber(),
      date: row.date,
      notes: row.notes,
      worker: row.worker,
    }));
    // HR-6 (ج): العقد الحرفي { items, total, page, limit }.
    return new ListResponseDto(data, total, page, pageSize);
  }

  /**
   * HR-6 (ج): قائمة سجلات الإنتاج اليومي — مرقمة بفلاتر workerId/workOrderId/
   * from/to، بإسقاط آمن صريح مع اسم العامل، والأسعار/الإجماليات أرقامًا.
   */
  async getDailyProductionRecords(
    query: WorkerPeriodQueryDto = new WorkerPeriodQueryDto(),
  ) {
    const page = query.page ?? 1;
    const pageSize = query.limit ?? 20;
    const skip = (page - 1) * pageSize;
    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;
    if (from && to && from > to) {
      throw new BadRequestException(
        'تاريخ بداية فترة البحث لا يمكن أن يكون بعد تاريخ النهاية',
      );
    }
    const where: Prisma.DailyProductionWhereInput = {};
    if (query.workerId) where.workerId = query.workerId;
    if (query.workOrderId) where.workOrderId = query.workOrderId;
    if (from || to) {
      where.date = {
        ...(from ? { gte: from } : {}),
        ...(to ? { lte: to } : {}),
      };
    }

    const [rows, total] = await Promise.all([
      this.prisma.dailyProduction.findMany({
        where,
        select: {
          id: true,
          workerId: true,
          workOrderId: true,
          date: true,
          piecesCount: true,
          pieceRate: true,
          totalAmount: true,
          notes: true,
          worker: { select: { id: true, name: true, code: true } },
        },
        orderBy: { date: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.dailyProduction.count({ where }),
    ]);

    const data = rows.map((row) => ({
      id: row.id,
      workerId: row.workerId,
      workOrderId: row.workOrderId,
      date: row.date,
      piecesCount: row.piecesCount,
      pieceRate: row.pieceRate.toNumber(),
      totalAmount: row.totalAmount.toNumber(),
      notes: row.notes,
      worker: row.worker,
    }));
    // HR-6 (ج): العقد الحرفي { items, total, page, limit }.
    return new ListResponseDto(data, total, page, pageSize);
  }

  /**
   * HR-2 (P1 — GF-IMP-W2): توزيع خصم السلف على سلف الفترة FIFO داخل معاملة
   * الدفع. لكل سلفة بالترتيب الزمني: المخصص = min(المتبقي من الخصم،
   * amount - settledAmount)، ويُحدّث settledAmount بالمخصص (بحد amount).
   * السلف المسية بالكامل (settledAmount == amount) تُتخطى عمدًا — لا تدخل
   * حسابات الخصم لاحقًا. إن تجاوز الخصم مجموع المتبقي (بيانات متقادمة)
   * يُوزّع المتاح فقط ويبقى الفارق بلا تحديث سلف — القيد GL يبقى مصدر
   * الحقيقة المالية.
   */
  private async settleWorkerAdvancesFifoInTx(
    tx: Prisma.TransactionClient,
    input: {
      workerId: string;
      periodStart: Date;
      periodEnd: Date;
      allocation: Prisma.Decimal;
    },
  ): Promise<void> {
    const periodEndExclusive = getPeriodEndExclusive(input.periodEnd);
    const advances = await tx.workerAdvance.findMany({
      where: {
        workerId: input.workerId,
        date: { gte: input.periodStart, lt: periodEndExclusive },
      },
      select: { id: true, amount: true, settledAmount: true },
      orderBy: [{ date: 'asc' }, { id: 'asc' }],
    });
    let remaining = input.allocation;
    for (const advance of advances) {
      if (remaining.lte(0)) break;
      const outstanding = advance.amount.minus(advance.settledAmount);
      if (outstanding.lte(0)) continue; // سلفة مسية بالكامل (HR-2 ج)
      const allocation = outstanding.lt(remaining) ? outstanding : remaining;
      await tx.workerAdvance.update({
        where: { id: advance.id },
        data: { settledAmount: { increment: allocation } },
      });
      remaining = remaining.minus(allocation);
    }
    // أي متبقٍ من الخصم بعد آخر سلفة (لا يحدث في المسارات الحالية لأن
    // التوزيع يستخدم نفس نطاق الفترة المستخدم في حساب الخصم وabsenceDeduct
    // صفر) يبقى بلا تحديث سلف — القيد GL مصدر الحقيقة المالية، وسجل
    // النشاط أدناه يوثّق قيمة الخصم الكاملة للمراجعة.
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
