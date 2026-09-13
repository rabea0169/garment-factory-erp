import { Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * SELIM-ERP W2 — خدمة البحث الشامل عابر الأقسام.
 *
 * تصميم مطابق لسلوك Selim ERP: استعلام واحد يبحث في كل الأنواع دفعة واحدة
 * ويعيد نتائج مجمّعة بحسب النوع مع حد صغير لكل نوع (اللوحة تعرض 5 لكل
 * قسم — نفس سلوك CommandPalette.tsx هناك).
 *
 * قواعد الأدوار — مرآة أدوار القراءة لكل وحدة أصل:
 * - العملاء/المنتجات/عروض الأسعار: كل مستخدم موثّق (لا @Roles على قراءتها).
 * - أوامر البيع: CASHIER + GENERAL_MANAGER + SUPER_ADMIN (كنترولر المبيعات).
 * - أوامر الشراء/الموردون: INVENTORY_MANAGER + GENERAL_MANAGER + SUPER_ADMIN.
 * - أوامر التشغيل: GENERAL_MANAGER + PRODUCTION_MANAGER + SUPER_ADMIN.
 * - العمال: HR_MANAGER + GENERAL_MANAGER + SUPER_ADMIN.
 * - الخزائن: ACCOUNTANT + GENERAL_MANAGER + SUPER_ADMIN (INV-2: إخفاء
 *   البيانات المالية عن الأدوار غير المالية).
 *
 * كل استعلام يحمل `take: 5` — لا ترقيم ولا تعداء، الأداء محفوظ بفهارس
 * contains الموجودة (unique codes) وبحد البحث الطويل أصلًا.
 */

/** حد النتائج لكل نوع كيان — نفس سلوك لوحة الأوامر في Selim. */
const PER_TYPE_LIMIT = 5;

/** أقل طول للاستعلام — 2 حرف يمنع الاستعلامات المفرطة المطابقة. */
const MIN_QUERY_LENGTH = 2;

/** شكل نتيجة واحدة تستهلكها لوحة الأوامر في الجوال/الديسكتوب. */
export interface SearchHit {
  /** نوع الكيان — يحدد مسار الانتقال في التطبيق. */
  type: string;
  /** معرف الكيان (UUID). */
  id: string;
  /** العنوان الرئيسي (الاسم أو الكود). */
  title: string;
  /** سطر ثانوي (السعر/الهاتف/الحالة...). */
  subtitle: string;
  /** كود المستند/الكيان كما يظهر للمستخدم. */
  code: string;
}

@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  /** بحث شامل — يرجع مجموعات بحسب النوع مع تصفية الأدوار. */
  async search(
    q: string,
    role: UserRole,
  ): Promise<{ query: string; groups: { type: string; hits: SearchHit[] }[] }> {
    const query = (q ?? '').trim();
    if (query.length < MIN_QUERY_LENGTH) {
      return { query, groups: [] };
    }
    const contains = { contains: query, mode: 'insensitive' as const };

    // مجموعات مستقلة — Promise.all آمن (كل استعلام قراءة مستقلة).
    const tasks: { type: string; hits: Promise<SearchHit[]> }[] = [];

    // العملاء — كل موثّق.
    tasks.push({
      type: 'customer',
      hits: this.prisma.customer
        .findMany({
          where: {
            OR: [{ name: contains }, { code: contains }, { phone: contains }],
            deletedAt: null,
          },
          select: {
            id: true,
            name: true,
            code: true,
            phone: true,
            isActive: true,
          },
          take: PER_TYPE_LIMIT,
          orderBy: { createdAt: 'desc' },
        })
        .then((rows) =>
          rows.map((r) =>
            this.hit('customer', r.id, r.name, r.phone ?? '—', r.code),
          ),
        ),
    });

    // المنتجات + التوليفات بباركود — كل موثّق (اسم/كود/باركود).
    tasks.push({
      type: 'product',
      hits: this.prisma.product
        .findMany({
          where: {
            OR: [{ name: contains }, { code: contains }, { barcode: contains }],
            isActive: true,
            deletedAt: null,
          },
          select: { id: true, name: true, code: true, retailPrice: true },
          take: PER_TYPE_LIMIT,
          orderBy: { createdAt: 'desc' },
        })
        .then((rows) =>
          rows.map((r) =>
            this.hit(
              'product',
              r.id,
              r.name,
              `${Number(r.retailPrice)} ج.م`,
              r.code,
            ),
          ),
        ),
    });

    // عروض الأسعار — كل موثّق (قراءتها بلا @Roles).
    tasks.push({
      type: 'quotation',
      hits: this.prisma.quotation
        .findMany({
          where: {
            OR: [{ quotationNo: contains }, { customerName: contains }],
          },
          select: {
            id: true,
            quotationNo: true,
            customerName: true,
            total: true,
            status: true,
          },
          take: PER_TYPE_LIMIT,
          orderBy: { createdAt: 'desc' },
        })
        .then((rows) =>
          rows.map((r) =>
            this.hit(
              'quotation',
              r.id,
              r.quotationNo,
              `${r.customerName} · ${Number(r.total)} ج.م`,
              r.quotationNo,
            ),
          ),
        ),
    });

    // أوامر البيع — أدوار قراءة المبيعات.
    if (
      this.can(role, [
        UserRole.CASHIER,
        UserRole.GENERAL_MANAGER,
        UserRole.SUPER_ADMIN,
        UserRole.ACCOUNTANT,
      ])
    ) {
      tasks.push({
        type: 'salesOrder',
        hits: this.prisma.salesOrder
          .findMany({
            where: { code: contains },
            select: { id: true, code: true, totalAmount: true, status: true },
            take: PER_TYPE_LIMIT,
            orderBy: { createdAt: 'desc' },
          })
          .then((rows) =>
            rows.map((r) =>
              this.hit(
                'salesOrder',
                r.id,
                r.code,
                `${Number(r.totalAmount)} ج.م · ${r.status}`,
                r.code,
              ),
            ),
          ),
      });
    }

    // أوامر الشراء + الموردون — أدوار المشتريات.
    if (
      this.can(role, [
        UserRole.INVENTORY_MANAGER,
        UserRole.GENERAL_MANAGER,
        UserRole.SUPER_ADMIN,
        UserRole.ACCOUNTANT,
      ])
    ) {
      tasks.push({
        type: 'purchaseOrder',
        hits: this.prisma.purchaseOrder
          .findMany({
            where: { code: contains },
            select: { id: true, code: true, totalAmount: true, status: true },
            take: PER_TYPE_LIMIT,
            orderBy: { createdAt: 'desc' },
          })
          .then((rows) =>
            rows.map((r) =>
              this.hit(
                'purchaseOrder',
                r.id,
                r.code,
                `${Number(r.totalAmount)} ج.م · ${r.status}`,
                r.code,
              ),
            ),
          ),
      });
      tasks.push({
        type: 'supplier',
        hits: this.prisma.supplier
          .findMany({
            where: {
              OR: [{ name: contains }, { code: contains }, { phone: contains }],
              isActive: true,
              deletedAt: null,
            },
            select: { id: true, name: true, code: true, phone: true },
            take: PER_TYPE_LIMIT,
            orderBy: { createdAt: 'desc' },
          })
          .then((rows) =>
            rows.map((r) =>
              this.hit('supplier', r.id, r.name, r.phone ?? '—', r.code),
            ),
          ),
      });
    }

    // أوامر التشغيل — أدوار الإنتاج.
    if (
      this.can(role, [
        UserRole.GENERAL_MANAGER,
        UserRole.PRODUCTION_MANAGER,
        UserRole.SUPER_ADMIN,
        UserRole.INVENTORY_MANAGER,
      ])
    ) {
      tasks.push({
        type: 'workOrder',
        hits: this.prisma.workOrder
          .findMany({
            where: { code: contains },
            select: { id: true, code: true, status: true, quantity: true },
            take: PER_TYPE_LIMIT,
            orderBy: { createdAt: 'desc' },
          })
          .then((rows) =>
            rows.map((r) =>
              this.hit(
                'workOrder',
                r.id,
                r.code,
                `${Number(r.quantity)} قطعة · ${r.status}`,
                r.code,
              ),
            ),
          ),
      });
    }

    // العمال — أدوار الموارد البشرية (بيانات هوية حساسة).
    if (
      this.can(role, [
        UserRole.HR_MANAGER,
        UserRole.GENERAL_MANAGER,
        UserRole.SUPER_ADMIN,
      ])
    ) {
      tasks.push({
        type: 'worker',
        hits: this.prisma.worker
          .findMany({
            where: { OR: [{ name: contains }, { code: contains }] },
            select: { id: true, name: true, code: true },
            take: PER_TYPE_LIMIT,
            orderBy: { createdAt: 'desc' },
          })
          .then((rows) =>
            rows.map((r) => this.hit('worker', r.id, r.name, r.code, r.code)),
          ),
      });
    }

    // الخزائن — الأدوار المالية فقط (INV-2).
    if (
      this.can(role, [
        UserRole.ACCOUNTANT,
        UserRole.GENERAL_MANAGER,
        UserRole.SUPER_ADMIN,
        UserRole.CASHIER,
      ])
    ) {
      tasks.push({
        type: 'treasury',
        hits: this.prisma.treasury
          .findMany({
            where: { name: contains, isActive: true },
            select: { id: true, name: true, balance: true, type: true },
            take: PER_TYPE_LIMIT,
            orderBy: { createdAt: 'desc' },
          })
          .then((rows) =>
            rows.map((r) =>
              this.hit(
                'treasury',
                r.id,
                r.name,
                `${Number(r.balance)} ج.م · ${r.type}`,
                r.id,
              ),
            ),
          ),
      });
    }

    const settled = await Promise.all(
      tasks.map(async (t) => ({ type: t.type, hits: await t.hits })),
    );
    return {
      query,
      groups: settled.filter((g) => g.hits.length > 0),
    };
  }

  private can(role: UserRole, allowed: UserRole[]): boolean {
    if (role === UserRole.SUPER_ADMIN) return true;
    return allowed.includes(role);
  }

  private hit(
    type: string,
    id: string,
    title: string,
    subtitle: string,
    code: string,
  ): SearchHit {
    return { type, id, title, subtitle, code };
  }
}
