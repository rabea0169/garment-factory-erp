import { UserRole } from '@prisma/client';

/**
 * SELIM-ERP W4: مجال الصلاحيات التفصيلية — نقل نظام UserPermission من
 * Selim ERP (frontend-permissions.ts + permissions.ts) بمعمارية أحادية
 * المستأجر، مع طباعة النموذج على أدوار GF-ERP الثمانية.
 *
 * نموذج الطبقتين (نفس المرجع SPRINT 81):
 * 1) الأدوار خط الأساس — مصفوفة ROLE_DEFAULTS أدناه تطابق حراس @Roles
 *    الفعليين في المتحكمات (المصدر: جرد كامل لمسارات الباكند).
 * 2) صلاحيات صريحة على المستخدم (عمود users.permissions JSON:
 *    [{ resource, action }]) **تضيف** وصولًا فوق الدور — لا تحذفه أبدًا.
 *    دعم البدل: { resource: '*', action: '*' } = كل شيء (SUPER_ADMIN ضمنيًا).
 *
 * التنفيذ: RolesGuard يستدعي hasExplicitPermission عند فشل فحص الدور —
 * فالوصول لا يتسع إلا بمنحٍ صريح من SUPER_ADMIN (نفس owner/admin في المرجع).
 */

export const PERMISSION_ACTIONS = [
  'READ',
  'CREATE',
  'UPDATE',
  'DELETE',
  'EXPORT',
  'APPROVE',
] as const;
export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

/**
 * الموارد — مطابقة بادئات المتحكمات (RolesGuard يستنتج المورد من
 * @Controller('sales') إلخ) + موارد العرض فقط في الجوال.
 */
export const PERMISSION_RESOURCES = [
  'sales',
  'purchases',
  'purchase-returns',
  'quotations',
  'customers',
  'suppliers',
  'products',
  'inventory',
  'inventory-adjustments',
  'production',
  'cutting',
  'quality',
  'hr',
  'payroll-statements',
  'worker-receipts',
  'shifts',
  'expenses',
  'treasury',
  'accounting',
  'financial-reports',
  'journal-templates',
  'shipping',
  'pos',
  'printing',
  'search',
  'dashboard',
  'reports',
  'data-import',
  'exports',
  'audit-logs',
  'branches',
  'settings',
  'backup',
  'devices',
  'packing',
  'users',
] as const;
export type PermissionResource = (typeof PERMISSION_RESOURCES)[number];

const RESOURCE_SET = new Set<string>(PERMISSION_RESOURCES);
const ACTION_SET = new Set<string>(PERMISSION_ACTIONS);

/** صف صلاحية كما يُخزَّن في users.permissions (JSON). */
export interface StoredPermission {
  resource: string;
  action: string;
}

/** المصفوفة الكاملة (resource × action) — لأدوار الإدارة العليا. */
function all(): StoredPermission[] {
  const out: StoredPermission[] = [];
  for (const r of PERMISSION_RESOURCES) {
    for (const a of PERMISSION_ACTIONS) {
      out.push({ resource: r, action: a });
    }
  }
  return out;
}

/** كل الإجراءات لموارد محددة. */
function full(...resources: string[]): StoredPermission[] {
  const out: StoredPermission[] = [];
  for (const r of resources) {
    for (const a of PERMISSION_ACTIONS) {
      out.push({ resource: r, action: a });
    }
  }
  return out;
}

/** قراءة فقط لموارد محددة. */
function readOnly(...resources: string[]): StoredPermission[] {
  return resources.map((r) => ({ resource: r, action: 'READ' }));
}

/**
 * خط أساس الأدوار — يطابق حراس @Roles في المتحكمات (جُرد فعلي):
 * - SUPER_ADMIN: wildcard (الحارس يتجاوز أصلًا).
 * - GENERAL_MANAGER: كل الموارد ما عدا users (SA حصريًا).
 * - الأدوار المتخصصة: نطاقها التشغيلي الفعلي من المتحكمات.
 */
const ROLE_DEFAULTS: Record<UserRole, StoredPermission[]> = {
  [UserRole.SUPER_ADMIN]: [{ resource: '*', action: '*' }],
  [UserRole.GENERAL_MANAGER]: all().filter(
    (p) => !(p.resource === 'users' && p.action !== 'READ'),
  ),
  [UserRole.ACCOUNTANT]: [
    ...full(
      'accounting',
      'journal-templates',
      'treasury',
      'expenses',
      'financial-reports',
      'purchase-returns',
      'worker-receipts',
      'payroll-statements',
      'exports',
    ),
    ...readOnly(
      'sales',
      'purchases',
      'quotations',
      'inventory-adjustments',
      'printing',
      'branches',
      'dashboard',
      'search',
      'audit-logs',
      'data-import',
      'reports',
    ),
  ],
  [UserRole.CASHIER]: [
    ...full('sales', 'pos', 'shifts', 'shipping'),
    { resource: 'treasury', action: 'READ' },
    { resource: 'treasury', action: 'CREATE' },
    { resource: 'quotations', action: 'CREATE' },
    ...readOnly(
      'customers',
      'products',
      'expenses',
      'branches',
      'dashboard',
      'search',
      'data-import',
    ),
  ],
  [UserRole.PRODUCTION_MANAGER]: [
    ...full('production', 'cutting', 'quality', 'data-import'),
    { resource: 'products', action: 'READ' },
    { resource: 'products', action: 'CREATE' },
    { resource: 'products', action: 'UPDATE' },
    ...readOnly('inventory', 'quotations', 'branches', 'dashboard', 'search'),
  ],
  [UserRole.INVENTORY_MANAGER]: [
    ...full(
      'purchases',
      'inventory',
      'inventory-adjustments',
      'data-import',
      'exports',
    ),
    ...readOnly(
      'cutting',
      'products',
      'branches',
      'dashboard',
      'search',
      'quotations',
    ),
  ],
  [UserRole.HR_MANAGER]: [
    ...full('hr', 'worker-receipts', 'payroll-statements', 'data-import'),
    ...readOnly('branches', 'dashboard', 'search', 'exports'),
  ],
  [UserRole.VIEWER]: [
    ...readOnly('search', 'branches', 'dashboard', 'products'),
  ],
};

/** صلاحيات الدور الافتراضية (للعرض في محرر الصلاحيات كخلفية). */
export function getRoleDefaultPermissions(role: UserRole): StoredPermission[] {
  return ROLE_DEFAULTS[role] ?? [];
}

/** هل المورد/الإجراء ضمن المجموعات المسموحة (حماية من أي قيم شاذة)؟ */
export function isAllowedPermission(resource: string, action: string): boolean {
  return (
    (resource === '*' || RESOURCE_SET.has(resource)) &&
    (action === '*' || ACTION_SET.has(action))
  );
}

/** مطابقة صف مخزَّن مع مورد/إجراء مطلوبين (مع دعم البدل). */
function matches(
  stored: StoredPermission,
  resource: string,
  action: string,
): boolean {
  const resourceOk = stored.resource === '*' || stored.resource === resource;
  const actionOk = stored.action === '*' || stored.action === action;
  return resourceOk && actionOk;
}

/**
 * هل يملك المستخدم صلاحية صريحة؟ (الصلاحيات الصريحة فقط — لا fallback
 * للدور هنا؛ الرائد للـ RolesGuard: يفحص الدور أولًا ثم هذا.)
 */
export function hasExplicitPermission(
  storedPermissions: unknown,
  resource: string,
  action: string,
): boolean {
  if (!Array.isArray(storedPermissions)) {
    return false;
  }
  return storedPermissions.some(
    (p) =>
      p &&
      typeof p === 'object' &&
      typeof (p as StoredPermission).resource === 'string' &&
      typeof (p as StoredPermission).action === 'string' &&
      matches(p as StoredPermission, resource, action),
  );
}

/**
 * hasPermission الكامل (الدور أساس + الصريح يضيف) — نفس دلالة
 * hasPermission في المرجع: SUPER_ADMIN يمر دائمًا.
 */
export function hasPermission(
  role: UserRole,
  storedPermissions: unknown,
  resource: string,
  action: PermissionAction,
): boolean {
  if (role === UserRole.SUPER_ADMIN) {
    return true;
  }
  if (hasExplicitPermission(storedPermissions, resource, action)) {
    return true;
  }
  const defaults = ROLE_DEFAULTS[role] ?? [];
  return defaults.some((p) => matches(p, resource, action));
}

/**
 * الصلاحيات الفعالة للعرض (login//me ومحرر الصلاحيات):
 * SUPER_ADMIN → بطاقة wildcard واحدة؛ وإلا: صريحة المستخدم إن وُجدت،
 * وإلا افتراضيات الدور (نفس isDefault في المرجع).
 */
export function computeEffectivePermissions(
  role: UserRole,
  storedPermissions: unknown,
): { permissions: StoredPermission[]; source: 'super' | 'user' | 'role' } {
  if (role === UserRole.SUPER_ADMIN) {
    return { permissions: [{ resource: '*', action: '*' }], source: 'super' };
  }
  const normalized = normalizeStoredPermissions(storedPermissions);
  if (normalized.length > 0) {
    return { permissions: normalized, source: 'user' };
  }
  return {
    permissions: ROLE_DEFAULTS[role] ?? [],
    source: 'role',
  };
}

/** تنقية أي JSON دخيل إلى صفوف صلاحية صالحة فقط. */
export function normalizeStoredPermissions(
  storedPermissions: unknown,
): StoredPermission[] {
  if (!Array.isArray(storedPermissions)) {
    return [];
  }
  const seen = new Set<string>();
  const out: StoredPermission[] = [];
  for (const p of storedPermissions) {
    if (
      !p ||
      typeof p !== 'object' ||
      typeof (p as StoredPermission).resource !== 'string' ||
      typeof (p as StoredPermission).action !== 'string'
    ) {
      continue;
    }
    const resource = (p as StoredPermission).resource;
    const action = (p as StoredPermission).action;
    if (!isAllowedPermission(resource, action)) {
      continue;
    }
    const key = `${resource}:${action}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push({ resource, action });
  }
  return out;
}

/**
 * خريطة HTTP method → إجراء الصلاحية (للاستنتاج التلقائي في RolesGuard):
 * GET→READ، POST→CREATE، PATCH/PUT→UPDATE، DELETE→DELETE.
 */
export function actionFromHttpMethod(method: string): PermissionAction {
  switch (method.toUpperCase()) {
    case 'POST':
      return 'CREATE';
    case 'PATCH':
    case 'PUT':
      return 'UPDATE';
    case 'DELETE':
      return 'DELETE';
    default:
      return 'READ';
  }
}

/**
 * SELIM-ERP W4: تحويل مسار المتحكم إلى مورد صلاحية (RolesGuard).
 * المورد = آخر جزء من المسار يطابق موردًا معروفًا بعد فك الأسماء البديلة
 * (purchasing→purchases، treasury-transactions→treasury، import→data-import،
 * export→exports، factory-settings→settings، restore→backup).
 * أمثلة: 'system/audit-logs'→audit-logs؛ 'financial-reports'→financial-reports؛
 * 'system/backup/summary'→backup (آخر جزء «summary» ليس موردًا فيتراجع لـ«backup»).
 */
const ROUTE_ALIAS: Record<string, string> = {
  purchasing: 'purchases',
  'treasury-transactions': 'treasury',
  import: 'data-import',
  export: 'exports',
  'factory-settings': 'settings',
  restore: 'backup',
};

export function resourceFromRoutePath(controllerPath: string): string {
  const segments = (controllerPath || '')
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean);
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i];
    const candidate = ROUTE_ALIAS[seg] ?? seg;
    if (candidate === '*' || RESOURCE_SET.has(candidate)) {
      return candidate;
    }
  }
  return segments[segments.length - 1] ?? '';
}
