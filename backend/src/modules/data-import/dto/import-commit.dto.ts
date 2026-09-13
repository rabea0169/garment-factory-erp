import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  ValidateIf,
} from 'class-validator';

/**
 * SELIM-ERP W2 — تنفيذ دفعة استيراد: الصفوف الصالحة (من المعاينة)
 * تُرسل كمصفوفة خرائط نصية {حقل: قيمة}، والخدمة تعيد التحقق خادميًا
 * قبل أي إنشاء (لا ثقة بالعميل).
 */
export class ImportCommitDto {
  /** نوع الكيان المدعوم. */
  @IsIn(['products', 'customers', 'suppliers', 'workers'])
  entityType!: string;

  /**
   * صفوف البيانات — كل عنصر خريطة {مفتاح الحقل: قيمة نصية}.
   * التحقق التفصيلي (الحقول/الأنواع/التكرارات) داخل الخدمة على أي حال.
   */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2000)
  rows!: Record<string, string>[];
}

/** عناصر مساعدة للتوثيق فقط (Swagger) — ليست جزءًا من التحقق. */
export class ImportRowExample {
  @IsString()
  key!: string;

  @ValidateIf(() => false)
  @IsOptional()
  @IsString()
  value?: string;

  @IsObject()
  row!: Record<string, string>;
}
