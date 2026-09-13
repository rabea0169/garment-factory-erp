import { UserRole, WorkerSpecialty } from '@prisma/client';
import { DocumentCodePrefix } from '../../core/common/codes.util';

/**
 * SELIM-ERP W2 — تعريفات كيانات الاستيراد (عمود واحد لكل حقل قابل
 * للاستيراد مع مرادفات الرؤوس العربية/الإنجليزية مثل ImportWizard في
 * Selim ERP الذي يقبل الملف بصيغتي القوائم).
 *
 * الكيانات المدعومة: المنتجات / العملاء / الموردون / العمال — بيانات
 * الماستر داتا (نفس نطاق معالج Selim). الأدوار مرآة أدوار الإنشاء لكل
 * وحدة أصلها (لا ترقية صلاحيات عبر الاستيراد).
 */

/** نوع عمود الاستيراد. */
export type ImportColumnType = 'string' | 'number' | 'phone' | 'enum' | 'date';

/** تعريف عمود واحد. */
export interface ImportColumnDef {
  /** الحقل الأساسي في السجل المنشأ. */
  key: string;
  /** الرأس العربي الأساسي. */
  header: string;
  /** مرادفات مقبولة (إنجليزية/رؤوس بديلة). */
  altHeaders?: string[];
  required: boolean;
  type: ImportColumnType;
  /** قيم enum مع مرادفاتها العربية (نمط specialty). */
  enumValues?: Record<string, string[]>;
  /** وصف قصير للمعالج في الجوال. */
  hint: string;
}

/** تعريف كيان استيراد كامل. */
export interface ImportEntityDef {
  type: string;
  title: string;
  /** أدوار من يملك إنشاء هذا الكيان (مرآة الوحدة الأصل). */
  roles: UserRole[];
  columns: ImportColumnDef[];
  /** بادئة كود التوليد عند غياب عمود الكود. */
  codePrefix: string;
  /** حقول فريدة للكشف عن التكرار داخل الملف وخارجًا. */
  uniqueKeys: string[];
}

/** خرائط تخصصات العمال: القيمة القياسية → مرادفات عربية مقبولة. */
const SPECIALTY_MAP: Record<string, string[]> = {
  [WorkerSpecialty.CUTTING]: ['قص', 'القص', 'cutting'],
  [WorkerSpecialty.SEWING]: ['خياطة', 'الخياطة', 'sewing'],
  [WorkerSpecialty.FINISHING]: ['تشطيب', 'التشطيب', 'finishing'],
  [WorkerSpecialty.PACKAGING]: ['تغليف', 'التغليف', 'packaging'],
  [WorkerSpecialty.IRONING]: ['كبس', 'الكبس', 'مكواة', 'ironing'],
  [WorkerSpecialty.QUALITY_CONTROL]: ['جودة', 'الجودة', 'quality', 'qc'],
  [WorkerSpecialty.OTHER]: ['أخرى', 'اخرى', 'عام', 'other'],
};

const ENTITIES: ImportEntityDef[] = [
  {
    type: 'products',
    title: 'المنتجات',
    roles: [
      UserRole.GENERAL_MANAGER,
      UserRole.PRODUCTION_MANAGER,
      UserRole.SUPER_ADMIN,
    ],
    codePrefix: 'PROD',
    uniqueKeys: ['code'],
    columns: [
      {
        key: 'name',
        header: 'الاسم',
        altHeaders: ['name', 'اسم المنتج'],
        required: true,
        type: 'string',
        hint: 'اسم المنتج كما يظهر بالكتالوج',
      },
      {
        key: 'code',
        header: 'الكود',
        altHeaders: ['code'],
        required: false,
        type: 'string',
        hint: 'اختياري — يولد تلقائيًا عند الغياب',
      },
      {
        key: 'retailPrice',
        header: 'سعر القطاعي',
        altHeaders: ['retailPrice', 'السعر'],
        required: true,
        type: 'number',
        hint: 'سعر البيع القطاعي بالجنيه',
      },
      {
        key: 'wholesalePrice',
        header: 'سعر الجملة',
        altHeaders: ['wholesalePrice'],
        required: false,
        type: 'number',
        hint: 'افتراضي = سعر القطاعي',
      },
      {
        key: 'category',
        header: 'التصنيف',
        altHeaders: ['category'],
        required: false,
        type: 'string',
        hint: 'تصنيف حر (قمصان/بنطالون...)',
      },
      {
        key: 'barcode',
        header: 'الباركود',
        altHeaders: ['barcode'],
        required: false,
        type: 'string',
        hint: 'باركود المنتج (فريد إن وُجد)',
      },
    ],
  },
  {
    type: 'customers',
    title: 'العملاء',
    roles: [UserRole.CASHIER, UserRole.GENERAL_MANAGER, UserRole.SUPER_ADMIN],
    codePrefix: DocumentCodePrefix.CUSTOMER,
    uniqueKeys: ['code', 'phone'],
    columns: [
      {
        key: 'name',
        header: 'الاسم',
        altHeaders: ['name', 'اسم العميل'],
        required: true,
        type: 'string',
        hint: 'اسم العميل',
      },
      {
        key: 'code',
        header: 'الكود',
        altHeaders: ['code'],
        required: false,
        type: 'string',
        hint: 'اختياري — يولد تلقائيًا',
      },
      {
        key: 'phone',
        header: 'الهاتف',
        altHeaders: ['phone', 'التليفون'],
        required: false,
        type: 'phone',
        hint: '11 رقمًا تقريبًا (01xxxxxxxxx)',
      },
      {
        key: 'address',
        header: 'العنوان',
        altHeaders: ['address'],
        required: false,
        type: 'string',
        hint: 'عنوان التوصيل',
      },
      {
        key: 'email',
        header: 'البريد',
        altHeaders: ['email'],
        required: false,
        type: 'string',
        hint: 'بريد إلكتروني',
      },
    ],
  },
  {
    type: 'suppliers',
    title: 'الموردون',
    roles: [
      UserRole.INVENTORY_MANAGER,
      UserRole.GENERAL_MANAGER,
      UserRole.SUPER_ADMIN,
    ],
    codePrefix: DocumentCodePrefix.SUPPLIER,
    uniqueKeys: ['code', 'phone'],
    columns: [
      {
        key: 'name',
        header: 'الاسم',
        altHeaders: ['name', 'اسم المورد'],
        required: true,
        type: 'string',
        hint: 'اسم المورد/الشركة',
      },
      {
        key: 'code',
        header: 'الكود',
        altHeaders: ['code'],
        required: false,
        type: 'string',
        hint: 'اختياري — يولد تلقائيًا',
      },
      {
        key: 'phone',
        header: 'الهاتف',
        altHeaders: ['phone'],
        required: false,
        type: 'phone',
        hint: 'هاتف المورد',
      },
      {
        key: 'address',
        header: 'العنوان',
        altHeaders: ['address'],
        required: false,
        type: 'string',
        hint: 'عنوان المورد',
      },
      {
        key: 'email',
        header: 'البريد',
        altHeaders: ['email'],
        required: false,
        type: 'string',
        hint: 'بريد إلكتروني',
      },
    ],
  },
  {
    type: 'workers',
    title: 'العمال',
    roles: [
      UserRole.HR_MANAGER,
      UserRole.GENERAL_MANAGER,
      UserRole.SUPER_ADMIN,
    ],
    codePrefix: 'WKR',
    uniqueKeys: ['code', 'nationalId'],
    columns: [
      {
        key: 'name',
        header: 'الاسم',
        altHeaders: ['name', 'اسم العامل'],
        required: true,
        type: 'string',
        hint: 'اسم العامل',
      },
      {
        key: 'specialty',
        header: 'التخصص',
        altHeaders: ['specialty'],
        required: true,
        type: 'enum',
        enumValues: SPECIALTY_MAP,
        hint: 'قص/خياطة/تشطيب/تغليف/كبس/جودة/أخرى',
      },
      {
        key: 'phone',
        header: 'الهاتف',
        altHeaders: ['phone'],
        required: false,
        type: 'phone',
        hint: 'هاتف العامل',
      },
      {
        key: 'nationalId',
        header: 'الرقم القومي',
        altHeaders: ['nationalId'],
        required: false,
        type: 'string',
        hint: 'فريد إن وُجد',
      },
      {
        key: 'pieceRate',
        header: 'أجر القطعة',
        altHeaders: ['pieceRate'],
        required: false,
        type: 'number',
        hint: 'أجر القطعة بالجنيه (افتراضي 0)',
      },
    ],
  },
];

/** كل التعريفات — للـ endpoints الوصفية. */
export function getImportEntities(): ImportEntityDef[] {
  return ENTITIES;
}

/** تعريف كيان بنوعه — يرمي إن كان النوع غير مدعوم. */
export function getImportEntity(type: string): ImportEntityDef {
  const def = ENTITIES.find((e) => e.type === type);
  if (!def) {
    throw new Error(`نوع استيراد غير مدعوم: ${type}`);
  }
  return def;
}

/**
 * توصيف العمود برأسه: يطابق الرأس الأساسي أو المرادفات (تجاهل الحالة
 * والفراغات) — يرجع مفتاح العمود أو null.
 */
export function matchColumn(
  def: ImportEntityDef,
  header: string,
): string | null {
  const normalized = header.trim().toLowerCase();
  if (!normalized) return null;
  for (const col of def.columns) {
    if (col.header.toLowerCase() === normalized) return col.key;
    if (col.altHeaders?.some((alt) => alt.toLowerCase() === normalized))
      return col.key;
  }
  return null;
}

/** تحويل قيمة نصية enum إلى قيمتها القياسية ( specialty عربية → enum). */
export function resolveEnumValue(
  col: ImportColumnDef,
  raw: string,
): string | null {
  const value = raw.trim();
  const map = col.enumValues ?? {};
  // مطابقة مباشرة بالقيمة القياسية (حالة حساسة للنص الكامل).
  if (value in map) return value;
  for (const [canonical, aliases] of Object.entries(map)) {
    if (aliases.some((alias) => alias.toLowerCase() === value.toLowerCase())) {
      return canonical;
    }
  }
  return null;
}
