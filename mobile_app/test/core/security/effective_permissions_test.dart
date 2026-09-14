import 'package:flutter_test/flutter_test.dart';

import 'package:garment_factory_erp/core/security/effective_permissions.dart';
import 'package:garment_factory_erp/core/security/route_access.dart';

/// SELIM-ERP W4 — الصلاحيات الفعالة في الجوال: الدور خط أساس، والصريحة
/// (effectivePermissions من /auth/me) تفتح مسارات فوق الدور (نفس hasPermission
/// في المرجع). الجلسة القديمة بلا صلاحيات تظل تعمل بفحص الدور وحده.
void main() {
  group('effectiveRowsOf', () {
    test('يقرأ الشكل الكنوني { permissions, source } من الخادم', () {
      final user = <String, dynamic>{
        'role': 'CASHIER',
        'effectivePermissions': {
          'permissions': [
            {'resource': 'reports', 'action': 'READ'},
            {'resource': '*', 'action': '*'},
          ],
          'source': 'user',
        },
      };
      final rows = effectiveRowsOf(user);
      expect(rows, hasLength(2));
      expect(rows.first.resource, 'reports');
      expect(rows.first.action, 'READ');
    });

    test('يتسامح مع الجلسة القديمة (permissions خام) وبلا شيء', () {
      expect(effectiveRowsOf(null), isEmpty);
      expect(effectiveRowsOf(<String, dynamic>{'role': 'VIEWER'}), isEmpty);
      // كاش قديم: الصلاحيات الخام تحت user['permissions'].
      final legacy = <String, dynamic>{
        'role': 'VIEWER',
        'permissions': [
          {'resource': 'hr', 'action': 'READ'},
          'garbage',
        ],
      };
      expect(effectiveRowsOf(legacy), hasLength(1));
      expect(effectiveRowsOf(legacy).first.resource, 'hr');
    });

    test('يسقط الصفوف غير الصالحة', () {
      final user = <String, dynamic>{
        'effectivePermissions': {
          'permissions': [
            {'resource': '', 'action': 'READ'},
            {'action': 'READ'},
            'x',
          ],
        },
      };
      expect(effectiveRowsOf(user), isEmpty);
    });
  });

  group('hasPermission', () {
    test('SUPER_ADMIN يمر دائمًا', () {
      final user = <String, dynamic>{'role': 'SUPER_ADMIN'};
      expect(hasPermission(user, 'users', 'DELETE'), isTrue);
    });

    test('بلا صفوف فعالة → false (الرايع فحص الدور)', () {
      final user = <String, dynamic>{'role': 'VIEWER'};
      expect(hasPermission(user, 'sales', 'READ'), isFalse);
    });

    test('منح صريح يفتح، والبدل *:* يفتح كل شيء', () {
      final grant = <String, dynamic>{
        'role': 'VIEWER',
        'effectivePermissions': {
          'permissions': [
            {'resource': 'financial-reports', 'action': 'READ'},
          ],
          'source': 'user',
        },
      };
      expect(hasPermission(grant, 'financial-reports', 'READ'), isTrue);
      expect(hasPermission(grant, 'financial-reports', 'CREATE'), isFalse);
      expect(hasPermission(grant, 'hr', 'READ'), isFalse);

      final wildcard = <String, dynamic>{
        'role': 'VIEWER',
        'effectivePermissions': {
          'permissions': [
            {'resource': '*', 'action': '*'},
          ],
        },
      };
      expect(hasPermission(wildcard, 'accounting', 'APPROVE'), isTrue);
    });
  });

  group('canAccessWithUser', () {
    test('الدور يكفي بلا صلاحيات (توافق كامل مع الوضع القائم)', () {
      final cashier = <String, dynamic>{'role': 'CASHIER'};
      expect(canAccessWithUser('/pos', cashier), isTrue);
      expect(canAccessWithUser('/users', cashier), isFalse);
    });

    test('منح صريح READ يفتح مسارًا محجوبًا عن الدور', () {
      final cashierWithGrant = <String, dynamic>{
        'role': 'CASHIER',
        'effectivePermissions': {
          'permissions': [
            {'resource': 'reports', 'action': 'READ'},
          ],
          'source': 'user',
        },
      };
      // /reports مقيد بـ GM/SA/ACC — الكاشير الممنوح يفتحه الآن.
      expect(canAccessWithUser('/reports', cashierWithGrant), isTrue);
      // مسار آخر بلا منح يبقى محجوبًا.
      expect(canAccessWithUser('/hr', cashierWithGrant), isFalse);
    });

    test('مورد المسار يُستنتج بأطول بادئة (المعاملات تتبع الأب)', () {
      final viewer = <String, dynamic>{
        'role': 'VIEWER',
        'effectivePermissions': {
          'permissions': [
            {'resource': 'hr', 'action': 'READ'},
          ],
        },
      };
      expect(canAccessWithUser('/hr/workers/w-1', viewer), isTrue);
      expect(canAccessWithUser('/hr/payrolls', viewer), isTrue);
    });
  });

  group('resourceOfRoute', () {
    test('خريطة المسار → المورد', () {
      expect(RouteAccess.resourceOfRoute('/inventory'), 'inventory');
      expect(RouteAccess.resourceOfRoute('/cost-centers'), 'accounting');
      expect(RouteAccess.resourceOfRoute('/statement/customer/c-1'),
          'financial-reports');
      expect(RouteAccess.resourceOfRoute('/branches'), 'branches');
    });

    test('مسار غير مقيد → null', () {
      expect(RouteAccess.resourceOfRoute('/sales'), isNull);
      expect(RouteAccess.resourceOfRoute('/suppliers'), isNull);
    });
  });
}
