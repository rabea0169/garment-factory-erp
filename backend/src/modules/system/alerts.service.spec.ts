import 'reflect-metadata';
import { UserRole } from '@prisma/client';
import { AlertsService, SmartAlert } from './alerts.service';
import { FactorySettingsService } from './factory-settings.service';
import { PrismaService } from '../../prisma/prisma.service';
import { createPrismaMock } from '../../../test/helpers/prisma-mock';

/**
 * SELIM-ERP W3 — اختبارات التنبيهات الذكية (نفس حالات المرجع الستة):
 * مستحقات العملاء، غياب اليوم، تذكير النسخ الاحتياطي (من الخادم —
 * تصحيح اعتماد المرجع على localStorage)، مبيعات اليوم، مصاريف مرتفعة،
 * نقص المخزون.
 */

describe('AlertsService — التنبيهات الذكية (SELIM W3)', () => {
  let service: AlertsService;
  let prisma: ReturnType<typeof createPrismaMock>;
  let factorySettings: { getSettings: jest.Mock };

  beforeEach(() => {
    prisma = createPrismaMock();
    factorySettings = { getSettings: jest.fn() };
    service = new AlertsService(
      prisma as unknown as PrismaService,
      factorySettings as unknown as FactorySettingsService,
    );

    // حالة ساكنة افتراضية: لا تنبيهات إطلاقًا.
    prisma.customer.aggregate.mockResolvedValue({
      _count: { _all: 0 },
      _sum: { balance: null },
    });
    prisma.attendance.findMany.mockResolvedValue([]);
    prisma.worker.count.mockResolvedValue(0);
    prisma.salesOrder.aggregate.mockResolvedValue({
      _count: { _all: 0 },
      _sum: { totalAmount: null },
    });
    prisma.expense.aggregate.mockResolvedValue({ _sum: { amount: null } });
    prisma.rawMaterial.findMany.mockResolvedValue([]);
    factorySettings.getSettings.mockResolvedValue({
      lastBackupAt: new Date(),
    });
  });

  const idsOf = (alerts: SmartAlert[]) => alerts.map((a) => a.id);

  it('لا تنبيهات في الحالة الساكنة', async () => {
    const alerts = await service.getAlerts(UserRole.CASHIER);
    expect(alerts).toEqual([]);
  });

  it('مستحقات العملاء: عدّ + إجمالي + مسار الانتقال', async () => {
    prisma.customer.aggregate.mockResolvedValue({
      _count: { _all: 3 },
      _sum: { balance: '12500.50' },
    });
    const alerts = await service.getAlerts(UserRole.CASHIER);
    const due = alerts.find((a) => a.id === 'due-customers');
    expect(due).toBeDefined();
    expect(due?.type).toBe('warning');
    expect(due?.message).toContain('3');
    expect(due?.message).toContain('12,500.5');
    expect(due?.actionRoute).toBe('/sales');
  });

  it('غياب اليوم: عدد العمال النشطين ناقص من سجّل حضور اليوم', async () => {
    prisma.worker.count.mockResolvedValue(10);
    prisma.attendance.findMany.mockResolvedValue([
      { workerId: 'w-1' },
      { workerId: 'w-2' },
    ]);
    const alerts = await service.getAlerts(UserRole.HR_MANAGER);
    const absent = alerts.find((a) => a.id === 'absent-workers');
    expect(absent).toBeDefined();
    expect(absent?.message).toContain('8');
  });

  it('تذكير النسخ: null → تنبيه خطر للمدير فقط (لا localStorage)', async () => {
    factorySettings.getSettings.mockResolvedValue({ lastBackupAt: null });
    const adminAlerts = await service.getAlerts(UserRole.SUPER_ADMIN);
    expect(idsOf(adminAlerts)).toContain('backup-reminder');
    expect(adminAlerts.find((a) => a.id === 'backup-reminder')?.type).toBe(
      'danger',
    );

    // الكاشير لا يرى تذكير النسخ (لا يستطيع عمل نسخة أصلًا).
    const cashierAlerts = await service.getAlerts(UserRole.CASHIER);
    expect(idsOf(cashierAlerts)).not.toContain('backup-reminder');
  });

  it('تذكير النسخ: آخر نسخة قريبة (اليوم) → لا تنبيه', async () => {
    factorySettings.getSettings.mockResolvedValue({
      lastBackupAt: new Date(),
    });
    const alerts = await service.getAlerts(UserRole.SUPER_ADMIN);
    expect(idsOf(alerts)).not.toContain('backup-reminder');
  });

  it('مبيعات اليوم: عدد + إجمالي (نجاح)', async () => {
    prisma.salesOrder.aggregate.mockResolvedValue({
      _count: { _all: 7 },
      _sum: { totalAmount: '4200' },
    });
    const alerts = await service.getAlerts(UserRole.CASHIER);
    const sales = alerts.find((a) => a.id === 'today-sales');
    expect(sales?.type).toBe('success');
    expect(sales?.message).toContain('7');
  });

  it('مصاريف الشهر فوق العتبة (50000) → تحذير', async () => {
    prisma.expense.aggregate.mockResolvedValue({ _sum: { amount: '61000' } });
    const alerts = await service.getAlerts(UserRole.ACCOUNTANT);
    const expenses = alerts.find((a) => a.id === 'high-expenses');
    expect(expenses?.type).toBe('warning');
    expect(expenses?.actionRoute).toBe('/expenses');
  });

  it('نقص المخزون: خامات عند/تحت حد الطلب (عدّ برمجي)', async () => {
    prisma.rawMaterial.findMany.mockResolvedValue([
      { currentStock: '2', minStockLevel: '10' }, // نقص
      { currentStock: '50', minStockLevel: '10' }, // سليم
      { currentStock: '10', minStockLevel: '10' }, // عند الحد (يساوي)
    ]);
    const alerts = await service.getAlerts(UserRole.INVENTORY_MANAGER);
    const low = alerts.find((a) => a.id === 'low-stock');
    expect(low).toBeDefined();
    expect(low?.type).toBe('danger');
    expect(low?.message).toContain('2');
  });
});
