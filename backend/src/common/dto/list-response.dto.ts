import { ApiProperty } from '@nestjs/swagger';

/**
 * CC-6 (P2 — GF-IMP-W3): قالب الاستجابة الموحد للقوائم المقسمة بمرشحات.
 *
 * العقد الكنسي الذي تلتزم به كل قوائم الموجات اللاحقة (كل وكيل يطبّق CC-6
 * على قوائمه يعيده من خدمته):
 * - `items` — عناصر الصفحة الحالية (إسقاط انتقائي محدد من الخدمة).
 * - `total` — إجمالي العناصر المطابقة للمرشحات (قبل الترقيم).
 * - `page` — رقم الصفحة الحالية (يبدأ من 1).
 * - `limit` — عدد العناصر المطلوب في الصفحة (أقصى 100).
 *
 * حقلا التوافق الانتقاليان `data` و`meta` (نفس شكل PaginatedResult/
 * PaginationMeta القديم): مستهلكو الواجهة الحاليون (mobile_app يقرأ
 * payload['data'] في ApiParsing.paginatedMaps وextractPaginatedData) خارج
 * نطاق هذه الموجة، فيُبقيان الاستجابة متوافقة معهم أثناء الترحيل إلى
 * `items`. قرار إزالتهما موثق ويُنفذ في موجة لاحقة بعد ترحيل الجوال —
 * أي خدمة جديدة تلتزم الحقول الكنسية فقط ولا تعتمد على حقلي التوافق.
 */
export class ListResponseMeta {
  @ApiProperty({ description: 'إجمالي عدد العناصر المطابقة للمرشحات' })
  total: number;

  @ApiProperty({ description: 'رقم الصفحة الحالية' })
  page: number;

  @ApiProperty({ description: 'عدد العناصر في الصفحة' })
  pageSize: number;

  @ApiProperty({ description: 'عدد الصفحات الكلي' })
  totalPages: number;

  @ApiProperty({ description: 'هل توجد صفحة تالية' })
  hasNextPage: boolean;

  @ApiProperty({ description: 'هل توجد صفحة سابقة' })
  hasPreviousPage: boolean;
}

export class ListResponseDto<T> {
  @ApiProperty({ isArray: true, description: 'عناصر الصفحة الحالية' })
  items: T[];

  @ApiProperty({ description: 'إجمالي العناصر المطابقة للمرشحات' })
  total: number;

  @ApiProperty({ description: 'رقم الصفحة الحالية (يبدأ من 1)' })
  page: number;

  @ApiProperty({ description: 'عدد العناصر في الصفحة (أقصى 100)' })
  limit: number;

  /** توافق انتقالي — نفس مرجع items؛ يُزال بعد ترحيل الجوال إلى items. */
  @ApiProperty({ isArray: true, description: 'مرادف items (توافق قديم)' })
  data: T[];

  /** توافق انتقالي — شكل PaginationMeta القديم؛ يُزال مع data. */
  @ApiProperty({
    type: ListResponseMeta,
    description: 'ميتا الترقيم (توافق قديم)',
  })
  meta: ListResponseMeta;

  constructor(items: T[], total: number, page: number, limit: number) {
    const totalPages = Math.ceil(total / limit);

    this.items = items;
    this.total = total;
    this.page = page;
    this.limit = limit;
    // حقلا التوافق — نفس مرجع المصفوفة لا نسخة (أي تحديث لاحق ينعكس عليهما)
    this.data = items;
    this.meta = {
      total,
      page,
      pageSize: limit,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1 && totalPages > 0,
    };
  }
}
