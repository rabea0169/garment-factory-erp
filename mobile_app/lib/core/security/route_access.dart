/// سلطة وصول المسارات حسب الدور — audit-FE (P0).
///
/// مرآة دقيقة لسياسات `@Roles` في الخلفية (backend/src/modules/*):
/// الشاشات القرائية المتاحة لكل موثّق (قوائم المنتجات/المخزون/أوامر
/// البيع/المشتريات/الموردين/الشحن) تبقى لكل الأدوار بما فيها VIEWER،
/// بينما الشاشات الامتيازية (الجودة/العمالة/الرواتب/الحسابات/التقارير/
/// المستخدمون) تُقيَّد بأدوارها الخادمية الفعلية. الهدف:
/// 1) منع الوصول المباشر عبر URL (deep-link) لشاشة لا يملك دور المستخدم
///    صلاحيتها — كان أي مستخدم موثّق يصل /users أو /accounting مباشرة
///    فيرى شاشة خطأ 403 بدل منع الدخول.
/// 2) توحيد مصدر واحد لحماية الموجّه وتصفية عناصر درج التنقل.
///
/// الخادم يظل خط الدفاع الأخير (fail-closed) — هذه الطبقة تجربة استخدام
/// وأمان دفاعي، لا بديلاً عن RBAC الخادمي.
library;

/// أدوار النظام (تطابق UserRole في schema.prisma).
class AppRoles {
  AppRoles._();

  static const String superAdmin = 'SUPER_ADMIN';
  static const String generalManager = 'GENERAL_MANAGER';
  static const String productionManager = 'PRODUCTION_MANAGER';
  static const String inventoryManager = 'INVENTORY_MANAGER';
  static const String accountant = 'ACCOUNTANT';
  static const String cashier = 'CASHIER';
  static const String hrManager = 'HR_MANAGER';
  static const String viewer = 'VIEWER';

  static const Set<String> all = {
    superAdmin,
    generalManager,
    productionManager,
    inventoryManager,
    accountant,
    cashier,
    hrManager,
    viewer,
  };
}

class RouteAccess {
  RouteAccess._();

  /// مسارات لوحة الدخول والشاشات المتاحة لكل الموثّقين.
  static const Set<String> _publicRoutes = {'/login', '/dashboard'};

  /// مسار → الأدوار المسموح لها. المسارات غير المذكورة = كل الموثّقين
  /// (نفس مبدأ الخادم: القراءات العامة متاحة، والكتابة يحميها الخادم).
  static const Map<String, Set<String>> _routeRoles = {
    // المخزون: قراءات عامة (التكلفة تُخفى خادميًا لغير المالية)،
    // ودفتر الحركات INV/ACC/GM — الشاشة أساسًا لمسؤول المخزون والمالية.
    '/inventory': {
      AppRoles.inventoryManager,
      AppRoles.generalManager,
      AppRoles.superAdmin,
      AppRoles.accountant,
      AppRoles.viewer,
    },
    // الجودة: GET /quality و/kpis — PM/GM/SA فقط (QLT-6 خادميًا).
    '/quality': {
      AppRoles.productionManager,
      AppRoles.generalManager,
      AppRoles.superAdmin,
    },
    // العمالة: بيانات الهوية HR/GM (HR-8)، والكشوف HR/GM.
    '/hr': {
      AppRoles.hrManager,
      AppRoles.generalManager,
      AppRoles.superAdmin,
    },
    '/hr/payrolls': {
      AppRoles.hrManager,
      AppRoles.generalManager,
      AppRoles.superAdmin,
    },
    // السلف/الإنتاج اليومي لعامل: قوائم HR/GM فقط.
    '/hr/workers': {
      AppRoles.hrManager,
      AppRoles.generalManager,
      AppRoles.superAdmin,
    },
    // الحسابات: ACC/GM/SA + CASHIER (السندات — ACC-5).
    '/accounting': {
      AppRoles.accountant,
      AppRoles.generalManager,
      AppRoles.superAdmin,
      AppRoles.cashier,
    },
    // التقارير: تستهلك /dashboard/stats — GM/SA/ACC فقط خادميًا.
    '/reports': {
      AppRoles.generalManager,
      AppRoles.superAdmin,
      AppRoles.accountant,
    },
    // المستخدمون: SUPER_ADMIN فقط (CC-9 خادميًا).
    '/users': {
      AppRoles.superAdmin,
    },
  };

  /// هل يملك [role] صلاحية الوصول إلى [location]؟
  ///
  /// مطابقة أطول بادئة مسار معلنة (تتعامل مع المسارات ذات المعاملات مثل
  /// `/hr/workers/<id>`). الدور غير المعروف يُرفض للمسارات المقيَّدة
  /// (fail-closed) والمسارات غير المقيَّدة تبقى متاحة للقراءة العامة.
  static bool canAccess(String location, String role) {
    if (_publicRoutes.contains(location)) return true;

    // أطول بادئة مطابقة من خريطة القيود.
    String? bestMatch;
    for (final route in _routeRoles.keys) {
      final normalized = route.contains('/:') ? route.substring(0, route.indexOf('/:')) : route;
      if (location == route ||
          location.startsWith('$normalized/') ||
          location == normalized) {
        if (bestMatch == null || route.length > bestMatch.length) {
          bestMatch = route;
        }
      }
    }

    if (bestMatch == null) {
      // مسار غير مقيَّد: كل الموثّقين (قوائم قرائية عامة).
      return true;
    }
    final allowed = _routeRoles[bestMatch]!;
    return allowed.contains(role);
  }

  /// أدوار مسار معلَن (للاختبارات).
  static Set<String>? rolesFor(String route) => _routeRoles[route];
}
