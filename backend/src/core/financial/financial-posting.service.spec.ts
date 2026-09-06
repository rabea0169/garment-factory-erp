import { FinancialPostingService } from './financial-posting.service';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { createPrismaMock } from '../../../test/helpers/prisma-mock';

describe('FinancialPostingService', () => {
  // ACC-3 (GF-IMP-W2): فترة مفتوحة افتراضية شاملة لكل تواريخ الاختبارات —
  // الترحيل بلا fiscalPeriodId يمر الآن عبر حلّ الفترة المفتوحة.
  const openPeriod = {
    id: 'period-open-2026',
    status: 'OPEN',
    startDate: new Date('2026-01-01T00:00:00.000Z'),
    endDate: new Date('2026-12-31T00:00:00.000Z'),
  };

  it('replays the same keyed posting without creating a second journal entry', async () => {
    const prisma = createPrismaMock();
    const service = new FinancialPostingService(
      prisma as unknown as PrismaService,
    );
    prisma.fiscalPeriod.findFirst.mockResolvedValue(openPeriod);
    const input = {
      description: 'Sale posting',
      reference: 'SO-1',
      postingKey: 'sales-confirm:so-1',
      lines: [
        {
          debitAccountId: 'cash-account',
          creditAccountId: 'sales-account',
          amount: 100,
        },
      ],
    };

    prisma.account.findMany.mockResolvedValue([
      { id: 'cash-account', isActive: true, isGroup: false },
      { id: 'sales-account', isActive: true, isGroup: false },
    ]);
    prisma.journalEntry.findUnique.mockResolvedValue(null);
    prisma.journalEntry.create.mockResolvedValue({
      id: 'je-1',
      code: 'JE-1',
      createdAt: new Date('2026-08-26T00:00:00.000Z'),
    });

    const first = await service.postJournalEntryInTx(
      prisma as never,
      input,
      'user-1',
    );
    expect(first.entryId).toBe('je-1');
    expect(prisma.journalEntry.create).toHaveBeenCalledTimes(1);

    const createCalls = prisma.journalEntry.create.mock.calls as unknown as [
      [{ data: { postingKey: string; postingHash: string } }],
    ];
    const createData = createCalls[0][0];
    prisma.journalEntry.findUnique.mockResolvedValue({
      id: 'je-1',
      code: 'JE-1',
      postingKey: createData.data.postingKey,
      postingHash: createData.data.postingHash,
      createdAt: new Date('2026-08-26T00:00:00.000Z'),
      lines: [
        {
          amount: 100,
          debitAccountId: 'cash-account',
          creditAccountId: 'sales-account',
        },
      ],
    });

    const replay = await service.postJournalEntryInTx(
      prisma as never,
      input,
      'user-1',
    );
    expect(replay.entryId).toBe('je-1');
    expect(replay.linesCount).toBe(1);
    expect(prisma.journalEntry.create).toHaveBeenCalledTimes(1);
  });

  it('reverses the journal and all linked balances atomically', async () => {
    const prisma = createPrismaMock();
    const service = new FinancialPostingService(
      prisma as unknown as PrismaService,
    );
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
    );
    prisma.fiscalPeriod.findFirst.mockResolvedValue(openPeriod);
    prisma.journalEntry.findUnique.mockResolvedValue({
      id: 'je-original',
      code: 'JE-ORIGINAL',
      createdAt: new Date('2026-08-26T00:00:00.000Z'),
      isReversed: false,
      metadata: {
        treasuryUpdates: [{ treasuryId: 'treasury-1', delta: 100 }],
        customerUpdates: [{ customerId: 'customer-1', delta: 100 }],
        supplierUpdates: [{ supplierId: 'supplier-1', delta: -40 }],
      },
      lines: [
        {
          debitAccountId: 'cash-account',
          creditAccountId: 'sales-account',
          amount: 100,
          description: 'بيع',
        },
      ],
    });
    prisma.journalEntry.updateMany.mockResolvedValue({ count: 1 });
    prisma.account.findMany.mockResolvedValue([
      { id: 'sales-account', isActive: true, isGroup: false },
      { id: 'cash-account', isActive: true, isGroup: false },
    ]);
    prisma.treasury.findMany.mockResolvedValue([
      { id: 'treasury-1', isActive: true, balance: 1000 },
    ]);
    prisma.customer.findMany.mockResolvedValue([{ id: 'customer-1' }]);
    prisma.supplier.findMany.mockResolvedValue([{ id: 'supplier-1' }]);
    prisma.journalEntry.create.mockResolvedValue({
      id: 'je-reversal',
      code: 'JE-REVERSAL',
      createdAt: new Date('2026-08-26T00:01:00.000Z'),
    });

    const result = await service.reverseJournalEntry(
      'je-original',
      'user-2',
      'إلغاء البيع',
    );

    expect(result.reversedEntryId).toBe('je-original');
    type UpdateManyCall = [
      {
        where: { id: string; isReversed: boolean };
        data: { isReversed: boolean; reversedById: string };
      },
    ];
    const updateManyCalls = prisma.journalEntry.updateMany.mock
      .calls as unknown as UpdateManyCall[];
    expect(updateManyCalls[0][0].where).toEqual({
      id: 'je-original',
      isReversed: false,
    });
    expect(updateManyCalls[0][0].data).toMatchObject({
      isReversed: true,
      reversedById: 'user-2',
    });

    type CreateCall = [
      {
        data: {
          reference: string;
          reversalOfId: string;
          metadata?: {
            source?: string;
            reversalOfId?: string;
            treasuryUpdates?: { delta: number }[];
            customerUpdates?: { delta: number }[];
            supplierUpdates?: { delta: number }[];
          };
          lines: {
            create: Array<{
              debitAccountId: string;
              creditAccountId: string;
              amount: number;
            }>;
          };
        };
      },
    ];
    const createCalls = prisma.journalEntry.create.mock
      .calls as unknown as CreateCall[];
    expect(createCalls[0][0].data.reference).toBe('REVERSAL-OF-JE-ORIGINAL');
    expect(createCalls[0][0].data.lines.create[0]).toEqual(
      expect.objectContaining({
        debitAccountId: 'sales-account',
        creditAccountId: 'cash-account',
        amount: 100,
      }),
    );
    // ACC-2: عكس أرصدة الخزينة والعملاء والموردين كلها داخل معاملة العكس.
    expect(prisma.treasury.update).toHaveBeenCalledWith({
      where: { id: 'treasury-1' },
      data: { balance: { increment: -100 } },
    });
    expect(prisma.customer.update).toHaveBeenCalledWith({
      where: { id: 'customer-1' },
      data: { balance: { increment: -100 } },
    });
    expect(prisma.supplier.update).toHaveBeenCalledWith({
      where: { id: 'supplier-1' },
      data: { balance: { increment: 40 } },
    });
    expect(prisma.journalEntry.update).toHaveBeenCalledWith({
      where: { id: 'je-reversal' },
      data: { reversalOfId: 'je-original' },
    });
    // ACC-2: القيد العكسي يوثّق تأثيراته الفعلية (المقلوبة) في لقطة metadata
    // خاصة به — لا يرث لقطة الأصل باتجاهها الأصلي.
    expect(createCalls[0][0].data.metadata).toMatchObject({
      source: 'accounting.reversal',
      reversalOfId: 'je-original',
      treasuryUpdates: [{ treasuryId: 'treasury-1', delta: -100 }],
      customerUpdates: [{ customerId: 'customer-1', delta: -100 }],
      supplierUpdates: [{ supplierId: 'supplier-1', delta: 40 }],
    });
  });

  it('rejects supplier balance updates that would become negative', async () => {
    const prisma = createPrismaMock();
    const service = new FinancialPostingService(
      prisma as unknown as PrismaService,
    );
    prisma.fiscalPeriod.findFirst.mockResolvedValue(openPeriod);
    prisma.account.findMany.mockResolvedValue([
      { id: 'expense-account', isActive: true, isGroup: false },
      { id: 'cash-account', isActive: true, isGroup: false },
    ]);
    prisma.supplier.findMany.mockResolvedValue([
      { id: 'supplier-1', balance: new Prisma.Decimal('10.00') },
    ]);

    await expect(
      service.postJournalEntryInTx(
        prisma as never,
        {
          description: 'Invalid supplier update',
          lines: [
            {
              debitAccountId: 'expense-account',
              creditAccountId: 'cash-account',
              amount: 40,
            },
          ],
          supplierUpdates: [{ supplierId: 'supplier-1', delta: -40 }],
        },
        'user-1',
      ),
    ).rejects.toThrow('الرصيد السالب للمورد ممنوع');
    expect(prisma.journalEntry.create).not.toHaveBeenCalled();
  });

  // SAL-1 (P0): فحص حد الائتمان/تحديث رصيد العميل يجب أن يمر بقفل صف
  // SELECT ... FOR UPDATE — نفس نمط الخزائن والموردين — وإلا اجتاز طلبان
  // متزامنان لنفس العميل فحص الحد على رصيد قديم.
  it('locks customer rows with FOR UPDATE before the balance update (SAL-1)', async () => {
    const prisma = createPrismaMock();
    const service = new FinancialPostingService(
      prisma as unknown as PrismaService,
    );
    prisma.fiscalPeriod.findFirst.mockResolvedValue(openPeriod);
    prisma.account.findMany.mockResolvedValue([
      { id: 'ar-account', isActive: true, isGroup: false },
      { id: 'sales-account', isActive: true, isGroup: false },
    ]);
    prisma.journalEntry.create.mockResolvedValue({
      id: 'je-credit-sale',
      code: 'JE-CREDIT-SALE',
      createdAt: new Date('2026-09-06T00:00:00.000Z'),
    });
    prisma.customer.findMany.mockResolvedValue([
      { id: 'customer-1' },
      { id: 'customer-2' },
    ]);

    await service.postJournalEntryInTx(
      prisma as never,
      {
        description: 'Credit sale posting',
        lines: [
          {
            debitAccountId: 'ar-account',
            creditAccountId: 'sales-account',
            amount: 150,
          },
        ],
        customerUpdates: [
          { customerId: 'customer-1', delta: 150 },
          { customerId: 'customer-2', delta: 50 },
        ],
      },
      'user-1',
    );

    // يقع القفل قبل قراءة العملاء ويحمل كل المعرفات المطلوب قفلها.
    const rawCalls = (
      prisma.$queryRaw.mock.calls as unknown as [Prisma.Sql][]
    ).map((call) => call[0]);
    const customerLockSql = rawCalls.find(
      (sql) =>
        sql.sql.includes('FROM customers') && sql.sql.includes('FOR UPDATE'),
    );
    if (!customerLockSql) {
      throw new Error('Expected a customers FOR UPDATE lock query');
    }
    expect(customerLockSql.values).toEqual(['customer-1', 'customer-2']);
    const lockInvocationOrder =
      prisma.$queryRaw.mock.invocationCallOrder[
        rawCalls.indexOf(customerLockSql)
      ];
    const findManyInvocationOrder =
      prisma.customer.findMany.mock.invocationCallOrder[0];
    expect(lockInvocationOrder).toBeLessThan(findManyInvocationOrder);
    // فحص الوجود يبقى كما هو بعد القفل.
    expect(prisma.customer.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['customer-1', 'customer-2'] } },
      select: { id: true },
    });
    expect(prisma.customer.update).toHaveBeenCalledWith({
      where: { id: 'customer-1' },
      data: { balance: { increment: 150 } },
    });
  });

  // ACC-3 (P1 — GF-IMP-W2): إقفال الفترات يسري الآن على كل الترحيل الآلي —
  // القيد بلا fiscalPeriodId يُحل إلى الفترة المفتوحة الشاملة لتاريخه.
  describe('ACC-3 — إقفال الفترات المالية على الترحيل الآلي', () => {
    it('يربط القيد بالفترة المفتوحة الشاملة لتاريخ القيد عند غياب fiscalPeriodId', async () => {
      const prisma = createPrismaMock();
      const service = new FinancialPostingService(
        prisma as unknown as PrismaService,
      );
      const postingDate = new Date('2026-08-26T15:30:00.000Z');
      prisma.fiscalPeriod.findFirst.mockResolvedValue(openPeriod);
      prisma.account.findMany.mockResolvedValue([
        { id: 'cash-account', isActive: true, isGroup: false },
        { id: 'sales-account', isActive: true, isGroup: false },
      ]);
      prisma.journalEntry.create.mockResolvedValue({
        id: 'je-acc3',
        code: 'JE-ACC3',
        createdAt: new Date('2026-08-26T00:00:00.000Z'),
      });

      await service.postJournalEntryInTx(
        prisma as never,
        {
          description: 'Auto posting without period',
          date: postingDate,
          lines: [
            {
              debitAccountId: 'cash-account',
              creditAccountId: 'sales-account',
              amount: 100,
            },
          ],
        },
        'user-1',
      );

      const startOfPostingDay = new Date(postingDate);
      startOfPostingDay.setUTCHours(0, 0, 0, 0);
      expect(prisma.fiscalPeriod.findFirst).toHaveBeenCalledWith({
        where: {
          status: 'OPEN',
          startDate: { lte: postingDate },
          endDate: { gte: startOfPostingDay },
        },
        orderBy: { startDate: 'desc' },
        select: { id: true },
      });
      const createCalls = prisma.journalEntry.create.mock.calls as unknown as [
        [{ data: { fiscalPeriodId: string | null } }],
      ];
      expect(createCalls[0][0].data.fiscalPeriodId).toBe('period-open-2026');
    });

    it('يرفض الترحيل بـ 400 عندما لا توجد فترة مفتوحة شاملة التاريخ', async () => {
      const prisma = createPrismaMock();
      const service = new FinancialPostingService(
        prisma as unknown as PrismaService,
      );
      prisma.fiscalPeriod.findFirst.mockResolvedValue(null);
      prisma.account.findMany.mockResolvedValue([
        { id: 'cash-account', isActive: true, isGroup: false },
        { id: 'sales-account', isActive: true, isGroup: false },
      ]);

      await expect(
        service.postJournalEntryInTx(
          prisma as never,
          {
            description: 'Auto posting outside all periods',
            date: new Date('2027-01-01T10:00:00.000Z'),
            lines: [
              {
                debitAccountId: 'cash-account',
                creditAccountId: 'sales-account',
                amount: 100,
              },
            ],
          },
          'user-1',
        ),
      ).rejects.toThrow('لا يمكن الترحيل خارج فترة مالية مفتوحة');
      expect(prisma.journalEntry.create).not.toHaveBeenCalled();
    });

    it('الفترة المُمرَّرة يدويًا والمغلقة تُرفض بالرسالة القائمة', async () => {
      const prisma = createPrismaMock();
      const service = new FinancialPostingService(
        prisma as unknown as PrismaService,
      );
      prisma.fiscalPeriod.findUnique.mockResolvedValue({
        id: 'period-closed',
        status: 'CLOSED',
        startDate: new Date('2026-01-01T00:00:00.000Z'),
        endDate: new Date('2026-12-31T00:00:00.000Z'),
      });

      await expect(
        service.postJournalEntryInTx(
          prisma as never,
          {
            description: 'Manual posting into closed period',
            fiscalPeriodId: 'period-closed',
            date: new Date('2026-08-26T00:00:00.000Z'),
            lines: [
              {
                debitAccountId: 'cash-account',
                creditAccountId: 'sales-account',
                amount: 100,
              },
            ],
          },
          'user-1',
        ),
      ).rejects.toThrow('لا يمكن الترحيل في فترة مالية مغلقة');
      expect(prisma.fiscalPeriod.findFirst).not.toHaveBeenCalled();
      expect(prisma.journalEntry.create).not.toHaveBeenCalled();
    });
  });

  // ACC-2 (P1 — GF-IMP-W2): postJournalEntryInTx يوثّق تأثيراته الجانبية
  // الفعلية في metadata — فيستطيع reverseJournalEntry عكس الأرصدة موثوقًا.
  describe('ACC-2 — لقطة التأثيرات الجانبية في metadata', () => {
    const arrangeHappyPosting = () => {
      const prisma = createPrismaMock();
      const service = new FinancialPostingService(
        prisma as unknown as PrismaService,
      );
      prisma.fiscalPeriod.findFirst.mockResolvedValue(openPeriod);
      prisma.account.findMany.mockResolvedValue([
        { id: 'cash-account', isActive: true, isGroup: false },
        { id: 'sales-account', isActive: true, isGroup: false },
      ]);
      prisma.treasury.findMany.mockResolvedValue([
        { id: 'treasury-1', isActive: true, balance: 1000 },
      ]);
      prisma.customer.findMany.mockResolvedValue([{ id: 'customer-1' }]);
      prisma.supplier.findMany.mockResolvedValue([{ id: 'supplier-1' }]);
      prisma.journalEntry.create.mockResolvedValue({
        id: 'je-acc2',
        code: 'JE-ACC2',
        createdAt: new Date('2026-09-06T00:00:00.000Z'),
      });
      return { prisma, service };
    };

    it('يكتب لقطة treasuryUpdates/customerUpdates/supplierUpdates/accountDeltas الفعلية عند غياب metadata', async () => {
      const { prisma, service } = arrangeHappyPosting();

      await service.postJournalEntryInTx(
        prisma as never,
        {
          description: 'Posting with side effects, no metadata',
          lines: [
            {
              debitAccountId: 'cash-account',
              creditAccountId: 'sales-account',
              amount: 100,
            },
          ],
          treasuryUpdates: [{ treasuryId: 'treasury-1', delta: 100 }],
          customerUpdates: [{ customerId: 'customer-1', delta: 100 }],
          supplierUpdates: [{ supplierId: 'supplier-1', delta: -40 }],
        },
        'user-1',
      );

      const createCalls = prisma.journalEntry.create.mock.calls as unknown as [
        [
          {
            data: {
              metadata: {
                treasuryUpdates: unknown;
                customerUpdates: unknown;
                supplierUpdates: unknown;
                accountDeltas: Record<string, number>;
              };
            };
          },
        ],
      ];
      const metadata = createCalls[0][0].data.metadata;
      expect(metadata).toMatchObject({
        treasuryUpdates: [{ treasuryId: 'treasury-1', delta: 100 }],
        customerUpdates: [{ customerId: 'customer-1', delta: 100 }],
        supplierUpdates: [{ supplierId: 'supplier-1', delta: -40 }],
      });
      expect(metadata.accountDeltas).toEqual({
        'cash-account': 100,
        'sales-account': -100,
      });
    });

    it('يحفظ مفاتيح المستدعي الخاصة بجانب اللقطة ولا يستبدل قيمًا وثّقها بنفسه', async () => {
      const { prisma, service } = arrangeHappyPosting();

      await service.postJournalEntryInTx(
        prisma as never,
        {
          description: 'Voucher-like posting with custom metadata',
          lines: [
            {
              debitAccountId: 'cash-account',
              creditAccountId: 'sales-account',
              amount: 100,
            },
          ],
          treasuryUpdates: [{ treasuryId: 'treasury-1', delta: 100 }],
          metadata: {
            source: 'accounting.voucher',
            counterpartyType: 'SUPPLIER',
            // المستدعي وثّق treasuryUpdates بنفسه — لا نستبدلها.
            treasuryUpdates: [{ treasuryId: 'treasury-1', delta: 555 }],
          },
        },
        'user-1',
      );

      const createCalls = prisma.journalEntry.create.mock.calls as unknown as [
        [
          {
            data: {
              metadata: {
                source: string;
                counterpartyType: string;
                treasuryUpdates: unknown;
                customerUpdates: unknown;
                accountDeltas: Record<string, number>;
              };
            };
          },
        ],
      ];
      const metadata = createCalls[0][0].data.metadata;
      expect(metadata.source).toBe('accounting.voucher');
      expect(metadata.counterpartyType).toBe('SUPPLIER');
      // قيمة المستدقى تبقى كما وثّقها هو.
      expect(metadata.treasuryUpdates).toEqual([
        { treasuryId: 'treasury-1', delta: 555 },
      ]);
      // باقي اللقطة تُكمل عند الغياب.
      expect(metadata.customerUpdates).toEqual([]);
      expect(metadata.accountDeltas).toEqual({
        'cash-account': 100,
        'sales-account': -100,
      });
    });
  });

  // ACC-2 (P1 — GF-IMP-W2): قيد بلا أثر جانبي موثق يُحظر عكسه — عكس GL
  // وحده كان يترك أرصدة الخزائن/العملاء/الموردين تتقادم.
  describe('ACC-2 — حظر عكس قيد بلا أثر جانبي موثق', () => {
    it('يرمي 409 ولا يعلّم القيد معكوسًا ولا ينشئ قيدًا عكسيًا', async () => {
      const prisma = createPrismaMock();
      const service = new FinancialPostingService(
        prisma as unknown as PrismaService,
      );
      prisma.$transaction.mockImplementation(
        (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
      );
      // قيد تراثي: metadata تخزّن نوع الطرف فقط (نمط ما قبل ACC-2).
      prisma.journalEntry.findUnique.mockResolvedValue({
        id: 'je-legacy',
        code: 'JE-LEGACY',
        createdAt: new Date('2026-08-26T00:00:00.000Z'),
        isReversed: false,
        metadata: { source: 'accounting.voucher', counterpartyType: 'WORKER' },
        lines: [
          {
            debitAccountId: 'advances-account',
            creditAccountId: 'cash-account',
            amount: 100,
            description: 'سلفة قديمة',
          },
        ],
      });

      await expect(
        service.reverseJournalEntry('je-legacy', 'user-2', 'عكس قديم'),
      ).rejects.toThrow('لا يمكن عكس قيد JE-LEGACY بلا أثر جانبي موثق');

      expect(prisma.journalEntry.updateMany).not.toHaveBeenCalled();
      expect(prisma.journalEntry.create).not.toHaveBeenCalled();
      expect(prisma.journalEntry.update).not.toHaveBeenCalled();
    });

    it('يرفض أيضًا قيدًا بلا metadata إطلاقًا', async () => {
      const prisma = createPrismaMock();
      const service = new FinancialPostingService(
        prisma as unknown as PrismaService,
      );
      prisma.$transaction.mockImplementation(
        (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
      );
      prisma.journalEntry.findUnique.mockResolvedValue({
        id: 'je-bare',
        code: 'JE-BARE',
        createdAt: new Date('2026-08-26T00:00:00.000Z'),
        isReversed: false,
        metadata: null,
        lines: [
          {
            debitAccountId: 'advances-account',
            creditAccountId: 'cash-account',
            amount: 100,
            description: null,
          },
        ],
      });

      await expect(
        service.reverseJournalEntry('je-bare', 'user-2'),
      ).rejects.toThrow('بلا أثر جانبي موثق');
      expect(prisma.journalEntry.updateMany).not.toHaveBeenCalled();
    });
  });

  // PRD-5 (W2-3 — إنتاج): مسار الإنتاج يمرر Prisma.Decimal من مصدره —
  // يجب أن يصل المبلغ إلى journal_lines وتحديثات أرصدة الحسابات Decimal
  // كما هو (بلا toNumber/تحلل عائم)، مع بقاء لقطة metadata أرقامًا.
  describe('PRD-5 — مبالغ Decimal في سلسلة الترحيل', () => {
    it('يكتب بند القيد وزيادة الرصيد Decimal كما وردت دون تحلل عائم', async () => {
      const prisma = createPrismaMock();
      const service = new FinancialPostingService(
        prisma as unknown as PrismaService,
      );
      prisma.fiscalPeriod.findFirst.mockResolvedValue(openPeriod);
      prisma.account.findMany.mockResolvedValue([
        { id: 'fg-account', isActive: true, isGroup: false },
        { id: 'wip-account', isActive: true, isGroup: false },
      ]);
      prisma.journalEntry.create.mockResolvedValue({
        id: 'je-prd5',
        code: 'JE-PRD5',
        createdAt: new Date('2026-09-06T00:00:00.000Z'),
      });

      const result = await service.postJournalEntryInTx(
        prisma as never,
        {
          description: 'ترحيل إنتاج تام من أمر تشغيل #WO-1',
          postingKey: 'production-completion:wo-1',
          isAuto: true,
          lines: [
            {
              debitAccountId: 'fg-account',
              creditAccountId: 'wip-account',
              amount: new Prisma.Decimal('150.55'),
            },
          ],
        },
        'user-1',
      );

      // البند يُكتب بالقيمة الأصلية (Decimal) — نفس الكائن دقةً
      const createCalls = prisma.journalEntry.create.mock.calls as unknown as [
        [
          {
            data: {
              lines: {
                create: Array<{
                  amount: number | Prisma.Decimal;
                }>;
              };
            };
          },
        ],
      ];
      const writtenAmount = createCalls[0][0].data.lines.create[0]
        .amount as Prisma.Decimal;
      expect(Prisma.Decimal.isDecimal(writtenAmount)).toBe(true);
      expect(writtenAmount.eq(150.55)).toBe(true);
      expect(writtenAmount.toString()).toBe('150.55');

      // ACC-7 (GF-IMP-W3): أرصدة الحسابات تُحدَّث بدفعة خام واحدة
      // (UPDATE ... FROM (VALUES ...)) — لا حلقة await متتابعة. الدلتات
      // تصل معاملات Decimal كما هي (لا تحلل عائم في السلسلة).
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
      expect(prisma.account.update).not.toHaveBeenCalled();
      const executeCalls = prisma.$executeRaw.mock.calls as unknown as [
        [{ strings: string[]; values: unknown[] }],
      ];
      const batchSql = executeCalls[0][0];
      // بيان واحد يجمع الحسابين: بنية UPDATE ... FROM (VALUES ...) AS t —
      // والتحويل الراجع ::text إلزامي (accounts.id عمود TEXT بUUID نصي):
      // بدونه يرمي PostgreSQL «operator does not exist: text = uuid».
      expect(batchSql.strings.join('?')).toContain(
        'UPDATE accounts SET balance = balance + t.d FROM (VALUES',
      );
      expect(batchSql.strings.join('?')).toContain(
        'AS t(id, d) WHERE accounts.id = t.id::text',
      );
      // القيم: (id, delta) لكل حساب — Decimal كما حُسبت في deltaMap
      expect(batchSql.values).toHaveLength(4);
      expect(batchSql.values).toContain('fg-account');
      expect(batchSql.values).toContain('wip-account');
      const deltas = batchSql.values.filter((v) => Prisma.Decimal.isDecimal(v));
      expect(deltas).toHaveLength(2);
      expect(deltas.some((d) => d.eq(150.55))).toBe(true);
      expect(deltas.some((d) => d.eq(-150.55))).toBe(true);

      // المجاميع في الاستجابة مطابقة للقيمة الدقيقة
      expect(result.totalDebit).toBe(150.55);
      expect(result.totalCredit).toBe(150.55);
    });
  });

  // ACC-7 (P2 — GF-IMP-W3): تحديث أرصدة الحسابات كان حلقة await متتابعة
  // (N round-trips داخل المعاملة لكل قيد) — قيد بـ k حسابات مختلفة يدفع
  // k استعلامات تسلسلية. الآن: تنفيذ خام موحد واحد يحدّث كل الحسابات
  // في بيان واحد ذري داخل نفس المعاملة (زيادة/خصم مضمونة بالدلتا).
  describe('ACC-7 — دفعة تحديث أرصدة الحسابات', () => {
    const arrangeTwoAccountEntry = () => {
      const prisma = createPrismaMock();
      const service = new FinancialPostingService(
        prisma as unknown as PrismaService,
      );
      prisma.fiscalPeriod.findFirst.mockResolvedValue(openPeriod);
      prisma.account.findMany.mockResolvedValue([
        { id: 'cash-account', isActive: true, isGroup: false },
        { id: 'revenue-account', isActive: true, isGroup: false },
        { id: 'cogs-account', isActive: true, isGroup: false },
      ]);
      prisma.journalEntry.create.mockResolvedValue({
        id: 'je-acc7',
        code: 'JE-ACC7',
        createdAt: new Date('2026-09-12T00:00:00.000Z'),
      });
      return { prisma, service };
    };

    it('قيد بحسابين يحدّثهما في $executeRaw واحد بلا تحديثات فردية', async () => {
      const { prisma, service } = arrangeTwoAccountEntry();

      await service.postJournalEntryInTx(
        prisma as never,
        {
          description: 'بيع نقدي',
          lines: [
            {
              debitAccountId: 'cash-account',
              creditAccountId: 'revenue-account',
              amount: 200,
            },
          ],
        },
        'user-acc7',
      );

      // بيان واحد للأرصدة (وليس بيانًا لكل حساب) وبلا account.update
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
      expect(prisma.account.update).not.toHaveBeenCalled();
      const batchSql = (
        prisma.$executeRaw.mock.calls as unknown as [
          [{ strings: string[]; values: unknown[] }],
        ]
      )[0][0];
      // ACC-7: التحويل الراجع t.id::text في شرط المطابقة — عمود
      // accounts.id في القاعدة TEXT (UUID نصي) فالمقارنة المباشرة
      // بالـ uuid الممرر في VALUES ترمي خطأ عامل غير موجود.
      expect(batchSql.strings.join('?')).toContain(
        'WHERE accounts.id = t.id::text',
      );
      expect(batchSql.values).toContain('cash-account');
      expect(batchSql.values).toContain('revenue-account');
      expect(
        batchSql.values.some((v) => Prisma.Decimal.isDecimal(v) && v.eq(200)),
      ).toBe(true);
      expect(
        batchSql.values.some((v) => Prisma.Decimal.isDecimal(v) && v.eq(-200)),
      ).toBe(true);
    });

    it('حساب مشترك بين عدة بنود يظهر مرة واحدة بدلتا مجمّعة', async () => {
      const { prisma, service } = arrangeTwoAccountEntry();

      // بندان يقيّدان cash مرتين (مدين 200 ثم دائن 50) — الدلتا الصافية 150
      await service.postJournalEntryInTx(
        prisma as never,
        {
          description: 'قيد ببندين على حساب مشترك',
          lines: [
            {
              debitAccountId: 'cash-account',
              creditAccountId: 'revenue-account',
              amount: 200,
            },
            {
              debitAccountId: 'cogs-account',
              creditAccountId: 'cash-account',
              amount: 50,
            },
          ],
        },
        'user-acc7',
      );

      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
      const batchSql = (
        prisma.$executeRaw.mock.calls as unknown as [
          [{ strings: string[]; values: unknown[] }],
        ]
      )[0][0];
      // 3 حسابات × (id, delta) = 6 قيم فقط (cash مرة واحدة بدلتا 150)
      expect(batchSql.values).toHaveLength(6);
      const cashIndex = batchSql.values.indexOf('cash-account');
      const cashDelta = batchSql.values[cashIndex + 1] as Prisma.Decimal;
      expect(Prisma.Decimal.isDecimal(cashDelta)).toBe(true);
      expect(cashDelta.eq(150)).toBe(true);
    });
  });
});
