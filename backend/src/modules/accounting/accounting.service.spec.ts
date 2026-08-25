import { AccountType, VoucherType } from '@prisma/client';
import { AccountingService } from './accounting.service';
import { PrismaService } from '../../prisma/prisma.service';
import { createPrismaMock } from '../../../test/helpers/prisma-mock';

describe('AccountingService — الحسابات والسندات (GF-0003)', () => {
  let service: AccountingService;
  let prisma: ReturnType<typeof createPrismaMock>;

  beforeEach(() => {
    prisma = createPrismaMock();
    service = new AccountingService(prisma as unknown as PrismaService);
  });

  it('يجلب شجرة الحسابات مرتبة بالكود تصاعديًا', async () => {
    const accounts = [
      { id: 'a-1', code: '1000', name: 'الصندوق' },
      { id: 'a-2', code: '1100', name: 'البنك' },
    ];
    prisma.account.findMany.mockResolvedValue(accounts);
    prisma.account.count.mockResolvedValue(accounts.length);

    const result = await service.getChartOfAccounts();

    expect(result.data).toEqual(accounts);
    expect(prisma.account.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { code: 'asc' } }),
    );
  });

  it('ينشئ حسابًا بنوعه من الـ enum وبلا isGroup افتراضيًا', async () => {
    prisma.account.create.mockResolvedValue({ id: 'a-3' });

    await service.createAccount({
      code: '1200',
      name: 'ذمم العملاء',
      type: AccountType.ASSET,
    });

    expect(prisma.account.create).toHaveBeenCalledWith({
      data: {
        code: '1200',
        name: 'ذمم العملاء',
        type: AccountType.ASSET,
        parentId: undefined,
        isGroup: false,
      },
    });
  });

  it('يجلب السندات مع اسم منشئها فقط (لا كلمة مرور ولا بيانات حساسة)', async () => {
    const vouchers = [{ id: 'v-1', createdBy: { name: 'المحاسب' } }];
    prisma.voucher.findMany.mockResolvedValue(vouchers);
    prisma.voucher.count.mockResolvedValue(vouchers.length);

    const result = await service.getVouchers();

    expect(result.data).toEqual(vouchers);
    expect(prisma.voucher.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: { createdBy: { select: { name: true } } },
        orderBy: { date: 'desc' },
      }),
    );
  });

  it('ينشئ سندًا بكود VCH-* والمنشئ من الجلسة (المعامل الثاني)', async () => {
    prisma.voucher.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: 'v-9', ...data }),
    );

    const result = await service.createVoucher(
      {
        type: VoucherType.PAYMENT,
        amount: 500,
        description: 'صرف نثريات',
      },
      'user-from-session',
    );

    expect(result.code).toMatch(/^VCH-\d+$/);
    expect(prisma.voucher.create).toHaveBeenCalledWith({
      data: {
        code: expect.stringMatching(/^VCH-\d+$/) as string,
        type: VoucherType.PAYMENT,
        amount: 500,
        description: 'صرف نثريات',
        reference: undefined,
        createdById: 'user-from-session',
      },
    });
  });
});
