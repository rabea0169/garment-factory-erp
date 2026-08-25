import { PaginatedResult } from './paginated-result.dto';

describe('PaginatedResult — GF-0012 contract', () => {
  it('returns the canonical data/meta shape for a populated page', () => {
    const result = new PaginatedResult([{ id: 'item-1' }], 41, 2, 20);

    expect(result).toEqual({
      data: [{ id: 'item-1' }],
      meta: {
        total: 41,
        page: 2,
        pageSize: 20,
        totalPages: 3,
        hasNextPage: true,
        hasPreviousPage: true,
      },
    });
  });

  it('returns no navigation flags for an empty result', () => {
    const result = new PaginatedResult([], 0, 1, 20);

    expect(result.meta).toEqual({
      total: 0,
      page: 1,
      pageSize: 20,
      totalPages: 0,
      hasNextPage: false,
      hasPreviousPage: false,
    });
  });
});
