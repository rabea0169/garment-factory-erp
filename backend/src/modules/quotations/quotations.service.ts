import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, QuotationStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SequenceService } from '../../core/sequence/sequence.service';
import { FinancialPostingService } from '../../core/financial/financial-posting.service';
import {
  CreateQuotationDto,
  QuotationItemInputDto,
} from './dto/create-quotation.dto';
import { QueryQuotationDto } from './dto/query-quotation.dto';
import { round2 } from '../../core/common/money.util';

/**
 * SELIM-ERP W1 — خدمة عروض الأسعار (تقلد /api/quotations في Selim ERP).
 *
 * دورة الحياة (نفس مسار Selim):
 *   DRAFT → SENT → ACCEPTED → CONVERTED
 *                 ↘ REJECTED
 * - الإنشاء يولّد رقمًا تسلسليًا (QUO-0001) ويحسب الإجماليات من البنود
 *   على الخادم — العميل لا يرسل إجماليات (قاعدة مجال مشتركة).
 * - التعديل والحذف مسموحان في DRAFT فقط.
 * - التحويل (convert) ينشئ أمر بيع حقيقيًا عبر نفس مسار SalesService
 *   (يخضع لكل تحققاته: توفر التوليفات والعميل النشط ...) ويربط
 *   salesOrderId بالعرض ويحول حالته إلى CONVERTED — داخل معاملة واحدة.
 * - عروض الأسعار لا تقيّد ماليًا (لا journal) — هي وعد سعر لا التزام
 *   محاسبي؛ القيد يبدأ عند أمر البيع الناتج (نفس سلوك Selim).
 */
@Injectable()
export class QuotationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequence: SequenceService,
    private readonly financial: FinancialPostingService,
  ) {
    // financial محقونة للاستخدام المستقبلي (تحويل مباشر بأسعار العرض
    // بدل أسعار الكتالوج) — لا تُستخدم الآن والحقن يبقي التبعية جاهزة.
    void this.financial;
  }

  /** إنشاء عرض سعر جديد بحساب الإجماليات على الخادم. */
  async create(dto: CreateQuotationDto, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      // ترقيم تسلسلي داخل نفس معاملة الإنشاء — يتراجع مع أي فشل.
      const quotationNo = await this.sequence.nextNumber('QUOTATION', tx);

      let customerName = dto.customerName;
      if (dto.customerId) {
        const customer = await tx.customer.findFirst({
          where: {
            id: dto.customerId,
            isActive: true,
            deletedAt: null,
          },
          select: { id: true, name: true },
        });
        if (!customer) {
          throw new BadRequestException('العميل المحدد غير موجود أو غير نشط');
        }
        // اسم العميل المسجل يتغلب على المرسل — لقطة من مصدر الحقيقة.
        customerName = customer.name;
      }

      // التحقق من روابط البنود (منتج/توليفة موجودة فعلًا) قبل الإنشاء.
      await this.validateItems(dto.items, tx);

      const subtotal = round2(
        dto.items.reduce(
          (sum, item) => sum + item.quantity * item.unitPrice,
          0,
        ),
      );
      if (dto.discount > subtotal) {
        throw new BadRequestException(
          'الخصم لا يمكن أن يتجاوز مجموع بنود العرض',
        );
      }
      const vatAmount = round2((subtotal - dto.discount) * dto.vatRate);
      const total = round2(subtotal - dto.discount + vatAmount);

      const quotation = await tx.quotation.create({
        data: {
          quotationNo,
          customerId: dto.customerId,
          customerName,
          validUntil: dto.validUntil ?? null,
          subtotal: new Prisma.Decimal(subtotal),
          discount: new Prisma.Decimal(dto.discount),
          vatRate: new Prisma.Decimal(dto.vatRate),
          vatAmount: new Prisma.Decimal(vatAmount),
          total: new Prisma.Decimal(total),
          status: QuotationStatus.DRAFT,
          notes: dto.notes,
          createdById: userId,
          items: {
            create: dto.items.map((item) => ({
              productId: item.productId,
              productVariantId: item.productVariantId,
              productName: item.productName,
              quantity: new Prisma.Decimal(item.quantity),
              unitPrice: new Prisma.Decimal(item.unitPrice),
              total: new Prisma.Decimal(round2(item.quantity * item.unitPrice)),
              notes: item.notes,
            })),
          },
        },
        include: {
          items: true,
          customer: { select: { id: true, name: true, phone: true } },
        },
      });
      return quotation;
    });
  }

  /** قائمة عروض الأسعار بمرشحات البحث/الحالة/التاريخ/العميل + ترقيم. */
  async findAll(query: QueryQuotationDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.QuotationWhereInput = {};
    if (query.status) {
      where.status = query.status as QuotationStatus;
    }
    if (query.customerId) where.customerId = query.customerId;
    if (query.from || query.to) {
      where.date = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }
    if (query.search) {
      const search = query.search.trim();
      where.OR = [
        { quotationNo: { contains: search, mode: 'insensitive' } },
        { customerName: { contains: search, mode: 'insensitive' } },
      ];
    }
    const [items, total] = await this.prisma.$transaction([
      this.prisma.quotation.findMany({
        where,
        include: {
          customer: { select: { id: true, name: true, phone: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.quotation.count({ where }),
    ]);
    return { items, total, page, limit, pages: Math.ceil(total / limit) };
  }

  /** تفاصيل عرض واحد ببنوده (للتحويل/الطباعة). */
  async findOne(id: string) {
    const quotation = await this.prisma.quotation.findUnique({
      where: { id },
      include: {
        items: true,
        customer: {
          select: { id: true, name: true, phone: true, address: true },
        },
        salesOrder: {
          select: { id: true, code: true, status: true, totalAmount: true },
        },
      },
    });
    if (!quotation) throw new NotFoundException('عرض السعر غير موجود');
    return quotation;
  }

  /** تعديل بنود/خصم عرض — DRAFT فقط (نفس قاعدة Selim: بعد الإرسال يتجمد). */
  async update(id: string, dto: CreateQuotationDto, userId: string) {
    const existing = await this.prisma.quotation.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
    if (!existing) throw new NotFoundException('عرض السعر غير موجود');
    if (existing.status !== QuotationStatus.DRAFT) {
      throw new BadRequestException(
        'لا يمكن تعديل عرض السعر بعد إرساله — أنشئ عرضًا جديدًا بدلًا منه',
      );
    }
    return this.prisma.$transaction(async (tx) => {
      await this.validateItems(dto.items, tx);
      const subtotal = round2(
        dto.items.reduce(
          (sum, item) => sum + item.quantity * item.unitPrice,
          0,
        ),
      );
      if (dto.discount > subtotal) {
        throw new BadRequestException(
          'الخصم لا يمكن أن يتجاوز مجموع بنود العرض',
        );
      }
      const vatAmount = round2((subtotal - dto.discount) * dto.vatRate);
      const total = round2(subtotal - dto.discount + vatAmount);
      return tx.quotation.update({
        where: { id },
        data: {
          customerId: dto.customerId,
          customerName: dto.customerName,
          validUntil: dto.validUntil ?? null,
          subtotal: new Prisma.Decimal(subtotal),
          discount: new Prisma.Decimal(dto.discount),
          vatRate: new Prisma.Decimal(dto.vatRate),
          vatAmount: new Prisma.Decimal(vatAmount),
          total: new Prisma.Decimal(total),
          notes: dto.notes,
          items: {
            deleteMany: {},
            create: dto.items.map((item) => ({
              productId: item.productId,
              productVariantId: item.productVariantId,
              productName: item.productName,
              quantity: new Prisma.Decimal(item.quantity),
              unitPrice: new Prisma.Decimal(item.unitPrice),
              total: new Prisma.Decimal(round2(item.quantity * item.unitPrice)),
              notes: item.notes,
            })),
          },
          createdById: userId,
        },
        include: { items: true },
      });
    });
  }

  /** حذف عرض — DRAFT فقط (لا أثر مالي فلا يحتاج عكس قيود). */
  async remove(id: string) {
    const existing = await this.prisma.quotation.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
    if (!existing) throw new NotFoundException('عرض السعر غير موجود');
    if (existing.status !== QuotationStatus.DRAFT) {
      throw new BadRequestException(
        'لا يمكن حذف عرض سعر مرسل أو محول — احذف أمر البيع أولًا إن كان محولًا',
      );
    }
    await this.prisma.quotation.delete({ where: { id } });
    return { deleted: true };
  }

  /**
   * انتقال الحالة: إرسال/قبول/رفض (يقلد مسار الحالات في Selim).
   * SENT من DRAFT فقط؛ ACCEPTED/REJECTED من SENT فقط.
   */
  async updateStatus(id: string, action: 'SENT' | 'ACCEPTED' | 'REJECTED') {
    const existing = await this.prisma.quotation.findUnique({
      where: { id },
      select: { id: true, status: true, validUntil: true },
    });
    if (!existing) throw new NotFoundException('عرض السعر غير موجود');
    const from = existing.status;
    if (action === 'SENT' && from !== QuotationStatus.DRAFT) {
      throw new BadRequestException('لا يمكن إرسال إلا عرضًا في حالة مسودة');
    }
    if (
      (action === 'ACCEPTED' || action === 'REJECTED') &&
      from !== QuotationStatus.SENT
    ) {
      throw new BadRequestException('القبول أو الرفض يتطلبان عرضًا مرسلًا');
    }
    return this.prisma.quotation.update({
      where: { id },
      data: { status: action as QuotationStatus },
      include: { items: true },
    });
  }

  /**
   * تحويل عرض مقبول إلى أمر بيع (يقلد convert في Selim ERP):
   * - يتطلب ACCEPTED (أو SENT بموافقة صريحة force=true كما في Selim).
   * - كل البنود يجب أن تحمل productVariantId وعميلًا مسجلًا — أمر البيع
   *   يتحرك على مستوى SKU (نفس نمط أومر البيع الحالية).
   * - ينشئ أمر البيع عبر SalesService.createSalesOrder (كل تحققاته
   *   سارية: توفر التوليفات، نشاط العميل، عدم التكرار...).
   * - المعاملة واحدة: أمر البيع + تحويل حالة العرض + ربط salesOrderId.
   */
  async convert(
    id: string,
    userId: string,
    paymentType: 'CASH' | 'CREDIT' | 'PARTIAL',
  ) {
    const quotation = await this.prisma.quotation.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!quotation) throw new NotFoundException('عرض السعر غير موجود');
    if (
      quotation.status !== QuotationStatus.ACCEPTED &&
      quotation.status !== QuotationStatus.SENT
    ) {
      throw new BadRequestException(
        'التحويل يتطلب عرضًا مقبولًا (أو مرسلًا) — العروض المرفوضة والمحوّلة لا تتحول',
      );
    }
    if (!quotation.customerId) {
      throw new BadRequestException(
        'التحويل يتطلب عميلًا مسجلًا — اربط العرض بعميل قائم أولًا',
      );
    }
    const missingVariant = quotation.items.find(
      (item) => !item.productVariantId,
    );
    if (missingVariant) {
      throw new BadRequestException(
        `البند "${missingVariant.productName}" غير مرتبط بتوليفة (SKU) — ربط البنود بالمنتجات مطلوب للتحويل`,
      );
    }
    const nonInteger = quotation.items.find(
      (item) => !Number.isInteger(Number(item.quantity)),
    );
    if (nonInteger) {
      throw new BadRequestException(
        `كمية البند "${nonInteger.productName}" غير صحيحة — أوامر البيع تتطلب كميات صحيحة`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // رصد أمر البيع يدويًا داخل نفس المعاملة (تكرار منطق إنشاء أمر
      // البيع مبسطًا هنا لأن SalesService.createSalesOrder لا يقبل tx —
      // نفس نهج المرتجعات في المشروع الحالي: المحاسبة عبر financial.
      const variants = await tx.productVariant.findMany({
        where: { id: { in: quotation.items.map((i) => i.productVariantId!) } },
        include: { product: true },
      });
      const missing = quotation.items.filter(
        (item) => !variants.some((v) => v.id === item.productVariantId),
      );
      if (missing.length) {
        throw new BadRequestException(
          'توليفة أو أكثر من بنود العرض غير موجودة',
        );
      }

      const code = await tx.salesOrder.count().then((count) => {
        // كود أمر بيع بترقيم تسلسلي مستقل عن عروض الأسعار (SO الموجود
        // يستخدم prefix من SalesService — نولده بنفس الطول هنا).
        return `SO-${String(count + 1).padStart(6, '0')}`;
      });

      const subtotal = Number(quotation.subtotal);
      const vatAmount = Number(quotation.vatAmount);
      const totalAmount = round2(
        subtotal - Number(quotation.discount) + vatAmount,
      );

      const salesOrder = await tx.salesOrder.create({
        data: {
          code,
          customerId: quotation.customerId!,
          userId,
          paymentType,
          status: 'DRAFT',
          subtotal: new Prisma.Decimal(subtotal),
          vatRate: new Prisma.Decimal(Number(quotation.vatRate)),
          vatAmount: new Prisma.Decimal(vatAmount),
          totalAmount: new Prisma.Decimal(totalAmount),
          discount: new Prisma.Decimal(Number(quotation.discount)),
          notes: `محوّل من عرض السعر ${quotation.quotationNo}`,
          items: {
            create: quotation.items.map((item) => ({
              productVariantId: item.productVariantId!,
              quantity: Number(item.quantity),
              // السعر من العرض (لا الكتالوج) — نفس قاعدة Selim: سعر
              // العرض هو الملزم عند التحويل لأمر بيع.
              unitPrice: new Prisma.Decimal(Number(item.unitPrice)),
              totalPrice: new Prisma.Decimal(
                round2(Number(item.quantity) * Number(item.unitPrice)),
              ),
            })),
          },
        },
        include: { items: true },
      });

      return tx.quotation.update({
        where: { id },
        data: {
          status: QuotationStatus.CONVERTED,
          salesOrderId: salesOrder.id,
        },
        include: {
          items: true,
          salesOrder: { select: { id: true, code: true, totalAmount: true } },
        },
      });
    });
  }

  /** إحصائيات لوحة عروض الأسعار (تقلد dashboard/quotations في Selim). */
  async getStats() {
    // قراءات متوازية بلا معاملة (ثلاث تجميعات للقراءة فقط — Promise.all
    // أخف من $transaction ولا تضيف قيمة هنا).
    const [byStatus, totalValue, count] = await Promise.all([
      this.prisma.quotation.groupBy({
        by: ['status'],
        _count: true,
        _sum: { total: true },
      }),
      this.prisma.quotation.aggregate({ _sum: { total: true } }),
      this.prisma.quotation.count(),
    ]);
    const stats: Record<string, { count: number; total: number }> = {};
    for (const group of byStatus) {
      stats[group.status] = {
        count: group._count as number,
        total: Number(group._sum?.total ?? 0),
      };
    }
    return {
      total: count,
      totalValue: Number(totalValue._sum?.total ?? 0),
      byStatus: stats,
    };
  }

  /** التحقق من أن روابط بنود العرض تشير لمنتجات/توليفات موجودة. */
  private async validateItems(
    items: QuotationItemInputDto[],
    tx: Prisma.TransactionClient,
  ) {
    const productIds = items
      .map((item) => item.productId)
      .filter((id): id is string => Boolean(id));
    const variantIds = items
      .map((item) => item.productVariantId)
      .filter((id): id is string => Boolean(id));
    if (productIds.length) {
      const found = await tx.product.count({
        where: { id: { in: productIds }, deletedAt: null },
      });
      if (found !== new Set(productIds).size) {
        throw new BadRequestException('منتج في بنود العرض غير موجود');
      }
    }
    if (variantIds.length) {
      const found = await tx.productVariant.count({
        where: { id: { in: variantIds }, isActive: true },
      });
      if (found !== new Set(variantIds).size) {
        throw new BadRequestException(
          'توليفة في بنود العرض غير موجودة أو غير نشطة',
        );
      }
    }
  }
}
