import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, SalesOrderStatus, ShipmentStatus } from '@prisma/client';
import { ListResponseDto } from '../../common/dto/list-response.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { FinancialPostingService } from '../../core/financial/financial-posting.service';
import { CHART_OF_ACCOUNTS } from '../../core/financial/chart-of-accounts';
import { ShipmentQueryDto } from './dto/shipment-query.dto';

import {
  computeRequestHash,
  createIdempotencyKey,
  isIdempotencyUniqueViolation,
  storeIdempotencyResponse,
  tryReplayIdempotencyKey,
} from '../../core/common/idempotency.util';
import {
  generateDocumentCode,
  DocumentCodePrefix,
} from '../../core/common/codes.util';

@Injectable()
export class ShippingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly financialPosting: FinancialPostingService,
  ) {}

  async getShipments(query: ShipmentQueryDto = new ShipmentQueryDto()) {
    const page = query.page ?? 1;
    const pageSize = query.limit ?? 20;
    const skip = (page - 1) * pageSize;

    // SHP-5 (P2 — GF-IMP-W3): فلاتر اختيارية عبر ShipmentQueryDto (قالب
    // CC-6) — التواريخ ISO صالحة وfrom ≤ to، وإلا 400 قبل أي استعلام.
    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;
    if (
      (from && Number.isNaN(from.getTime())) ||
      (to && Number.isNaN(to.getTime()))
    ) {
      throw new BadRequestException('فلاتر الشحنات تتطلب تواريخ ISO صالحة');
    }
    if (from && to && from > to) {
      throw new BadRequestException(
        'تاريخ بداية فلاتر الشحنات لا يمكن أن يكون بعد تاريخ النهاية',
      );
    }

    const where: Prisma.ShipmentWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(from || to
        ? {
            createdAt: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          }
        : {}),
      ...(query.q
        ? {
            OR: [
              { code: { contains: query.q, mode: 'insensitive' } },
              { trackingNumber: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    // SHP-5 (P2 — GF-IMP-W3): إسقاط انتقائي بدل include العميل كاملًا —
    // كان `include: { salesOrder: { include: { customer: true } } }` يسرّب
    // كائن العميل كاملًا (الرصيد balance، الهاتف، البريد، الملاحظات ...)
    // إلى كل مستخدم يقرأ قائمة الشحنات. الإسقاط الآن: أمر البيع بمعرّفه
    // وكوده فقط، والعميل بمعرّفه واسمه فقط — الحقول التي تعرضها القائمة
    // فعليًا. أي حقل إضافي يحتاجه مستهلك لاحقًا يُضاف هنا صراحةً.
    const options = {
      where,
      orderBy: { createdAt: 'desc' } as const,
      skip,
      take: pageSize,
      include: {
        salesOrder: {
          select: {
            id: true,
            code: true,
            customer: { select: { id: true, name: true } },
          },
        },
      },
    };

    const [data, total] = await Promise.all([
      this.prisma.shipment.findMany(options),
      this.prisma.shipment.count({ where }),
    ]);

    // CC-6: قالب الاستجابة الموحد (items/total/page/limit + توافق
    // data/meta الانتقالي للمستهلكين الحاليين).
    return new ListResponseDto(data, total, page, pageSize);
  }

  async createShipment(
    data: {
      salesOrderId: string;
      shippingCompanyId?: string;
      shippingCost?: number;
      trackingNumber?: string;
      notes?: string;
      treasuryId?: string;
      accrueToPayable?: boolean;
    },
    actorId: string,
    idempotencyKey?: string,
  ) {
    const requestHash = computeRequestHash({
      operation: 'shipping.shipment.create',
      actorId,
      salesOrderId: data.salesOrderId,
      shippingCompanyId: data.shippingCompanyId ?? null,
      shippingCost: data.shippingCost ?? null,
      trackingNumber: data.trackingNumber ?? null,
      notes: data.notes ?? null,
      treasuryId: data.treasuryId ?? null,
      accrueToPayable: data.accrueToPayable ?? false,
    });
    const replay = await tryReplayIdempotencyKey(
      this.prisma,
      idempotencyKey,
      'shipping.shipment.create',
      requestHash,
    );
    if (replay) return replay;

    const order = await this.prisma.salesOrder.findUnique({
      where: { id: data.salesOrderId },
      select: { id: true, status: true, code: true },
    });
    if (!order) throw new NotFoundException('Sales order not found');
    if (order.status !== SalesOrderStatus.CONFIRMED) {
      throw new BadRequestException(
        'Cannot create shipment for an unconfirmed order',
      );
    }
    // SHP-1 (P0): الفحص أعلاه خارج المعاملة للتغذية الراجعة السريعة فقط —
    // مصدر الحقيقة هو إعادة القراءة تحت قفل الصف داخل المعاملة أدناه، حيث
    // يُقلب أمر البيع إلى SHIPPED ويُمنع الشحن المزدوج.

    // COMM-F11 / ACC-F03: GL posting for shipping cost. Three modes:
    //   (a) treasuryId + shippingCost > 0 → Dr Shipping Expense / Cr Cash
    //       + treasury balance update (cash sale of shipping service).
    //   (b) accrueToPayable=true + shippingCost > 0 (no treasury) → Dr Shipping
    //       Expense / Cr Accounts Payable (credit to supplier, paid later).
    //   (c) neither flag → no GL posting; the cost is recorded on the shipment
    //       row only and may be expensed later via a separate voucher. This is
    //       the backward-compatible default (existing callers that don't send
    //       treasuryId / accrueToPayable behave exactly as before).
    const shippingCost = data.shippingCost ?? 0;
    if (!Number.isFinite(shippingCost) || shippingCost < 0) {
      throw new BadRequestException(
        'تكلفة الشحن يجب أن تكون رقمًا موجبًا أو صفرًا',
      );
    }
    if (data.treasuryId && data.accrueToPayable) {
      throw new BadRequestException(
        'لا يمكن تحديد treasuryId و accrueToPayable معًا — اختر إما صرف نقدي أو استحقاق',
      );
    }
    if (shippingCost > 0 && data.treasuryId) {
      const treasury = await this.prisma.treasury.findUnique({
        where: { id: data.treasuryId },
        select: { id: true, isActive: true },
      });
      if (!treasury || !treasury.isActive) {
        throw new NotFoundException('الخزينة غير موجودة أو غير نشطة');
      }
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const idempotencyKeyId = await createIdempotencyKey(
          tx,
          idempotencyKey,
          'shipping.shipment.create',
          requestHash,
        );

        // SHP-1 (أ): قفل صف أمر البيع وإعادة قراءته داخل المعاملة — نفس
        // نمط purchase_orders/sales_orders في بقية المسارات. الفحص الذي
        // سبق المعاملة تغذية راجعة سريعة فقط؛ هذا القفل هو مصدر الحقيقة ضد
        // تأكيد/إلغاء/شحن متزامن لنفس الأمر.
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM sales_orders WHERE id = ${data.salesOrderId} FOR UPDATE`,
        );
        const lockedOrder = await tx.salesOrder.findUnique({
          where: { id: data.salesOrderId },
          select: { id: true, status: true, code: true },
        });
        if (!lockedOrder) throw new NotFoundException('Sales order not found');
        if (lockedOrder.status !== SalesOrderStatus.CONFIRMED) {
          throw new ConflictException(
            'أمر البيع لم يعد مؤكدًا — لا يمكن إنشاء شحنة له',
          );
        }

        // SHP-1 (ب): منع شحنة نشطة ثانية لنفس الأمر — "النشطة" هنا
        // PREPARING أو IN_TRANSIT (نفس تعريف الفهرس الجزئي الفريد
        // shipments_active_per_order_unique في هجرة 20260906000000؛
        // الفهرس يظل خط الدفاع الأخير ضد سباق لم يلتقطه هذا الفحص).
        //
        // SHP-3 (أ) (GF-IMP-W2) — قرار موثّق: الشحنة الملغاة (CANCELLED)
        // ليست نشطة فلا تُضاف لهذا الفحص ولا تحجب إنشاء شحنة جديدة
        // (الفهرس الجزئي يستثنيها أصلًا: WHERE status IN
        // ('PREPARING','IN_TRANSIT')). ملاحظة: قيمة CANCELLED موجودة
        // في الـ enum من الهجرة الموحدة 20260906100000 لكن لا يوجد مسار
        // يصلها حاليًا — راجع مصفوفة الانتقالات وتحذيرها أدناه وADR-0017.
        const activeShipments = await tx.shipment.count({
          where: {
            salesOrderId: data.salesOrderId,
            status: {
              in: [ShipmentStatus.PREPARING, ShipmentStatus.IN_TRANSIT],
            },
          },
        });
        if (activeShipments > 0) {
          throw new ConflictException(
            'هناك شحنة نشطة لهذا الأمر بالفعل — أكمل شحنته الحالية أولًا',
          );
        }

        const created = await tx.shipment.create({
          data: {
            code: generateDocumentCode(DocumentCodePrefix.SHIPMENT),
            salesOrderId: data.salesOrderId,
            shippingCompanyId: data.shippingCompanyId,
            shippingCost,
            trackingNumber: data.trackingNumber,
            notes: data.notes,
            idempotencyKeyId,
          },
        });

        // COMM-F11 / ACC-F03: post the GL entry INSIDE the same tx so the
        // shipping expense hit and the shipment row commit atomically.
        // postingKey is keyed to the shipment id → safe for idempotent retry.
        if (shippingCost > 0) {
          if (data.treasuryId) {
            // (a) cash mode — Dr Shipping Expense / Cr Cash
            await this.financialPosting.postJournalEntryInTx(
              tx,
              {
                description: `تكلفة شحن شحنة ${created.code}`,
                reference: `SHIPMENT:${created.id}`,
                postingKey: `shipping-cost-cash:${created.id}`,
                isAuto: true,
                lines: [
                  {
                    debitAccountId: CHART_OF_ACCOUNTS.SHIPPING_EXPENSE,
                    creditAccountId: CHART_OF_ACCOUNTS.CASH,
                    amount: shippingCost,
                    description: `شحن ${lockedOrder.code ?? created.salesOrderId}`,
                  },
                ],
                treasuryUpdates: [
                  { treasuryId: data.treasuryId, delta: -shippingCost },
                ],
                metadata: {
                  source: 'SHIPPING_COST_CASH',
                  shipmentId: created.id,
                  salesOrderId: created.salesOrderId,
                  treasuryId: data.treasuryId,
                },
              },
              actorId,
            );
          } else if (data.accrueToPayable) {
            // (b) accrual mode — Dr Shipping Expense / Cr Accounts Payable
            await this.financialPosting.postJournalEntryInTx(
              tx,
              {
                description: `استحقاق تكلفة شحن ${created.code}`,
                reference: `SHIPMENT:${created.id}`,
                postingKey: `shipping-cost-accrual:${created.id}`,
                isAuto: true,
                lines: [
                  {
                    debitAccountId: CHART_OF_ACCOUNTS.SHIPPING_EXPENSE,
                    creditAccountId: CHART_OF_ACCOUNTS.ACCOUNTS_PAYABLE,
                    amount: shippingCost,
                    description: `استحقاق شحن ${lockedOrder.code ?? created.salesOrderId}`,
                  },
                ],
                metadata: {
                  source: 'SHIPPING_COST_ACCRUAL',
                  shipmentId: created.id,
                  salesOrderId: created.salesOrderId,
                  shippingCompanyId: data.shippingCompanyId ?? null,
                },
              },
              actorId,
            );
          }
          // (c) no flag → skip GL posting intentionally
        }

        await tx.activityLog.create({
          data: {
            userId: actorId,
            action: 'SHIPMENT_CREATED',
            module: 'SHIPPING',
            details: {
              shipmentId: created.id,
              salesOrderId: created.salesOrderId,
              shippingCost,
              postedToGL:
                shippingCost > 0
                  ? data.treasuryId
                    ? 'CASH'
                    : data.accrueToPayable
                      ? 'ACCRUAL'
                      : 'NONE'
                  : 'NONE',
              treasuryId: data.treasuryId ?? null,
            },
          },
        });

        // SHP-1 (أ): بعد نجاح إنشاء الشحنة (والقيود المالية والسجل) نُقلب
        // حالة أمر البيع إلى SHIPPED داخل نفس المعاملة. updateMany مشروط
        // بالحالة CONFIRMED هو حارس أخير: إن صفر صفوف تأثرت فالأمر تغيّر
        // بالتزامن → نُلغي المعاملة كلها (الشحنة + القيد + السجل).
        const flipped = await tx.salesOrder.updateMany({
          where: {
            id: data.salesOrderId,
            status: SalesOrderStatus.CONFIRMED,
          },
          data: { status: SalesOrderStatus.SHIPPED },
        });
        if (flipped.count !== 1) {
          throw new ConflictException(
            'أمر البيع لم يعد مؤكدًا — تعذر تحويله إلى SHIPPED',
          );
        }

        const response = {
          ...created,
          shippingCost: Number(created.shippingCost),
        };
        await storeIdempotencyResponse(tx, idempotencyKey, response);
        // SHP-4 (P1 — GF-IMP-W2): المسار السعيد يرجع نفس الكائن المنسّق
        // المُخزَّن لإعادة التشغيل (shippingCost رقمي) — كانت الاستجابة الأولى
        // ترجع كائن Prisma خامًا (shippingCost Decimal نصي عند التسلسل) فكانت
        // إعادة التشغيل تختلف عن الأولى في الشكل والقيم.
        return response;
      });
    } catch (error) {
      if (idempotencyKey && isIdempotencyUniqueViolation(error)) {
        const replayed = await tryReplayIdempotencyKey(
          this.prisma,
          idempotencyKey,
          'shipping.shipment.create',
          requestHash,
        );
        if (replayed) return replayed;
      }
      throw error;
    }
  }

  async updateShipmentStatus(
    id: string,
    status: ShipmentStatus,
    actorId: string,
    proofOfDelivery?: string,
    idempotencyKey?: string,
  ) {
    // SHP-6 (P2 — GF-IMP-W3): تحديث حالة الشحنة بلا idempotency كان يسمح
    // لإعادة إرسال نفس الطلب (شبكة بطيئة + retry) بتكرار الأثر — لا مشكلة
    // في الحالة نفسها (CAS يرفض الانتقال الثاني) لكن ActivityLog يتكرر
    // والمستخدم يرى 409 «تغيّر بالتزامن» بدل استجابته الأصلية. القرار
    // الموثق (ADR بديل — البران يقبل الخيارين): نفس نمط createShipment —
    // نطاق مستقل shipping.status-update + بصمة تشمل الحالة الهدف
    // وإثبات التسليم والفاعل؛ نفس المفتاح + نفس البصمة = نفس الاستجابة
    // المخزنة (replayed)، وبصمة مختلفة = 409. المفتاح يُنشأ داخل المعاملة
    // والاستجابة لا تُخزن إلا بعد نجاح كل آثار الانتقال (عكس القيد عند
    // الإلغاء، RETURNED gate، ActivityLog) — فشل أي خطوة يرجع المعاملة
    // كلها فلا يبقى مفتاح بلا استجابة.
    const statusScope = 'shipping.status-update';
    const requestHash = computeRequestHash({
      operation: statusScope,
      shipmentId: id,
      status,
      actorId,
      proofOfDelivery: proofOfDelivery?.trim() ?? null,
    });
    const replay = await tryReplayIdempotencyKey(
      this.prisma,
      idempotencyKey,
      statusScope,
      requestHash,
    );
    if (replay) return replay;

    const shipment = await this.prisma.shipment.findUnique({
      where: { id },
      include: { salesOrder: { include: { items: true } } },
    });
    if (!shipment) throw new NotFoundException('Shipment not found');

    // SHP-3 (أ) (P1 — GF-IMP-W2) — إلغاء شحنة في طور التحضير مسموح ومكتمل:
    // انتقال PREPARING → CANCELLED داخل المعاملة يعكس قيد تكلفة الشحن
    // المرحّل عند الإنشاء (نقدًا أو استحقاقًا عبر reverseJournalEntryInTx)
    // ويعيد أمر البيع من SHIPPED إلى CONFIRMED (CAS) بحيث يمكن إنشاء شحنة
    // بديلة. القيود التاريخية (قبل لقطات ACC-2) يرفضها محرك العكس برسالة
    // واضحة — قرار موثق في ADR-0017. لا آثار مخزون: createShipment لا
    // يحرك المخزون (ADR-0017) — الأثر الوحيد مالي (قيد التكلفة) وحالوي
    // (حالة الأمر) وكلاهما يعالج داخل المعاملة نفسها.
    const allowed: Record<ShipmentStatus, ShipmentStatus[]> = {
      [ShipmentStatus.PREPARING]: [
        ShipmentStatus.SHIPPED,
        ShipmentStatus.CANCELLED,
      ],
      [ShipmentStatus.CANCELLED]: [],
      [ShipmentStatus.SHIPPED]: [ShipmentStatus.IN_TRANSIT],
      [ShipmentStatus.IN_TRANSIT]: [
        ShipmentStatus.DELIVERED,
        ShipmentStatus.RETURNED,
      ],
      [ShipmentStatus.DELIVERED]: [ShipmentStatus.RETURNED],
      [ShipmentStatus.RETURNED]: [],
    };
    if (!allowed[shipment.status].includes(status)) {
      throw new BadRequestException('Invalid shipment status transition');
    }
    if (status === ShipmentStatus.DELIVERED && !proofOfDelivery?.trim()) {
      throw new BadRequestException(
        'إثبات التسليم مطلوب عند تحويل الشحنة إلى DELIVERED',
      );
    }

    try {
      return await this.prisma.$transaction(
        async (tx: Prisma.TransactionClient) => {
          // SHP-6: المفتاح يُنشأ أولًا داخل المعاملة — أي فشل لاحق
          // (بوابة RETURNED، عكس القيد، CAS) يرجع المعاملة كلها فلا يبقى
          // مفتاح بلا استجابة، وسباق مفتاحين متزامنين يلتقط P2002 في
          // المعالج أدناه ويعيد التشغيل.
          await createIdempotencyKey(
            tx,
            idempotencyKey,
            statusScope,
            requestHash,
          );

          // SHP-3 (ب) (P1 — GF-IMP-W2): RETURNED لا يُقبل إلا بوجود مرتجع بيع
          // مقترن بأمر البيع (SalesReturn بـ salesOrderId) — الدلالة الجديدة:
          // البضاعة عادت فعليًا وأُثبت أثرها المالي عبر مرتجع البيع، فالشحنة
          // لا «تُرجَع» تخطيطيًا قبل أن يُنشأ المرتجع (409 برسالة عربية).
          if (status === ShipmentStatus.RETURNED) {
            const linkedReturn = await tx.salesReturn.findFirst({
              where: { salesOrderId: shipment.salesOrderId },
              select: { id: true },
            });
            if (!linkedReturn) {
              throw new ConflictException(
                'لا يمكن تحويل الشحنة إلى RETURNED — أنشئ مرتجع البيع المقترن بالأمر أولًا',
              );
            }
          }

          // SHP-3 (أ): إلغاء شحنة PREPARING — عكس قيد تكلفة الشحن (نقد أو
          // استحقاق) داخل نفس المعاملة عبر النسخة InTx، ثم إعادة أمر البيع
          // إلى CONFIRMED بـ CAS حتى يمكن إنشاء شحنة بديلة. القيد يوجد بأحد
          // مفتاحين ثابتين مشتقين من معرف الشحنة (كما في createShipment).
          if (status === ShipmentStatus.CANCELLED) {
            const costEntry = await tx.journalEntry.findFirst({
              where: {
                postingKey: {
                  in: [
                    `shipping-cost-cash:${id}`,
                    `shipping-cost-accrual:${id}`,
                  ],
                },
              },
              select: { id: true, isReversed: true, code: true },
            });
            if (costEntry) {
              if (costEntry.isReversed) {
                throw new ConflictException(
                  `قيد تكلفة الشحنة ${costEntry.code} معكوس بالفعل — حالة غير متسقة تتطلب مراجعة يدوية`,
                );
              }
              await this.financialPosting.reverseJournalEntryInTx(
                tx,
                costEntry.id,
                actorId,
                `عكس قيد تكلفة شحنة ملغاة ${shipment.code}`,
              );
            }
            // قيد غائب = شحنة بلا تكلفة مرحّلة (تكلفة صفر) — لا شيء لعكسه.

            const orderRevert = await tx.salesOrder.updateMany({
              where: {
                id: shipment.salesOrderId,
                status: SalesOrderStatus.SHIPPED,
              },
              data: { status: SalesOrderStatus.CONFIRMED },
            });
            if (orderRevert.count !== 1) {
              throw new ConflictException(
                'تعذر إعادة أمر البيع إلى CONFIRMED — تغيّرت حالته بشكل متزامن؛ راجع الأمر قبل إعادة المحاولة',
              );
            }
          }
          const result = await tx.shipment.updateMany({
            where: { id, status: shipment.status },
            data: {
              status,
              shippedAt:
                status === ShipmentStatus.SHIPPED
                  ? new Date()
                  : shipment.shippedAt,
              deliveredAt:
                status === ShipmentStatus.DELIVERED
                  ? new Date()
                  : shipment.deliveredAt,
              proofOfDelivery:
                status === ShipmentStatus.DELIVERED
                  ? proofOfDelivery?.trim()
                  : undefined,
              deliveredById:
                status === ShipmentStatus.DELIVERED ? actorId : undefined,
            },
          });
          if (result.count !== 1) {
            throw new ConflictException('Shipment status changed concurrently');
          }

          const updated = await tx.shipment.findUnique({ where: { id } });
          if (!updated) throw new NotFoundException('Shipment not found');
          await tx.activityLog.create({
            data: {
              userId: actorId,
              action: 'SHIPMENT_STATUS_CHANGED',
              module: 'SHIPPING',
              details: {
                shipmentId: id,
                from: shipment.status,
                to: status,
                proofOfDelivery: status === ShipmentStatus.DELIVERED,
              },
            },
          });

          // SHP-4 (نفس فلسفة createShipment): الاستجابة المنسّقة (shippingCost
          // رقمي لا Decimal خام) تُخزَّن على المفتاح وتُعاد للطرف الأول —
          // الاستجابة الأولى وإعادة التشغيل متطابقتان في الشكل والقيم.
          const response = {
            ...updated,
            shippingCost: Number(updated.shippingCost ?? 0),
          };
          await storeIdempotencyResponse(tx, idempotencyKey, response);
          return response;
        },
      );
    } catch (error) {
      // SHP-6: سباق مفتاحين متزامنين → الخاسر يلتقط P2002 على فهرس
      // idempotency ويعيد محاولة التشغيل (الرابح خزّن استجابته بالفعل).
      if (idempotencyKey && isIdempotencyUniqueViolation(error)) {
        const replayed = await tryReplayIdempotencyKey(
          this.prisma,
          idempotencyKey,
          statusScope,
          requestHash,
        );
        if (replayed) return replayed;
      }
      throw error;
    }
  }
}
