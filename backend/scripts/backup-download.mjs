#!/usr/bin/env node
/**
 * GF-OPS-BACKUP — تنزيل نسخة احتياطية خارجية مؤتمتة (طبقة فوق GET /system/backup).
 *
 * الغرض: أتمتة «النسخة خارج البيت» التي يشترطها runbook النسخ الاحتياطي
 * (BACKUP_RESTORE.md — طبقة خارجية إلزامية). السكربت يسجّل الدخول بحساب
 * SUPER_ADMIN، ينزّل النسخة الكاملة (JSON)، يكتبها مع sha256 بجانبها،
 * ويتحقق من الحد الأدنى لسلامة النسخة (formatVersion + totalRows + عدد
 * الجداول) قبل اعتبار العملية ناجحة. مصمم ليعمل من cron على أي آلة
 * خارج Railway — لو ضاع الخادم كله تبقى النسخة عندنا.
 *
 * الاستخدام (cron يوميًا 02:00 مثلًا):
 *   BACKUP_EMAIL=admin@factory.com BACKUP_PASSWORD='...' \
 *   BACKUP_DIR=/var/backups/garment-erp \
 *     node scripts/backup-download.mjs
 *
 * متغيرات البيئة:
 *   BACKUP_BASE_URL (اختياري) — افتراضيًا رابط Railway للإنتاج
 *   BACKUP_EMAIL    (مطلوب)   — بريد SUPER_ADMIN
 *   BACKUP_PASSWORD (مطلوب)   — كلمة المرور
 *   BACKUP_DIR      (اختياري) — مجلد الحفظ، افتراضي ./backups (يُنشأ إن غاب)
 *   BACKUP_RETENTION_DAYS (اختياري) — حذف النسخ الأقدم من N يومًا بعد نجاح
 *                                النسخة الجديدة (افتراضي 30 — مثل runbook)
 *
 * رموز الخروج: 0 = نسخة سليمة محفوظة، 1 = فشل (لا تُعد العملية ناجحة أبدًا
 * دون ملف سليم على القرص).
 *
 * ملاحظة أمان: كلمة المرور والتوكن لا يُطبعان؛ الملف الناتج يحتوي بيانات
 * النظام كاملة — طبّق صلاحيات قراءة ضيقة على BACKUP_DIR (chmod 700) وتشفير
 * عند النقل للأرشيف البارد كما في runbook.
 */

import { createHash } from 'node:crypto';
import { mkdir, writeFile, readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';

const BASE_URL = (
  process.env.BACKUP_BASE_URL ??
  'https://garment-factory-erp-production.up.railway.app'
).replace(/\/+$/, '');
const EMAIL = process.env.BACKUP_EMAIL;
const PASSWORD = process.env.BACKUP_PASSWORD;
const BACKUP_DIR = process.env.BACKUP_DIR ?? path.join(process.cwd(), 'backups');
const RETENTION_DAYS = Number(process.env.BACKUP_RETENTION_DAYS ?? 30);

const MIN_TABLES = 40; // القاعدة 76 جدولًا؛ عتبة تحذّر من نسخة مبتورة

async function fail(msg) {
  console.error(`فشل النسخ الاحتياطي: ${msg}`);
  process.exit(1);
}

async function main() {
  if (!EMAIL || !PASSWORD) {
    await fail('BACKUP_EMAIL و BACKUP_PASSWORD مطلوبان (حساب SUPER_ADMIN)');
  }

  // 1) تسجيل الدخول
  let accessToken;
  try {
    const res = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-client-type': 'backup-script',
      },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.status !== 200 || !body.access_token) {
      await fail(
        `تسجيل الدخول فشل (status=${res.status}) — تحقق من البيانات وحالة الخادم`,
      );
    }
    accessToken = body.access_token;
  } catch (err) {
    await fail(`تعذر الوصول للخادم: ${err.message}`);
  }

  // 2) تنزيل النسخة الكاملة
  let backup;
  try {
    const res = await fetch(`${BASE_URL}/system/backup`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (res.status !== 200) {
      await fail(`تنزيل النسخة فشل (status=${res.status})`);
    }
    backup = await res.json();
  } catch (err) {
    await fail(`تنزيل النسخة فشل: ${err.message}`);
  }

  // 3) تحقق الحد الأدنى لسلامة النسخة قبل الحفظ
  const meta = backup?.meta ?? {};
  const data = backup?.data ?? {};
  const tableNames = Object.keys(data);
  const totalRows = Number(meta.totalRows ?? -1);
  if (!meta.formatVersion) {
    await fail('النسخة بلا formatVersion — رفض حفظها (سلامة غير مؤكدة)');
  }
  if (tableNames.length < MIN_TABLES) {
    await fail(
      `النسخة تحتوي ${tableNames.length} جدولًا فقط (الحد الأدنى ${MIN_TABLES}) — يبدو مبتورة`,
    );
  }
  if (totalRows <= 0) {
    await fail(`totalRows غير سليم (${totalRows}) — قاعدة فارغة أو نسخة تالفة`);
  }

  // 4) الحفظ مع sha256
  await mkdir(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filePath = path.join(BACKUP_DIR, `backup-${stamp}.json`);
  const content = JSON.stringify(backup, null, 2);
  await writeFile(filePath, content, { encoding: 'utf8', mode: 0o600 });
  const sha256 = createHash('sha256').update(content, 'utf8').digest('hex');
  await writeFile(`${filePath}.sha256`, `${sha256}  ${path.basename(filePath)}\n`);

  // 5) تدوير النسخ القديمة (retention) — بعد نجاح الجديدة فقط
  let removed = 0;
  if (Number.isFinite(RETENTION_DAYS) && RETENTION_DAYS > 0) {
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    for (const entry of await readdir(BACKUP_DIR)) {
      const full = path.join(BACKUP_DIR, entry);
      try {
        const st = await stat(full);
        if (st.isFile() && st.mtimeMs < cutoff) {
          await unlink(full);
          removed += 1;
        }
      } catch {
        // تجاهل مقصود — ملف لا يمكن فحصه لا يوقف التدوير
      }
    }
  }

  console.log(
    [
      `نسخة احتياطية سليمة: ${path.basename(filePath)}`,
      `tables=${tableNames.length}`,
      `totalRows=${totalRows}`,
      `size=${(Buffer.byteLength(content) / 1024).toFixed(1)}KB`,
      `sha256=${sha256.slice(0, 16)}…`,
      removed > 0 ? `تدوير: حُذف ${removed} ملفًا قديمًا` : 'تدوير: لا شيء',
    ].join(' — '),
  );
}

main().catch((err) => {
  console.error('خطأ غير متوقع في النسخ الاحتياطي:', err.message);
  process.exit(1);
});
