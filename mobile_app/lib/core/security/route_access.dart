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

    // ===== SELIM-ERP W1: قيود الوحدات المقلدة (مرآة @Roles الخادمية) =====
    // عروض الأسعار: قراءتها GM/ACC/CASHIER وإنشاؤها GM/CASHIER (خادميًا).
    '/quotations': {
      AppRoles.generalManager,
      AppRoles.accountant,
      AppRoles.cashier,
      AppRoles.superAdmin,
    },
    // مرتجع المشتريات: مسار مالي — ACC/GM/SA.
    '/purchase-returns': {
      AppRoles.accountant,
      AppRoles.generalManager,
      AppRoles.superAdmin,
    },
    // تسويات الجرد: INV/ACC/GM.
    '/adjustments': {
      AppRoles.inventoryManager,
      AppRoles.accountant,
      AppRoles.generalManager,
      AppRoles.superAdmin,
    },
    // المصاريف: ACC/GM/CASHIER.
    '/expenses': {
      AppRoles.accountant,
      AppRoles.generalManager,
      AppRoles.cashier,
      AppRoles.superAdmin,
    },
    // الخزينة: ACC/GM/CASHIER (سندات الصندوق).
    '/treasury': {
      AppRoles.accountant,
      AppRoles.generalManager,
      AppRoles.cashier,
      AppRoles.superAdmin,
    },
    // الورديات: CASHIER/GM (نفس أدوار فتح الوردية خادميًا).
    '/shifts': {
      AppRoles.cashier,
      AppRoles.generalManager,
      AppRoles.superAdmin,
    },
    // سندات قبض العمال: HR/ACC/GM.
    '/worker-receipts': {
      AppRoles.hrManager,
      AppRoles.accountant,
      AppRoles.generalManager,
      AppRoles.superAdmin,
    },
    // كشوف الرواتب المجمدة: HR/ACC/GM.
    '/payroll-statements': {
      AppRoles.hrManager,
      AppRoles.accountant,
      AppRoles.generalManager,
      AppRoles.superAdmin,
    },
    // القص والتعبئة: PM/INV/GM.
    '/cutting': {
      AppRoles.productionManager,
      AppRoles.inventoryManager,
      AppRoles.generalManager,
      AppRoles.superAdmin,
    },
    // التقارير المالية: ACC/GM (نفس قيد الحسابات).
    '/financial-reports': {
      AppRoles.accountant,
      AppRoles.generalManager,
      AppRoles.superAdmin,
    },
    // مركز الطباعة: قوالب القراءة عامة، الإدارة ACC/GM — الشاشة تعرض
    // القوالب والسجل فتُقيد بالمالية والإدارة.
    '/printing': {
      AppRoles.accountant,
      AppRoles.generalManager,
      AppRoles.cashier,
      AppRoles.superAdmin,
    },

    // ===== SELIM-ERP W2: قيود الموجة الثانية (مرآة @Roles الخادمية) =====
    // نقطة البيع: CASHIER/GM/SA (POS_ROLES الخادمية).
    '/pos': {
      AppRoles.cashier,
      AppRoles.generalManager,
      AppRoles.superAdmin,
    },
    // معالج الاستيراد: اتحاد أدوار إنشاء الكيانات الأربعة (الخادم يفحص
    // الكيان المحدد بدقة — هذا حاجز التنقل الأول).
    '/import': {
      AppRoles.generalManager,
      AppRoles.productionManager,
      AppRoles.cashier,
      AppRoles.hrManager,
      AppRoles.inventoryManager,
      AppRoles.superAdmin,
    },
    // النسخ الاحتياطي/الاستعادة: SUPER_ADMIN فقط (SYSTEM الخادمية).
    '/backup': {
      AppRoles.superAdmin,
    },
    // --- SELIM-ERP W3: مرآة أدوار الخادم للمسارات الجديدة ---
    // أجهزة التطبيق: قائمة الأجهزة GM/SA (تسجيل/نبضة متاحة للكل خادميًا
    // لكن الشاشة تعرض القائمة).
    '/devices': {
      AppRoles.generalManager,
      AppRoles.superAdmin,
    },
    // مراكز التكلفة: ACC/GM/SA (نفس أدوار accounting الخادمية).
    '/cost-centers': {
      AppRoles.accountant,
      AppRoles.generalManager,
      AppRoles.superAdmin,
    },
    // كشف حساب عميل: ACC/GM/CASHIER/SA (نفس financial-reports).
    '/statement/customer': {
      AppRoles.accountant,
      AppRoles.generalManager,
      AppRoles.cashier,
      AppRoles.superAdmin,
    },
    // كشف حساب مورد: ACC/GM/INV/SA (نفس financial-reports).
    '/statement/supplier': {
      AppRoles.accountant,
      AppRoles.generalManager,
      AppRoles.inventoryManager,
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
