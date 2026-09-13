import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PayrollStatus, PayrollStatementStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SequenceService } from '../../core/sequence/sequence.service';
import { FinancialPostingService } from '../../core/financial/financial-posting.service';
import { CHART_OF_ACCOUNTS } from '../../core/financial/chart-of-accounts';
import { GeneratePayrollStatementDto } from './dto/generate-payroll-statement.dto';
import { QueryPayrollStatementDto } from './dto/query-payroll-statement.dto';
import { round2 } from '../../core/common/money.util';

/**
 * SELIM-ERP W1 — خدمة كشوف الرواتب المجمدة (تقلد PayrollStatement في
 * Selim ERP): تجميع كشوف رواتب شهر كامل في مستند واحد.
 *
 * دورة الحياة (نفس Selim):
 *   DRAFT → POSTED
 * - التوليد: يجمع كل كشوف رواتب معتمدة غير مدفوعة وغير مجمّعة تتقاطع
 *   فتراتها مع النطاق المطلوب، ويلقّطها JSON (صف لكل عامل + مجاميع)
 *   — اللقطة مجمدة فلا تتأثر بأي تعديل لاحق على الكشوف الأصلية.
 * - الترحيل (post): قيد واحد Dr SALARIES_EXPENSE (الإجمالي) /
 *   Cr SALARIES_PAYABLE (الصافي) / Cr WORKER_ADVANCES (الخصومات — سلف
 *   وغياب معًا كما في مسار payPayroll الحالي) + تعليم الكشوف المرتبطة
 *   مدفوعة (isPaid + paidAt + status PAID) داخل معاملة واحدة. في Selim
 *   ترحيل الكشف المجمع = دفع رواتب الشهر، وهذا ما ننفذه هنا.
 * - الحذف: DRAFT فقط — يفك ربط الكشوف فتعود متاحة للتجميع مجددًا.
 */
@Injectable()
export class PayrollStatementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequence: SequenceService,
    private readonly financial: FinancialPostingService,
  ) {}

  /**
   * توليد كشف مجمع من كشوف الفترة المعتمدة غير المدفوعة وربطها به.
   * (لا معامل مستخدم — المُرحّل يُوثّق لاحقًا عند post فحسب.)
   */
  async generate(dto: GeneratePayrollStatementDto) {
    const periodFrom = new Date(dto.periodFrom);
    const periodTo = new Date(dto.periodTo);
    if (periodFrom >= periodTo) {
      throw new BadRequestException('بداية الفترة يجب أن تسبق نهايتها');
    }

    // فترة الكشف تتقاطع مع فترة الكشف الفردي إذا تداخلت النطاقان.
    const payrolls = await this.prisma.payroll.findMany({
      where: {
        status: PayrollStatus.APPROVED,
        isPaid: false,
        payrollStatementId: null,
        AND: [
          { periodStart: { lte: periodTo } },
          { periodEnd: { gte: periodFrom } },
        ],
      },
      include: { worker: { select: { id: true, name: true, code: true } } },
      orderBy: { workerId: 'asc' },
    });
    if (payrolls.length === 0) {
      throw new BadRequestException(
        'لا توجد كشوف رواتب معتمدة غير مدفوعة في الفترة',
      );
    }

    // اللقطة المجمدة: صف لكل عامل + المجاميع — كل شيء داخل JSON.
    const lines = payrolls.map((p) => ({
      payrollId: p.id,
      workerId: p.workerId,
      workerName: p.worker.name,
      workerCode: p.worker.code,
      periodStart: p.periodStart.toISOString(),
      periodEnd: p.periodEnd.toISOString(),
      gross: Number(p.grossAmount),
      advanceDeductions: Number(p.advanceDeduct),
      absenceDeductions: Number(p.absenceDeduct),
      deductions: round2(Number(p.advanceDeduct) + Number(p.absenceDeduct)),
      net: Number(p.netAmount),
    }));
    const totals = {
      gross: round2(lines.reduce((sum, l) => sum + l.gross, 0)),
      advanceDeductions: round2(
        lines.reduce((sum, l) => sum + l.advanceDeductions, 0),
      ),
      absenceDeductions: round2(
        lines.reduce((sum, l) => sum + l.absenceDeductions, 0),
      ),
      deductions: round2(lines.reduce((sum, l) => sum + l.deductions, 0)),
      net: round2(lines.reduce((sum, l) => sum + l.net, 0)),
      count: lines.length,
    };

    return this.prisma.$transaction(async (tx) => {
      // الفترة نفسها (from, to) لا تُجمَّع مرتين — قيد التفرد في المخطط.
      const duplicate = await tx.payrollStatement.findUnique({
        where: {
          periodFrom_periodTo: { periodFrom, periodTo },
        },
        select: { id: true, code: true },
      });
      if (duplicate) {
        throw new ConflictException(
          `يوجد كشف مجمع لنفس الفترة بالفعل (${duplicate.code})`,
        );
      }

      const code = await this.sequence.nextNumber('PAYROLL_STATEMENT', tx);
      const statement = await tx.payrollStatement.create({
        data: {
          code,
          periodFrom,
          periodTo,
          status: PayrollStatementStatus.DRAFT,
          // لقطة JSON مجمدة (صفوف العمال + المجاميع) — Prisma.InputJsonValue
          // تقبل هذه الكائنات النقية مباشرة.
          lines,
          totals,
          workerCount: totals.count,
          notes: dto.notes,
        },
      });

      // ربط الكشوف بالكشف المجمع داخل نفس المعاملة — تصبح محجوزة له.
      const linked = await tx.payroll.updateMany({
        where: { id: { in: payrolls.map((p) => p.id) } },
        data: { payrollStatementId: statement.id },
      });
      if (linked.count !== payrolls.length) {
        throw new ConflictException(
          'تغيرت حالة كشوف الفترة بالتزامن — أعد التوليد',
        );
      }

      return statement;
    });
  }

  /**
   * ترحيل الكشف المجمع: قيد واحد + تعليم الكشوف المرتبطة مدفوعة.
   *
   * في Selim، ترحيل كشف الرواتب المجمع هو نفسه لحظة محاسبة الشهر
   * ودفع رواتبه: قيد واحد يُثبّت مصروف الرواتب بالإجمالي، ويُنشئ التزام
   * الرواتب المستحقة بالصافي، ويرد الخصومات (سلف + غياب معًا — نفس
   * دلالات payPayroll الحالية) لأصل سلف العمال، ثم تُعلم كل الكشوف
   * المرتبطة isPaid فورًا — «الترحيل = الدفع» كما في Selim ERP.
   */
  async post(id: string, userId: string) {
    const statement = await this.prisma.payrollStatement.findUnique({
      where: { id },
    });
    if (!statement) throw new NotFoundException('الكشف المجمع غير موجود');
    if (statement.status !== PayrollStatementStatus.DRAFT) {
      throw new BadRequestException('الكشف المجمع مرحّل بالفعل');
    }

    const totals = this.readTotals(statement.totals);
    if (totals.gross <= 0) {
      throw new BadRequestException('لا يمكن ترحيل كشف مجمع بإجمالي غير موجب');
    }

    return this.prisma.$transaction(async (tx) => {
      // قيد الترحيل (بنية Selim للكشف المجمد):
      //   Dr SALARIES_EXPENSE (الإجمالي = صافٍ + خصومات)
      //   Cr SALARIES_PAYABLE (الصافي)
      //   Cr WORKER_ADVANCES (الخصومات: سلف + غياب)
      // محرك القيود عندنا يبني كل بند (مدين/دائن) زوجًا واحدًا، فتتحلل
      // البنية أعلاه إلى زوجين متوازنين إجماليًا: مصروف بالصافي مقابل
      // المستحق، ومصروف بالخصومات مقابل السلف — مجموع مدين SALARIES_EXPENSE
      // = الإجمالي ومجموع الدائن = صافٍ + خصومات = الإجمالي. البنود
      // الصفرية تُتخطى حفاظًا على التوازن.
      const lines: {
        debitAccountId: string;
        creditAccountId: string;
        amount: number;
        description: string;
      }[] = [];
      if (totals.net > 0) {
        lines.push({
          debitAccountId: CHART_OF_ACCOUNTS.SALARIES_EXPENSE,
          creditAccountId: CHART_OF_ACCOUNTS.SALARIES_PAYABLE,
          amount: totals.net,
          description: `صافي رواتب مستحقة كشف ${statement.code}`,
        });
      }
      if (totals.deductions > 0) {
        lines.push({
          debitAccountId: CHART_OF_ACCOUNTS.SALARIES_EXPENSE,
          creditAccountId: CHART_OF_ACCOUNTS.WORKER_ADVANCES,
          amount: totals.deductions,
          description: `استرداد خصومات (سلف/غياب) كشف ${statement.code}`,
        });
      }

      const entry = await this.financial.postJournalEntryInTx(
        tx,
        {
          description: `ترحيل كشف رواتب مجمع ${statement.code}`,
          reference: `PAYROLL_STATEMENT:${statement.code}`,
          isAuto: true,
          postingKey: `payroll-statement-post:${statement.id}`,
          lines,
          metadata: {
            source: 'PAYROLL_STATEMENT_POST',
            payrollStatementId: statement.id,
            gross: totals.gross,
            net: totals.net,
            deductions: totals.deductions,
            workerCount: totals.count,
          },
        },
        userId,
      );

      // تعليم الكشوف المرتبطة مدفوعة (نفس لحظة الترحيل = لحظة الدفع).
      const paid = await tx.payroll.updateMany({
        where: {
          payrollStatementId: statement.id,
          isPaid: false,
        },
        data: {
          isPaid: true,
          paidAt: new Date(),
          status: PayrollStatus.PAID,
        },
      });
      if (paid.count !== totals.count) {
        throw new ConflictException(
          'عدد الكشوف المرتبطة تغير بالتزامن — راجع الكشف المجمع',
        );
      }

      const posted = await tx.payrollStatement.update({
        where: { id: statement.id, status: PayrollStatementStatus.DRAFT },
        data: {
          status: PayrollStatementStatus.POSTED,
          journalEntryId: entry.entryId,
          approvedById: userId,
          approvedAt: new Date(),
        },
      });
      return posted;
    });
  }

  /** قائمة الكشوف المجمدة بمرشحات الحالة/الفترة + ترقيم. */
  async findAll(query: QueryPayrollStatementDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.PayrollStatementWhereInput = {};
    if (query.status) {
      where.status = query.status as PayrollStatementStatus;
    }
    // الفلترة بتداخل النطاق: كشف يتقاطع مع [from, to] يظهر في النتائج.
    if (query.from || query.to) {
      where.AND = [
        ...(query.to ? [{ periodFrom: { lte: new Date(query.to) } }] : []),
        ...(query.from ? [{ periodTo: { gte: new Date(query.from) } }] : []),
      ];
    }
    const [items, total] = await this.prisma.$transaction([
      this.prisma.payrollStatement.findMany({
        where,
        orderBy: { periodFrom: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.payrollStatement.count({ where }),
    ]);
    return { items, total, page, limit, pages: Math.ceil(total / limit) };
  }

  /** تفاصيل كشف مجمع: اللقطة JSON + الكشوف الأصلية المرتبطة. */
  async findOne(id: string) {
    const statement = await this.prisma.payrollStatement.findUnique({
      where: { id },
      include: {
        approvedBy: { select: { id: true, name: true } },
        journalEntry: { select: { id: true, code: true, isReversed: true } },
        payrolls: {
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
          },
        },
      },
    });
    if (!statement) throw new NotFoundException('الكشف المجمع غير موجود');
    return statement;
  }

  /** حذف كشف مجمع — DRAFT فقط، ويفك ربط الكشوف فتعود متاحة للتجميع. */
  async remove(id: string) {
    const statement = await this.prisma.payrollStatement.findUnique({
      where: { id },
      select: { id: true, status: true, code: true },
    });
    if (!statement) throw new NotFoundException('الكشف المجمع غير موجود');
    if (statement.status !== PayrollStatementStatus.DRAFT) {
      throw new BadRequestException(
        'لا يمكن حذف كشف مجمع مرحّل — له قيد مالي وأثر دفع',
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.payroll.updateMany({
        where: { payrollStatementId: id },
        data: { payrollStatementId: null },
      });
      await tx.payrollStatement.delete({ where: { id } });
    });
    return { deleted: true, code: statement.code };
  }

  /**
   * قراءة مجاميع اللقطة JSON بأمان أنواع (الحقول مسؤوليتنا نحن).
   *
   * ملاحظة توازن: الإجمالي = الصافي + الخصومات (سلف + غياب) بحكم
   * بناء الكشوف الفردية في hr.service، لذا يظل قيد الترحيل متوازنًا.
   */
  private readTotals(totals: Prisma.JsonValue): {
    gross: number;
    advanceDeductions: number;
    absenceDeductions: number;
    deductions: number;
    net: number;
    count: number;
  } {
    const raw = (totals ?? {}) as Record<string, unknown>;
    return {
      gross: Number(raw.gross ?? 0),
      advanceDeductions: Number(raw.advanceDeductions ?? 0),
      absenceDeductions: Number(raw.absenceDeductions ?? 0),
      deductions: Number(raw.deductions ?? 0),
      net: Number(raw.net ?? 0),
      count: Number(raw.count ?? 0),
    };
  }
}
