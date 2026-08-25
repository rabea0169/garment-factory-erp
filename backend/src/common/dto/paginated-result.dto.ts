import { ApiProperty } from '@nestjs/swagger';

export class PaginationMeta {
  @ApiProperty({ description: 'إجمالي عدد العناصر' })
  total: number;

  @ApiProperty({ description: 'رقم الصفحة الحالية' })
  page: number;

  @ApiProperty({ description: 'رقم آخر صفحة' })
  lastPage: number;

  @ApiProperty({ description: 'عدد العناصر في الصفحة' })
  limit: number;
}

export class PaginatedResult<T> {
  @ApiProperty({ isArray: true, description: 'البيانات' })
  data: T[];

  @ApiProperty({ type: PaginationMeta, description: 'معلومات الصفحات' })
  meta: PaginationMeta;

  constructor(data: T[], total: number, page: number, limit: number) {
    this.data = data;
    this.meta = {
      total,
      page,
      lastPage: Math.ceil(total / limit) || 1,
      limit,
    };
  }
}
