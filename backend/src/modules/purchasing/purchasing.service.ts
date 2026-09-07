import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { PurchaseOrderStatus, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { CreatePurchaseReceiptDto } from './dto/create-purchase-receipt.dto';
import { ReturnToSupplierDto } from './dto/return-to-supplier.dto';
import { PurchaseOrderQueryDto } from './dto/purchase-order-query.dto';
import { FinancialPostingService } from '../../core/financial/financial-posting.service';
import { CHART_OF_ACCOUNTS } from '../../core/financial/chart-of-accounts';
import { ListResponseDto } from '../../common/dto/list-response.dto';
import {
  generateDocumentCode,
  DocumentCodePrefix,
} from '../../core/common/codes.util';
import {
  computeRequestHash,
  createIdempotencyKey,
  isIdempotencyUniqueViolation,
  storeIdempotencyResponse,
  tryReplayIdempotencyKey,
} from '../../core/common/idempotency.util';

/**
 * PUR-1: تقريب المبالغ المالية لمنزلتين عشريتين مطابقة لأعمدة
 * Decimal(10,2) في القاعدة — نفس النمط المعرف محليًا في sales/inventory.
 * يمنع تسرب كسور الفاصلة العائمة إلى المجموع المحفوظ.
 */
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * PUR-2: تقريب الكميات لـ 4 منازل مطابقة لعمود Decimal(10,4) — يجعل
 * مقارنات البواقي الكسرية (المستلم + الجديد مقابل المطلوب) محصنة ضد
 * أخطاء تمثيل الفاصلة العائمة (مثل 0.1 + 0.2 > 0.3).
 */
function round4(value: number): number {
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}

@Injectable()
export class PurchasingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventoryService: InventoryService,
    private readonly financialPosting: FinancialPostingService,
  ) {}

  async getPurchaseOrders(
    query: PurchaseOrderQueryDto = new PurchaseOrderQueryDto(),
  ) {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    // PUR-6 (أ) (P2 — GF-IMP-W3): فلاتر اختيارية عبر PurchaseOrderQueryDto
    // (قالب CC-6) — التواريخ ISO صالحة وfrom ≤ to، وإلا 400 قبل أي استعلام.
    // كانت القائمة ترجع كل الأوامر بلا أي فلترة.
    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;
    if (
      (from && Number.isNaN(from.getTime())) ||
      (to && Number.isNaN(to.getTime()))
    ) {
      throw new BadRequestException(
        'فلاتر أوامر الشراء تتطلب تواريخ ISO صالحة',
      );
    }
    if (from && to && from > to) {
      throw new BadRequestException(
        'تاريخ بداية فلاتر أوامر الشراء لا يمكن أن يكون بعد تاريخ النهاية',
      );
    }

    const where: Prisma.PurchaseOrderWhereInput = {
      supplier: { deletedAt: null },
      ...(query.status ? { status: query.status } : {}),
      ...(query.supplierId ? { supplierId: query.supplierId } : {}),
      ...(from || to
        ? {
            createdAt: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          }
        : {}),
      ...(query.q ? { code: { contains: query.q, mode: 'insensitive' } } : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.purchaseOrder.findMany({
        skip,
        take: limit,
        where,
        // PUR-6 (أ): بنود نحيفة بدل include البنود كاملًا — الحقول الجوهرية
        // للعرض (المادة بالكود والاسم/الكمية/تكلفة الوحدة/إجمالي البند) +
        // معرّف البند الذي تحتاجه مسارات الاستلام/المرتجع
        // (purchaseOrderItemId). ملاحظة مخطط: لا يوجد عمود materialCode في
        // PurchaseOrderItem — كود المادة يجلب عبر علاقة rawMaterial
        // (عمود RawMaterial.code الفريد) بنفس إسقاط SAL-5 للبنود
        // (variant بselect نحيف)، فتلبية «materialCode» تتم بالوصل النحيف
        // لا بعمود مكرر.
        include: {
          supplier: { select: { id: true, code: true, name: true } },
          items: {
            select: {
              id: true,
              rawMaterialId: true,
              rawMaterial: {
                select: { id: true, code: true, name: true },
              },
              quantity: true,
              unitCost: true,
              totalCost: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.purchaseOrder.count({ where }),
    ]);

    // UAT-FIX (استقبال الجوال): الكمية المستلمة لكل بند مطلوبة في واجهتي
    // الاستلام («المتبقي») والمرتجع («المتاح للإرجاع») — بدونها تُبنى
    // القوائم على حقول غير موجودة فتظهر فارغة دائمًا. نحسبها بمجموعة
    // receipt items واحدة لكل الصفحة (استعلام إضافي واحد بدل N+1).
    const pageItemIds = data.flatMap((order) =>
      (order.items ?? []).map((i) => i.id),
    );
    const receivedMap = new Map<string, number>();
    if (pageItemIds.length > 0) {
      const receiptItems =
        (await this.prisma.purchaseReceiptItem.findMany({
          where: { purchaseOrderItemId: { in: pageItemIds } },
          select: { purchaseOrderItemId: true, quantity: true },
        })) ?? [];
      for (const ri of receiptItems) {
        receivedMap.set(
          ri.purchaseOrderItemId,
          (receivedMap.get(ri.purchaseOrderItemId) ?? 0) + Number(ri.quantity),
        );
      }
    }
    const ordersWithReceived = data.map((order) => ({
      ...order,
      items: (order.items ?? []).map((item) => ({
        ...item,
        receivedQuantity: receivedMap.get(item.id) ?? 0,
      })),
    }));

    // CC-6: قالب الاستجابة الموحد (items/total/page/limit + توافق
    // data/meta الانتقالي للمستهلكين الحاليين).
    return new ListResponseDto(ordersWithReceived, total, page, limit);
  }

  async createPurchaseOrder(
    dto: CreatePurchaseOrderDto,
    creatorId: string,
    idempotencyKey?: string,
  ) {
    // PUR-8 (أ) (P1 مؤجل — GF-IMP-W3): حرس دفاعي على مستوى الخدمة لكمية/
    // تكلفة سالبة أو غير رقمية. خط الدفاع الأول هو تحقق DTO (IsPositive
    // بمنازل محدودة — PUR-1) عبر ValidationPipe (يرفض بـ 400 قبل الخدمة)،
    // لكن الخدمة قابلة للاستدعاء مباشرة من موديولات أخرى بلا DTO، فالخطأ
    // هنا يمنع تلوث totalAmount/القيد المالي قبل أي كتابة.
    for (const item of dto.items) {
      if (
        !Number.isFinite(item.quantity) ||
        item.quantity <= 0 ||
        !Number.isFinite(item.unitCost) ||
        item.unitCost <= 0
      ) {
        throw new BadRequestException(
          'كمية البند وتكلفة الوحدة يجب أن تكونا رقمين موجبين (أكبر من صفر)',
        );
      }
    }

    // PUR-3 (P1 — GF-IMP-W2): idempotency كامل النمط القياسي — نفس المفتاح
    // + نفس المحتوى = نفس الاستجابة بلا أمر ثانٍ؛ محتوى مختلف بنفس المفتاح
    // = 409؛ السباق (P2002) = محاولة replay. المفتاح يُنشأ داخل نفس المعاملة
    // التي تنشئ الأمر والاستجابة لا تُخزّن إلا بعد نجاحها.
    const scope = 'purchase-order-create';
    const requestHash = computeRequestHash({
      operation: scope,
      creatorId,
      supplierId: dto.supplierId,
      paymentType: dto.paymentType,
      dueDate: dto.dueDate ?? null,
      notes: dto.notes ?? null,
      items: dto.items,
    });
    const replay = await tryReplayIdempotencyKey(
      this.prisma,
      idempotencyKey,
      scope,
      requestHash,
    );
    if (replay) return replay;

    // PUR-1: المجموع مقرب لمنزلتين (كان يجمع كسور الفاصلة العائمة خامًا)
    // — كذلك totalCost لكل بند.
    const totalAmount = round2(
      dto.items.reduce((sum, item) => sum + item.quantity * item.unitCost, 0),
    );

    try {
      return await this.prisma.$transaction(async (tx) => {
        await createIdempotencyKey(tx, idempotencyKey, scope, requestHash);
        // PUR-3: فحص المورد داخل المعاملة (كان خارجها) — مصدر الحقيقة ضد
        // تفعيل/حذف مورد متزامن بين الفحص والإنشاء.
        const supplier = await tx.supplier.findFirst({
          where: { id: dto.supplierId, isActive: true, deletedAt: null },
          select: { id: true },
        });
        if (!supplier)
          throw new NotFoundException('المورد غير موجود أو غير نشط');
        const created = await tx.purchaseOrder.create({
          data: {
            code: generateDocumentCode(DocumentCodePrefix.PURCHASE_ORDER),
            supplierId: dto.supplierId,
            paymentType: dto.paymentType,
            totalAmount,
            dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
            notes: dto.notes,
            userId: creatorId,
            status: PurchaseOrderStatus.DRAFT,
            items: {
              create: dto.items.map((item) => ({
                rawMaterialId: item.rawMaterialId,
                quantity: item.quantity,
                unitCost: item.unitCost,
                totalCost: round2(item.quantity * item.unitCost),
              })),
            },
          },
          include: { items: true },
        });
        // SEC-F02: audit trail for every purchase order write.
        await tx.activityLog.create({
          data: {
            userId: creatorId,
            action: 'PURCHASE_ORDER_CREATED',
            module: 'PURCHASING',
            details: {
              purchaseOrderId: created.id,
              code: created.code,
              supplierId: dto.supplierId,
              totalAmount,
              itemsCount: dto.items.length,
            },
          },
        });
        await storeIdempotencyResponse(tx, idempotencyKey, created);
        return created;
      });
    } catch (error) {
      if (idempotencyKey && isIdempotencyUniqueViolation(error)) {
        const replayed = await tryReplayIdempotencyKey(
          this.prisma,
          idempotencyKey,
          scope,
          requestHash,
        );
        if (replayed) return replayed;
      }
      throw error;
    }
  }

  async createReceipt(
    orderId: string,
    dto: CreatePurchaseReceiptDto,
    userId: string,
    idempotencyKey?: string,
  ) {
    if (!dto.items.length) {
      throw new BadRequestException(
        'يجب أن يحتوي إذن الاستلام على بند واحد على الأقل',
      );
    }

    const requestHash = computeRequestHash({
      orderId,
      items: dto.items,
      notes: dto.notes ?? null,
      userId,
    });
    const scope = 'purchasing-receipt-create';
    const replay = await tryReplayIdempotencyKey(
      this.prisma,
      idempotencyKey,
      scope,
      requestHash,
    );
    if (replay) return replay;

    const itemIds = dto.items.map((item) => item.purchaseOrderItemId);
    if (new Set(itemIds).size !== itemIds.length) {
      throw new BadRequestException(
        'لا يجوز تكرار بند أمر الشراء في إذن الاستلام',
      );
    }

    const order = await this.prisma.purchaseOrder.findUnique({
      where: { id: orderId },
      include: { items: true },
    });
    if (!order) throw new NotFoundException('Purchase order not found');
    if (order.status === PurchaseOrderStatus.CANCELLED) {
      throw new BadRequestException('Cannot receive a cancelled order');
    }
    // PUR-5 (أ): بوابة الاعتماد — الاستلام على APPROVED فقط. الفحص
    // هنا تغذية راجعة سريعة؛ مصدر الحقيقة إعادة القراءة تحت القفل داخل
    // المعاملة أدناه (نفس نمط فحص CANCELLED أعلاه).
    if (order.status !== PurchaseOrderStatus.APPROVED) {
      throw new BadRequestException(
        'أمر الشراء غير معتمد — اعتمده أولًا (الاستلام متاح لأوامر APPROVED فقط)',
      );
    }

    const existing =
      (await this.prisma.purchaseReceiptItem.findMany({
        where: { purchaseOrderItemId: { in: itemIds } },
        select: { purchaseOrderItemId: true, quantity: true },
      })) || [];
    const receivedByItem = new Map<string, number>();
    for (const item of existing) {
      receivedByItem.set(
        item.purchaseOrderItemId,
        (receivedByItem.get(item.purchaseOrderItemId) ?? 0) +
          Number(item.quantity),
      );
    }

    const orderItems = new Map(order.items.map((item) => [item.id, item]));
    for (const item of dto.items) {
      const orderItem = orderItems.get(item.purchaseOrderItemId);
      if (!orderItem) throw new NotFoundException('Item not found in order');
      const alreadyReceived = receivedByItem.get(item.purchaseOrderItemId) ?? 0;
      // PUR-2: مقارنة مقربة لـ4 منازل — كميات كسرية بدون أخطاء فاصلة عائمة
      if (
        round4(alreadyReceived + item.quantity) >
        round4(Number(orderItem.quantity))
      ) {
        throw new BadRequestException(
          `كمية الاستلام تتجاوز المتبقي للبند ${item.purchaseOrderItemId}`,
        );
      }
    }

    const rawWarehouse = await this.prisma.warehouse.findFirst({
      where: { code: 'WH-RAW' },
    });
    if (!rawWarehouse) {
      throw new BadRequestException('Default RAW warehouse not found');
    }

    try {
      return await this.prisma.$transaction(
        async (tx: Prisma.TransactionClient) => {
          // Serialize all receipts for one purchase order. The preflight checks
          // above are only for fast feedback; this lock is the source of truth
          // against two concurrent receipts exceeding the ordered quantity.
          const lockedOrder = await tx.$queryRaw<Array<{ id: string }>>(
            Prisma.sql`SELECT id FROM purchase_orders WHERE id = ${orderId} FOR UPDATE`,
          );
          if (lockedOrder.length === 0) {
            throw new NotFoundException('Purchase order not found');
          }

          const currentOrder = await tx.purchaseOrder.findUnique({
            where: { id: orderId },
            include: { items: true },
          });
          if (!currentOrder) {
            throw new NotFoundException('Purchase order not found');
          }
          if (currentOrder.status === PurchaseOrderStatus.CANCELLED) {
            throw new BadRequestException('Cannot receive a cancelled order');
          }
          // PUR-5 (أ): بوابة الاعتماد داخل المعاملة تحت قفل الصف —
          // مصدر الحقيقة ضد اعتماد/إلغاء متزامن بين الفحص المسبق والكتابة.
          if (currentOrder.status !== PurchaseOrderStatus.APPROVED) {
            throw new BadRequestException(
              'أمر الشراء غير معتمد — اعتمده أولًا (الاستلام متاح لأوامر APPROVED فقط)',
            );
          }

          const currentExisting = await tx.purchaseReceiptItem.findMany({
            where: {
              purchaseOrderItemId: {
                in: currentOrder.items.map((item) => item.id),
              },
            },
            select: { purchaseOrderItemId: true, quantity: true },
          });
          const currentReceivedByItem = new Map<string, number>();
          for (const item of currentExisting) {
            currentReceivedByItem.set(
              item.purchaseOrderItemId,
              (currentReceivedByItem.get(item.purchaseOrderItemId) ?? 0) +
                Number(item.quantity),
            );
          }
          const currentOrderItems = new Map(
            currentOrder.items.map((item) => [item.id, item]),
          );
          for (const item of dto.items) {
            const orderItem = currentOrderItems.get(item.purchaseOrderItemId);
            if (!orderItem) {
              throw new NotFoundException('Item not found in order');
            }
            const alreadyReceived =
              currentReceivedByItem.get(item.purchaseOrderItemId) ?? 0;
            // PUR-2: مقارنة مقربة لـ4 منازل — كميات كسرية بدون أخطاء فاصلة عائمة
            if (
              round4(alreadyReceived + item.quantity) >
              round4(Number(orderItem.quantity))
            ) {
              throw new BadRequestException(
                `كمية الاستلام تتجاوز المتبقي للبند ${item.purchaseOrderItemId}`,
              );
            }
          }

          const receiptIdempotencyKeyId = await createIdempotencyKey(
            tx,
            idempotencyKey,
            scope,
            requestHash,
          );
          const receipt = await tx.purchaseReceipt.create({
            data: {
              code: generateDocumentCode(DocumentCodePrefix.PURCHASE_RECEIPT),
              purchaseOrderId: orderId,
              userId,
              notes: dto.notes,
              idempotencyKeyId: receiptIdempotencyKeyId,
              items: {
                create: dto.items.map((item) => ({
                  purchaseOrderItemId: item.purchaseOrderItemId,
                  quantity: item.quantity,
                })),
              },
            },
            include: { items: true },
          });

          let receiptTotal = 0;
          for (const item of dto.items) {
            const orderItem = currentOrderItems.get(item.purchaseOrderItemId);
            if (!orderItem) {
              throw new NotFoundException('Item not found in order');
            }
            // PUR-1: مبلغ مالي مقرب لمنزلتين قبل ترحيله للقيد والدائن
            receiptTotal = round2(
              receiptTotal + item.quantity * Number(orderItem.unitCost),
            );
            await this.inventoryService.receive(
              {
                rawMaterialId: orderItem.rawMaterialId,
                warehouseId: rawWarehouse.id,
                quantity: item.quantity,
                unitCost: Number(orderItem.unitCost),
                reference: receipt.code,
                notes: `استلام ${receipt.code} من أمر الشراء ${currentOrder.code}`,
              },
              userId,
              tx,
            );
          }

          await this.financialPosting.postJournalEntryInTx(
            tx,
            {
              description: `استلام مشتريات ${receipt.code}`,
              reference: receipt.code,
              isAuto: true,
              lines: [
                {
                  debitAccountId: CHART_OF_ACCOUNTS.INVENTORY,
                  creditAccountId: CHART_OF_ACCOUNTS.ACCOUNTS_PAYABLE,
                  amount: receiptTotal,
                  description: `إثبات مخزون مقابل مورد ${currentOrder.supplierId}`,
                },
              ],
              supplierUpdates: [
                { supplierId: currentOrder.supplierId, delta: receiptTotal },
              ],
              metadata: {
                source: 'PURCHASE_RECEIPT',
                purchaseReceiptId: receipt.id,
              },
              postingKey: `purchasing.grn:${receipt.id}`,
            },
            userId,
          );

          const allReceived = currentOrder.items.every((item) => {
            const previous = currentReceivedByItem.get(item.id) ?? 0;
            const current =
              dto.items.find(
                (receiptItem) => receiptItem.purchaseOrderItemId === item.id,
              )?.quantity ?? 0;
            // PUR-2: مقارنة مقربة لـ4 منازل (مثل 0.1+0.2 مقابل 0.3)
            return round4(previous + current) >= round4(Number(item.quantity));
          });

          // SEC-F02: audit trail for purchase receipt (financial impact).
          await tx.activityLog.create({
            data: {
              userId,
              action: 'PURCHASE_RECEIPT_CREATED',
              module: 'PURCHASING',
              details: {
                purchaseReceiptId: receipt.id,
                code: receipt.code,
                purchaseOrderId: orderId,
                supplierId: currentOrder.supplierId,
                receiptTotal,
                itemsCount: dto.items.length,
                allReceived,
              },
            },
          });

          // PUR-6 (ب) (P2 — GF-IMP-W3) — قرار النموذج الميت الموثق:
          // نموذج SupplierPayment ميت بلا أي استخدام في الكود كله (لا
          // seed ولا مسار API يكتبه)، وحقل PurchaseOrder.paidAmount كان
          // يُكتب أبدًا فيبقى صفرًا للأوامر المستلمة كلها. بلا تغيير schema
          // (مقرر في هذه الموجة) نفّذنا الأصح عمليًا: paidAmount يتتبع
          // قيمة الاستلام التراكمية (Σ الكميات المستلمة × تكلفة وحدة
          // البند) — وهي نفس القيمة المُرحّلة للدائن (Cr ACCOUNTS_PAYABLE)
          // عند كل استلام، فتصبح مرآة صادقة لما «تحمّله» المورد على هذا
          // الأمر. تحذير دلالي موثق: الاسم paidAmount لا يعني نقدًا مدفوعًا
          // فعليًا للمورد — لا يوجد مسار دفع نقدي بعد؛ عند إضافة مسار دفع
          // مورد مستقبلي يُفعَّل نموذج SupplierPayment (يوجد بكل علاقاته
          // جاهزًا: supplier/purchaseOrderId/amount/date/notes) ويُعاد ضبط
          // دلالة الحقل آنذاك (مدفوع فعليًا = Σ SupplierPayment.amount) مع
          // هجرة تسوية للقيم القائمة — لا يحذف النموذج بلا schema change
          // كما نص البند.
          const previousReceivedValue = round2(
            currentOrder.items.reduce(
              (sum, item) =>
                sum +
                (currentReceivedByItem.get(item.id) ?? 0) *
                  Number(item.unitCost),
              0,
            ),
          );
          const cumulativeReceivedValue = round2(
            previousReceivedValue + receiptTotal,
          );

          await tx.purchaseOrder.update({
            where: { id: orderId },
            data: {
              // PUR-5 (أ): الاستلام الجزئي يُبقي الأمر APPROVED (وليس
              // PENDING) — بوابة الاستلام أعلاه تقبل APPROVED فقط، فلو
              // رجعنا إلى PENDING لاستلام جزئي ثانٍ لحُجب ببابه الخاص.
              // PENDING تظل قيمة تراثية تُقرأ ولا تُكتب في هذه المسارات.
              status: allReceived
                ? PurchaseOrderStatus.RECEIVED
                : PurchaseOrderStatus.APPROVED,
              // PUR-6 (ب): قيمة الاستلام التراكمية داخل نفس المعاملة —
              // أي فشل لاحق يرجع الكتابة كلها فلا ينفصل المبلغ عن الاستلام.
              paidAmount: cumulativeReceivedValue,
            },
          });

          await storeIdempotencyResponse(tx, idempotencyKey, {
            id: receipt.id,
            code: receipt.code,
          });
          return receipt;
        },
      );
    } catch (error) {
      if (isIdempotencyUniqueViolation(error) && idempotencyKey) {
        const replayed = await tryReplayIdempotencyKey(
          this.prisma,
          idempotencyKey,
          scope,
          requestHash,
        );
        if (replayed) return replayed;
      }
      throw error;
    }
  }

  async receiveOrder(orderId: string, userId: string) {
    const order = await this.prisma.purchaseOrder.findUnique({
      where: { id: orderId },
      include: { items: true },
    });

    if (!order) throw new NotFoundException('Purchase order not found');

    // 1. Safe rejection for final states before unnecessary queries
    if (order.status === PurchaseOrderStatus.RECEIVED) {
      throw new BadRequestException('Order is already fully received');
    }
    if (order.status === PurchaseOrderStatus.CANCELLED) {
      throw new BadRequestException('Cannot receive a cancelled order');
    }
    // PUR-5 (أ): بوابة الاعتماد للمسار القديم — نفس رسالة createReceipt
    // (المسار يحوّل لاحقًا إلى createIntent الذي يعيد الفحص تحت القفل).
    if (order.status !== PurchaseOrderStatus.APPROVED) {
      throw new BadRequestException(
        'أمر الشراء غير معتمد — اعتمده أولًا (الاستلام متاح لأوامر APPROVED فقط)',
      );
    }

    // 2. Fetch existing receipts to calculate remaining quantities
    // Use fallback to empty array to handle potential mock issues in tests
    const existingItems =
      (await this.prisma.purchaseReceiptItem.findMany({
        where: { purchaseOrderItemId: { in: order.items.map((i) => i.id) } },
      })) || [];

    const receivedMap = new Map<string, number>();
    existingItems.forEach((ei) => {
      receivedMap.set(
        ei.purchaseOrderItemId,
        (receivedMap.get(ei.purchaseOrderItemId) ?? 0) + Number(ei.quantity),
      );
    });

    const itemsToReceive = order.items
      .map((item) => ({
        purchaseOrderItemId: item.id,
        // PUR-2: الباقي مقرب لـ4 منازل — كميات كسرية بلا كسور فاصلة عائمة
        quantity: round4(
          Number(item.quantity) - (receivedMap.get(item.id) ?? 0),
        ),
      }))
      .filter((item) => item.quantity > 0);

    if (itemsToReceive.length === 0) {
      throw new BadRequestException('All items are already received');
    }

    const dto: CreatePurchaseReceiptDto = {
      items: itemsToReceive,
      notes: `استلام كامل (legacy) لأمر الشراء ${order.code}`,
    };

    // Derive the legacy key from the remaining quantities. A key based only on
    // orderId would replay an earlier legacy receipt after a later partial receipt.
    const remainingHash = computeRequestHash({
      operation: 'purchasing.legacy-receive',
      orderId,
      items: itemsToReceive,
    }).slice(0, 16);
    const idempotencyKey = `legacy-receive-${order.id}-${remainingHash}`;

    return this.createReceipt(orderId, dto, userId, idempotencyKey);
  }

  /**
   * PUR-5 (أ) (P1 — GF-IMP-W2): خطوة اعتماد لأمر الشراء.
   *
   * - **فصل الواجبات (SoD):** رافض الاعتماد هو منشئ الأمر نفسه → 409
   *   برسالة عربية قبل أي أثر (نفس نمط SAL-4 في sales.confirmOrder).
   * - **الانتقال الوحيد:** DRAFT → APPROVED فقط، عبر updateMany مشروط
   *   بالحالة DRAFT (CAS) — صفر صفوف متأثرة → 409 عربية توضح الحالة
   *   المقروءة (أو تغيّرها بالتزامن). لا يوجد مسار PENDING → APPROVED:
   *   PENDING أصبحت قيمة تراثية لا تُكتب بعد بوابة الاستلام أدناه
   *   (الاستلام الجزئي يُبقي الأمر APPROVED حتى الاكتمال → RECEIVED).
   * - **التدقيق:** ActivityLog (PURCHASE_ORDER_APPROVED) بالفاعل داخل
   *   نفس المعاملة.
   * - **Idempotency:** كامل النمط القياسي (scope: purchase-order-approve).
   *
   * الأدوار (المتحكم): INVENTORY_MANAGER أو GENERAL_MANAGER — نفس أدوار
   * الإلغاء والاستلام؛ المنشئ نفسه يُحجب هنا بفصل الواجبات.
   */
  async approvePurchaseOrder(
    orderId: string,
    userId: string,
    idempotencyKey?: string,
  ) {
    const scope = 'purchase-order-approve';
    const requestHash = computeRequestHash({
      operation: scope,
      orderId,
      userId,
    });
    const replay = await tryReplayIdempotencyKey(
      this.prisma,
      idempotencyKey,
      scope,
      requestHash,
    );
    if (replay) return replay;

    try {
      return await this.prisma.$transaction(async (tx) => {
        await createIdempotencyKey(tx, idempotencyKey, scope, requestHash);
        const order = await tx.purchaseOrder.findUnique({
          where: { id: orderId },
          select: {
            id: true,
            code: true,
            status: true,
            totalAmount: true,
            supplierId: true,
            // حقل المنشئ في نموذج PurchaseOrder هو userId (علاقة user)
            userId: true,
          },
        });
        if (!order) throw new NotFoundException('Purchase order not found');

        // PUR-5 (أ): فصل الواجبات — منشئ الأمر لا يعتمده بنفسه (409)
        // قبل أي كتابة أو تدقيق.
        if (order.userId === userId) {
          throw new ConflictException(
            'لا يمكن لمنشئ أمر الشراء اعتماده بنفسه (فصل الواجبات)',
          );
        }

        // CAS: الانتقال DRAFT → APPROVED فقط — صفر صفوف = الحالة ليست
        // DRAFT (أو تغيّرت بالتزامن) → 409 توضّح الحالة المقروءة.
        const transition = await tx.purchaseOrder.updateMany({
          where: { id: orderId, status: PurchaseOrderStatus.DRAFT },
          data: { status: PurchaseOrderStatus.APPROVED },
        });
        if (transition.count !== 1) {
          throw new ConflictException(
            `تعذر اعتماد أمر الشراء — حالته الحالية «${order.status}» وليست DRAFT (أو تغيّرت بالتزامن)`,
          );
        }

        const approved = await tx.purchaseOrder.findUnique({
          where: { id: orderId },
        });
        await tx.activityLog.create({
          data: {
            userId,
            action: 'PURCHASE_ORDER_APPROVED',
            module: 'PURCHASING',
            details: {
              purchaseOrderId: orderId,
              code: order.code,
              supplierId: order.supplierId,
              totalAmount: Number(order.totalAmount ?? 0),
              approvedBy: userId,
              previousStatus: PurchaseOrderStatus.DRAFT,
              newStatus: PurchaseOrderStatus.APPROVED,
            },
          },
        });
        await storeIdempotencyResponse(tx, idempotencyKey, approved);
        return approved;
      });
    } catch (error) {
      if (idempotencyKey && isIdempotencyUniqueViolation(error)) {
        const replayed = await tryReplayIdempotencyKey(
          this.prisma,
          idempotencyKey,
          scope,
          requestHash,
        );
        if (replayed) return replayed;
      }
      throw error;
    }
  }

  /**
   * PUR-5 (ب) (P1 — GF-IMP-W2): إلغاء أمر شراء مسودة.
   *
   * مقصور على DRAFT (400 لغيرها): أمر عليه استلامات أو مدفوعات لا يُلغى —
   * يُعالَج بالمرتجعات/السندات العكسية لأن آثاره المالية والمخزونية مرحّلة
   * فعلًا. الانتقال ذري (updateMany مشروط بالحالة) + ActivityLog +
   * idempotency كامل النمط (نفس مفتاح = نفس الاستجابة، محتوى مختلف = 409).
   *
   * ملاحظة (الجزء (أ) من PUR-5): مسار الاعتماد DRAFT → APPROVED نُفِّذ
   * أعلاه (approvePurchaseOrder) بعد إضافة قيمة APPROVED إلى
   * PurchaseOrderStatus في الهجرة الموحدة 20260906100000_wave2_unified —
   * كان معلقًا في W2-2b بحكم المخطط.
   */
  async cancelPurchaseOrder(
    orderId: string,
    userId: string,
    idempotencyKey?: string,
  ) {
    const scope = 'purchasing-order-cancel';
    const requestHash = computeRequestHash({
      operation: scope,
      orderId,
      userId,
    });
    const replay = await tryReplayIdempotencyKey(
      this.prisma,
      idempotencyKey,
      scope,
      requestHash,
    );
    if (replay) return replay;

    try {
      return await this.prisma.$transaction(async (tx) => {
        await createIdempotencyKey(tx, idempotencyKey, scope, requestHash);
        const order = await tx.purchaseOrder.findUnique({
          where: { id: orderId },
          select: {
            id: true,
            code: true,
            status: true,
            totalAmount: true,
            supplierId: true,
          },
        });
        if (!order) throw new NotFoundException('Purchase order not found');
        if (order.status !== PurchaseOrderStatus.DRAFT) {
          throw new BadRequestException(
            'لا يمكن إلغاء إلا أمر شراء بحالة DRAFT — الأوامر المستلمة تُعالج بالمرتجعات',
          );
        }
        const transition = await tx.purchaseOrder.updateMany({
          where: { id: orderId, status: PurchaseOrderStatus.DRAFT },
          data: { status: PurchaseOrderStatus.CANCELLED },
        });
        if (transition.count !== 1) {
          throw new ConflictException('تم تغيير أمر الشراء بالتزامن');
        }
        const cancelled = await tx.purchaseOrder.findUnique({
          where: { id: orderId },
        });
        // PUR-5 (ب): سجل تدقيق للإلغاء داخل نفس المعاملة.
        await tx.activityLog.create({
          data: {
            userId,
            action: 'PURCHASE_ORDER_CANCELLED',
            module: 'PURCHASING',
            details: {
              purchaseOrderId: orderId,
              code: order.code,
              supplierId: order.supplierId,
              totalAmount: Number(order.totalAmount ?? 0),
            },
          },
        });
        await storeIdempotencyResponse(tx, idempotencyKey, cancelled);
        return cancelled;
      });
    } catch (error) {
      if (idempotencyKey && isIdempotencyUniqueViolation(error)) {
        const replayed = await tryReplayIdempotencyKey(
          this.prisma,
          idempotencyKey,
          scope,
          requestHash,
        );
        if (replayed) return replayed;
      }
      throw error;
    }
  }

  async returnToSupplier(
    orderId: string,
    dto: ReturnToSupplierDto,
    userId: string,
    idempotencyKey?: string,
  ) {
    const requestHash = computeRequestHash({
      orderId,
      dto,
      userId,
    });
    const scope = 'purchasing-return-create';

    const replay = await tryReplayIdempotencyKey(
      this.prisma,
      idempotencyKey,
      scope,
      requestHash,
    );
    if (replay) return replay;

    const order = await this.prisma.purchaseOrder.findUnique({
      where: { id: orderId },
      include: { items: true },
    });

    if (!order) throw new NotFoundException('Purchase order not found');

    // Safe rejection for invalid states before unnecessary queries
    if (order.status === PurchaseOrderStatus.CANCELLED) {
      throw new BadRequestException('Cannot return from a cancelled order');
    }
    if (order.status === PurchaseOrderStatus.DRAFT) {
      throw new BadRequestException('Cannot return from a draft order');
    }

    const item = order.items.find((i) => i.id === dto.purchaseOrderItemId);
    if (!item) throw new NotFoundException('Item not found in order');

    const rawWarehouse = await this.prisma.warehouse.findFirst({
      where: { code: 'WH-RAW' },
    });
    if (!rawWarehouse)
      throw new BadRequestException('Default RAW warehouse not found');

    try {
      return await this.prisma.$transaction(
        async (tx: Prisma.TransactionClient) => {
          // Serialize returns for one purchase order before calculating the
          // cumulative returned quantity. This prevents two distinct keys from
          // both passing the limit check concurrently.
          const lockedOrder = await tx.$queryRaw<Array<{ id: string }>>(
            Prisma.sql`SELECT id FROM purchase_orders WHERE id = ${orderId} FOR UPDATE`,
          );
          if (lockedOrder.length === 0) {
            throw new NotFoundException('Purchase order not found');
          }

          await createIdempotencyKey(tx, idempotencyKey, scope, requestHash);

          // 1. Calculate cumulative received quantity
          const receipts = await tx.purchaseReceiptItem.aggregate({
            where: { purchaseOrderItemId: dto.purchaseOrderItemId },
            _sum: { quantity: true },
          });
          const totalReceived = Number(receipts._sum.quantity ?? 0);

          // 2. Calculate cumulative returned quantity
          // We use the reference field as a matchable anchor since the schema lacks a dedicated return table
          const referenceAnchor = `PURCHASE_RETURN_ITEM:${dto.purchaseOrderItemId}`;

          // PUR-4 (P1 — GF-IMP-W2): كود مرتجع مستقر يعرّف عملية المرتجع
          // الواحدة عبر كل السجلات (reference حركة المخزون + reference القيد
          // + metadata القيد + ActivityLog) بدل الذيل غير المستقر السابق
          // (idempotencyKeyId أو 'manual').
          //
          // صيغة الـ reference الموحدة:
          //   PURCHASE_RETURN_ITEM:<purchaseOrderItemId>:supplier-return:<uuid>
          // البادئة PURCHASE_RETURN_ITEM:<purchaseOrderItemId> يظل مطابقًا
          // حرفيًا لتجميع الكمية المرتجعة القائم أعلاه (startsWith) فلا ينكسر
          // أي نص قائم.
          //
          // حدود التمثيل النصي (توثيق عربي مقصود): لا يوجد نموذج
          // SupplierReturn في schema.prisma، فيُمثَّل المرتجع نصيًا في
          // reference/metadata فقط — أي استعلام تحليلي للمرتجعات يعتمد على
          // المطابقة النصية لا على جدول علائقي. الترقية لنموذج SupplierReturn
          // حقيقي (كميات/مبالغ/مورد/فترة/حالة) موصى بها — PUR-4 المرحلة
          // الثانية (تتطلب schema change خارج نطاق هذه الموجة).
          const returnCode = `supplier-return:${randomUUID()}`;
          const returnReference = `${referenceAnchor}:${returnCode}`;

          const returns = await tx.stockLedgerEntry.aggregate({
            where: {
              rawMaterialId: item.rawMaterialId,
              reference: { startsWith: referenceAnchor },
            },
            _sum: { quantityDelta: true },
          });
          const totalReturned = Math.abs(
            Number(returns._sum.quantityDelta ?? 0),
          );

          // PUR-2: مقارنة مقربة لـ4 منازل — الاستلام صار كسريًا فيجب تحصين
          // جمع المرتجعات والمستلم من أخطاء الفاصلة العائمة
          if (round4(totalReturned + dto.quantity) > round4(totalReceived)) {
            throw new BadRequestException(
              `الكمية المرتجعة (${round4(totalReturned + dto.quantity)}) تتجاوز الكمية المستلمة (${round4(totalReceived)})`,
            );
          }

          // 3. Issue items from inventory
          // Note: We use the referenceAnchor to allow cumulative tracking
          const result = await this.inventoryService.issue(
            {
              rawMaterialId: item.rawMaterialId,
              warehouseId: rawWarehouse.id,
              quantity: dto.quantity,
              reference: returnReference,
              notes: dto.notes ?? `مرتجع للمورد من أمر الشراء ${order.code}`,
              idempotencyKey: idempotencyKey
                ? `return-${idempotencyKey}`
                : undefined,
            },
            userId,
            tx,
          );

          const returnTotal = dto.quantity * Number(item.unitCost);
          await this.financialPosting.postJournalEntryInTx(
            tx,
            {
              description: `مرتجع مشتريات ${order.code}`,
              reference: returnReference,
              isAuto: true,
              lines: [
                {
                  debitAccountId: CHART_OF_ACCOUNTS.ACCOUNTS_PAYABLE,
                  creditAccountId: CHART_OF_ACCOUNTS.INVENTORY,
                  amount: returnTotal,
                  description: `عكس قيمة مرتجع المورد من أمر الشراء ${order.code}`,
                },
              ],
              supplierUpdates: [
                { supplierId: order.supplierId, delta: -returnTotal },
              ],
              metadata: {
                source: 'PURCHASE_RETURN',
                purchaseOrderId: orderId,
                purchaseOrderItemId: item.id,
                // PUR-4: الكود المستقر + المجاميع الجوهرية في metadata القيد
                returnCode,
                returnQuantity: dto.quantity,
                returnAmount: returnTotal,
                inventoryEntryCode: result.entryCode,
              },
              postingKey: idempotencyKey
                ? `purchasing.return:${idempotencyKey}`
                : undefined,
            },
            userId,
          );

          // PUR-4 (ب): سجل تدقيق داخل نفس معاملة المرتجع — كان المسار كله
          // بلا ActivityLog (المبالغ والبنود والفاعل).
          await tx.activityLog.create({
            data: {
              userId,
              action: 'SUPPLIER_RETURN_CREATED',
              module: 'PURCHASING',
              details: {
                returnCode,
                purchaseOrderId: orderId,
                purchaseOrderItemId: item.id,
                rawMaterialId: item.rawMaterialId,
                quantity: dto.quantity,
                amount: returnTotal,
                journalReference: returnReference,
                inventoryEntryCode: result.entryCode,
              },
            },
          });

          const response = {
            success: true,
            message: 'Return processed',
            entryCode: result.entryCode,
          };

          if (idempotencyKey) {
            await storeIdempotencyResponse(tx, idempotencyKey, response);
          }

          return response;
        },
      );
    } catch (error) {
      if (isIdempotencyUniqueViolation(error) && idempotencyKey) {
        const replayed = await tryReplayIdempotencyKey(
          this.prisma,
          idempotencyKey,
          scope,
          requestHash,
        );
        if (replayed) return replayed;
      }
      throw error;
    }
  }
}
