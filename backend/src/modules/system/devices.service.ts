import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RegisterDeviceDto } from './dto/register-device.dto';

/**
 * SELIM-ERP W3 — خدمة الأجهزة (تقلد /api/devices في Selim — APP-1):
 * register (upsert على deviceId: أنشئ أو حدّث آخر ظهور) + heartbeat
 * (تحديث lastSeenAt فقط) + قائمة الأجهزة (ADMIN+).
 *
 * تكييف: بلا companyId (أحادي المستأجر) وisStandalone استُبدل بـ
 * appVersion (إصدار تطبيق Flutter).
 *
 * heartbeat بلا upsert مقصود: الجهاز غير المسجل مسبقًا يجب أن يسجل نفسه
 * أولًا (register) — نفس سلوك المرجع (updateMany لا تنشئ صفوفًا).
 */
@Injectable()
export class DevicesService {
  constructor(private readonly prisma: PrismaService) {}

  /** تسجيل/تحديث جهاز — يرجع الجهاز المحفوظ. */
  async register(dto: RegisterDeviceDto, userId: string) {
    const deviceId = dto.deviceId.trim();
    if (!deviceId) {
      throw new BadRequestException('معرّف الجهاز مطلوب');
    }
    return this.prisma.device.upsert({
      where: { deviceId },
      create: {
        deviceId,
        userId,
        userAgent: dto.userAgent ?? null,
        platform: dto.platform ?? null,
        language: dto.language ?? null,
        screenWidth: dto.screenWidth ?? null,
        screenHeight: dto.screenHeight ?? null,
        isMobile: dto.isMobile ?? false,
        appVersion: dto.appVersion ?? null,
        lastSeenAt: new Date(),
      },
      update: {
        userId,
        userAgent: dto.userAgent ?? undefined,
        platform: dto.platform ?? undefined,
        language: dto.language ?? undefined,
        screenWidth: dto.screenWidth ?? undefined,
        screenHeight: dto.screenHeight ?? undefined,
        isMobile: dto.isMobile ?? undefined,
        appVersion: dto.appVersion ?? undefined,
        lastSeenAt: new Date(),
      },
    });
  }

  /** نبضة — تحدّث آخر ظهور فقط للجهاز المسجل مسبقًا. */
  async heartbeat(deviceId: string, userId: string) {
    const trimmed = (deviceId ?? '').trim();
    if (!trimmed) {
      throw new BadRequestException('معرّف الجهاز مطلوب');
    }
    const result = await this.prisma.device.updateMany({
      where: { deviceId: trimmed },
      data: { lastSeenAt: new Date(), userId },
    });
    return { ok: true, updated: result.count, ts: Date.now() };
  }

  /** قائمة الأجهزة — ADMIN+ (أحدث ظهور أولًا). */
  async list(limit = 50) {
    return this.prisma.device.findMany({
      orderBy: { lastSeenAt: 'desc' },
      take: limit,
      select: {
        id: true,
        deviceId: true,
        platform: true,
        language: true,
        screenWidth: true,
        screenHeight: true,
        isMobile: true,
        appVersion: true,
        lastSeenAt: true,
        createdAt: true,
        user: { select: { name: true } },
      },
    });
  }
}
