import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreatePurchaseReceiptDto } from './create-purchase-receipt.dto';

/**
 * PUR-2 (W1-D): مواصفة تحقق DTO إذن الاستلام —
 * الكمية عشرية موجبة حتى 4 منازل (كانت IsInt فتعذر استلام الكميات
 * الكسرية رغم أن عمود بند الشراء Decimal(10,4)).
 */
describe('CreatePurchaseReceiptDto — PUR-2 كميات كسرية', () => {
  const itemId = '5b1f7c2e-0000-4000-8000-000000000001';

  async function errorsOf(items: unknown[]) {
    const dto = plainToInstance(CreatePurchaseReceiptDto, { items });
    return validate(dto, { whitelist: true, forbidNonWhitelisted: true });
  }

  it('يقبل كمية استلام كسرية 2.5 (كان IsInt يرفضها)', async () => {
    const errors = await errorsOf([
      { purchaseOrderItemId: itemId, quantity: 2.5 },
    ]);
    expect(errors).toHaveLength(0);
  });

  it('يقبل كمية عشرية حتى 4 منازل مطابقة لعمود Decimal(10,4)', async () => {
    const errors = await errorsOf([
      { purchaseOrderItemId: itemId, quantity: 1.2345 },
    ]);
    expect(errors).toHaveLength(0);
  });

  it('يرفض كمية بمنازل عشرية أكثر من 4', async () => {
    const errors = await errorsOf([
      { purchaseOrderItemId: itemId, quantity: 1.00001 },
    ]);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('يرفض كمية سالبة', async () => {
    const errors = await errorsOf([
      { purchaseOrderItemId: itemId, quantity: -2.5 },
    ]);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('يرفض كمية صفر (IsPositive)', async () => {
    const errors = await errorsOf([
      { purchaseOrderItemId: itemId, quantity: 0 },
    ]);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('يرفض كمية غير رقمية (نص)', async () => {
    const errors = await errorsOf([
      { purchaseOrderItemId: itemId, quantity: 'abc' },
    ]);
    expect(errors.length).toBeGreaterThan(0);
  });
});
