import { ListResponseDto } from './list-response.dto';

/**
 * CC-6 (P2 — GF-IMP-W3): مواصفة قالب الاستجابة الموحد —
 * الحقول الكنسية items/total/page/limit + حقلا التوافق الانتقاليان
 * data/meta (نفس مرجع items وشكل PaginationMeta) حتى ترحيل مستهلكي
 * الواجهة الحاليين إلى العقد الجديد.
 */
describe('ListResponseDto — CC-6 قالب الاستجابة الموحد', () => {
  it('يبني العقد الكنسي items/total/page/limit', () => {
    const result = new ListResponseDto([{ id: 'a' }, { id: 'b' }], 42, 2, 2);

    expect(result.items).toEqual([{ id: 'a' }, { id: 'b' }]);
    expect(result.total).toBe(42);
    expect(result.page).toBe(2);
    expect(result.limit).toBe(2);
  });

  it('حقلا التوافق data/meta بنفس مرجع items وشكل PaginationMeta القديم', () => {
    const items = [{ id: 'a' }];
    const result = new ListResponseDto(items, 5, 2, 2);

    // data نفس المرجع (لا نسخة) — توافق مع payload['data'] في الجوال
    expect(result.data).toBe(items);
    expect(result.meta).toEqual({
      total: 5,
      page: 2,
      pageSize: 2,
      totalPages: 3,
      hasNextPage: true,
      hasPreviousPage: true,
    });
  });

  it('ميتا الترقيم الحدودية: صفحة أخيرة بلا تالية وصفحة أولى بلا سابقة', () => {
    const last = new ListResponseDto([], 4, 2, 2);
    expect(last.meta.totalPages).toBe(2);
    expect(last.meta.hasNextPage).toBe(false);
    expect(last.meta.hasPreviousPage).toBe(true);

    const first = new ListResponseDto([], 4, 1, 2);
    expect(first.meta.hasNextPage).toBe(true);
    expect(first.meta.hasPreviousPage).toBe(false);
  });

  it('قائمة فارغة: hasNextPage=false حتى في الصفحة الأولى', () => {
    const empty = new ListResponseDto([], 0, 1, 20);
    expect(empty.items).toEqual([]);
    expect(empty.meta.totalPages).toBe(0);
    expect(empty.meta.hasNextPage).toBe(false);
    expect(empty.meta.hasPreviousPage).toBe(false);
  });

  it('يتسلسل عبر JSON.stringify بحقوله الكنسية والتوافقية (شكل استجابة HTTP)', () => {
    const result = new ListResponseDto([{ id: 'a' }], 1, 1, 20);
    const serialized = JSON.parse(JSON.stringify(result)) as Record<
      string,
      unknown
    >;

    expect(serialized).toMatchObject({
      items: [{ id: 'a' }],
      total: 1,
      page: 1,
      limit: 20,
      data: [{ id: 'a' }],
      meta: { total: 1, page: 1, pageSize: 20, totalPages: 1 },
    });
  });
});
