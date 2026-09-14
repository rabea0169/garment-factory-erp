import { UserRole } from '@prisma/client';
import {
  PERMISSION_ACTIONS,
  PERMISSION_RESOURCES,
  actionFromHttpMethod,
  computeEffectivePermissions,
  getRoleDefaultPermissions,
  hasExplicitPermission,
  hasPermission,
  isAllowedPermission,
  normalizeStoredPermissions,
  resourceFromRoutePath,
} from './permissions.domain';

/**
 * SELIM-ERP W4: اختبارات مجال الصلاحيات — نقل نموذج UserPermission
 * من المرجع (SPRINT 81): الدور خط أساس + صريح يضيف + بدل '*'.
 */
describe('permissions.domain — الصلاحيات التفصيلية (SELIM-ERP W4)', () => {
  describe('isAllowedPermission', () => {
    it('يقبل الموارد والأفعال المعروفة والبدل *', () => {
      expect(isAllowedPermission('sales', 'READ')).toBe(true);
      expect(isAllowedPermission('*', '*')).toBe(true);
    });
    it('يرفض قيمًا شاذة (حماية تخزين)', () => {
      expect(isAllowedPermission('hackers', 'READ')).toBe(false);
      expect(isAllowedPermission('sales', 'EXEC')).toBe(false);
      expect(isAllowedPermission('', '')).toBe(false);
    });
  });

  describe('normalizeStoredPermissions', () => {
    it('يسقط الصفوف الدخيلة والتكرارات ويحفظ الصالح', () => {
      const out = normalizeStoredPermissions([
        { resource: 'sales', action: 'READ' },
        { resource: 'sales', action: 'READ' }, // تكرار
        { resource: 'nope', action: 'READ' }, // مورد مجهول
        { resource: 'users', action: 'EXECUTE' }, // فعل مجهول
        { resource: '*', action: '*' }, // بدل صالح
        'garbage', // ليس كائنًا
        null,
        { resource: 5, action: 'READ' }, // أنواع خاطئة
      ]);
      expect(out).toEqual([
        { resource: 'sales', action: 'READ' },
        { resource: '*', action: '*' },
      ]);
    });
    it('غير الصفيف يرجع []', () => {
      expect(normalizeStoredPermissions(null)).toEqual([]);
      expect(normalizeStoredPermissions({})).toEqual([]);
      expect(normalizeStoredPermissions('sales')).toEqual([]);
    });
  });

  describe('hasExplicitPermission', () => {
    it('مطابقة مباشرة', () => {
      const perms = [{ resource: 'sales', action: 'READ' }];
      expect(hasExplicitPermission(perms, 'sales', 'READ')).toBe(true);
      expect(hasExplicitPermission(perms, 'sales', 'CREATE')).toBe(false);
      expect(hasExplicitPermission(perms, 'purchases', 'READ')).toBe(false);
    });
    it('البدل *:* يطابق كل شيء', () => {
      const perms = [{ resource: '*', action: '*' }];
      expect(hasExplicitPermission(perms, 'accounting', 'APPROVE')).toBe(true);
    });
    it('بدل المورد فقط أو الفعل فقط', () => {
      expect(
        hasExplicitPermission(
          [{ resource: '*', action: 'READ' }],
          'hr',
          'READ',
        ),
      ).toBe(true);
      expect(
        hasExplicitPermission(
          [{ resource: 'hr', action: '*' }],
          'hr',
          'DELETE',
        ),
      ).toBe(true);
    });
  });

  describe('hasPermission — الدور أساس + الصريح يضيف', () => {
    it('SUPER_ADMIN يمر دائمًا (نفس owner/admin في المرجع)', () => {
      expect(hasPermission(UserRole.SUPER_ADMIN, null, 'users', 'DELETE')).toBe(
        true,
      );
    });
    it('افتراضيات الدور تعمل بلا صريح (CASHIER يقرأ sales)', () => {
      expect(hasPermission(UserRole.CASHIER, null, 'sales', 'READ')).toBe(true);
      expect(hasPermission(UserRole.CASHIER, null, 'sales', 'CREATE')).toBe(
        true,
      );
    });
    it('حدود الدور تُحترم (VIEWER لا ينشئ مبيعات)', () => {
      expect(hasPermission(UserRole.VIEWER, null, 'sales', 'CREATE')).toBe(
        false,
      );
    });
    it('منح صريح يفتح ما يحجبه الدور (كاشير يقرأ التقارير المالية)', () => {
      const grant = [{ resource: 'financial-reports', action: 'READ' }];
      expect(
        hasPermission(UserRole.CASHIER, grant, 'financial-reports', 'READ'),
      ).toBe(true);
    });
    it('GM لا يملك users كتابةً (SA حصري) لكن يقرؤها', () => {
      expect(
        hasPermission(UserRole.GENERAL_MANAGER, null, 'users', 'READ'),
      ).toBe(true);
      expect(
        hasPermission(UserRole.GENERAL_MANAGER, null, 'users', 'CREATE'),
      ).toBe(false);
    });
  });

  describe('computeEffectivePermissions', () => {
    it('SUPER_ADMIN → بطاقة wildcard واحدة', () => {
      const out = computeEffectivePermissions(UserRole.SUPER_ADMIN, []);
      expect(out).toEqual({
        permissions: [{ resource: '*', action: '*' }],
        source: 'super',
      });
    });
    it('لا صريح → افتراضيات الدور (source: role)', () => {
      const out = computeEffectivePermissions(UserRole.VIEWER, null);
      expect(out.source).toBe('role');
      expect(out.permissions.length).toBeGreaterThan(0);
    });
    it('صريح موجود → هو الفعال (source: user)', () => {
      const grant = [{ resource: 'sales', action: 'READ' }];
      const out = computeEffectivePermissions(UserRole.VIEWER, grant);
      expect(out).toEqual({ permissions: grant, source: 'user' });
    });
    it('صفوف دخيلة تُعامل كأنها لا شيء (fallback للدور)', () => {
      const out = computeEffectivePermissions(UserRole.VIEWER, ['junk']);
      expect(out.source).toBe('role');
    });
  });

  describe('getRoleDefaultPermissions', () => {
    it('كل دور له مصفوفة صالحة', () => {
      for (const role of Object.values(UserRole)) {
        const defaults = getRoleDefaultPermissions(role);
        expect(Array.isArray(defaults)).toBe(true);
        for (const p of defaults) {
          expect(isAllowedPermission(p.resource, p.action)).toBe(true);
        }
      }
    });
  });

  describe('actionFromHttpMethod', () => {
    it('GET→READ، POST→CREATE، PATCH/PUT→UPDATE، DELETE→DELETE', () => {
      expect(actionFromHttpMethod('GET')).toBe('READ');
      expect(actionFromHttpMethod('POST')).toBe('CREATE');
      expect(actionFromHttpMethod('PATCH')).toBe('UPDATE');
      expect(actionFromHttpMethod('PUT')).toBe('UPDATE');
      expect(actionFromHttpMethod('DELETE')).toBe('DELETE');
      expect(actionFromHttpMethod('get')).toBe('READ');
    });
  });

  describe('resourceFromRoutePath', () => {
    it('يفك الأسماء البديلة', () => {
      expect(resourceFromRoutePath('purchasing')).toBe('purchases');
      expect(resourceFromRoutePath('treasury-transactions')).toBe('treasury');
      expect(resourceFromRoutePath('import')).toBe('data-import');
      expect(resourceFromRoutePath('export')).toBe('exports');
      expect(resourceFromRoutePath('system/factory-settings')).toBe('settings');
      expect(resourceFromRoutePath('system/restore')).toBe('backup');
    });
    it('مورد المعالج يغلب مورد المتحكم (system/audit-logs)', () => {
      expect(resourceFromRoutePath('system/audit-logs')).toBe('audit-logs');
    });
    it('جزء غير معروف يتراجع لأقرب مورد سابق (backup/summary)', () => {
      expect(resourceFromRoutePath('system/backup/summary')).toBe('backup');
    });
    it('مسار بلا مورد معروف يرجع آخر جزء (فشل آمن: لا منح عرضي)', () => {
      expect(resourceFromRoutePath('x/y/z')).toBe('z');
      expect(resourceFromRoutePath('')).toBe('');
    });
  });

  describe('اتساق الثوابت', () => {
    it('الأفعال الستة كما في المرجع', () => {
      expect([...PERMISSION_ACTIONS]).toEqual([
        'READ',
        'CREATE',
        'UPDATE',
        'DELETE',
        'EXPORT',
        'APPROVE',
      ]);
    });
    it('الموارد كلها بلا فواصل علوية', () => {
      for (const r of PERMISSION_RESOURCES) {
        expect(r).not.toContain(' ');
      }
    });
  });
});
