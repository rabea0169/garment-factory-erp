#!/usr/bin/env node
/**
 * GF-IMP-W2 / CC-4: فحص تغطية مفاتيح idempotency على مسارات الكتابة.
 *
 * القاعدة القابلة للفحص (قائمة فحص المراجعة REVIEW_CHECKLIST): كل POST/PUT/
 * PATCH يمس مالًا أو مخزونًا يجب أن يستقبل Idempotency-Key ويعيد الاستجابة
 * المخزنة عند التكرار. هذا الفحص يستقصي متحكمات الكتابة غير المحمية.
 *
 * الاستخدام:
 *   node scripts/check-idempotency.mjs            → تقرير (الخروج 0 دائمًا)
 *   node scripts/check-idempotency.mjs --strict   → الخروج 1 إن وُجدت ثغرات
 *
 * منهجية الكشف (heuristics موثقة):
 *   يُعد المسار محميًا إن وجد في ملف المتحكم (أو في سطر المسار نفسه):
 *   - ترويسة @Headers('Idempotency-Key') أو معامل idempotencyKey/idemKey
 *   - أو استدعاء خدمة يمرر مفتاح idempotency
 *   استثناءات مصرّح بها (WHITELIST): مسارات المصادقة (login/refresh/logout)
 *   — جلسات لا كتابات مالية — ومسارات القراءة.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'modules');
const STRICT = process.argv.includes('--strict');

// مسارات مصرّح بها بلا مفتاح: جلسات المصادقة فقط (لا تمس مالًا/مخزونًا).
const WHITELIST = [
  // صيغة المسار المطبوعة: <module>/<file>.controller.ts:<method>
  /auth\.controller\.ts:(login|refresh|logout)/i,
];

const MUTATING = /@(Post|Put|Patch)\(\s*['"`]([^'"`]+)?['"`]?\s*\)?/g;
const IDEMPOTENT_HINTS = [
  /Idempotency-Key/i,
  /idempotencyKey/i,
  /idemKey/i,
];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith('.controller.ts')) out.push(full);
  }
  return out;
}

const gaps = [];
let protectedCount = 0;

for (const file of walk(ROOT)) {
  const src = readFileSync(file, 'utf8');
  const fileIsIdempotent = IDEMPOTENT_HINTS.some((h) => h.test(src));
  const module = file.split('modules')[1]?.slice(1).replace(/\\/g, '/');
  let m;
  MUTATING.lastIndex = 0;
  while ((m = MUTATING.exec(src)) !== null) {
    const path = `${module}:${m[2] ?? '(collection)'}`;
    if (WHITELIST.some((w) => w.test(path))) continue;
    if (fileIsIdempotent) {
      protectedCount++;
      continue;
    }
    gaps.push(path);
  }
}

const controllers = walk(ROOT).length;
console.log(`# CC-4 idempotency coverage`);
console.log(`# متحكمات فُحصت: ${controllers} — مسارات كتابة محمية: ${protectedCount}`);
if (gaps.length === 0) {
  console.log('✅ لا مسارات كتابة غير محمية (خارج قائمة المصادقة المصرّح بها).');
} else {
  console.log(`⚠️ مسارات كتابة بلا علامة idempotency في ملفها (${gaps.length}):`);
  for (const g of gaps) console.log(`   - ${g}`);
  if (STRICT) {
    console.error('\nفشل الفحص الصارم: علامات idempotency ناقصة.');
    process.exit(1);
  }
}
