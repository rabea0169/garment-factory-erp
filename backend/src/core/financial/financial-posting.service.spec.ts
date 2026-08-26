import { FinancialPostingService } from './financial-posting.service';
import { PrismaService } from '../../prisma/prisma.service';
import { createPrismaMock } from '../../../test/helpers/prisma-mock';

describe('FinancialPostingService', () => {
  it('replays the same keyed posting without creating a second journal entry', async () => {
    const prisma = createPrismaMock();
    const service = new FinancialPostingService(
      prisma as unknown as PrismaService,
    );
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
  });
});
