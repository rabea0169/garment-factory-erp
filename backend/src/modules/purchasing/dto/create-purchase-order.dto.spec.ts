import { validate, ValidationError } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import {
  CreatePurchaseOrderDto,
  PurchaseOrderItemDto,
} from './create-purchase-order.dto';
import { PaymentType } from '@prisma/client';

/**
 * PUR-1 (W1-D): مواصفة تحقق DTO أمر الشراء —
 * الكمية/التكلفة يجب أن تكونا موجبتين (بمنازل عشرية محدودة)،
 * والبنود غير فارغة وبحجم أقصى 200 بند.
 * الـ ValidationPipe العالمي يرفض أي مخالفة بـ 400.
 */
describe('CreatePurchaseOrderDto — PUR-1 تحقق البنود', () => {
  const baseItem = {
    rawMaterialId: '5b1f7c2e-0000-4000-8000-000000000001',
    quantity: 10,
    unitCost: 25,
  };

  function buildDto(overrides: Record<string, unknown> = {}) {
    return plainToInstance(CreatePurchaseOrderDto, {
      supplierId: '5b1f7c2e-0000-4000-8000-000000000002',
      paymentType: PaymentType.CASH,
      items: [baseItem],
      ...overrides,
    });
  }

  async function errorsOf(dto: object) {
    return validate(dto, { whitelist: true, forbidNonWhitelisted: true });
  }

  /** جمع كل قيود التحقق من شجرة الأخطاء (المتداخلة عبر ValidateNested) */
  function allConstraintKeys(errors: ValidationError[]): string[] {
    const keys: string[] = [];
    for (const e of errors) {
      if (e.constraints) keys.push(...Object.keys(e.constraints));
      if (e.children?.length) keys.push(...allConstraintKeys(e.children));
    }
    return keys;
  }

  it('يقبل DTO صالحًا كاملًا دون أخطاء', async () => {
    expect(await errorsOf(buildDto())).toHaveLength(0);
  });

  it('كمية سالبة → خطأ تحقق (400 عبر ValidationPipe)', async () => {
    const errors = await errorsOf(
      buildDto({ items: [{ ...baseItem, quantity: -5 }] }),
    );
    expect(allConstraintKeys(errors)).toContain('isPositive');
  });

  it('تكلفة وحدة سالبة → خطأ تحقق (400 عبر ValidationPipe)', async () => {
    const errors = await errorsOf(
      buildDto({ items: [{ ...baseItem, unitCost: -1.5 }] }),
    );
    expect(allConstraintKeys(errors)).toContain('isPositive');
  });

  it('كمية صفر → خطأ تحقق (IsPositive)', async () => {
    const errors = await errorsOf(
      buildDto({ items: [{ ...baseItem, quantity: 0 }] }),
    );
    expect(allConstraintKeys(errors)).toContain('isPositive');
  });

  it('بنود فارغة (items: []) → خطأ تحقق ArrayMinSize (400)', async () => {
    const errors = await errorsOf(buildDto({ items: [] }));
    expect(allConstraintKeys(errors)).toContain('arrayMinSize');
  });

  it('أكثر من 200 بند → خطأ تحقق ArrayMaxSize', async () => {
    const items = Array.from({ length: 201 }, () => ({ ...baseItem }));
    const errors = await errorsOf(buildDto({ items }));
    expect(allConstraintKeys(errors)).toContain('arrayMaxSize');
  });

  it('كمية بمنازل عشرية أكثر من 4 → خطأ تحقق (مطابقة Decimal(10,4))', async () => {
    const errors = await errorsOf(
      buildDto({ items: [{ ...baseItem, quantity: 1.00001 }] }),
    );
    expect(allConstraintKeys(errors)).toContain('isNumber');
  });

  it('تكلفة وحدة بمنازل عشرية أكثر من 2 → خطأ تحقق (مطابقة Decimal(10,2))', async () => {
    const errors = await errorsOf(
      buildDto({ items: [{ ...baseItem, unitCost: 1.001 }] }),
    );
    expect(allConstraintKeys(errors)).toContain('isNumber');
  });

  it('يقبل كمية كسرية حتى 4 منازل وتكلفة حتى منزلتين (PUR-2 اتساق السياسة)', async () => {
    const errors = await errorsOf(
      buildDto({ items: [{ ...baseItem, quantity: 2.5001, unitCost: 3.33 }] }),
    );
    expect(errors).toHaveLength(0);
  });

  it('رسم Swagger (ApiProperty) موجود على حقول البند — نمط موديول المبيعات', () => {
    const item = plainToInstance(PurchaseOrderItemDto, baseItem);
    const qtyMeta: unknown = Reflect.getMetadata(
      'swagger/apiModelProperties',
      item,
      'quantity',
    );
    const costMeta: unknown = Reflect.getMetadata(
      'swagger/apiModelProperties',
      item,
      'unitCost',
    );
    expect(qtyMeta).toBeDefined();
    expect(costMeta).toBeDefined();
  });
});
