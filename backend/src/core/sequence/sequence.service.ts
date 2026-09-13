import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * SELIM-ERP W1 — خدمة الترقيم التسلسلي الذري (تقلد Sequence في Selim ERP).
 *
 * كل مستندات Selim تستخدم ترقيمًا بشريًا قابلًا للقراءة ("INV-0001"،
 * "PR-0001"، "CUT-00001") بدل الـ UUID فقط. هذه الخدمة تولّد الأرقام
 * بتسلسل ذري لا يتكرر تحت التزامن:
 *
 * - `upsert` بـ `increment: 1` داخل قفل الصف على مستوى PostgreSQL
 *   (UPDATE ... WHERE type = ... RETURNING) — طابور ذري حقيقي، لا
 *   يُنتج نفس الرقم لخطين متوازيين أبدًا.
 * - النتيجة مُصفّرة بالبادئة وبطول ثابت (PAD=4) لضمان ترتيب معجمي
 *   مطابق للترتيب الزمني: QUO-0001 < QUO-0002 < ... < QUO-9999.
 * - تُستدعى دائمًا داخل معاملة المستند نفسها (tx) بحيث يعود الترقيم
 *   إن فشل إنشاء المستند (لا ثقوب في التسلسل بفشل المعاملة).
 *
 * البادئات المعتمدة (نفس تسميات Selim ERP):
 *   QUOTATION → QUO | PURCHASE_RETURN → PRR | INVENTORY_ADJUSTMENT → ADJ
 *   TREASURY_TRANSACTION → TRT | SHIFT_SESSION → SHF | WORKER_RECEIPT → WRC
 *   PAYROLL_STATEMENT → PSM | CUTTING_ORDER → CUT | PACK → PACK
 */
@Injectable()
export class SequenceService {
  /** خرائط النوع → البادئة (مصدر واحد للحقيقة — لا بادئات مبعثرة). */
  private static readonly PREFIXES: Record<string, string> = {
    QUOTATION: 'QUO',
    PURCHASE_RETURN: 'PRR',
    INVENTORY_ADJUSTMENT: 'ADJ',
    TREASURY_TRANSACTION: 'TRT',
    SHIFT_SESSION: 'SHF',
    WORKER_RECEIPT: 'WRC',
    PAYROLL_STATEMENT: 'PSM',
    CUTTING_ORDER: 'CUT',
    PACK: 'PACK',
  };

  /** طول التصفير — 9999 مستندًا لكل نوع قبل تجاوز الطول (يستمر بلا خطأ). */
  private static readonly PAD = 4;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * يولّد الرقم التسلسلي التالي لنوع المستند داخل معاملة المستدعي.
   *
   * @param type مفتاح النوع (مفتاح SequenceService.PREFIXES)
   * @param tx معاملة Prisma الجارية (إلزامية — الترقيم جزء من معاملة
   *        المستند حتى يتراجع مع فشله فلا تظهر ثقوب).
   * @returns رقم مثل "QUO-0042"
   */
  async nextNumber(type: string, tx: Prisma.TransactionClient): Promise<string> {
    const prefix = SequenceService.PREFIXES[type];
    if (!prefix) {
      throw new Error(`نوع ترقيم غير معروف: ${type}`);
    }
    // upsert + increment ذري: قاعدة البيانات تقفل صف التسلسل حتى نهاية
    // المعاملة، فأي استدعاء متوازٍ ينتظر ويأخذ الرقم التالي فعليًا.
    const seq = await tx.sequence.upsert({
      where: { type },
      update: { value: { increment: 1 } },
      create: { type, value: 1 },
    });
    return `${prefix}-${String(seq.value).padStart(SequenceService.PAD, '0')}`;
  }
}
