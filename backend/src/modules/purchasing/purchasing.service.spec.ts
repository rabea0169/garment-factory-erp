/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
import { PurchasingService } from './purchasing.service';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { createPrismaMock } from '../../../test/helpers/prisma-mock';
import { PaymentType, PurchaseOrderStatus } from '@prisma/client';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { computeRequestHash } from '../../core/common/idempotency.util';
import { FinancialPostingService } from '../../core/financial/financial-posting.service';

describe('PurchasingService (GF-0009)', () => {
  let service: PurchasingService;
  let prisma: ReturnType<typeof createPrismaMock>;
  let inventoryService: { receive: jest.Mock };
  let financialPosting: { postJournalEntryInTx: jest.Mock };

  beforeEach(() => {
    prisma = createPrismaMock();
    prisma.$queryRaw.mockResolvedValue([{ id: 'po-1' }]);

    // PUR-5 (GF-IMP-W2): purchaseOrder.updateMany غير موجودة في
    // prisma-mock المشترك — توسعة محلية (نمط W1-C) بدل تعديل مساعد مشترك.
    (prisma.purchaseOrder as unknown as { updateMany: jest.Mock }).updateMany =
      jest.fn().mockResolvedValue({ count: 1 });

    // SEC-F02 + RES-F02: $transaction must invoke the callback with the
    // prisma mock so the inner tx.purchaseOrder.create / tx.activityLog.create
    // calls resolve against the same mocked model objects.
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
    );

    inventoryService = { receive: jest.fn() };
    financialPosting = { postJournalEntryInTx: jest.fn() };
    prisma.supplier.findFirst.mockResolvedValue({ id: 'sup-1' });

    service = new PurchasingService(
      prisma as unknown as PrismaService,
      inventoryService as unknown as InventoryService,
      financialPosting as unknown as FinancialPostingService,
    );
  });

  describe('createPurchaseOrder', () => {
    it('should create order and items', async () => {
      const dto = {
        supplierId: 'sup-1',
        paymentType: PaymentType.CASH,
        items: [{ rawMaterialId: 'rm-1', quantity: 10, unitCost: 5 }],
      };

      prisma.purchaseOrder.create.mockResolvedValue({ id: 'po-1', ...dto });

      const res = await service.createPurchaseOrder(dto, 'user-1');
      expect((res as { id: string }).id).toBe('po-1');

      expect(prisma.purchaseOrder.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-1',
            status: PurchaseOrderStatus.DRAFT,
            totalAmount: 50,
          }),
        }),
      );
    });

    it('PUR-1: يقرب المجموع لمنزلتين عشريتين و totalCost لكل بند (لا كسور فاصلة عائمة خامّة)', async () => {
      const dto = {
        supplierId: 'sup-1',
        paymentType: PaymentType.CASH,
        items: [
          // 10.555 × 3.33 = 35.14815 → 35.15
          { rawMaterialId: 'rm-1', quantity: 10.555, unitCost: 3.33 },
          // 2.5 × 4.44 = 11.1
          { rawMaterialId: 'rm-2', quantity: 2.5, unitCost: 4.44 },
        ],
      };

      prisma.purchaseOrder.create.mockResolvedValue({ id: 'po-1', ...dto });

      await service.createPurchaseOrder(dto, 'user-1');

      // المجموع الخام = 46.24815 → round2 = 46.25
      expect(prisma.purchaseOrder.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            totalAmount: 46.25,
            items: {
              create: [
                expect.objectContaining({ totalCost: 35.15 }),
                expect.objectContaining({ totalCost: 11.1 }),
              ],
            },
          }),
        }),
      );
    });

    it('PUR-3: يرفض موردًا غير موجود داخل المعاملة قبل إنشاء الأمر', async () => {
      const dto = {
        supplierId: 'sup-missing',
        paymentType: PaymentType.CASH,
        items: [{ rawMaterialId: 'rm-1', quantity: 10, unitCost: 5 }],
      };
      prisma.supplier.findFirst.mockResolvedValue(null);

      await expect(
        service.createPurchaseOrder(dto, 'user-1', 'po-key-1'),
      ).rejects.toThrow('المورد غير موجود');
      expect(prisma.purchaseOrder.create).not.toHaveBeenCalled();
    });

    it('PUR-3: نفس المفتاح + نفس المحتوى يعيد نفس الاستجابة بلا أمر ثانٍ (replay)', async () => {
      const dto = {
        supplierId: 'sup-1',
        paymentType: PaymentType.CASH,
        items: [{ rawMaterialId: 'rm-1', quantity: 10, unitCost: 5 }],
      };
      const stored = { id: 'po-replayed', code: 'PO-R', items: [] };
      prisma.idempotencyKey.findUnique.mockResolvedValue({
        key: 'po-key-replay',
        scope: 'purchase-order-create',
        requestHash: computeRequestHash({
          operation: 'purchase-order-create',
          creatorId: 'user-1',
          supplierId: dto.supplierId,
          paymentType: dto.paymentType,
          dueDate: null,
          notes: null,
          items: dto.items,
        }),
        response: stored,
      });

      const result = await service.createPurchaseOrder(
        dto,
        'user-1',
        'po-key-replay',
      );

      expect(result).toEqual({ ...stored, replayed: true });
      expect(prisma.purchaseOrder.create).not.toHaveBeenCalled();
    });

    it('PUR-3: نفس المفتاح + بصمة مختلفة → 409 (ConflictException)', async () => {
      const dto = {
        supplierId: 'sup-1',
        paymentType: PaymentType.CASH,
        items: [{ rawMaterialId: 'rm-1', quantity: 10, unitCost: 5 }],
      };
      prisma.idempotencyKey.findUnique.mockResolvedValue({
        key: 'po-key-conflict',
        scope: 'purchase-order-create',
        requestHash: computeRequestHash({
          operation: 'purchase-order-create',
          creatorId: 'user-1',
          supplierId: 'sup-1',
          paymentType: PaymentType.CREDIT,
          dueDate: null,
          notes: null,
          items: [{ rawMaterialId: 'rm-2', quantity: 1, unitCost: 99 }],
        }),
        response: { id: 'po-1' },
      });

      await expect(
        service.createPurchaseOrder(dto, 'user-1', 'po-key-conflict'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.purchaseOrder.create).not.toHaveBeenCalled();
    });

    it('PUR-3: ينشئ مفتاح idempotency داخل المعاملة ويخزن الاستجابة', async () => {
      const dto = {
        supplierId: 'sup-1',
        paymentType: PaymentType.CASH,
        items: [{ rawMaterialId: 'rm-1', quantity: 10, unitCost: 5 }],
      };
      prisma.idempotencyKey.findUnique.mockResolvedValue(null);
      prisma.idempotencyKey.create.mockResolvedValue({ id: 'idem-po' });
      prisma.purchaseOrder.create.mockResolvedValue({ id: 'po-1' });

      await service.createPurchaseOrder(dto, 'user-1', 'po-key-new');

      expect(prisma.idempotencyKey.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          key: 'po-key-new',
          scope: 'purchase-order-create',
        }),
        select: { id: true },
      });
      expect(prisma.idempotencyKey.update).toHaveBeenCalledWith({
        where: { key: 'po-key-new' },
        data: { response: expect.anything() },
      });
    });
  });

  describe('createReceipt', () => {
    it('ينشئ إذن استلام جزئيًا ويرسل الكمية المستلمة فقط إلى المخزون', async () => {
      // PUR-5 (أ): الاستلام أصبح على أوامر APPROVED فقط — الحالة المسبقة
      // للإعداد تُهيّأ APPROVED بدل PENDING (نفس التعديل بكل مواصفات الاستلام).
      prisma.purchaseOrder.findUnique.mockResolvedValue({
        id: 'po-1',
        code: 'PO-100',
        status: PurchaseOrderStatus.APPROVED,
        items: [
          { id: 'poi-1', rawMaterialId: 'rm-1', quantity: 10, unitCost: 5 },
        ],
      });
      prisma.purchaseReceiptItem.findMany.mockResolvedValue([]);
      prisma.warehouse.findFirst.mockResolvedValue({ id: 'wh-raw' });
      prisma.$transaction.mockImplementation(async (cb) => cb(prisma));
      prisma.purchaseReceipt.create.mockResolvedValue({
        id: 'grn-1',
        code: 'GRN-100',
        items: [{ purchaseOrderItemId: 'poi-1', quantity: 4 }],
      });
      prisma.purchaseOrder.update.mockResolvedValue({
        status: PurchaseOrderStatus.APPROVED,
      });

      const result = await service.createReceipt(
        'po-1',
        { items: [{ purchaseOrderItemId: 'poi-1', quantity: 4 }] },
        'user-1',
      );

      expect((result as { id: string }).id).toBe('grn-1');
      expect(inventoryService.receive).toHaveBeenCalledWith(
        expect.objectContaining({ rawMaterialId: 'rm-1', quantity: 4 }),
        'user-1',
        prisma,
      );
      expect(prisma.purchaseOrder.update).toHaveBeenCalledWith({
        where: { id: 'po-1' },
        // PUR-5 (أ): الاستلام الجزئي يُبقي الأمر APPROVED (لم يعد PENDING)
        data: { status: PurchaseOrderStatus.APPROVED },
      });
    });

    it('يربط Idempotency-Key بإذن الاستلام ويخزن الاستجابة داخل transaction', async () => {
      prisma.purchaseOrder.findUnique.mockResolvedValue({
        id: 'po-1',
        code: 'PO-100',
        status: PurchaseOrderStatus.APPROVED,
        items: [
          { id: 'poi-1', rawMaterialId: 'rm-1', quantity: 10, unitCost: 5 },
        ],
      });
      prisma.purchaseReceiptItem.findMany.mockResolvedValue([]);
      prisma.warehouse.findFirst.mockResolvedValue({ id: 'wh-raw' });
      prisma.$transaction.mockImplementation(async (cb) => cb(prisma));
      prisma.idempotencyKey.create.mockResolvedValue({ id: 'idem-1' });
      prisma.purchaseReceipt.create.mockResolvedValue({
        id: 'grn-1',
        code: 'GRN-100',
        items: [{ purchaseOrderItemId: 'poi-1', quantity: 4 }],
      });
      prisma.purchaseOrder.update.mockResolvedValue({
        status: PurchaseOrderStatus.APPROVED,
      });

      await service.createReceipt(
        'po-1',
        { items: [{ purchaseOrderItemId: 'poi-1', quantity: 4 }] },
        'user-1',
        'receipt-key',
      );

      expect(prisma.idempotencyKey.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          key: 'receipt-key',
          scope: 'purchasing-receipt-create',
        }),
        select: { id: true },
      });
      expect(prisma.purchaseReceipt.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ idempotencyKeyId: 'idem-1' }),
        include: { items: true },
      });
      expect(prisma.idempotencyKey.update).toHaveBeenCalledWith({
        where: { key: 'receipt-key' },
        data: { response: expect.anything() },
      });
    });

    it('يعيد replay لإذن الاستلام دون إنشاء receipt جديد', async () => {
      const dto = { items: [{ purchaseOrderItemId: 'poi-1', quantity: 4 }] };
      const key = 'receipt-replay-key';
      prisma.idempotencyKey.findUnique.mockResolvedValue({
        key,
        scope: 'purchasing-receipt-create',
        requestHash: computeRequestHash({
          orderId: 'po-1',
          items: dto.items,
          notes: null,
          userId: 'user-1',
        }),
        response: { id: 'grn-1', code: 'GRN-100' },
      });

      const result = await service.createReceipt('po-1', dto, 'user-1', key);

      expect(result).toEqual({
        id: 'grn-1',
        code: 'GRN-100',
        replayed: true,
      });
      expect(prisma.purchaseOrder.findUnique).not.toHaveBeenCalled();
      expect(prisma.purchaseReceipt.create).not.toHaveBeenCalled();
    });

    it('يرفض الاستلام الذي يتجاوز كمية أمر الشراء', async () => {
      prisma.purchaseOrder.findUnique.mockResolvedValue({
        id: 'po-1',
        status: PurchaseOrderStatus.APPROVED,
        items: [
          { id: 'poi-1', rawMaterialId: 'rm-1', quantity: 10, unitCost: 5 },
        ],
      });
      prisma.purchaseReceiptItem.findMany.mockResolvedValue([]);

      await expect(
        service.createReceipt(
          'po-1',
          { items: [{ purchaseOrderItemId: 'poi-1', quantity: 11 }] },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.purchaseReceipt.create).not.toHaveBeenCalled();
    });

    it('PUR-2: يقبل استلام 2.5 وحدة على بند أمر كمية 3 (كميات كسرية)', async () => {
      prisma.purchaseOrder.findUnique.mockResolvedValue({
        id: 'po-1',
        code: 'PO-100',
        status: PurchaseOrderStatus.APPROVED,
        items: [
          { id: 'poi-1', rawMaterialId: 'rm-1', quantity: 3, unitCost: 5 },
        ],
      });
      prisma.purchaseReceiptItem.findMany.mockResolvedValue([]);
      prisma.warehouse.findFirst.mockResolvedValue({ id: 'wh-raw' });
      prisma.$transaction.mockImplementation(async (cb) => cb(prisma));
      prisma.purchaseReceipt.create.mockResolvedValue({
        id: 'grn-frac',
        code: 'GRN-200',
        items: [{ purchaseOrderItemId: 'poi-1', quantity: 2.5 }],
      });
      prisma.purchaseOrder.update.mockResolvedValue({
        status: PurchaseOrderStatus.APPROVED,
      });

      const result = await service.createReceipt(
        'po-1',
        { items: [{ purchaseOrderItemId: 'poi-1', quantity: 2.5 }] },
        'user-1',
      );

      expect((result as { id: string }).id).toBe('grn-frac');
      // الكمية الكسرية تمر للمخزون كما هي
      expect(inventoryService.receive).toHaveBeenCalledWith(
        expect.objectContaining({ rawMaterialId: 'rm-1', quantity: 2.5 }),
        'user-1',
        prisma,
      );
    });

    it('PUR-2: مقارنة البواقي الكسرية محصّنة من أخطاء الفاصلة العائمة (0.1+0.2 مقابل 0.3)', async () => {
      prisma.purchaseOrder.findUnique.mockResolvedValue({
        id: 'po-1',
        code: 'PO-100',
        status: PurchaseOrderStatus.APPROVED,
        items: [
          { id: 'poi-1', rawMaterialId: 'rm-1', quantity: 0.3, unitCost: 10 },
        ],
      });
      // مستلم مسبقًا 0.1 — استلام 0.2 يكمل الكمية تمامًا
      // (المجموع الخام 0.3000000000000004 > 0.3 كان سيرفض خطأً)
      prisma.purchaseReceiptItem.findMany.mockResolvedValue([
        { purchaseOrderItemId: 'poi-1', quantity: 0.1 },
      ]);
      prisma.warehouse.findFirst.mockResolvedValue({ id: 'wh-raw' });
      prisma.$transaction.mockImplementation(async (cb) => cb(prisma));
      prisma.purchaseReceipt.create.mockResolvedValue({
        id: 'grn-complete',
        code: 'GRN-201',
        items: [{ purchaseOrderItemId: 'poi-1', quantity: 0.2 }],
      });
      prisma.purchaseOrder.update.mockResolvedValue({
        status: PurchaseOrderStatus.RECEIVED,
      });

      const result = await service.createReceipt(
        'po-1',
        { items: [{ purchaseOrderItemId: 'poi-1', quantity: 0.2 }] },
        'user-1',
      );

      expect((result as { id: string }).id).toBe('grn-complete');
      // اكتمال الكمية معترف به رغم كسر الفاصلة العائمة → الحالة RECEIVED
      expect(prisma.purchaseOrder.update).toHaveBeenCalledWith({
        where: { id: 'po-1' },
        data: { status: PurchaseOrderStatus.RECEIVED },
      });
    });

    // PUR-5 (أ): بوابة الاعتماد — الاستلام على DRAFT يُرفض بـ 400 عربية
    it('PUR-5 (أ): يرفض الاستلام على أمر DRAFT بـ 400 (أمر الشراء غير معتمد)', async () => {
      prisma.purchaseOrder.findUnique.mockResolvedValue({
        id: 'po-1',
        code: 'PO-100',
        status: PurchaseOrderStatus.DRAFT,
        items: [
          { id: 'poi-1', rawMaterialId: 'rm-1', quantity: 10, unitCost: 5 },
        ],
      });

      await expect(
        service.createReceipt(
          'po-1',
          { items: [{ purchaseOrderItemId: 'poi-1', quantity: 4 }] },
          'user-1',
        ),
      ).rejects.toThrow('أمر الشراء غير معتمد — اعتمده أولًا');
      expect(prisma.purchaseReceipt.create).not.toHaveBeenCalled();
      expect(prisma.activityLog.create).not.toHaveBeenCalled();
    });

    it('PUR-5 (أ): يرفض الاستلام على أمر DRAFT داخل المعاملة أيضًا (إعادة قراءة تحت القفل)', async () => {
      // الحالة المقروءة مسبقًا APPROVED لكن إعادة القراءة داخل المعاملة
      // تُظهر DRAFT (تغيّر متزامن) → نفس البوابة تحت القفل
      prisma.purchaseOrder.findUnique
        .mockResolvedValueOnce({
          id: 'po-1',
          code: 'PO-100',
          status: PurchaseOrderStatus.APPROVED,
          items: [
            { id: 'poi-1', rawMaterialId: 'rm-1', quantity: 10, unitCost: 5 },
          ],
        })
        .mockResolvedValue({
          id: 'po-1',
          code: 'PO-100',
          status: PurchaseOrderStatus.DRAFT,
          items: [
            { id: 'poi-1', rawMaterialId: 'rm-1', quantity: 10, unitCost: 5 },
          ],
        });
      prisma.purchaseReceiptItem.findMany.mockResolvedValue([]);
      prisma.warehouse.findFirst.mockResolvedValue({ id: 'wh-raw' });
      prisma.$transaction.mockImplementation(async (cb) => cb(prisma));

      await expect(
        service.createReceipt(
          'po-1',
          { items: [{ purchaseOrderItemId: 'poi-1', quantity: 4 }] },
          'user-1',
        ),
      ).rejects.toThrow('أمر الشراء غير معتمد — اعتمده أولًا');
      expect(prisma.purchaseReceipt.create).not.toHaveBeenCalled();
    });
  });

  // PUR-5 (أ) (P1 — GF-IMP-W2): خطوة اعتماد أمر الشراء DRAFT → APPROVED
  describe('PUR-5 (أ) — اعتماد أمر الشراء', () => {
    const updateManyMock = () =>
      prisma.purchaseOrder as unknown as { updateMany: jest.Mock };

    it('يعتمد أمر DRAFT ذريًا (CAS) مع ActivityLog وidempotency', async () => {
      prisma.idempotencyKey.findUnique.mockResolvedValue(null);
      prisma.idempotencyKey.create.mockResolvedValue({ id: 'idem-approve' });
      prisma.purchaseOrder.findUnique
        .mockResolvedValueOnce({
          id: 'po-1',
          code: 'PO-100',
          status: PurchaseOrderStatus.DRAFT,
          totalAmount: 50,
          supplierId: 'sup-1',
          userId: 'creator-1',
        })
        .mockResolvedValue({
          id: 'po-1',
          code: 'PO-100',
          status: PurchaseOrderStatus.APPROVED,
        });
      updateManyMock().updateMany.mockResolvedValue({ count: 1 });

      const result = await service.approvePurchaseOrder(
        'po-1',
        'approver-1',
        'approve-key-1',
      );

      expect(result).toMatchObject({
        id: 'po-1',
        status: PurchaseOrderStatus.APPROVED,
      });
      expect(updateManyMock().updateMany).toHaveBeenCalledWith({
        where: { id: 'po-1', status: PurchaseOrderStatus.DRAFT },
        data: { status: PurchaseOrderStatus.APPROVED },
      });
      expect(prisma.activityLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'approver-1',
          action: 'PURCHASE_ORDER_APPROVED',
          module: 'PURCHASING',
          details: expect.objectContaining({
            purchaseOrderId: 'po-1',
            approvedBy: 'approver-1',
            previousStatus: PurchaseOrderStatus.DRAFT,
            newStatus: PurchaseOrderStatus.APPROVED,
          }),
        }),
      });
      expect(prisma.idempotencyKey.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { key: 'approve-key-1' } }),
      );
    });

    it('يرفض اعتماد المنشئ لنفسه بـ 409 (فصل واجبات) قبل أي كتابة', async () => {
      prisma.idempotencyKey.findUnique.mockResolvedValue(null);
      prisma.purchaseOrder.findUnique.mockResolvedValue({
        id: 'po-1',
        code: 'PO-100',
        status: PurchaseOrderStatus.DRAFT,
        totalAmount: 50,
        supplierId: 'sup-1',
        userId: 'creator-1',
      });

      await expect(
        service.approvePurchaseOrder('po-1', 'creator-1'),
      ).rejects.toThrow('فصل الواجبات');
      expect(updateManyMock().updateMany).not.toHaveBeenCalled();
      expect(prisma.activityLog.create).not.toHaveBeenCalled();
    });

    it('يرفض اعتماد أمر غير DRAFT بـ 409 توضح الحالة الحالية', async () => {
      prisma.idempotencyKey.findUnique.mockResolvedValue(null);
      prisma.purchaseOrder.findUnique.mockResolvedValue({
        id: 'po-1',
        code: 'PO-100',
        status: PurchaseOrderStatus.RECEIVED,
        totalAmount: 50,
        supplierId: 'sup-1',
        userId: 'creator-1',
      });
      // CAS على WHERE status = DRAFT لا يمسّ صفًا (الأمر RECEIVED)
      updateManyMock().updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.approvePurchaseOrder('po-1', 'approver-1'),
      ).rejects.toThrow('حالته الحالية «RECEIVED»');
      expect(prisma.activityLog.create).not.toHaveBeenCalled();
    });

    it('نفس المفتاح يعيد replay بلا اعتماد ثانٍ', async () => {
      const stored = { id: 'po-1', status: PurchaseOrderStatus.APPROVED };
      prisma.idempotencyKey.findUnique.mockResolvedValue({
        key: 'approve-key-replay',
        scope: 'purchase-order-approve',
        requestHash: computeRequestHash({
          operation: 'purchase-order-approve',
          orderId: 'po-1',
          userId: 'approver-1',
        }),
        response: stored,
      });

      const result = await service.approvePurchaseOrder(
        'po-1',
        'approver-1',
        'approve-key-replay',
      );

      expect(result).toEqual({ ...stored, replayed: true });
      expect(updateManyMock().updateMany).not.toHaveBeenCalled();
    });
  });

  describe('PUR-5 (ب) — إلغاء أمر الشراء', () => {
    it('يلغي أمر DRAFT ذريًا مع ActivityLog وidempotency', async () => {
      prisma.idempotencyKey.findUnique.mockResolvedValue(null);
      prisma.idempotencyKey.create.mockResolvedValue({ id: 'idem-cancel' });
      prisma.purchaseOrder.findUnique
        .mockResolvedValueOnce({
          id: 'po-1',
          code: 'PO-100',
          status: PurchaseOrderStatus.DRAFT,
          totalAmount: 50,
          supplierId: 'sup-1',
        })
        .mockResolvedValue({
          id: 'po-1',
          code: 'PO-100',
          status: PurchaseOrderStatus.CANCELLED,
        });

      const result = await service.cancelPurchaseOrder(
        'po-1',
        'user-1',
        'cancel-key-1',
      );

      expect(result).toMatchObject({
        id: 'po-1',
        status: PurchaseOrderStatus.CANCELLED,
      });
      expect(
        (prisma.purchaseOrder as unknown as { updateMany: jest.Mock })
          .updateMany,
      ).toHaveBeenCalledWith({
        where: { id: 'po-1', status: PurchaseOrderStatus.DRAFT },
        data: { status: PurchaseOrderStatus.CANCELLED },
      });
      expect(prisma.activityLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-1',
          action: 'PURCHASE_ORDER_CANCELLED',
          module: 'PURCHASING',
          details: expect.objectContaining({
            purchaseOrderId: 'po-1',
            totalAmount: 50,
          }),
        }),
      });
      expect(prisma.idempotencyKey.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { key: 'cancel-key-1' } }),
      );
    });

    it('يرفض إلغاء أمر غير DRAFT (400)', async () => {
      prisma.idempotencyKey.findUnique.mockResolvedValue(null);
      prisma.purchaseOrder.findUnique.mockResolvedValue({
        id: 'po-1',
        code: 'PO-100',
        status: PurchaseOrderStatus.RECEIVED,
        totalAmount: 50,
        supplierId: 'sup-1',
      });

      await expect(
        service.cancelPurchaseOrder('po-1', 'user-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(
        (prisma.purchaseOrder as unknown as { updateMany: jest.Mock })
          .updateMany,
      ).not.toHaveBeenCalled();
    });

    it('يرفض التزامن: updateMany صفر صفوف → 409', async () => {
      prisma.idempotencyKey.findUnique.mockResolvedValue(null);
      prisma.purchaseOrder.findUnique.mockResolvedValue({
        id: 'po-1',
        code: 'PO-100',
        status: PurchaseOrderStatus.DRAFT,
        totalAmount: 50,
        supplierId: 'sup-1',
      });
      (
        prisma.purchaseOrder as unknown as { updateMany: jest.Mock }
      ).updateMany = jest.fn().mockResolvedValue({ count: 0 });

      await expect(
        service.cancelPurchaseOrder('po-1', 'user-1'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.activityLog.create).not.toHaveBeenCalled();
    });

    it('نفس المفتاح يعيد replay بلا إلغاء ثانٍ', async () => {
      const stored = { id: 'po-1', status: PurchaseOrderStatus.CANCELLED };
      prisma.idempotencyKey.findUnique.mockResolvedValue({
        key: 'cancel-key-replay',
        scope: 'purchasing-order-cancel',
        requestHash: computeRequestHash({
          operation: 'purchasing-order-cancel',
          orderId: 'po-1',
          userId: 'user-1',
        }),
        response: stored,
      });

      const result = await service.cancelPurchaseOrder(
        'po-1',
        'user-1',
        'cancel-key-replay',
      );

      expect(result).toEqual({ ...stored, replayed: true });
      expect(
        (prisma.purchaseOrder as unknown as { updateMany: jest.Mock })
          .updateMany,
      ).not.toHaveBeenCalled();
    });
  });

  describe('receiveOrder', () => {
    it('should throw if order already received', async () => {
      prisma.purchaseOrder.findUnique.mockResolvedValue({
        id: 'po-1',
        status: PurchaseOrderStatus.RECEIVED,
        items: [],
      });
      await expect(service.receiveOrder('po-1', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should receive items via InventoryService within a transaction', async () => {
      prisma.purchaseOrder.findUnique.mockResolvedValue({
        id: 'po-1',
        code: 'PO-100',
        // PUR-5 (أ): الاستلام على APPROVED فقط — كان PENDING
        status: PurchaseOrderStatus.APPROVED,
        items: [
          { id: 'poi-1', rawMaterialId: 'rm-1', quantity: 10, unitCost: 5 },
        ],
      });
      prisma.warehouse.findFirst.mockResolvedValue({ id: 'wh-raw' });
      prisma.purchaseReceiptItem.findMany.mockResolvedValue([]);
      prisma.idempotencyKey.create.mockResolvedValue({ id: 'idem-1' });
      prisma.purchaseReceipt.create.mockResolvedValue({
        id: 'grn-1',
        code: 'GRN-100',
        items: [],
      });
      prisma.$transaction.mockImplementation(async (cb) => {
        return cb(prisma); // Pass mocked prisma as tx
      });
      prisma.purchaseOrder.update.mockResolvedValue({ code: 'PO-100' });

      await service.receiveOrder('po-1', 'user-1');

      expect(prisma.purchaseOrder.update).toHaveBeenCalledWith({
        where: { id: 'po-1' },
        data: { status: PurchaseOrderStatus.RECEIVED },
      });
      expect(inventoryService.receive).toHaveBeenCalledWith(
        {
          rawMaterialId: 'rm-1',
          warehouseId: 'wh-raw',
          quantity: 10,
          unitCost: 5,
          reference: 'GRN-100',
          notes: expect.any(String),
        },
        'user-1',
        prisma,
      );
    });

    it('derives a new legacy idempotency key when a later partial receipt changes the remainder', async () => {
      const receiptSpy = jest
        .spyOn(service, 'createReceipt')
        .mockResolvedValue({
          id: 'grn-legacy',
          code: 'GRN-LEGACY',
          notes: null,
          idempotencyKeyId: null,
          userId: 'user-1',
          purchaseOrderId: 'po-1',
          receivedAt: new Date(),
          items: [],
        });
      prisma.purchaseOrder.findUnique.mockResolvedValue({
        id: 'po-1',
        code: 'PO-100',
        // PUR-5 (أ): الاستلام على APPROVED فقط — كان PENDING
        status: PurchaseOrderStatus.APPROVED,
        items: [
          { id: 'poi-1', rawMaterialId: 'rm-1', quantity: 10, unitCost: 5 },
        ],
      });
      prisma.purchaseReceiptItem.findMany.mockResolvedValue([
        { purchaseOrderItemId: 'poi-1', quantity: 4 },
      ]);

      await service.receiveOrder('po-1', 'user-1');

      expect(receiptSpy).toHaveBeenCalledWith(
        'po-1',
        {
          items: [{ purchaseOrderItemId: 'poi-1', quantity: 6 }],
          notes: 'استلام كامل (legacy) لأمر الشراء PO-100',
        },
        'user-1',
        expect.stringMatching(/^legacy-receive-po-1-[a-f0-9]{16}$/),
      );
    });
  });
});
