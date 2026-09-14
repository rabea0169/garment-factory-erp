import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { FactorySettingsService } from './factory-settings.service';
import { PrismaService } from '../../prisma/prisma.service';
import { createPrismaMock } from '../../../test/helpers/prisma-mock';
import { UpdateFactorySettingsDto } from './dto/update-factory-settings.dto';

/**
 * SELIM-ERP W3 — اختبارات إعدادات المصنع:
 * - get-or-create للصف الوحيد (مع سباق إنشاء نادر).
 * - تحديث جزئي + تدقيق ActivityLog.
 * - بوابات الشعار: data-URL صورة فقط + حد 512KB (تصحيح خطأ المرجع
 *   الذي يكتب الشعار إلى القرص — لا ننقل الخطأ).
 */

const SETTINGS_ROW = {
  id: 'factory',
  factoryName: 'مصنع الملابس',
  factoryNameEn: null,
  slogan: null,
  phone: null,
  whatsapp: null,
  email: null,
  address: null,
  taxNumber: null,
  commercialRegister: null,
  logo: null,
  currency: 'ج.م',
  invoicePrefix: 'INV-',
  invoiceFooter: null,
  defaultPaperSize: 'A4',
  enableInvoiceQr: true,
  taxRate: new Prisma.Decimal(0),
  lastBackupAt: null,
  updatedAt: new Date(),
};

describe('FactorySettingsService — إعدادات المصنع (SELIM W3)', () => {
  let service: FactorySettingsService;
  let prisma: ReturnType<typeof createPrismaMock>;

  beforeEach(() => {
    prisma = createPrismaMock();
    service = new FactorySettingsService(prisma as unknown as PrismaService);
    prisma.factorySettings.findUnique.mockResolvedValue(SETTINGS_ROW);
    prisma.$transaction.mockImplementation((arg: unknown): Promise<unknown> =>
      Array.isArray(arg) ? Promise.all(arg) : Promise.resolve(arg),
    );
  });

  it('getSettings: يقرأ الصف الموجود كما هو', async () => {
    const settings = await service.getSettings();
    expect(settings).toBe(SETTINGS_ROW);
    expect(prisma.factorySettings.create).not.toHaveBeenCalled();
  });

  it('getSettings: ينشئ الصف الافتراضي عند أول قراءة', async () => {
    prisma.factorySettings.findUnique.mockResolvedValue(null);
    prisma.factorySettings.create.mockResolvedValue(SETTINGS_ROW);
    const settings = await service.getSettings();
    expect(settings).toBe(SETTINGS_ROW);
    expect(prisma.factorySettings.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ id: 'factory' }) as Record<
          string,
          unknown
        >,
      }) as Record<string, unknown>,
    );
  });

  it('getSettings: سباق إنشاء (P2002) يعيد القراءة — لا يرمي', async () => {
    prisma.factorySettings.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(SETTINGS_ROW);
    prisma.factorySettings.create.mockRejectedValue(
      new Error('Unique constraint failed'),
    );
    prisma.factorySettings.findUniqueOrThrow.mockResolvedValue(SETTINGS_ROW);
    const settings = await service.getSettings();
    expect(settings).toBe(SETTINGS_ROW);
  });

  it('update: تحديث جزئي يمرر الحقول المرسلة فقط + سجل تدقيق', async () => {
    const updated = { ...SETTINGS_ROW, factoryName: 'مصنع سليم' };
    prisma.factorySettings.update.mockResolvedValue(updated);
    const dto = new UpdateFactorySettingsDto();
    dto.factoryName = 'مصنع سليم';

    const result = await service.update(dto, 'user-1');

    expect(result).toBe(updated);
    expect(prisma.factorySettings.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'factory' },
        data: expect.objectContaining({
          factoryName: 'مصنع سليم',
        }) as Record<string, unknown>,
      }) as Record<string, unknown>,
    );
    expect(prisma.activityLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user-1',
          action: 'FACTORY_SETTINGS_UPDATED',
          module: 'SYSTEM',
        }) as Record<string, unknown>,
      }) as Record<string, unknown>,
    );
  });

  it('update: اسم فارغ يُرفض (BadRequest)', async () => {
    const dto = new UpdateFactorySettingsDto();
    dto.factoryName = '   ';
    await expect(service.update(dto, 'user-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('update: الشعار يجب أن يكون data-URL صورة — يُرفض غير ذلك', async () => {
    const dto = new UpdateFactorySettingsDto();
    dto.logo = 'https://evil.example.com/logo.png';
    await expect(service.update(dto, 'user-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );

    const svg = new UpdateFactorySettingsDto();
    svg.logo = 'data:image/svg+xml;base64,PHN2Zy8+';
    await expect(service.update(svg, 'user-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('update: شعار data-URL صالح يُقبل ويُخزَّن في القاعدة', async () => {
    const updated = { ...SETTINGS_ROW, logo: 'data:image/png;base64,aGVsbG8=' };
    prisma.factorySettings.update.mockResolvedValue(updated);
    const dto = new UpdateFactorySettingsDto();
    dto.logo = 'data:image/png;base64,aGVsbG8=';
    const result = await service.update(dto, 'user-1');
    expect(result).toBe(updated);
    expect(prisma.factorySettings.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          logo: 'data:image/png;base64,aGVsbG8=',
        }) as Record<string, unknown>,
      }) as Record<string, unknown>,
    );
  });

  it('markBackupDone: يحدّث lastBackupAt للصف الوحيد', async () => {
    await service.markBackupDone(new Date('2026-09-14T10:00:00Z'));
    expect(prisma.factorySettings.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'factory' },
        data: expect.objectContaining({
          lastBackupAt: new Date('2026-09-14T10:00:00Z'),
        }) as Record<string, unknown>,
      }) as Record<string, unknown>,
    );
  });
});
