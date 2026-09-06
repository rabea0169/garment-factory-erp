import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ListQueryDto } from './list-query.dto';

/**
 * CC-6 (P2 — GF-IMP-W3): مواصفة قالب الاستعلام الموحد —
 * نفس قواعد PaginationDto (page ≥ 1 وlimit بين 1 و100) زائد
 * from/to ISO اختياريان وq نص اختياري بحد 100 حرف.
 */
describe('ListQueryDto — CC-6 قالب الاستعلام الموحد', () => {
  async function errorsOf(payload: Record<string, unknown>) {
    return validate(plainToInstance(ListQueryDto, payload), {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
  }

  it('يقبل قيمة فارغة (كل الحقول اختيارية بقيم افتراضية)', async () => {
    const dto = plainToInstance(ListQueryDto, {});
    expect(dto.page).toBe(1);
    expect(dto.limit).toBe(20);
    expect(await errorsOf({})).toHaveLength(0);
  });

  it('يرفض limit فوق 100 (حد أقصى موحد للقوائم)', async () => {
    const errors = await errorsOf({ page: 1, limit: 101 });
    expect(errors.some((e) => e.constraints?.['max'])).toBe(true);
  });

  it('يرفض from غير ISO (IsDateString)', async () => {
    const errors = await errorsOf({ from: 'ليس تاريخًا' });
    expect(errors.some((e) => e.constraints?.['isDateString'])).toBe(true);
  });

  it('يرفض to غير ISO (IsDateString)', async () => {
    const errors = await errorsOf({ to: '31/08/2026' });
    expect(errors.some((e) => e.constraints?.['isDateString'])).toBe(true);
  });

  it('يقبل from/to صالحين وq نصًا حرًا', async () => {
    expect(
      await errorsOf({
        from: '2026-08-01T00:00:00Z',
        to: '2026-08-31T23:59:59Z',
        q: 'SHP-2026',
      }),
    ).toHaveLength(0);
  });

  it('يرفض q أطول من 100 حرف (حد موحد لنص البحث)', async () => {
    const errors = await errorsOf({ q: 'أ'.repeat(101) });
    expect(errors.some((e) => e.constraints?.['maxLength'])).toBe(true);
  });

  it('يرفض حقولًا غير معرفة (whitelist) — لا تمرير مرشحات مجهولة', async () => {
    const errors = await errorsOf({ status: 'PREPARING' });
    // status ليس من القالب الأساسي — يعرّفه DTO الابن فقط
    expect(errors.length).toBeGreaterThan(0);
  });
});
