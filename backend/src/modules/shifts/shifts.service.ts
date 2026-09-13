import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PaymentType, Prisma, ShiftStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SequenceService } from '../../core/sequence/sequence.service';
import { CloseShiftDto } from './dto/close-shift.dto';
import { OpenShiftDto } from './dto/open-shift.dto';
import { QueryShiftDto } from './dto/query-shift.dto';
import { round2 } from '../../core/common/money.util';

/**
 * SELIM-ERP W1 — خدمة الورديات (تقلد ShiftSession في Selim ERP).
 *
 * الوردية مستند رقابة نقدية للـ POS: فتح برصيد افتتاحي → إغلاق برصيد
 * فعلي يُقارن بالمتوقع فيُحسب الفرق. القواعد (نفس Selim):
 * - مستخدم واحد لا يملك أكثر من وردية مفتوحة في نفس الوقت.
 * - الإغلاق لصاحب الوردية فقط، أو للمدير العام/السوبر أدمن (إغلاق
 *   ورديات الآخرين — سيناريو الإشراف).
 * - النقدية المتوقعة = رصيد الافتتاح + مجموع المدفوع نقدًا في أوامر
 *   البيع التي أنشأها صاحب الوردية منذ بدءها. لا يوجد قيد محاسبي —
 *   الوردية وثيقة جرد درج (القيود تصدر من أوامر البيع نفسها)، وهو نفس
 *   سلوك Selim: الوردية لا تلمس دفتر اليومية إطلاقًا.
 * - أرقام الورديات SHF-0001 عبر SequenceService داخل معاملة الإنشاء.
 */
@Injectable()
export class ShiftsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequence: SequenceService,
  ) {}

  /** فتح وردية جديدة — يُرفض إذا للمستخدم وردية مفتوحة بالفعل. */
  async open(dto: OpenShiftDto, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      // قاعدة Selim: كاشير واحد = وردية مفتوحة واحدة (درج واحد).
      const existing = await tx.shiftSession.findFirst({
        where: { openedById: userId, status: ShiftStatus.OPEN },
        select: { id: true, code: true },
      });
      if (existing) {
        throw new ConflictException('توجد وردية مفتوحة بالفعل لهذا المستخدم');
      }

      // لقطة اسم الفاتح — تُقرأ الورديات بعد مغادرة المستخدم/تغيير اسمه.
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true, name: true },
      });
      if (!user) {
        throw new NotFoundException('المستخدم غير موجود');
      }

      const code = await this.sequence.nextNumber('SHIFT_SESSION', tx);
      return tx.shiftSession.create({
        data: {
          code,
          openedById: userId,
          openedByName: user.name,
          startCash: new Prisma.Decimal(dto.startCash ?? 0),
          notes: dto.notes,
          status: ShiftStatus.OPEN,
        },
      });
    });
  }

  /**
   * إغلاق وردية: حساب المتوقع والفرق على الخادم ثم تعليم CLOSED.
   *
   * - المفتوح فقط قابل للإغلاق، وصاحبه فقط — إلا للمدير العام/السوبر
   *   أدمن (إغلاق إشرافي لورديات الكاشيرين).
   * - الإغلاق نفسه شرط ذري (updateMany WHERE status=OPEN) فالإغلاق
   *   المتزامن المزدوج يُرفض بدل كتابة نتائج متضاربة.
   */
  async close(
    id: string,
    dto: CloseShiftDto,
    actor: { id: string; role?: UserRole },
  ) {
    const shift = await this.prisma.shiftSession.findUnique({
      where: { id },
    });
    if (!shift) throw new NotFoundException('الوردية غير موجودة');
    if (shift.status !== ShiftStatus.OPEN) {
      throw new BadRequestException('الوردية مغلقة بالفعل');
    }

    const isOwner = shift.openedById === actor.id;
    const isSupervisor =
      actor.role === UserRole.GENERAL_MANAGER ||
      actor.role === UserRole.SUPER_ADMIN;
    if (!isOwner && !isSupervisor) {
      throw new ForbiddenException(
        'لا يمكن إغلاق وردية مستخدم آخر — الإغلاق لصاحبها أو للإدارة العامة',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // المتوقع = الافتتاحي + مبيعات صاحب الوردية النقدية منذ بدءها.
      // (المحسوبة على الخادم داخل نفس معاملة الإغلاق — لقطة موثوقة.)
      const sales = await tx.salesOrder.aggregate({
        where: {
          userId: shift.openedById,
          paymentType: PaymentType.CASH,
          createdAt: { gte: shift.startTime },
        },
        _sum: { paidAmount: true },
      });
      const cashSales = round2(Number(sales._sum.paidAmount ?? 0));
      const expectedCash = round2(Number(shift.startCash) + cashSales);
      const difference = round2(dto.endCash - expectedCash);

      const notes = dto.notes
        ? shift.notes
          ? `${shift.notes} | إغلاق: ${dto.notes}`
          : `إغلاق: ${dto.notes}`
        : shift.notes;

      // شرط الحالة OPEN داخل التحديث — حماية من إغلاق متزامن مزدوج.
      const updated = await tx.shiftSession.updateMany({
        where: { id, status: ShiftStatus.OPEN },
        data: {
          endTime: new Date(),
          endCash: new Prisma.Decimal(dto.endCash),
          expectedCash: new Prisma.Decimal(expectedCash),
          difference: new Prisma.Decimal(difference),
          status: ShiftStatus.CLOSED,
          notes,
        },
      });
      if (updated.count !== 1) {
        throw new ConflictException(
          'تعذر إغلاق الوردية؛ حالتها تغيرت بالتزامن',
        );
      }

      return tx.shiftSession.findUnique({ where: { id } });
    });
  }

  /** وردية المستخدم المفتوحة حاليًا — أو null (شاشة الـ POS تسألها دائمًا). */
  async getCurrent(userId: string) {
    return this.prisma.shiftSession.findFirst({
      where: { openedById: userId, status: ShiftStatus.OPEN },
      orderBy: { startTime: 'desc' },
    });
  }

  /** قائمة الورديات بمرشحات الحالة/الفاتح/النطاق الزمني + ترقيم. */
  async findAll(query: QueryShiftDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.ShiftSessionWhereInput = {};
    if (query.status) {
      where.status = query.status as ShiftStatus;
    }
    if (query.openedBy) {
      where.openedById = query.openedBy;
    }
    if (query.from || query.to) {
      where.startTime = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }
    const [items, total, openCount] = await this.prisma.$transaction([
      this.prisma.shiftSession.findMany({
        where,
        orderBy: { startTime: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.shiftSession.count({ where }),
      // عدّاد الورديات المفتوحة الآن (لوحة الإشراف على الدروج).
      this.prisma.shiftSession.count({
        where: { status: ShiftStatus.OPEN },
      }),
    ]);
    return {
      items,
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
      openCount,
    };
  }

  /** تفاصيل وردية واحدة. */
  async findOne(id: string) {
    const shift = await this.prisma.shiftSession.findUnique({
      where: { id },
      include: {
        openedBy: { select: { id: true, name: true, email: true } },
      },
    });
    if (!shift) throw new NotFoundException('الوردية غير موجودة');
    return shift;
  }
}
