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
  };

  beforeEach(() => {
    service = {
      getChartOfAccounts: jest.fn().mockResolvedValue([]),
      createAccount: jest.fn().mockResolvedValue({ id: 'a-1' }),
      getVouchers: jest.fn().mockResolvedValue([]),
      createVoucher: jest.fn().mockResolvedValue({ id: 'v-1' }),
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
    );
  });

  it('إضافة حساب تمرر البيانات كما وردت', async () => {
    const body = { code: '1000', name: 'الصندوق', type: AccountType.ASSET };
    await controller.createAccount(body);
    expect(service.createAccount).toHaveBeenCalledWith(body);
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

  it('إنشاء سند مقيّد بـ ACCOUNTANT وCASHIER', () => {
    const roles = getMethodMetadata<UserRole[]>(
      ROLES_KEY,
      AccountingController.prototype,
      'createVoucher',
    );
    expect(roles).toEqual([UserRole.ACCOUNTANT, UserRole.CASHIER]);
  });
});
