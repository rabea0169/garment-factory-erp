import { validate, ValidationError } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import {
  CreateJournalEntryDto,
  JournalLineDto,
} from './create-journal-entry.dto';

/**
 * ACC-10 (GF-IMP-W3): مواصفة حدود مصفوفة بنود القيد —
 * لا تُقبل مصفوفة فارغة (بند واحد على الأقل) ولا تتجاوز 500 بند
 * (حماية القيد الواحد من ضخامة payload تُرهق $transaction).
 * الـ ValidationPipe العالمي يرفض أي مخالفة بـ 400 برسالة عربية.
 */
describe('CreateJournalEntryDto — ACC-10 سقف بنود القيد', () => {
  const baseLine = {
    debitAccountId: '00000000-0000-4000-8000-0000000000d1',
    creditAccountId: '00000000-0000-4000-8000-0000000000c1',
    amount: 100,
  };

  function buildDto(overrides: Record<string, unknown> = {}) {
    return plainToInstance(CreateJournalEntryDto, {
      description: 'قيد اختبار',
      fiscalPeriodId: '00000000-0000-4000-8000-0000000000f1',
      lines: [baseLine],
      ...overrides,
    });
  }

  async function errorsOf(dto: object) {
    return validate(dto, { whitelist: true, forbidNonWhitelisted: true });
  }

  function allConstraintKeys(errors: ValidationError[]): string[] {
    const keys: string[] = [];
    for (const e of errors) {
      if (e.constraints) keys.push(...Object.keys(e.constraints));
      if (e.children?.length) keys.push(...allConstraintKeys(e.children));
    }
    return keys;
  }

  it('يقبل DTO صالحًا ببند واحد دون أخطاء', async () => {
    expect(await errorsOf(buildDto())).toHaveLength(0);
  });

  it('مصفوفة بنود فارغة → خطأ ArrayMinSize برسالة عربية (400)', async () => {
    const errors = await errorsOf(buildDto({ lines: [] }));
    expect(allConstraintKeys(errors)).toContain('arrayMinSize');
    const messages = JSON.stringify(errors);
    expect(messages).toContain('بندًا واحدًا على الأقل');
  });

  it('أكثر من 500 بند → خطأ ArrayMaxSize برسالة عربية (400)', async () => {
    const lines = Array.from({ length: 501 }, () => ({ ...baseLine }));
    const errors = await errorsOf(buildDto({ lines }));
    expect(allConstraintKeys(errors)).toContain('arrayMaxSize');
    const messages = JSON.stringify(errors);
    expect(messages).toContain('500');
  });

  it('يقبل 500 بندًا بالضبط (الحد الأقصى المشروع)', async () => {
    const lines = Array.from({ length: 500 }, () => ({ ...baseLine }));
    expect(await errorsOf(buildDto({ lines }))).toHaveLength(0);
  });

  it('بند بلا مدين/دائن يُرفض (IsUUID داخل ValidateNested)', async () => {
    const errors = await errorsOf(
      buildDto({ lines: [{ ...baseLine, debitAccountId: 'not-a-uuid' }] }),
    );
    expect(allConstraintKeys(errors)).toContain('isUuid');
  });

  it('رسم Swagger (ApiProperty) موجود على lines — مواصفة القائمة', () => {
    const dto = plainToInstance(CreateJournalEntryDto, {
      description: 'x',
      fiscalPeriodId: '00000000-0000-4000-8000-0000000000f1',
      lines: [plainToInstance(JournalLineDto, baseLine)],
    });
    const meta: unknown = Reflect.getMetadata(
      'swagger/apiModelProperties',
      dto,
      'lines',
    );
    expect(meta).toBeDefined();
  });
});
