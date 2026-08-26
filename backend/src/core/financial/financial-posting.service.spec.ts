import { FinancialPostingService } from './financial-posting.service';
import { PrismaService } from '../../prisma/prisma.service';
import { createPrismaMock } from '../../../test/helpers/prisma-mock';

describe('FinancialPostingService — keyed posting idempotency', () => {
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
});
