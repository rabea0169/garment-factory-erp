import { createHash } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * A8: أداة idempotency مركزية — تُستخدم من الخدمات التي تُحرّر تأثيرات جانبية
 * مالية/مخزونية قابلة للتكرار (POST /sales/orders, POST /sales/orders/:id/confirm,
 * POST /accounting/vouchers, ...).
 *
 * الأنماط المعتمدة:
 * 1. **Replay**: نفس المفتاح + نفس المحتوى → نفس الاستجابة بلا أثر جديد (200).
 * 2. **Conflict**: نفس المفتاح + محتوى مختلف → 409 ConflictException (لا تنفيذ).
 * 3. **Race**: مفتاحان متزامنان → الخاسر يلتقط P2002 → يُعيد محاولة replay.
 *
 * لا يُعتمد على هذا الملف وحده لـ atomicity — يجب أن يُستدعى createIdempotencyKey
 * داخل نفس $transaction الذي ينفّذ التأثير الفعلي (لضمان أن الـ key يُلتزم قبل
 * أي تأثير ويُحدّث بالاستجابة فقط بعد نجاح التأثير).
 */

type TxClient = Prisma.TransactionClient;
type PrismaLike = Prisma.TransactionClient;

interface PrismaKnownErrorLike {
  code: string;
  meta?: unknown;
}

function asPrismaKnownError(err: unknown): PrismaKnownErrorLike | null {
  if (typeof err !== 'object' || err === null) return null;
  const candidate = err as Partial<PrismaKnownErrorLike>;
  if (typeof candidate.code !== 'string') return null;
  return { code: candidate.code, meta: candidate.meta };
}

/**
 * هل الخطأ تعارض فريد على مفتاح idempotency (وليس أي unique آخر)؟
 *
 * Prisma يرمي P2002 على أي unique constraint — نميّز idempotency بفحص meta.target
 * الذي يحوي اسم الـ index/الجدول. هذا يمنع false positive على unique آخر.
 */
export function isIdempotencyUniqueViolation(err: unknown): boolean {
  const known = asPrismaKnownError(err);
  if (!known || known.code !== 'P2002') return false;
  return JSON.stringify(known.meta ?? {}).includes('idempotency');
}

/**
 * بصمة الطلب — نفس المفتاح بمحتوى مختلف = تعارض يُرفض بـ 409 لا إعادة تنفيذ.
 *
 * نستخدم SHA-256 على JSON.stringify(payload). الترتيب المفتاحي يهم: JSON.stringify
 * يحفظ ترتيب الإدراج، لذا يُنصح بمصدر ثابت للـ payload (لا spread عشوائي).
 */
export function computeRequestHash(payload: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

/**
 * إعادة استجابة مخزنة لمفتاح مكتمل — أو رفض واضح عند تعارض المحتوى/النطاق.
 *
 * @returns
 * - `null` إذا لم يوجد المفتاح (أول استخدام — نفذ المنطق).
 * - `unknown & { replayed: true }` إذا وُجد المفتاح واستجابة مخزنة (أعِد التشغيل).
 *   Caller must cast to the expected response shape.
 * - throws ConflictException عند التعارض في النطاق أو المحتوى أو عدم اكتمال سابق.
 *
 * @example
 * ```ts
 * const replay = await tryReplayIdempotencyKey(
 *   this.prisma, key, 'sales-order-create', requestHash,
 * );
 * if (replay) return replay as Awaited<ReturnType<typeof service.create>>;
 * ```
 */
export async function tryReplayIdempotencyKey(
  prisma: PrismaLike,
  key: string | undefined,
  scope: string,
  requestHash: string,
): Promise<{ replayed: true } | null> {
  if (!key) return null;
  const existing = await prisma.idempotencyKey.findUnique({
    where: { key },
  });
  if (!existing) return null;

  if (existing.scope !== scope) {
    throw new ConflictException(
      `Idempotency key used in a different scope (${existing.scope}) — use a new key`,
    );
  }
  if (existing.requestHash !== requestHash) {
    throw new ConflictException(
      'Same idempotency key with different request content — not allowed (use a new key for new content)',
    );
  }
  if (!existing.response) {
    throw new ConflictException(
      'A previous incomplete attempt with same key exists — retry with a new key',
    );
  }
  return {
    ...(existing.response as Record<string, unknown>),
    replayed: true,
  };
}

/**
 * إنشاء سجل مفتاح idempotency داخل transaction.
 *
 * يجب أن يُستدعى داخل نفس $transaction الذي ينفّذ التأثير — هذا يضمن أن المفتاح
 * يُلتزم قبل أي تأثير خارجي، وأي متزامن يحاول استخدام نفس المفتاح يلتقط P2002
 * من قاعدة البيانات ويُعيد replay.
 *
 * @returns معرّف السجل (id) أو undefined إذا لم يُمرر مفتاح.
 */
export async function createIdempotencyKey(
  tx: TxClient,
  key: string | undefined,
  scope: string,
  requestHash: string,
): Promise<string | undefined> {
  if (!key) return undefined;
  const idem = await tx.idempotencyKey.create({
    data: { key, scope, requestHash },
    select: { id: true },
  });
  return idem?.id;
}

/**
 * تخزين الاستجابة الناجحة على مفتاح idempotency (لإتاحة إعادة التشغيل لاحقًا).
 *
 * يجب أن يُستدعى داخل نفس $transaction الذي نفّذ التأثير — هذا يضمن أن الاستجابة
 * لا تُخزَّن إلا إذا التزم كل شيء بنجاح. فشل أي خطوة يرجع الـ transaction كله
 * ولا يُخزَّن مفتاح بلا استجابة (الـ CHECK على idempotency_keys.response nullable).
 */
export async function storeIdempotencyResponse(
  tx: TxClient,
  key: string | undefined,
  response: unknown,
): Promise<void> {
  if (!key) return;
  await tx.idempotencyKey.update({
    where: { key },
    data: { response: response as never },
  });
}
