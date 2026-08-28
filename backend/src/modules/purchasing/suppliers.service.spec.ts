import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createPrismaMock } from '../../../test/helpers/prisma-mock';
import { PrismaService } from '../../prisma/prisma.service';
import { SuppliersService } from './suppliers.service';

describe('SuppliersService — supplier master data', () => {
  let service: SuppliersService;
  let prisma: ReturnType<typeof createPrismaMock>;

  beforeEach(() => {
    prisma = createPrismaMock();
    // RES-F02: $transaction must invoke the callback with the prisma mock
    // so the inner tx.supplier.create / tx.idempotencyKey calls resolve.
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
    );
    prisma.idempotencyKey.findUnique.mockResolvedValue(null);
    service = new SuppliersService(prisma as unknown as PrismaService);
  });

  it('lists only active, non-deleted suppliers with pagination', async () => {
    prisma.supplier.findMany.mockResolvedValue([]);
    prisma.supplier.count.mockResolvedValue(0);

    const result = await service.getSuppliers({ page: 2, limit: 10 });

    expect(result.data).toEqual([]);
    expect(prisma.supplier.findMany).toHaveBeenCalledWith({
      where: { isActive: true, deletedAt: null },
      skip: 10,
      take: 10,
      orderBy: { createdAt: 'desc' },
    });
    expect(prisma.supplier.count).toHaveBeenCalledWith({
      where: { isActive: true, deletedAt: null },
    });
  });

  it('trims supplier fields and generates a supplier code', async () => {
    prisma.supplier.create.mockResolvedValue({ id: 'sup-1' });

    await service.createSupplier({
      name: '  شركة النسيج  ',
      phone: ' 01000000000 ',
      email: ' SALES@EXAMPLE.COM ',
      address: ' القاهرة ',
      notes: '  مورد أساسي ',
    });

    const calls = prisma.supplier.create.mock.calls as unknown as Array<
      [{ data: Record<string, unknown> }]
    >;
    const createCall = calls[0]?.[0];
    expect(createCall).toBeDefined();
    if (!createCall) throw new Error('supplier.create was not called');

    expect(createCall.data.name).toBe('شركة النسيج');
    expect(createCall.data.phone).toBe('01000000000');
    expect(createCall.data.email).toBe('sales@example.com');
    expect(createCall.data.address).toBe('القاهرة');
    expect(createCall.data.notes).toBe('مورد أساسي');
    expect(createCall.data.code).toEqual(expect.stringMatching(/^SUP-/));
  });

  it('maps supplier unique conflicts to 409', async () => {
    prisma.supplier.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: '7.9.1',
      }),
    );

    await expect(
      service.createSupplier({ name: 'شركة مكررة' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
