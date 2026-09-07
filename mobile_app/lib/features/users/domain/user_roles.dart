/// CC-9: أدوار UserRole الثمانية الفعلية من schema.prisma — القيم الخام
/// تُرسل للخادم كما هي، واللابلات عربية للعرض فقط (نفس لابلات لوحة
/// التحكم).
const Map<String, String> kUserRoleLabels = <String, String>{
  'SUPER_ADMIN': 'مدير النظام',
  'GENERAL_MANAGER': 'مدير عام',
  'PRODUCTION_MANAGER': 'مدير الإنتاج',
  'INVENTORY_MANAGER': 'مدير المخزون',
  'ACCOUNTANT': 'محاسب',
  'CASHIER': 'أمين صندوق',
  'HR_MANAGER': 'مدير الموارد البشرية',
  'VIEWER': 'مشاهد',
};

/// ترتيب العرض في القوائم المنسدلة (الأعوى صلاحية أولًا).
const List<String> kUserRoleOrder = <String>[
  'SUPER_ADMIN',
  'GENERAL_MANAGER',
  'PRODUCTION_MANAGER',
  'INVENTORY_MANAGER',
  'ACCOUNTANT',
  'CASHIER',
  'HR_MANAGER',
  'VIEWER',
];

/// لابل عربي لدور — دور غير معروف يُعرض خامًا (وليس "غير معروف")
/// كي لا يخفي قيمة جديدة من الخادم.
String userRoleLabel(String role) =>
    kUserRoleLabels[role] ?? (role.isEmpty ? 'دور غير معروف' : role);
