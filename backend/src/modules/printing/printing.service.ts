import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreatePrintTemplateDto,
  PRINT_DOCUMENT_TYPES,
  PRINT_PAPER_SIZES,
  QueryPrintTemplateDto,
} from './dto/create-print-template.dto';
import { UpdatePrintTemplateDto } from './dto/update-print-template.dto';
import { LogPrintDto, QueryPrintLogDto } from './dto/log-print.dto';

/**
 * SELIM-ERP W1 — خدمة قوالب الطباعة وسجل الطباعة (تقلد printing في Selim ERP).
 *
 * قواعد المجال (نفس مسار Selim):
 * - القالب = (اسم، مستند، حجم ورق، إعداد JSON) — القالب بيانات لا كود.
 * - قالب افتراضي واحد لكل (مستند × حجم ورق): تعيين isDefault=true يُزيل
 *   الافتراضية عن بقية قوالب الزوج داخل نفس المعاملة (ثابت Selim).
 * - الحذف ناعم (isActive=false) — سجل الطباعة يشير للقوالب بـ SetNull
 *   لكننا نحافظ على القالب للقراءة التاريخية.
 * - سجل الطباعة يلتقط أسماء المستخدم/القالب لحظة الطباعة (لقطات).
 * - البذرة idempotent: تنشئ قالبًا افتراضيًا عربيًا لكل زوج ناقص فقط.
 */

/** تسميات عربية لأنواع المستندات — تُستخدم في أسماء قوالب البذرة. */
const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  INVOICE: 'فاتورة مبيعات',
  PURCHASE: 'أمر شراء',
  PRODUCTION_ORDER: 'أمر إنتاج',
  MATERIAL_ISSUE: 'إذن صرف خامات',
  RECEIPT: 'سند قبض',
  QUOTATION: 'عرض سعر',
  VOUCHER: 'سند صرف/قبض',
  CUTTING: 'أمر قص',
};

/**
 * إعداد JSON الافتراضي لقالب بذرة (نفس بنية Selim):
 * styles + sections + customElements + tokens — مع الرموز المعيارية
 * {{company.name}} / {{doc.number}} / {{date.now}} التي يحلّها محرك
 * الرندرة في العميل.
 */
function buildSeedConfig(paperSize: string): Record<string, unknown> {
  const thermal = paperSize === '58mm' || paperSize === '80mm';
  return {
    styles: {
      fontName: thermal ? 'monospace' : 'Cairo',
      fontSize: thermal ? 10 : 12,
      direction: 'rtl',
      showLogo: !thermal,
      paperWidth: paperSize,
    },
    sections: thermal
      ? ['header', 'items_table', 'totals', 'footer']
      : ['header', 'items_table', 'totals', 'notes', 'footer'],
    customElements: [],
    tokens: ['{{company.name}}', '{{doc.number}}', '{{date.now}}'],
  };
}

@Injectable()
export class PrintingService {
  constructor(private readonly prisma: PrismaService) {}

  /** قائمة القوالب بفلترة مستند/ورق/حالة + ترقيم. */
  async findAll(query: QueryPrintTemplateDto) {
    const page = query.page ?? 1;
    const where: Prisma.PrintTemplateWhereInput = {};
    if (query.documentType) where.documentType = query.documentType;
    if (query.paperSize) where.paperSize = query.paperSize;
    if (query.isActive !== undefined) where.isActive = query.isActive;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.printTemplate.findMany({
        where,
        orderBy: [
          { documentType: 'asc' },
          { paperSize: 'asc' },
          { name: 'asc' },
        ],
        skip: (page - 1) * 20,
        take: 20,
      }),
      this.prisma.printTemplate.count({ where }),
    ]);
    const limit = 20;
    return { items, total, page, limit, pages: Math.ceil(total / limit) || 1 };
  }

  /** تفاصيل قالب واحد. */
  async findOne(id: string) {
    const template = await this.prisma.printTemplate.findUnique({
      where: { id },
    });
    if (!template) throw new NotFoundException('قالب الطباعة غير موجود');
    return template;
  }

  /**
   * إنشاء قالب — إذا كان افتراضيًا تُزال الافتراضية عن بقية قوالب
   * (المستند × حجم الورق) داخل نفس المعاملة (ثابت Selim: افتراضي واحد
   * لكل زوج).
   */
  async create(dto: CreatePrintTemplateDto) {
    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) {
        await tx.printTemplate.updateMany({
          where: {
            documentType: dto.documentType,
            paperSize: dto.paperSize,
            isDefault: true,
          },
          data: { isDefault: false },
        });
      }
      try {
        return await tx.printTemplate.create({
          data: {
            name: dto.name,
            documentType: dto.documentType,
            paperSize: dto.paperSize,
            isDefault: dto.isDefault ?? false,
            config: (dto.config ?? {}) as Prisma.InputJsonValue,
          },
        });
      } catch (error) {
        // القيد الفريد [name, documentType, paperSize] — تعارض الأسماء.
        if ((error as { code?: string })?.code === 'P2002') {
          throw new ConflictException(
            'اسم القالب مستخدم لنفس المستند وحجم الورق',
          );
        }
        throw error;
      }
    });
  }

  /**
   * تعديل قالب — نفس قاعدة الافترادية عند تعيين isDefault=true
   * (يستثني القالب نفسه من الإزالة)، والانتقال لزوج جديد يطبّق القاعدة
   * على الزوج الجديد.
   */
  async update(id: string, dto: UpdatePrintTemplateDto) {
    const existing = await this.prisma.printTemplate.findUnique({
      where: { id },
      select: { id: true, documentType: true, paperSize: true },
    });
    if (!existing) throw new NotFoundException('قالب الطباعة غير موجود');

    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) {
        await tx.printTemplate.updateMany({
          where: {
            documentType: dto.documentType ?? existing.documentType,
            paperSize: dto.paperSize ?? existing.paperSize,
            isDefault: true,
            id: { not: id },
          },
          data: { isDefault: false },
        });
      }
      try {
        return await tx.printTemplate.update({
          where: { id },
          data: {
            ...(dto.name !== undefined ? { name: dto.name } : {}),
            ...(dto.documentType !== undefined
              ? { documentType: dto.documentType }
              : {}),
            ...(dto.paperSize !== undefined
              ? { paperSize: dto.paperSize }
              : {}),
            ...(dto.isDefault !== undefined
              ? { isDefault: dto.isDefault }
              : {}),
            ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
            ...(dto.config !== undefined
              ? { config: dto.config as Prisma.InputJsonValue }
              : {}),
          },
        });
      } catch (error) {
        if ((error as { code?: string })?.code === 'P2002') {
          throw new ConflictException(
            'اسم القالب مستخدم لنفس المستند وحجم الورق',
          );
        }
        throw error;
      }
    });
  }

  /**
   * حذف قالب = تعطيل ناعم (isActive=false) — السجل التاريخي للطباعة
   * يظل قابلًا للقراءة. نُزيل الافتراضية أيضًا حتى لا يُختار قالب
   * معطّل افتراضيًا في أي مسار لاحق.
   */
  async remove(id: string) {
    const existing = await this.prisma.printTemplate.findUnique({
      where: { id },
      select: { id: true, isActive: true },
    });
    if (!existing) throw new NotFoundException('قالب الطباعة غير موجود');
    await this.prisma.printTemplate.update({
      where: { id },
      data: { isActive: false, isDefault: false },
    });
    return { deleted: true, id };
  }

  /**
   * بذرة idempotent (تقلد presets Selim): تنشئ قالبًا افتراضيًا عربيًا
   * لكل (مستند × حجم ورق) لا يملك أي قالب — الاستدعاء المتكرر لا ينشئ
   * شيئًا. 8 مستندات × 4 أحجام = 32 قالبًا كحد أقصى.
   */
  async seed() {
    const existing = await this.prisma.printTemplate.findMany({
      select: { documentType: true, paperSize: true },
    });
    const covered = new Set(
      existing.map((t) => `${t.documentType}|${t.paperSize}`),
    );

    let created = 0;
    let existingPairs = 0;
    for (const documentType of PRINT_DOCUMENT_TYPES) {
      for (const paperSize of PRINT_PAPER_SIZES) {
        if (covered.has(`${documentType}|${paperSize}`)) {
          existingPairs++;
          continue;
        }
        await this.prisma.printTemplate.create({
          data: {
            name: `${DOCUMENT_TYPE_LABELS[documentType]} — ${paperSize}`,
            documentType,
            paperSize,
            isDefault: true,
            config: buildSeedConfig(paperSize) as Prisma.InputJsonValue,
          },
        });
        created++;
      }
    }
    return {
      created,
      existing: existingPairs,
      totalPairs: PRINT_DOCUMENT_TYPES.length * PRINT_PAPER_SIZES.length,
    };
  }

  /**
   * القالب الافتراضي لزوج (مستند × حجم ورق) — أو 404 بلا افتراضي.
   * يُستخدم داخليًا من الطباعة التلقائية ويُعرَّب الخطأ كما في Selim.
   */
  async resolveDefault(documentType: string, paperSize: string) {
    this.assertValidPair(documentType, paperSize);
    const template = await this.prisma.printTemplate.findFirst({
      where: {
        documentType,
        paperSize,
        isDefault: true,
        isActive: true,
      },
    });
    if (!template) {
      throw new NotFoundException('لا يوجد قالب افتراضي لهذا المستند');
    }
    return template;
  }

  /**
   * تسجيل عملية طباعة — يتحقق من وجود القالب إن أُرسل templateId،
   * يلتقط اسم المستخدم الحالي واسم القالب، ويُنشئ سجلًا واحدًا.
   * نُنشئ السجل await (جدول صغير) رغم دلالة fire-and-forget في Selim —
   * حتى لا يضيع سجل تدقيق عند فشل مبكر (الجدول خفيف والكتابة واحدة).
   */
  async logPrint(dto: LogPrintDto, user: { id: string; name?: string }) {
    let template: { id: string; name: string; paperSize: string } | null = null;
    if (dto.templateId) {
      template = await this.prisma.printTemplate.findUnique({
        where: { id: dto.templateId },
        select: { id: true, name: true, paperSize: true },
      });
      if (!template) {
        throw new NotFoundException('القالب المحدد غير موجود');
      }
    }

    // لقطة اسم المستخدم من الجلسة، ومن قاعدة البيانات عند غيابها
    // (الجلسة تحمل الاسم أصلًا — الاحتياط لمسارات الاختبار/التكامل).
    let userName = user.name;
    if (!userName) {
      const found = await this.prisma.user.findUnique({
        where: { id: user.id },
        select: { name: true },
      });
      userName = found?.name ?? 'مستخدم غير معروف';
    }

    return this.prisma.printLog.create({
      data: {
        userId: user.id,
        userName,
        documentType: dto.documentType,
        documentId: dto.documentId ?? null,
        documentNumber: dto.documentNumber ?? null,
        templateId: template?.id ?? null,
        templateName: template?.name ?? null,
        channel: dto.channel,
        // حجم الورق المُرسل يتقدم؛ وإلا لقطة من القالب المستخدم.
        paperSize: dto.paperSize ?? template?.paperSize ?? null,
        copies: dto.copies ?? 1,
        isReprint: dto.isReprint ?? false,
      },
    });
  }

  /** سجل الطباعة بفلترة مستند/مستخدم/نطاق زمني + ترقيم (عرض تدقيق). */
  async findLogs(query: QueryPrintLogDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.PrintLogWhereInput = {};
    if (query.documentType) where.documentType = query.documentType;
    if (query.userId) where.userId = query.userId;
    if (query.from || query.to) {
      where.createdAt = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }
    const [items, total] = await this.prisma.$transaction([
      this.prisma.printLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.printLog.count({ where }),
    ]);
    return { items, total, page, limit, pages: Math.ceil(total / limit) || 1 };
  }

  /** التحقق من صلاحية زوج (مستند × حجم ورق) في مسارات المعاملات. */
  private assertValidPair(documentType: string, paperSize: string) {
    if (!PRINT_DOCUMENT_TYPES.includes(documentType as never)) {
      throw new BadRequestException('نوع المستند غير صالح');
    }
    if (!PRINT_PAPER_SIZES.includes(paperSize as never)) {
      throw new BadRequestException('حجم الورق غير صالح');
    }
  }
}
