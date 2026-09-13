import 'reflect-metadata';
import { PrintingService } from './printing.service';
import {
  PRINT_DOCUMENT_TYPES,
  PRINT_PAPER_SIZES,
} from './dto/create-print-template.dto';

/**
 * SELIM-ERP W1 — اختبارات خدمة الطباعة.
 *
 * تركّز على قواعد المجال (نفس قواعد Selim ERP):
 * - الافتراضي الواحد لكل (مستند × حجم ورق) داخل نفس المعاملة.
 * - بذرة القوالب idempotent — تنشئ الأزواج الناقصة فقط.
 * - resolveDefault يرفض بلا قالب افتراضي (404).
 * - سجل الطباعة يلتقط أسماء المستخدم/القالب ويتحقق من وجود القالب.
 * - الحذف ناعم، وتعارض الأسماء يُترجم P2002 لرسالة عربية.
 */
describe('PrintingService — قواعد الطباعة (SELIM W1)', () => {
  let service: PrintingService;
  let prisma: {
    $transaction: jest.Mock;
    printTemplate: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      delete: jest.Mock;
      count: jest.Mock;
    };
    printLog: { create: jest.Mock; findMany: jest.Mock; count: jest.Mock };
    user: { findUnique: jest.Mock };
  };
  const tx = {} as unknown as Record<string, unknown>;
  /** الوصول ل mock المعاملة بنوع معلوم (tx يُعاد تعبئته كل اختبار). */
  const txPrint = () =>
    tx.printTemplate as {
      create: jest.Mock;
      updateMany: jest.Mock;
    };

  beforeEach(() => {
    prisma = {
      $transaction: jest
        .fn()
        .mockImplementation(
          (arg: ((client: unknown) => unknown) | unknown[]) =>
            typeof arg === 'function' ? Promise.resolve(arg(tx)) : [[], 0],
        ),
      printTemplate: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'tpl-1' }),
        update: jest.fn().mockResolvedValue({ id: 'tpl-1' }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        delete: jest.fn().mockResolvedValue({ id: 'tpl-1' }),
        count: jest.fn().mockResolvedValue(0),
      },
      printLog: {
        create: jest.fn().mockResolvedValue({ id: 'log-1' }),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      user: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    Object.assign(tx, prisma);
    service = new PrintingService(prisma as never);
  });

  it('إنشاء قالب افتراضي يزيل الافتراضية عن بقية قوالب نفس المستند × الورق', async () => {
    await service.create({
      name: 'فاتورة مبيعات — A4 رسمية',
      documentType: 'INVOICE',
      paperSize: 'A4',
      isDefault: true,
    });
    // ثابت Selim: افتراضي واحد للزوج — الإزالة داخل نفس المعاملة.
    expect(txPrint().updateMany).toHaveBeenCalledWith({
      where: { documentType: 'INVOICE', paperSize: 'A4', isDefault: true },
      data: { isDefault: false },
    });
    const createCalls = txPrint().create.mock.calls as unknown as Array<
      [{ data: { isDefault: boolean } }]
    >;
    expect(createCalls[0]?.[0]?.data.isDefault).toBe(true);
  });

  it('إنشاء قالب غير افتراضي لا يمسّ افتراضية بقية القوالب', async () => {
    await service.create({
      name: 'فاتورة مبيعات — A4 مختصرة',
      documentType: 'INVOICE',
      paperSize: 'A4',
    });
    expect(txPrint().updateMany).not.toHaveBeenCalled();
  });

  it('تعيين isDefault في التعديل يزيل الافتراضية عن غيره (باستثناء نفسه)', async () => {
    prisma.printTemplate.findUnique.mockResolvedValue({
      id: 'tpl-1',
      documentType: 'INVOICE',
      paperSize: 'A4',
    });
    await service.update('tpl-1', { isDefault: true });
    expect(txPrint().updateMany).toHaveBeenCalledWith({
      where: {
        documentType: 'INVOICE',
        paperSize: 'A4',
        isDefault: true,
        id: { not: 'tpl-1' },
      },
      data: { isDefault: false },
    });
  });

  it('البذرة تنشئ قالبًا لكل زوج ناقص (40 زوجًا) ثم لا تنشئ شيئًا عند التكرار', async () => {
    const first = await service.seed();
    // 8 مستندات × 5 أحجام (58mm/80mm/A4/A5/A6) = 40 قالبًا عند الفراغ الكامل.
    expect(first.created).toBe(40);
    expect(first.existing).toBe(0);
    expect(prisma.printTemplate.create).toHaveBeenCalledTimes(40);
    expect(first.totalPairs).toBe(40);
    // كل قالب افتراضي وبتكوين عربي يحمل الرموز المعيارية.
    const createCalls = prisma.printTemplate.create.mock
      .calls as unknown as Array<
      [
        {
          data: {
            isDefault: boolean;
            name: string;
            config: { tokens: string[] };
          };
        },
      ]
    >;
    expect(createCalls[0]?.[0]?.data.isDefault).toBe(true);
    expect(createCalls[0]?.[0]?.data.name).toContain('فاتورة مبيعات — ');
    expect(createCalls[0]?.[0]?.data.config.tokens).toContain(
      '{{company.name}}',
    );

    // إعادة التشغيل بعد امتلاء كل الأزواج — لا إنشاء (idempotent).
    prisma.printTemplate.findMany.mockResolvedValue(
      PRINT_DOCUMENT_TYPES.flatMap((documentType) =>
        PRINT_PAPER_SIZES.map((paperSize) => ({ documentType, paperSize })),
      ),
    );
    prisma.printTemplate.create.mockClear();
    const second = await service.seed();
    expect(second.created).toBe(0);
    expect(second.existing).toBe(40);
    expect(prisma.printTemplate.create).not.toHaveBeenCalled();
  });

  it('البذرة تتخطى الأزواج الموجودة جزئيًا فقط', async () => {
    prisma.printTemplate.findMany.mockResolvedValue([
      { documentType: 'INVOICE', paperSize: 'A4' },
    ]);
    const result = await service.seed();
    expect(result.created).toBe(39);
    expect(result.existing).toBe(1);
    // لم يُنشأ قالب لزوج INVOICE×A4.
    const createCalls = prisma.printTemplate.create.mock
      .calls as unknown as Array<
      [{ data: { documentType: string; paperSize: string } }]
    >;
    const pairs = createCalls.map(
      (c) => `${c[0]?.data.documentType}|${c[0]?.data.paperSize}`,
    );
    expect(pairs).not.toContain('INVOICE|A4');
  });

  it('resolveDefault يرفض 404 عند غياب قالب افتراضي للزوج', async () => {
    prisma.printTemplate.findFirst.mockResolvedValue(null);
    await expect(service.resolveDefault('INVOICE', 'A4')).rejects.toThrow(
      'لا يوجد قالب افتراضي لهذا المستند',
    );
  });

  it('resolveDefault يرفض زوجًا غير صالح قبل الاستعلام', async () => {
    await expect(service.resolveDefault('NOT_A_DOC', 'A4')).rejects.toThrow(
      'نوع المستند غير صالح',
    );
    expect(prisma.printTemplate.findFirst).not.toHaveBeenCalled();
  });

  it('تسجيل طباعة يرفض قالبًا غير موجود عند إرسال templateId', async () => {
    prisma.printTemplate.findUnique.mockResolvedValue(null);
    await expect(
      service.logPrint(
        {
          documentType: 'INVOICE',
          channel: 'app_pdf',
          templateId: 'tpl-missing',
        },
        { id: 'user-1', name: 'سليم' },
      ),
    ).rejects.toThrow('القالب المحدد غير موجود');
  });

  it('تسجيل طباعة يلتقط اسم المستخدم واسم القالب وحجم الورق', async () => {
    prisma.printTemplate.findUnique.mockResolvedValue({
      id: 'tpl-9',
      name: 'فاتورة مبيعات — A4 رسمية',
      paperSize: 'A4',
    });
    await service.logPrint(
      {
        documentType: 'INVOICE',
        documentNumber: 'INV-0007',
        templateId: 'tpl-9',
        channel: 'thermal',
        copies: 2,
        isReprint: true,
      },
      { id: 'user-1', name: 'سليم محمود' },
    );
    const logCalls = prisma.printLog.create.mock.calls as unknown as Array<
      [{ data: Record<string, unknown> }]
    >;
    const logged = logCalls[0]?.[0]?.data ?? {};
    expect(logged).toMatchObject({
      userId: 'user-1',
      userName: 'سليم محمود',
      templateId: 'tpl-9',
      templateName: 'فاتورة مبيعات — A4 رسمية',
      documentNumber: 'INV-0007',
      channel: 'thermal',
      // حجم الورق لم يُرسل → لقطة من القالب.
      paperSize: 'A4',
      copies: 2,
      isReprint: true,
    });
  });

  it('تسجيل طباعة يلتقط اسم المستخدم من قاعدة البيانات عند غيابه من الجلسة', async () => {
    prisma.user.findUnique.mockResolvedValue({ name: 'محاسب المصنع' });
    await service.logPrint(
      { documentType: 'VOUCHER', channel: 'external' },
      { id: 'user-2' },
    );
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'user-2' },
      select: { name: true },
    });
    const logCalls = prisma.printLog.create.mock.calls as unknown as Array<
      [{ data: Record<string, unknown> }]
    >;
    expect(logCalls[0]?.[0]?.data).toMatchObject({
      userName: 'محاسب المصنع',
    });
  });

  it('الحذف ناعم: تعطيل القالب وإزالة افتراضيته دون حذف فعلي', async () => {
    prisma.printTemplate.findUnique.mockResolvedValue({
      id: 'tpl-1',
      isActive: true,
    });
    const result = await service.remove('tpl-1');
    expect(result).toEqual({ deleted: true, id: 'tpl-1' });
    expect(prisma.printTemplate.update).toHaveBeenCalledWith({
      where: { id: 'tpl-1' },
      data: { isActive: false, isDefault: false },
    });
    expect(prisma.printTemplate.delete).not.toHaveBeenCalled();
  });

  it('تعارض اسم القالب (P2002) يُترجم لرسالة تعارض عربية', async () => {
    txPrint().create.mockRejectedValueOnce({ code: 'P2002' });
    await expect(
      service.create({
        name: 'فاتورة مبيعات — A4 رسمية',
        documentType: 'INVOICE',
        paperSize: 'A4',
      }),
    ).rejects.toThrow('اسم القالب مستخدم لنفس المستند وحجم الورق');
  });
});
