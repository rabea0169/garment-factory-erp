import { validate, ValidationError } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { AddStockDto } from './add-stock.dto';
import { ReceiveStockDto } from './receive-stock.dto';
import { IssueStockDto } from './issue-stock.dto';
import { AdjustStockDto } from './adjust-stock.dto';
import { WasteStockDto } from './waste-stock.dto';

/**
 * INV-4 (W2-4): حدود الدقة العشرية في DTOs حركات المخزون —
 * الكميات حتى 4 منازل (مطابقة Decimal(12,4) لأعمدة الـ ledger)،
 * وحقول التكلفة منزلتان (مطابقة Decimal(10,2) لـ RawMaterial.costPerUnit).
 * الـ ValidationPipe العالمي يرفض أي مخالفة بـ 400 قبل أي معالجة/GL.
 */
describe('INV-4 — حدود الدقة العشرية في DTOs حركات المخزون', () => {
  const RM_ID = '5b1f7c2e-0000-4000-8000-000000000001';
  const WH_ID = '5b1f7c2e-0000-4000-8000-000000000002';

  /** بناة DTOs كاملة صالحة — تُبدَّل قيمة الحقل محل الاختبار فقط */
  const builders: Record<
    string,
    (overrides: Record<string, unknown>) => object
  > = {
    AddStockDto: (o) =>
      plainToInstance(AddStockDto, { quantity: 10, costPerUnit: 45.5, ...o }),
    ReceiveStockDto: (o) =>
      plainToInstance(ReceiveStockDto, {
        rawMaterialId: RM_ID,
        warehouseId: WH_ID,
        quantity: 10,
        unitCost: 48,
        ...o,
      }),
    IssueStockDto: (o) =>
      plainToInstance(IssueStockDto, {
        rawMaterialId: RM_ID,
        warehouseId: WH_ID,
        quantity: 10,
        ...o,
      }),
    AdjustStockDto: (o) =>
      plainToInstance(AdjustStockDto, {
        rawMaterialId: RM_ID,
        warehouseId: WH_ID,
        quantityDelta: -3.5,
        reason: 'عجز جرد شهري',
        ...o,
      }),
    WasteStockDto: (o) =>
      plainToInstance(WasteStockDto, {
        rawMaterialId: RM_ID,
        warehouseId: WH_ID,
        quantity: 2.5,
        reason: 'قماش تالف',
        ...o,
      }),
  };

  async function errorsOf(dto: object): Promise<ValidationError[]> {
    return validate(dto, { whitelist: true, forbidNonWhitelisted: true });
  }

  /** كل قيود التحقق من شجرة الأخطاء (المتداخلة ضمنًا) */
  function allConstraintKeys(errors: ValidationError[]): string[] {
    const keys: string[] = [];
    for (const e of errors) {
      if (e.constraints) keys.push(...Object.keys(e.constraints));
      if (e.children?.length) keys.push(...allConstraintKeys(e.children));
    }
    return keys;
  }

  it('كل الـ DTOs الخمسة صالحة بالقيم المرجعية قبل أي تعديل', async () => {
    for (const build of Object.values(builders)) {
      expect(await errorsOf(build({}))).toHaveLength(0);
    }
  });

  // ============ الكميات: 4 منازل مقبولة / 10 منازل مرفوضة ============

  it.each(['AddStockDto', 'ReceiveStockDto', 'IssueStockDto', 'WasteStockDto'])(
    '%s: كمية بـ 4 منازل عشرية → مقبولة (لا خطأ isNumber)',
    async (name) => {
      const errors = await errorsOf(builders[name]({ quantity: 2.5005 }));
      expect(allConstraintKeys(errors)).not.toContain('isNumber');
    },
  );

  it.each(['AddStockDto', 'ReceiveStockDto', 'IssueStockDto', 'WasteStockDto'])(
    '%s: كمية بـ 10 منازل عشرية → خطأ isNumber (400)',
    async (name) => {
      const errors = await errorsOf(builders[name]({ quantity: 0.1234567891 }));
      expect(allConstraintKeys(errors)).toContain('isNumber');
    },
  );

  it('AdjustStockDto: quantityDelta بـ 4 منازل → مقبول (سالب وموجب)', async () => {
    expect(
      await errorsOf(builders.AdjustStockDto({ quantityDelta: -3.5005 })),
    ).toHaveLength(0);
    expect(
      await errorsOf(builders.AdjustStockDto({ quantityDelta: 3.5005 })),
    ).toHaveLength(0);
  });

  it('AdjustStockDto: quantityDelta بـ 10 منازل → خطأ isNumber (400)', async () => {
    const errors = await errorsOf(
      builders.AdjustStockDto({ quantityDelta: -3.1234567891 }),
    );
    expect(allConstraintKeys(errors)).toContain('isNumber');
  });

  it('AdjustStockDto: quantityDelta صفر → مرفوض بـ notEquals لا بـ IsPositive', async () => {
    const keys = allConstraintKeys(
      await errorsOf(builders.AdjustStockDto({ quantityDelta: 0 })),
    );
    expect(keys).toContain('notEquals');
    // لا IsPositive على التسوية عمدًا — الإشارة السالبة/الموجبة كلاهما مشروع
    expect(keys).not.toContain('isPositive');
  });

  // ============ حقول التكلفة: منزلتان فقط ============

  it('ReceiveStockDto: unitCost بمنزلتين → مقبول', async () => {
    expect(
      await errorsOf(builders.ReceiveStockDto({ unitCost: 45.55 })),
    ).toHaveLength(0);
  });

  it('ReceiveStockDto: unitCost بأكثر من منزلتين (10 منازل) → خطأ isNumber (400)', async () => {
    const errors = await errorsOf(
      builders.ReceiveStockDto({ unitCost: 45.1234567891 }),
    );
    expect(allConstraintKeys(errors)).toContain('isNumber');
  });

  it('ReceiveStockDto: unitCost بـ 3 منازل → خطأ isNumber (400)', async () => {
    const errors = await errorsOf(
      builders.ReceiveStockDto({ unitCost: 45.505 }),
    );
    expect(allConstraintKeys(errors)).toContain('isNumber');
  });

  it('AddStockDto: costPerUnit بمنزلتين → مقبول', async () => {
    expect(
      await errorsOf(builders.AddStockDto({ costPerUnit: 45.55 })),
    ).toHaveLength(0);
  });

  it('AddStockDto: costPerUnit بأكثر من منزلتين → خطأ isNumber (400)', async () => {
    const errors = await errorsOf(
      builders.AddStockDto({ costPerUnit: 45.505 }),
    );
    expect(allConstraintKeys(errors)).toContain('isNumber');
  });

  // ============ الحراسات الأصلية بقيت كما هي ============

  it('WasteStockDto: كمية سالبة → تبقى مرفوضة بـ isPositive', async () => {
    const errors = await errorsOf(builders.WasteStockDto({ quantity: -2.5 }));
    expect(allConstraintKeys(errors)).toContain('isPositive');
  });

  it('ReceiveStockDto: كمية سالبة → تبقى مرفوضة بـ isPositive', async () => {
    const errors = await errorsOf(builders.ReceiveStockDto({ quantity: -5 }));
    expect(allConstraintKeys(errors)).toContain('isPositive');
  });
});
