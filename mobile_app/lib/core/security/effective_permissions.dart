/// SELIM-ERP W4 — الصلاحيات الفعالة في الجوال (نقل hasPermission من
/// المرجع frontend-permissions.ts): الدور خط الأساس، والصلاحيات الصريحة
/// على المستخدم (من عمود users.permissions عبر /auth/me) **تضيف** وصولًا
/// فوق الدور — لا تحذفه أبدًا.
///
/// المصدر: حقل `effectivePermissions` في جلسة المستخدم (يحسبه الخادم في
/// login//me بنفس منطق permissions.domain) — الدور يُستعمل احتياطًا عند
/// غيابه (جلسات مخزنة قبل الموجة الرابعة أو وضع لا-اتصالي).
library;

import 'route_access.dart';

/// صف صلاحية كما يصل من الخادم.
class PermissionRow {
  const PermissionRow({required this.resource, required this.action});

  factory PermissionRow.fromJson(Map<String, dynamic> json) => PermissionRow(
        resource: json['resource']?.toString() ?? '',
        action: json['action']?.toString() ?? '',
      );

  final String resource;
  final String action;
}

/// الأفعال الستة (نفس المرجع).
const Set<String> kPermissionActions = {
  'READ',
  'CREATE',
  'UPDATE',
  'DELETE',
  'EXPORT',
  'APPROVE',
};

/// استخراج الصفوف الفعالة من خريطة مستخدم الجلسة.
///
/// يتقبل الصيغتين: `user['effectivePermissions']` = { permissions, source }
/// (الشكل الكنوني من الخادم) أو `user['permissions']` خامًا (تسامح مع
/// الكاش القديم) — في كلتا الحالتين الصفوف غير الصالحة تُسقط.
List<PermissionRow> effectiveRowsOf(Map<String, dynamic>? user) {
  if (user == null) return const [];
  Object? raw = user['effectivePermissions'];
  if (raw is Map && raw['permissions'] is List) {
    return _rowsFrom(raw['permissions'] as List);
  }
  raw = user['permissions'];
  if (raw is List) {
    return _rowsFrom(raw);
  }
  return const [];
}

List<PermissionRow> _rowsFrom(List rows) {
  final out = <PermissionRow>[];
  for (final row in rows) {
    if (row is Map) {
      final parsed = PermissionRow.fromJson(
        Map<String, dynamic>.from(row),
      );
      if (parsed.resource.isNotEmpty && parsed.action.isNotEmpty) {
        out.add(parsed);
      }
    }
  }
  return out;
}

/// هل يملك المستخدم صلاحية [resource]:[action]؟
///
/// - SUPER_ADMIN → دائمًا (نفس owner/admin في المرجع).
/// - الصفوف الفعالة (صريحة من الخادم أو افتراضيات الدور المحسوبة هناك)
///   تُفحص مع دعم البدل `*`.
/// - لا صفوف فعالة (جلسة قديمة/لا-اتصالية) → false هنا؛ الرايع يبقى فحص
///   الدور في RouteAccess.canAccess.
bool hasPermission(
  Map<String, dynamic>? user,
  String resource, [
  String action = 'READ',
]) {
  if (user == null) return false;
  final role = user['role']?.toString() ?? '';
  if (role == AppRoles.superAdmin) return true;
  final rows = effectiveRowsOf(user);
  if (rows.isEmpty) return false;
  return rows.any(
    (row) =>
        (row.resource == '*' || row.resource == resource) &&
        (row.action == '*' || row.action == action),
  );
}

/// فحص الوصول بالصلاحيات الفعالة فوق الدور (بوابة موحدة W4).
///
/// 1) فحص الدور التقليدي (خط الأساس — يغطي الجلسات القديمة أيضًا).
/// 2) عند فشله: هل الصلاحية الصريحة `READ` على مورد المسار ممنوحة؟
///    (المسارات كلها شاشات قراءة+كتابة؛ القراءة بوابة الدخول الأولى).
bool canAccessWithUser(String location, Map<String, dynamic>? user) {
  final role = user?['role']?.toString() ?? '';
  if (RouteAccess.canAccess(location, role)) return true;
  if (user == null) return false;
  final resource = RouteAccess.resourceOfRoute(location);
  if (resource == null) return false;
  return hasPermission(user, resource, 'READ');
}
