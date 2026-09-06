import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma, WorkOrderStatus } from '@prisma/client';
import { InventoryService } from '../inventory/inventory.service';
import { PaginatedResult } from '../../common/dto/paginated-result.dto';
import { WorkOrderQueryDto } from './dto/work-order-query.dto';
import {
  generateDocumentCode,
  DocumentCodePrefix,
} from '../../core/common/codes.util';
import {
  computeRequestHash,
  storeIdempotencyResponse,
  tryReplayIdempotencyKey,
} from '../../core/common/idempotency.util';

/**
 * CC-8 (قرار موثّق): أحداث WORK_ORDER_CREATED/WORK_ORDER_CANCELLED كانت تُبث
 * هنا بـ void emitAsync بلا أي مستمع واحد في المستودع كله (لا يوجد أي
 * @OnEvent في src) — أي «قدرة غير موجودة» توحي بمعالجة لا تحدث. حُذف البث
 * ومعه حقن EventEmitter2. طبقة الأحداث في هذا المشروع تعمل بنمط post-commit
 * فقط (INV-1 من الموجة الأولى: الأحداث تُجمع أثناء المعاملة وتُبث بعد نجاح
 * commit الأب) — أي استعادة مستقبلية لحدث أمر عمل يجب أن تتبع النمط نفسه:
 * مستمع موثّق + تجميع أثناء tx + بث بعد commit، لا بث fire-and-forget خام.
 */
@Injectable()
export class ProductionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventoryService: InventoryService,
  ) {}

  /**
   * PRD-7 (P2 — GF-IMP-W3): فلاتر القائمة (status / currentStage / from-to /
   * q) عبر WorkOrderQueryDto (قالب ListQueryDto المشترك — CC-6) + select
   * نحيف بدلاً من include كامل مع stageUpdates — القائمة كانت تجلب كل علاقات
   * أمر التشغيل (المنتج كاملًا + إصدار BOM + تحديثات المراحل كاملة) لكل
   * صف؛ الآن: الهوية والملخص فقط (id/code/status/currentStage/quantity/
   * createdAt + ملخص المنتج والمتغير). count يستخدم نفس where فالترقيم يتفق
   * مع الفلاتر. q يبحث في كود الأمر (الحقل النصي المعرف الوحيد) بcontains
   * غير حساس — نمط القالب.
   */
  async getAllWorkOrders(query: WorkOrderQueryDto = new WorkOrderQueryDto()) {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;
    if (
      (from && Number.isNaN(from.getTime())) ||
      (to && Number.isNaN(to.getTime()))
    ) {
      throw new BadRequestException(
        'فلاتر أوامر التشغيل تتطلب تواريخ ISO صالحة',
      );
    }
    if (from && to && from > to) {
      throw new BadRequestException(
        'تاريخ بداية الفلاتر لا يمكن أن يكون بعد تاريخ النهاية',
      );
    }

    const where: Prisma.WorkOrderWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.currentStage ? { currentStage: query.currentStage } : {}),
      ...(from || to
        ? {
            createdAt: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          }
        : {}),
      // PRD-7/CC-6: q على كود الأمر — الحقل النصي المعرف الوحيد في المخطط
      ...(query.q
        ? { code: { contains: query.q, mode: 'insensitive' as const } }
        : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.workOrder.findMany({
        skip,
        take: limit,
        where,
        // PRD-7: select نحيف — لا stageUpdates ولا bomVersion كامل
        select: {
          id: true,
          code: true,
          status: true,
          currentStage: true,
          quantity: true,
          createdAt: true,
          variant: {
            select: {
              id: true,
              size: true,
              color: true,
              product: { select: { id: true, code: true, name: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.workOrder.count({ where }),
    ]);

    return new PaginatedResult(data, total, page, limit);
  }

  async createWorkOrder(
    dto: { productVariantId: string; bomVersionId: string; quantity: number },
    creatorId: string,
    idempotencyKey?: string,
  ) {
    // RES-F02: replay-safe retry via Idempotency-Key header.
    const requestHash = computeRequestHash({
      productVariantId: dto.productVariantId,
      bomVersionId: dto.bomVersionId,
      quantity: dto.quantity,
      creatorId,
    });
    const scope = 'work-order-create';
    return this.prisma.$transaction(async (tx) => {
      const replay = await tryReplayIdempotencyKey(
        tx,
        idempotencyKey,
        scope,
        requestHash,
      );
      if (replay)
        return replay as Awaited<ReturnType<typeof tx.workOrder.create>> & {
          replayed: true;
        };

      const created = await tx.workOrder.create({
        data: {
          code: generateDocumentCode(DocumentCodePrefix.WORK_ORDER),
          productVariantId: dto.productVariantId,
          bomVersionId: dto.bomVersionId,
          quantity: dto.quantity,
          status: WorkOrderStatus.PLANNED,
          createdById: creatorId,
        },
      });
      await storeIdempotencyResponse(tx, idempotencyKey, created);
      return created;
    });
  }

  async updateOrderStatus(
    id: string,
    status: WorkOrderStatus,
    userId?: string,
  ) {
    /**
     * PRD-2: القراءة والكتابة داخل $transaction واحدة + تحديث CAS مشروط
     * بالحالة المتوقعة. النمط القديم (findUnique خارج معاملة ثم update) كان
     * يفتح نافذة TOCTOU: طلبان متزامنان يقرآن PLANNED فيمرّ كلاهما فحوص
     * الانتقال ثم يكتبان (مثلًا إلغاء + بدء مرحلة) فتُداس آخر كتابة دون أي
     * أثر تدقيق. الآن: أي تغيّر في الحالة بين القراءة والكتابة → صفر صفوف
     * من updateMany → ConflictException عربية (409) وتراجع كامل، مع سجل
     * ActivityLog بالفاعل الفعلي داخل نفس المعاملة.
     */
    return this.prisma.$transaction(async (tx) => {
      // إعادة قراءة الأمر داخل المعاملة — مصدر الحقيقة لشروط الانتقال.
      const existing = await tx.workOrder.findUnique({
        where: { id },
      });

      if (!existing) {
        throw new NotFoundException('Work order not found');
      }

      // 1. منع تعديل أمر تشغيل مكتمل (Immutability)
      if (existing.status === WorkOrderStatus.COMPLETED) {
        throw new BadRequestException(
          'Completed work orders are immutable. Use approved reversal workflows if needed.',
        );
      }

      // 2. منع الإكمال المباشر عبر هذا المسار (Bypass Prevention)
      if (status === WorkOrderStatus.COMPLETED) {
        throw new BadRequestException(
          'Direct completion is disabled. Use ProductionWorkflowService stages (PACKING) to complete production.',
        );
      }

      // 3. منع الانتقال المباشر لحالات الـ workflow النشطة
      const workflowStatuses: WorkOrderStatus[] = [
        WorkOrderStatus.IN_PROGRESS,
        WorkOrderStatus.CUTTING,
        WorkOrderStatus.SEWING,
        WorkOrderStatus.IRONING,
        WorkOrderStatus.FINISHING,
        WorkOrderStatus.PACKAGING,
      ];

      if (workflowStatuses.includes(status)) {
        throw new BadRequestException(
          `Direct transition to ${status} is disabled. Use ProductionWorkflowService.transitionStage instead.`,
        );
      }

      // تحديث الحالة المسموحة (مثل CANCELLED أو PLANNED) — CAS: الشرط على
      // الحالة المقروءة للتو؛ تغيّرها بالتوازي = صفر صفوف = تعارض.
      const updated = await tx.workOrder.updateMany({
        where: { id, status: existing.status },
        data: { status },
      });
      if (updated.count === 0) {
        throw new ConflictException(
          'تغيرت حالة أمر التشغيل أثناء التحديث — أعد المحاولة بعد قراءة الحالة الجديدة',
        );
      }

      // PRD-2: تدقيق الفاعل — الفاعل مستخدم فعليًا من الجلسة (لا نظامًا)،
      // والحالة قبل/بعد تُسجَّلان داخل نفس المعاملة فلا حالة بلا أثر.
      if (userId) {
        await tx.activityLog.create({
          data: {
            userId,
            action: 'WORK_ORDER_STATUS_UPDATED',
            module: 'production',
            details: {
              workOrderId: id,
              fromStatus: existing.status,
              toStatus: status,
            },
          },
        });
      }

      return { ...existing, status };
    });
  }
}
