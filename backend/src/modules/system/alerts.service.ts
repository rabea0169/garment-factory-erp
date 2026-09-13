import { Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { FactorySettingsService } from './factory-settings.service';

/**
 * SELIM-ERP W3 — التنبيهات الذكية (نقل من src/lib/db/alerts.ts في Selim
 * ERP: نفس الأنواع الستة ودرجة الخطورة، مع تكييفين مهمين):
 *
 * 1. **تنبيه النسخ الاحتياطي من الخادم** — المرجع يقرأ آخر نسخة من
 *    localStorage في المتصفح (يضيع بمسح الكاش)؛ عندنا lastBackupAt
 *    في factory_settings يسجّله الباكند بعد كل تصدير ناجح.
 * 2. الاستعلامات على مخططنا (customers.balance، attendance بتاريخ
 *    اليوم، expenses بالشهر الحالي، raw_materials.min_stock_level).
 *
 * التنبيهات قراءة فقط — كل الأدوار الموثقة تراها (لوحة الجرس عامة
 * مثل Selim). البيانات المالية تُعرض كأرقام مجمّعة فقط.
 */

/** شكل تنبيه واحد (نفس SmartAlert في المرجع). */
export interface SmartAlert {
  id: string;
  type: 'warning' | 'info' | 'danger' | 'success';
  title: string;
  message: string;
  icon: string;
  actionLabel?: string;
  /** مسار الانتقال في التطبيق عند الضغط. */
  actionRoute?: string;
}

/** حد «المصاريف المرتفعة» — نفس عتبة المرجع (50000). */
const HIGH_EXPENSES_THRESHOLD = 50_000;

/** أسبوع بلا نسخة احتياطية → تنبيه danger (نفس سلوك المرجع). */
const BACKUP_REMINDER_DAYS = 7;

@Injectable()
export class AlertsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly factorySettings: FactorySettingsService,
  ) {}

  /** يجمع كل التنبيهات دفعة واحدة (استعلامات مستقلة بالتوازي). */
  async getAlerts(role: UserRole): Promise<SmartAlert[]> {
    const alerts: SmartAlert[] = [];
    const today = new Date();
    const todayStart = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
    );
    const monthStart = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1),
    );

    const [
      dueCustomers,
      todayAttendance,
      workersCount,
      todaySales,
      monthExpenses,
      rawMaterials,
      settings,
    ] = await Promise.all([
      this.prisma.customer.aggregate({
        where: { balance: { gt: 0 }, deletedAt: null, isActive: true },
        _count: { _all: true },
        _sum: { balance: true },
      }),
      this.prisma.attendance.findMany({
        where: { date: todayStart, isPresent: true },
        select: { workerId: true },
      }),
      this.prisma.worker.count({ where: { isActive: true } }),
      this.prisma.salesOrder.aggregate({
        where: {
          createdAt: { gte: todayStart },
          status: { in: ['CONFIRMED', 'SHIPPED'] },
        },
        _count: { _all: true },
        _sum: { totalAmount: true },
      }),
      this.prisma.expense.aggregate({
        where: { date: { gte: monthStart } },
        _sum: { amount: true },
      }),
      this.prisma.rawMaterial.findMany({
        where: { isActive: true },
        select: { currentStock: true, minStockLevel: true },
      }),
      this.factorySettings.getSettings(),
    ]);

    // 1. مبالغ مستحقة على العملاء
    const dueCount = dueCustomers._count._all;
    const dueTotal = Number(dueCustomers._sum.balance ?? 0);
    if (dueCount > 0) {
      alerts.push({
        id: 'due-customers',
        type: 'warning',
        title: 'مبالغ مستحقة',
        message: `${dueCount} عميل عليهم مبالغ متبقية بإجمالي ${dueTotal.toLocaleString('ar-EG-u-nu-latn')} ج.م`,
        icon: '💰',
        actionLabel: 'عرض العملاء',
        actionRoute: '/sales',
      });
    }

    // 2. عمال لم يسجلوا حضور اليوم
    const attended = new Set(todayAttendance.map((a) => a.workerId));
    const absent = workersCount - attended.size;
    if (absent > 0 && workersCount > 0) {
      alerts.push({
        id: 'absent-workers',
        type: 'info',
        title: 'حضور اليوم',
        message: `${absent} عامل لم يتم تسجيل حضورهم اليوم`,
        icon: '⏰',
        actionLabel: 'تسجيل الحضور',
        actionRoute: '/hr',
      });
    }

    // 3. تذكير النسخ الاحتياطي (من الخادم — بلا localStorage)
    const lastBackup = settings.lastBackupAt;
    const weekAgo = Date.now() - BACKUP_REMINDER_DAYS * 24 * 60 * 60 * 1000;
    if (!lastBackup || lastBackup.getTime() < weekAgo) {
      const adminOnly =
        role === UserRole.SUPER_ADMIN || role === UserRole.GENERAL_MANAGER;
      if (adminOnly) {
        alerts.push({
          id: 'backup-reminder',
          type: 'danger',
          title: 'نسخة احتياطية',
          message: !lastBackup
            ? 'لم تُنشأ أي نسخة احتياطية بعد. احفظ بياناتك!'
            : 'مر أكثر من أسبوع على آخر نسخة احتياطية. احفظ بياناتك!',
          icon: '💾',
          actionLabel: 'نسخ احتياطي',
          actionRoute: '/system',
        });
      }
    }

    // 4. مبيعات اليوم
    const salesCount = todaySales._count._all;
    const salesTotal = Number(todaySales._sum.totalAmount ?? 0);
    if (salesCount > 0) {
      alerts.push({
        id: 'today-sales',
        type: 'success',
        title: 'مبيعات اليوم',
        message: `${salesCount} فاتورة اليوم بإجمالي ${salesTotal.toLocaleString('ar-EG-u-nu-latn')} ج.م`,
        icon: '📈',
        actionLabel: 'المبيعات',
        actionRoute: '/sales',
      });
    }

    // 5. فحص المصاريف الزائدة (بداية الشهر حتى الآن)
    const expensesTotal = Number(monthExpenses._sum.amount ?? 0);
    if (expensesTotal > HIGH_EXPENSES_THRESHOLD) {
      alerts.push({
        id: 'high-expenses',
        type: 'warning',
        title: 'مصاريف مرتفعة',
        message: `مصاريف الشهر الحالي بلغت ${expensesTotal.toLocaleString('ar-EG-u-nu-latn')} ج.م — راجع البنود`,
        icon: '📊',
        actionLabel: 'المصاريف',
        actionRoute: '/expenses',
      });
    }

    // 6. نقص المخزون (خامات عند/تحت حد الطلب) — عدّ برمجي (جدول صغير).
    const lowStock = rawMaterials.filter(
      (m) => Number(m.currentStock) <= Number(m.minStockLevel),
    ).length;
    if (lowStock > 0) {
      alerts.push({
        id: 'low-stock',
        type: 'danger',
        title: 'نقص المخزون',
        message: `${lowStock} خامة وصلت حد إعادة الطلب أو دونه`,
        icon: '📦',
        actionLabel: 'المخزون',
        actionRoute: '/inventory',
      });
    }

    return alerts;
  }
}
