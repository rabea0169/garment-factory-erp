import 'package:flutter_test/flutter_test.dart';

import 'package:garment_factory_erp/core/security/route_access.dart';

/// audit-FE (P0): سلطة وصول المسارات — مرآة سياسات @Roles الخادمية.
/// التحقق من: القيود الامتيازية، المسارات القرائية العامة، مطابقة
/// المعاملات (/hr/workers/:id)، والدور غير المعروف (fail-closed).
void main() {
  group('RouteAccess.canAccess — المسارات الامتيازية', () {
    test('/users: SUPER_ADMIN فقط', () {
      expect(RouteAccess.canAccess('/users', 'SUPER_ADMIN'), isTrue);
      expect(RouteAccess.canAccess('/users', 'GENERAL_MANAGER'), isFalse);
      expect(RouteAccess.canAccess('/users', 'CASHIER'), isFalse);
      expect(RouteAccess.canAccess('/users', 'HR_MANAGER'), isFalse);
    });

    test('/accounting: ACCOUNTANT وGM وSA وCASHIER فقط', () {
      expect(RouteAccess.canAccess('/accounting', 'ACCOUNTANT'), isTrue);
      expect(RouteAccess.canAccess('/accounting', 'CASHIER'), isTrue);
      expect(RouteAccess.canAccess('/accounting', 'SUPER_ADMIN'), isTrue);
      expect(RouteAccess.canAccess('/accounting', 'GENERAL_MANAGER'), isTrue);
      expect(RouteAccess.canAccess('/accounting', 'HR_MANAGER'), isFalse);
      expect(RouteAccess.canAccess('/accounting', 'PRODUCTION_MANAGER'),
          isFalse);
    });

    test('/quality: PM وGM وSA فقط (QLT-6)', () {
      expect(RouteAccess.canAccess('/quality', 'PRODUCTION_MANAGER'), isTrue);
      expect(RouteAccess.canAccess('/quality', 'GENERAL_MANAGER'), isTrue);
      expect(RouteAccess.canAccess('/quality', 'INVENTORY_MANAGER'), isFalse);
      expect(RouteAccess.canAccess('/quality', 'VIEWER'), isFalse);
    });

    test('/hr و/hr/payrolls: HR وGM وSA فقط', () {
      for (final route in ['/hr', '/hr/payrolls']) {
        expect(RouteAccess.canAccess(route, 'HR_MANAGER'), isTrue);
        expect(RouteAccess.canAccess(route, 'GENERAL_MANAGER'), isTrue);
        expect(RouteAccess.canAccess(route, 'CASHIER'), isFalse);
        expect(RouteAccess.canAccess(route, 'ACCOUNTANT'), isFalse);
      }
    });

    test('/reports: GM وSA وACC فقط (مصدر بياناتها /dashboard/stats)', () {
      expect(RouteAccess.canAccess('/reports', 'ACCOUNTANT'), isTrue);
      expect(RouteAccess.canAccess('/reports', 'GENERAL_MANAGER'), isTrue);
      expect(RouteAccess.canAccess('/reports', 'CASHIER'), isFalse);
      expect(RouteAccess.canAccess('/reports', 'VIEWER'), isFalse);
    });

    test('/hr/workers/<id> يتبع قيد /hr/workers (مطابقة المعاملات)', () {
      expect(RouteAccess.canAccess('/hr/workers/abc-123', 'HR_MANAGER'),
          isTrue);
      expect(RouteAccess.canAccess('/hr/workers/abc-123', 'CASHIER'), isFalse);
    });

    test('/inventory: INV وGM وSA وACC وVIEWER (قراءات عامة بلا تكلفة)', () {
      expect(RouteAccess.canAccess('/inventory', 'INVENTORY_MANAGER'), isTrue);
      expect(RouteAccess.canAccess('/inventory', 'VIEWER'), isTrue);
      expect(RouteAccess.canAccess('/inventory', 'CASHIER'), isFalse);
    });
  });

  group('RouteAccess.canAccess — المسارات القرائية العامة', () {
    test('المنتجات/الإنتاج/المبيعات/المشتريات/الموردون/الشحن لكل الموثّقين',
        () {
      for (final route in [
        '/products',
        '/production',
        '/sales',
        '/purchasing',
        '/suppliers',
        '/shipping',
      ]) {
        for (final role in AppRoles.all) {
          expect(RouteAccess.canAccess(route, role), isTrue,
              reason: '$route should be readable by $role');
        }
      }
    });

    test('لوحة التحكم وتسجيل الدخول لكل الأدوار', () {
      for (final role in AppRoles.all) {
        expect(RouteAccess.canAccess('/dashboard', role), isTrue);
        expect(RouteAccess.canAccess('/login', role), isTrue);
      }
    });
  });

  group('RouteAccess.canAccess — الدفاع النهائي', () {
    test('الدور الفارغ/غير المعروف: يرفض المسارات المقيَّدة ويسمح بالعامة', () {
      expect(RouteAccess.canAccess('/users', ''), isFalse);
      expect(RouteAccess.canAccess('/accounting', 'UNKNOWN_ROLE'), isFalse);
      expect(RouteAccess.canAccess('/products', ''), isTrue);
      expect(RouteAccess.canAccess('/dashboard', ''), isTrue);
    });
  });
}
