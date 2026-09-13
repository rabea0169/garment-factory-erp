import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { DevicesService } from './devices.service';
import { PrismaService } from '../../prisma/prisma.service';
import { createPrismaMock } from '../../../test/helpers/prisma-mock';
import { RegisterDeviceDto } from './dto/register-device.dto';

/**
 * SELIM-ERP W3 — اختبارات الأجهزة (APP-1 في المرجع):
 * - register: upsert على deviceId (إنشاء أو تحديث + lastSeenAt).
 * - heartbeat: تحديث آخر ظهور فقط للجهاز المسجل (بلا إنشاء).
 * - list: أحدث ظهور أولًا + حد.
 */

describe('DevicesService — الأجهزة (SELIM W3)', () => {
  let service: DevicesService;
  let prisma: ReturnType<typeof createPrismaMock>;

  beforeEach(() => {
    prisma = createPrismaMock();
    service = new DevicesService(prisma as unknown as PrismaService);
  });

  it('register: upsert على deviceId مع بيانات الجهاز والمستخدم', async () => {
    const device = {
      id: 'd-1',
      deviceId: 'device-abc',
      platform: 'android',
      appVersion: '1.4.0+7',
    };
    prisma.device.upsert.mockResolvedValue(device);

    const dto = new RegisterDeviceDto();
    dto.deviceId = 'device-abc';
    dto.platform = 'android';
    dto.appVersion = '1.4.0+7';
    dto.isMobile = true;

    const result = await service.register(dto, 'user-1');

    expect(result).toBe(device);
    expect(prisma.device.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { deviceId: 'device-abc' },
        create: expect.objectContaining({
          deviceId: 'device-abc',
          userId: 'user-1',
          platform: 'android',
          isMobile: true,
          appVersion: '1.4.0+7',
        }) as Record<string, unknown>,
        update: expect.objectContaining({
          userId: 'user-1',
          lastSeenAt: expect.any(Date) as Date,
        }) as Record<string, unknown>,
      }) as Record<string, unknown>,
    );
  });

  it('register: deviceId فارغ → BadRequest', async () => {
    const dto = new RegisterDeviceDto();
    dto.deviceId = '   ';
    await expect(service.register(dto, 'user-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('heartbeat: updateMany على deviceId فقط — لا إنشاء صفوف', async () => {
    prisma.device.updateMany.mockResolvedValue({ count: 1 });
    const result = await service.heartbeat('device-abc', 'user-1');
    expect(prisma.device.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { deviceId: 'device-abc' },
        data: expect.objectContaining({
          lastSeenAt: expect.any(Date) as Date,
          userId: 'user-1',
        }) as Record<string, unknown>,
      }) as Record<string, unknown>,
    );
    expect(result.updated).toBe(1);
    expect(result.ok).toBe(true);
  });

  it('heartbeat: جهاز غير مسجل → updated 0 (يسجّل نفسه أولًا)', async () => {
    prisma.device.updateMany.mockResolvedValue({ count: 0 });
    const result = await service.heartbeat('unknown', 'user-1');
    expect(result.updated).toBe(0);
  });

  it('list: أحدث ظهور أولًا مع حد افتراضي 50', async () => {
    prisma.device.findMany.mockResolvedValue([]);
    await service.list();
    expect(prisma.device.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { lastSeenAt: 'desc' },
        take: 50,
      }) as Record<string, unknown>,
    );
  });
});
