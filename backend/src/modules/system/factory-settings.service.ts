import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateFactorySettingsDto } from './dto/update-factory-settings.dto';

/**
 * SELIM-ERP W3 — خدمة إعدادات المصنع (تقلد factorySettingsRepository في
 * Selim ERP: get-or-create لصف واحد + تحديث جزئي + تدقيق).
 *
 * التكييفات المقصودة عن المرجع (تُوثَّق في SELIM_REPLICATION.md):
 * 1. **الشعار data-URL في القاعدة** بدل fs.writeFileSync إلى public/
 *    (مجلد زائل على Railway ولا يُخدَّم بعد البناء — خطأ في المرجع
 *    لا ننسخه). الحد 512KB — عرض طباعة/تصدير فقط.
 * 2. **lastBackupAt في القاعدة** — تذكير النسخ الاحتياطي من الخادم
 *    (المرجع يقرأه من localStorage في المتصفح فيضيع مع مسح الكاش).
 */

/** المفتاح الثابت للصف الوحيد — get-or-create. */
const SETTINGS_ID = 'factory';

/** حد الشعار data-URL — 512KB يكفي شعارًا للإيصارات والتصدير. */
const MAX_LOGO_BYTES = 512 * 1024;

/** القيم الافتراضية عند أول قراءة (نفس افتراضات Selim). */
const DEFAULTS = {
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
};

@Injectable()
export class FactorySettingsService {
  constructor(private readonly prisma: PrismaService) {}

  /** يقرأ الإعدادات (ينشئ الصف الافتراضي أول مرة). */
  async getSettings() {
    const existing = await this.prisma.factorySettings.findUnique({
      where: { id: SETTINGS_ID },
    });
    if (existing) return existing;
    try {
      return await this.prisma.factorySettings.create({
        data: { id: SETTINGS_ID, ...DEFAULTS },
      });
    } catch {
      // سباق إنشاء نادر (طلبان متوازيان) — الصف صار موجودًا: اقرأه.
      return this.prisma.factorySettings.findUniqueOrThrow({
        where: { id: SETTINGS_ID },
      });
    }
  }

  /** تحديث جزئي + تحقق الشعار + تدقيق ActivityLog. */
  async update(dto: UpdateFactorySettingsDto, actorId: string) {
    await this.getSettings();
    const data: Prisma.FactorySettingsUpdateInput = {};

    if (dto.factoryName !== undefined) {
      if (!dto.factoryName.trim()) {
        throw new BadRequestException('اسم المصنع لا يمكن أن يكون فارغًا');
      }
      data.factoryName = dto.factoryName.trim();
    }
    if (dto.factoryNameEn !== undefined)
      data.factoryNameEn = dto.factoryNameEn ?? null;
    if (dto.slogan !== undefined) data.slogan = dto.slogan || null;
    if (dto.phone !== undefined) data.phone = dto.phone || null;
    if (dto.whatsapp !== undefined) data.whatsapp = dto.whatsapp || null;
    if (dto.email !== undefined) data.email = dto.email || null;
    if (dto.address !== undefined) data.address = dto.address || null;
    if (dto.taxNumber !== undefined) data.taxNumber = dto.taxNumber || null;
    if (dto.commercialRegister !== undefined)
      data.commercialRegister = dto.commercialRegister || null;

    if (dto.logo !== undefined) {
      if (dto.logo === '') {
        data.logo = null; // حذف الشعار
      } else {
        this.assertValidLogo(dto.logo);
        data.logo = dto.logo;
      }
    }

    if (dto.currency !== undefined) data.currency = dto.currency.trim();
    if (dto.invoicePrefix !== undefined)
      data.invoicePrefix = dto.invoicePrefix || null;
    if (dto.invoiceFooter !== undefined)
      data.invoiceFooter = dto.invoiceFooter || null;
    if (dto.defaultPaperSize !== undefined)
      data.defaultPaperSize = dto.defaultPaperSize;
    if (dto.enableInvoiceQr !== undefined)
      data.enableInvoiceQr = dto.enableInvoiceQr;
    if (dto.taxRate !== undefined)
      data.taxRate = new Prisma.Decimal(dto.taxRate);

    const [updated] = await this.prisma.$transaction([
      this.prisma.factorySettings.update({
        where: { id: SETTINGS_ID },
        data,
      }),
      this.prisma.activityLog.create({
        data: {
          userId: actorId,
          action: 'FACTORY_SETTINGS_UPDATED',
          module: 'SYSTEM',
          details: {
            changedFields: Object.keys(dto),
          },
        },
      }),
    ]);
    return updated;
  }

  /**
   * يسجّل آخر نسخة احتياطية ناجحة — تستدعيه BackupService بعد اكتمال
   * التصدير (يغذي تنبيه «مر أسبوع بلا نسخة» من الخادم).
   */
  async markBackupDone(at: Date = new Date()) {
    await this.getSettings();
    await this.prisma.factorySettings.update({
      where: { id: SETTINGS_ID },
      data: { lastBackupAt: at },
    });
  }

  /** تحقق الشعار: data-URL صورة فقط + حد الحجم (يمنع svg/نص ضار). */
  private assertValidLogo(logo: string) {
    const match =
      /^data:(image\/(png|jpe?g|webp));base64,([A-Za-z0-9+/=]+)$/.exec(logo);
    if (!match) {
      throw new BadRequestException(
        'الشعار يجب أن يكون data-URL بصيغة PNG أو JPG أو WEBP',
      );
    }
    // base64: 4 حروف لكل 3 بايتات — تقدير الحجم الفعلي.
    const approxBytes = Math.floor((match[3].length * 3) / 4);
    if (approxBytes > MAX_LOGO_BYTES) {
      throw new BadRequestException(
        'حجم الشعار يتجاوز 512KB — صغّر الصورة وأعد المحاولة',
      );
    }
  }
}
