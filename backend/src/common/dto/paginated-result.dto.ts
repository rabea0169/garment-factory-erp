import { ApiProperty } from '@nestjs/swagger';

export class PaginationMeta {
  @ApiProperty({ description: 'إجمالي عدد العناصر' })
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

export class PaginatedResult<T> {
  @ApiProperty({ isArray: true, description: 'البيانات' })
  data: T[];

  @ApiProperty({ type: PaginationMeta, description: 'معلومات الصفحات' })
  meta: PaginationMeta;

  constructor(data: T[], total: number, page: number, pageSize: number) {
    const totalPages = Math.ceil(total / pageSize);

    this.data = data;
    this.meta = {
      total,
      page,
      pageSize,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1 && totalPages > 0,
    };
  }
}
