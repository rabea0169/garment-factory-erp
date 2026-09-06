import 'reflect-metadata';
import { AccountType, UserRole, VoucherType } from '@prisma/client';
import { AccountingController } from './accounting.controller';
import { AccountingService } from './accounting.service';
import { ROLES_KEY } from '../auth/roles.guard';
import { getMethodMetadata } from '../../../test/helpers/method-metadata';
import { CreateVoucherDto } from './dto/create-voucher.dto';

describe('AccountingController — هوية الجلسة والصلاحيات (GF-0003)', () => {
  let controller: AccountingController;
  let service: {
    getChartOfAccounts: jest.Mock;
    createAccount: jest.Mock;
    getVouchers: jest.Mock;
    createVoucher: jest.Mock;
    createFiscalPeriod: jest.Mock;
    closeFiscalPeriod: jest.Mock;
    createJournalEntry: jest.Mock;
    getJournalEntries: jest.Mock;
    getAccountStatement: jest.Mock;
    getTrialBalance: jest.Mock;
  };

  beforeEach(() => {
    service = {
      getChartOfAccounts: jest.fn().mockResolvedValue([]),
      createAccount: jest.fn().mockResolvedValue({ id: 'a-1' }),
      getVouchers: jest.fn().mockResolvedValue([]),
      createVoucher: jest.fn().mockResolvedValue({ id: 'v-1' }),
      createFiscalPeriod: jest.fn().mockResolvedValue({ id: 'period-1' }),
      closeFiscalPeriod: jest.fn().mockResolvedValue({ id: 'period-1' }),
      createJournalEntry: jest.fn().mockResolvedValue({ entryId: 'je-1' }),
      getJournalEntries: jest.fn().mockResolvedValue({ data: [], meta: {} }),
      getAccountStatement: jest.fn().mockResolvedValue({ data: [], meta: {} }),
      getTrialBalance: jest
        .fn()
        .mockResolvedValue({ data: [], balanced: true }),
    };
    controller = new AccountingController(
      service as unknown as AccountingService,
    );
  });

  it('إنشاء سند يمرر هوية الجلسة (من @CurrentUser) ويتجاهل createdById من الطلب', async () => {
    const body: CreateVoucherDto & { createdById?: string } = {
      type: VoucherType.PAYMENT,
      amount: 100,
      description: 'اختبار',
      treasuryId: '00000000-0000-0000-0000-000000000001',
      createdById: 'HACKED-USER-ID',
    };
    await controller.createVoucher('user-from-session', body);

    expect(service.createVoucher).toHaveBeenCalledWith(
      expect.anything(),
      'user-from-session',
      undefined,
    );
  });

  it('يمرر الفترة والقيد مع actor من الجلسة', async () => {
    const period = {
      name: '2026-08',
      startDate: '2026-08-01',
      endDate: '2026-08-31',
    };
    const journal = {
      description: 'قيد اختبار',
      fiscalPeriodId: 'period-1',
      lines: [],
    };
    await controller.createFiscalPeriod(period, 'user-1');
    await controller.createJournalEntry(journal, 'user-1');
    await controller.closeFiscalPeriod('period-1', 'user-1');

    expect(service.createFiscalPeriod).toHaveBeenCalledWith(
      period,
      'user-1',
      undefined,
    );
    expect(service.createJournalEntry).toHaveBeenCalledWith(
      journal,
      'user-1',
      undefined,
    );
    expect(service.closeFiscalPeriod).toHaveBeenCalledWith(
      'period-1',
      'user-1',
    );
  });

  it('إضافة حساب تمرر البيانات كما وردت', async () => {
    const body = { code: '1000', name: 'الصندوق', type: AccountType.ASSET };
    await controller.createAccount(body);
    expect(service.createAccount).toHaveBeenCalledWith(body, undefined);
  });

  it('قراءة شجرة الحسابات مقيّدة بـ ACCOUNTANT وGENERAL_MANAGER', () => {
    const roles = getMethodMetadata<UserRole[]>(
      ROLES_KEY,
      AccountingController.prototype,
      'getAccounts',
    );
    expect(roles).toEqual([UserRole.ACCOUNTANT, UserRole.GENERAL_MANAGER]);
  });

  it('إضافة حساب مقيّدة بـ ACCOUNTANT فقط', () => {
    const roles = getMethodMetadata<UserRole[]>(
      ROLES_KEY,
      AccountingController.prototype,
      'createAccount',
    );
    expect(roles).toEqual([UserRole.ACCOUNTANT]);
  });

  it('إنشاء الفترة والقيد والإغلاق مقيّدة بالأدوار المحاسبية', () => {
    for (const method of [
      'createFiscalPeriod',
      'closeFiscalPeriod',
      'createJournalEntry',
    ] as const) {
      const roles = getMethodMetadata<UserRole[]>(
        ROLES_KEY,
        AccountingController.prototype,
        method,
      );
      expect(roles).toEqual([UserRole.ACCOUNTANT, UserRole.GENERAL_MANAGER]);
    }
  });

  it('إنشاء سند مقيّد بـ ACCOUNTANT وCASHIER', () => {
    const roles = getMethodMetadata<UserRole[]>(
      ROLES_KEY,
      AccountingController.prototype,
      'createVoucher',
    );
    expect(roles).toEqual([UserRole.ACCOUNTANT, UserRole.CASHIER]);
  });

  // ACC-5 (P2 — GF-IMP-W3): أمين الصندوق ينشئ السندات — والقراءة آمنة،
  // فقائمة السندات تُتاح له (كانت ACCOUNTANT وGENERAL_MANAGER فقط).
  it('قراءة السندات تتاح لـ ACCOUNTANT وGENERAL_MANAGER وCASHIER (ACC-5)', () => {
    const roles = getMethodMetadata<UserRole[]>(
      ROLES_KEY,
      AccountingController.prototype,
      'getVouchers',
    );
    expect(roles).toEqual([
      UserRole.ACCOUNTANT,
      UserRole.GENERAL_MANAGER,
      UserRole.CASHIER,
    ]);
  });

  // ACC-6 (P2 — GF-IMP-W3): قائمة السندات تقبل VoucherQueryDto (فلاتر + ترقيم).
  it('قراءة السندات تمرر فلاتر الاستعلام إلى الخدمة (ACC-6)', async () => {
    const query = {
      page: 1,
      limit: 20,
      type: VoucherType.PAYMENT,
      treasuryId: '00000000-0000-0000-0000-000000000001',
      from: '2026-08-01T00:00:00.000Z',
      to: '2026-08-31T23:59:59.000Z',
    };
    await controller.getVouchers(query);
    expect(service.getVouchers).toHaveBeenCalledWith(query);
  });

  // ACC-8 (P2 — GF-IMP-W3): سطح القراءة المحاسبي — قيود/كشف حساب/ميزان مراجعة
  // للأدوار المالية: ACCOUNTANT وGENERAL_MANAGER وSUPER_ADMIN.
  it('نقاط القراءة المحاسبية الثلاث مقيّدة بالأدوار المالية (ACC-8)', () => {
    const expectedFinancialRoles = [
      UserRole.ACCOUNTANT,
      UserRole.GENERAL_MANAGER,
      UserRole.SUPER_ADMIN,
    ];
    for (const method of [
      'getJournalEntries',
      'getAccountStatement',
      'getTrialBalance',
    ] as const) {
      const roles = getMethodMetadata<UserRole[]>(
        ROLES_KEY,
        AccountingController.prototype,
        method,
      );
      expect(roles).toEqual(expectedFinancialRoles);
    }
  });

  it('يحوّل قائمة القيود وكشف الحساب وميزان المراجعة إلى الخدمة (ACC-8)', async () => {
    await controller.getJournalEntries({
      page: 1,
      limit: 20,
      isReversed: false,
    });
    await controller.getAccountStatement('acc-1', {
      page: 1,
      limit: 20,
      from: '2026-08-01T00:00:00.000Z',
    });
    await controller.getTrialBalance();

    expect(service.getJournalEntries).toHaveBeenCalledWith({
      page: 1,
      limit: 20,
      isReversed: false,
    });
    expect(service.getAccountStatement).toHaveBeenCalledWith('acc-1', {
      page: 1,
      limit: 20,
      from: '2026-08-01T00:00:00.000Z',
    });
    expect(service.getTrialBalance).toHaveBeenCalledWith();
  });
});
