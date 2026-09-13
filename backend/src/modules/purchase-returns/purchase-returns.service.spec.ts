import 'reflect-metadata';
import { PurchaseOrderStatus, PurchaseReturnStatus } from '@prisma/client';
import { PurchaseReturnsService } from './purchase-returns.service';
import { SequenceService } from '../../core/sequence/sequence.service';
import { FinancialPostingService } from '../../core/financial/financial-posting.service';
import { InventoryService } from '../inventory/inventory.service';
import { CHART_OF_ACCOUNTS } from '../../core/financial/chart-of-accounts';
import { CreatePurchaseReturnDto } from './dto/create-purchase-return.dto';

/**
 * SELIM-ERP W1 — اختبارات خدمة مرتجع المشتريات.
 *
 * تركّز على قواعد المجال (نفس قواعد Selim ERP):
 * - الإجماليات تُحسب على الخادم من البنود (لا تُقبل من العميل).
 * - الترقيم PRR-0001 داخل نفس معاملة الإنشاء.
 * - القيد العكسي بالحسابات الصحيحة لكل تركيبة (restock × refundMethod × tax).
 * - استرداد credit يخفض رصيد المورد؛ cash لا يمسه.
 * - بنود المرتجع يجب أن تنتمي لأمر الشراء عند الربط.
 * - الحذف يعكس القيد ويستعيد المخزون.
 */
describe('PurchaseReturnsService — قواعد مرتجع المشتريات (SELIM W1)', () => {
  let service: PurchaseReturnsService;
  const prisma = {
    $transaction: jest.fn(),
    purchaseOrder: { findUnique: jest.fn() },
    purchaseReturn: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    rawMaterial: { findMany: jest.fn() },
    warehouse: { findFirst: jest.fn() },
    purchaseReceipt: { findMany: jest.fn() },
    stockLedgerEntry: { findFirst: jest.fn() },
  };
  const sequence = { nextNumber: jest.fn() };
  const financial = {
    postJournalEntryInTx: jest.fn(),
    reverseJournalEntryInTx: jest.fn(),
  };
  const inventory = { issue: jest.fn(), receive: jest.fn() };
  const tx = {} as unknown as Record<string, unknown>;

  /** إدخال وسيط لقراءة بيانات إنشاء المرتجع من الـ mock (بلا any مسرب). */
  const createDataOf = (): Record<string, unknown> =>
    (
      prisma.purchaseReturn.create.mock.calls as unknown as Array<
        [{ data: Record<string, unknown> }]
      >
    )[0]?.[0]?.data ?? {};

  /** إدخال وسيط لقراءة بيانات القيد المُرحَّل (بلا any مسرب). */
  const journalInputOf = (
    call = 0,
  ): {
    lines: Array<{
      debitAccountId: string;
      creditAccountId: string;
      amount: number;
    }>;
    supplierUpdates?: Array<{ supplierId: string; delta: number }>;
    postingKey?: string;
  } =>
    (
      financial.postJournalEntryInTx.mock.calls as unknown as Array<
        [
          unknown,
          {
            lines: Array<{
              debitAccountId: string;
              creditAccountId: string;
              amount: number;
            }>;
            supplierUpdates?: Array<{ supplierId: string; delta: number }>;
            postingKey?: string;
          },
        ]
      >
    )[call]?.[1];

  const order = {
    id: 'po-1',
    code: 'PO-0001',
    supplierId: 'sup-1',
    status: PurchaseOrderStatus.RECEIVED,
    supplier: { id: 'sup-1', name: 'مورد النسيج الشرقي' },
    items: [
      { id: 'poi-1', rawMaterialId: 'rm-1', quantity: '100', unitCost: '25' },
    ],
  };

  const baseDto: CreatePurchaseReturnDto = {
    purchaseOrderId: 'po-1',
    items: [{ purchaseOrderItemId: 'poi-1', quantity: 10, unitPrice: 25 }],
    discountAmount: 20,
    taxAmount: 14,
    refundMethod: 'credit',
    restockItems: true,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation((arg: unknown) => {
      if (typeof arg === 'function') {
        return (arg as (client: unknown) => unknown)(tx);
      }
      return [[], 0];
    });
    prisma.purchaseOrder.findUnique.mockResolvedValue(order);
    prisma.purchaseReturn.findUnique.mockResolvedValue(null);
    prisma.purchaseReturn.findMany.mockResolvedValue([]);
    prisma.purchaseReturn.count.mockResolvedValue(0);
    prisma.purchaseReturn.create.mockResolvedValue({
      id: 'pr-1',
      returnNumber: 'PRR-0001',
      items: [],
    });
    prisma.purchaseReturn.update.mockImplementation(
      (args: { data: Record<string, unknown> }) => ({
        id: 'pr-1',
        returnNumber: 'PRR-0001',
        ...args.data,
      }),
    );
    prisma.purchaseReturn.delete.mockResolvedValue({ id: 'pr-1' });
    prisma.rawMaterial.findMany.mockResolvedValue([
      { id: 'rm-1', name: 'قماش قطن', code: 'RM-001', costPerUnit: '25' },
    ]);
    prisma.warehouse.findFirst.mockResolvedValue({
      id: 'wh-raw',
      name: 'مخزن الخامات',
    });
    prisma.purchaseReceipt.findMany.mockResolvedValue([]);
    prisma.stockLedgerEntry.findFirst.mockResolvedValue(null);
    sequence.nextNumber.mockResolvedValue('PRR-0001');
    financial.postJournalEntryInTx.mockResolvedValue({
      entryId: 'je-1',
      entryCode: 'JE-0001',
      totalDebit: 244,
      totalCredit: 244,
      linesCount: 2,
      createdAt: new Date(),
    });
    financial.reverseJournalEntryInTx.mockResolvedValue({
      reversalEntryId: 'je-2',
      reversalEntryCode: 'JE-0002',
    });
    inventory.issue.mockResolvedValue({
      entryCode: 'SLE-1',
      balanceAfter: 90,
    });
    inventory.receive.mockResolvedValue({
      entryCode: 'SLE-2',
      balanceAfter: 100,
    });
    Object.assign(tx, prisma);
    service = new PurchaseReturnsService(
      prisma as never,
      sequence as unknown as SequenceService,
      financial as unknown as FinancialPostingService,
      inventory as unknown as InventoryService,
    );
  });

  it('يحسب الإجماليات على الخادم: مجموع − خصم + ضريبة', async () => {
    await service.create(baseDto, 'user-1');
    const data = createDataOf();
    // 10 × 25 = 250، صافي = 250 − 20 = 230، الإجمالي = 230 + 14 = 244.
    expect(Number(data.subtotal)).toBe(250);
    expect(Number(data.total)).toBe(244);
    // الترقيم عبر SequenceService داخل المعاملة نفسها.
    expect(sequence.nextNumber).toHaveBeenCalledWith('PURCHASE_RETURN', tx);
  });

  it('يرفض الخصم الأكبر من مجموع البنود', async () => {
    await expect(
      service.create({ ...baseDto, discountAmount: 9999 }, 'user-1'),
    ).rejects.toThrow('خصم المرتجع لا يمكن أن يتجاوز');
  });

  it('يرفض بندًا مرتبطًا ببند لا ينتمي لأمر الشراء', async () => {
    await expect(
      service.create(
        {
          ...baseDto,
          items: [
            { purchaseOrderItemId: 'poi-999', quantity: 5, unitPrice: 25 },
          ],
        },
        'user-1',
      ),
    ).rejects.toThrow('بند غير موجود في أمر الشراء');
  });

  it('يرفض إنشاء مرتجع لأمر شراء ملغى', async () => {
    prisma.purchaseOrder.findUnique.mockResolvedValue({
      ...order,
      status: PurchaseOrderStatus.CANCELLED,
    });
    await expect(service.create(baseDto, 'user-1')).rejects.toThrow(
      'أمر شراء ملغى',
    );
  });

  it('يرفض إنشاء مرتجع لأمر شراء غير موجود', async () => {
    prisma.purchaseOrder.findUnique.mockResolvedValue(null);
    await expect(service.create(baseDto, 'user-1')).rejects.toThrow(
      'أمر الشراء غير موجود',
    );
  });

  it('يرحّل القيد العكسي الصحيح للاسترداد الدائن مع ضريبة (Dr AP / Cr INVENTORY + VAT)', async () => {
    await service.create(baseDto, 'user-1');
    expect(financial.postJournalEntryInTx).toHaveBeenCalled();
    const input = journalInputOf();
    // بند المخزون: Dr AP / Cr INVENTORY بصافي 230.
    expect(input?.lines[0]?.debitAccountId).toBe(
      CHART_OF_ACCOUNTS.ACCOUNTS_PAYABLE,
    );
    expect(input?.lines[0]?.creditAccountId).toBe(CHART_OF_ACCOUNTS.INVENTORY);
    expect(input?.lines[0]?.amount).toBe(230);
    // بند الضريبة: Dr AP / Cr VAT_PAYABLE بمبلغ الضريبة.
    expect(input?.lines[1]?.creditAccountId).toBe(
      CHART_OF_ACCOUNTS.VAT_PAYABLE,
    );
    expect(input?.lines[1]?.amount).toBe(14);
    // الاسترداد الدائن يخفض رصيد المورد بالإجمالي (244).
    expect(input?.supplierUpdates).toEqual([
      { supplierId: 'sup-1', delta: -244 },
    ]);
  });

  it('الاسترداد النقدي يقيد Dr CASH ولا يمس رصيد المورد', async () => {
    await service.create({ ...baseDto, refundMethod: 'cash' }, 'user-1');
    const input = journalInputOf();
    expect(input?.lines[0]?.debitAccountId).toBe(CHART_OF_ACCOUNTS.CASH);
    expect(input?.supplierUpdates).toBeUndefined();
  });

  it('restockItems=false يقيد Dr AP / Cr COGS ولا يحرك المخزون', async () => {
    await service.create({ ...baseDto, restockItems: false }, 'user-1');
    const input = journalInputOf();
    expect(input?.lines[0]?.creditAccountId).toBe(
      CHART_OF_ACCOUNTS.COST_OF_GOODS_SOLD,
    );
    expect(inventory.issue).not.toHaveBeenCalled();
  });

  it('restockItems=true يصرف الخامات من المخزن داخل المعاملة', async () => {
    await service.create(baseDto, 'user-1');
    expect(inventory.issue).toHaveBeenCalledWith(
      expect.objectContaining({
        rawMaterialId: 'rm-1',
        quantity: 10,
        reference: 'PRR-0001',
      }),
      'user-1',
      tx,
    );
  });

  it('يربط القيد بالمستند ويحفظ journalEntryId', async () => {
    await service.create(baseDto, 'user-1');
    expect(prisma.purchaseReturn.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pr-1' },
        data: { journalEntryId: 'je-1' },
      }),
    );
  });

  it('الحذف يعكس القيد ويستعيد المخزون ويحذف في معاملة واحدة', async () => {
    prisma.purchaseReturn.findUnique.mockResolvedValue({
      id: 'pr-1',
      returnNumber: 'PRR-0001',
      purchaseOrderId: 'po-1',
      journalEntryId: 'je-1',
      restockItems: true,
      status: PurchaseReturnStatus.POSTED,
      items: [{ rawMaterialId: 'rm-1', quantity: '10', unitCost: '25' }],
    });
    const result = await service.remove('pr-1', 'user-1');
    expect(financial.reverseJournalEntryInTx).toHaveBeenCalledWith(
      tx,
      'je-1',
      'user-1',
      expect.stringContaining('عكس القيد'),
    );
    expect(inventory.receive).toHaveBeenCalledWith(
      expect.objectContaining({ rawMaterialId: 'rm-1', quantity: 10 }),
      'user-1',
      tx,
    );
    expect(prisma.purchaseReturn.delete).toHaveBeenCalledWith({
      where: { id: 'pr-1' },
    });
    expect(result).toEqual({ deleted: true });
  });

  it('الحذف لمستند بلا قيد يمضي بلا عكس (مرتجع تاريخي قبل الترحيل)', async () => {
    prisma.purchaseReturn.findUnique.mockResolvedValue({
      id: 'pr-1',
      returnNumber: 'PRR-0002',
      purchaseOrderId: 'po-1',
      journalEntryId: null,
      restockItems: false,
      status: PurchaseReturnStatus.POSTED,
      items: [],
    });
    await service.remove('pr-1', 'user-1');
    expect(financial.reverseJournalEntryInTx).not.toHaveBeenCalled();
    expect(prisma.purchaseReturn.delete).toHaveBeenCalled();
  });

  it('الحذف لمستند غير موجود يرفض 404', async () => {
    prisma.purchaseReturn.findUnique.mockResolvedValue(null);
    await expect(service.remove('pr-x', 'user-1')).rejects.toThrow(
      'مرتجع المشتريات غير موجود',
    );
  });
});
