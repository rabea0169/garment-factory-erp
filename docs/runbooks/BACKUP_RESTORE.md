# Runbook — النسخ الاحتياطي والاستعادة لقاعدة PostgreSQL 16

> **الغرض:** إجراء تشغيلي خطوة بخطوة لأخذ نسخة احتياطية كاملة من قاعدة بيانات نظام **garment-factory-erp** (PostgreSQL 16)، والتحقق من سلامتها، واستعادتها على قاعدة اختبار منفصلة، وإثبات نجاح الاستعادة بفحوصات ملزِمة.
>
> **العلاقة بالبوابات:** هذا الـ runbook يُغلق بند «backup/restore مجربان» من بوابة **G9→G10** في `docs/RELEASE_GATES.md` (المرحلة: Pilot). النتيجة تُسجَّل في جدول البروفات الشهرية أدناه وتُرفق بالـ handoff.
>
> **الملكية:** مسؤول التشغيل (Ops) — واعتماد قيم RPO/RTO من مالك المؤسسة.
>
> **تاريخ الإعداد:** 2026-09-03 · **مرجع الكود:** HEAD `e72ee94` (موجة UAT 6).

---

## 1. المتغيرات والأدوات المطلوبة

كل الأوامر التالية تستخدم **placeholders** — عوّضها بقيم بيئتك ولا تكتب أي قيمة حقيقية داخل أي ملف يُرفع إلى Git:

| الـ Placeholder | المعنى | مثال مصدر القيمة |
|---|---|---|
| `<DB_HOST>` / `<DB_PORT>` | عنوان ومنفذ خادم PostgreSQL (16) | `docker-compose.yml` أو متغيرات Railway |
| `<DB_USER>` / `<DB_PASSWORD>` | مستخدم النسخ/الاستعادة | `backend/.env` → مكوّنات `DATABASE_URL` |
| `<DB_NAME>` | اسم قاعدة البيانات | مكوّنات `DATABASE_URL` |
| `<DB_ADMIN_USER>` | مستخدم له صلاحية `CREATE DATABASE` لقاعدة البروفة | عادة `postgres` |
| `<REPO_PATH>` | مسار المستودع محليًا | مثل `/opt/garment-erp` |
| `<BACKUP_USER>@<OFFSITE_HOST>` | وجهة التخزين الخارجي (خادم/مخزن مختلف عن host القاعدة) | خادم نسخ مؤسسي أو S3-compatible |
| `<OFFSITE_DIR>` | مجلد النسخ على الوجهة الخارجية | مثل `/srv/backups/garment-erp` |
| `<DRILL_HOST>` / `<PORT>` | عنوان/منفذ خادم backend التجريبي الموصول بقاعدة البروفة | من `PORT` في `.env` التجريبي |
| `<UAT_ADMIN_EMAIL>` / `<UAT_ADMIN_PASSWORD>` | حساب أدمن اختباري (من `SEED_ADMIN_PASSWORD`) | بيانات بيئة staging فقط |

**الأدوات:** `pg_dump` / `pg_restore` / `psql` (نسخة 16 متوافقة مع خادم القاعدة)، `sha256sum`، `rsync` أو `scp`، `curl`، `tar`، وفي Railway: الصلاحية لقراءة متغيرات الخدمة.

> **قاعدة أمان البوابات:** لا تُشغَّل أي خطوة استعادة على قاعدة الإنتاج الموثقة في `docs/RELEASE_READINESS_2026-08-27.md` (المسماة `fulfilling-serenity`). الاستعادة **فقط** على قاعدة اختبار منفصلة.

---

## 2. الاستراتيجية

### 2.1 ماذا ننسخ

| الأصل | الطريقة | ملاحظات |
|---|---|---|
| **قاعدة البيانات كاملة** | `pg_dump --format=custom (-Fc)` | شاملة الـ schema والبيانات والـ enums والقيود والمفاتيح الأجنبية وفهارس `_prisma_migrations` |
| **مجلد migrations** | أرشيف `tar.gz` من `backend/prisma/migrations` | مرجع الحقيقة لعدد الهجرات المتوقع عند الاستعادة |
| **أسرار البيئة خارج Git** (`DATABASE_URL`, `JWT_SECRET`, `SEED_ADMIN_PASSWORD`, `PORT`, CORS) | نسخة مشفرة (gpg) لـ `backend/.env` + نسخة نصية داخل خزنة أسرار (password manager) | ممنوع تخزينها بصيغة نصية على خادم النسخ |

> لماذا `--format=custom`؟ صيغة `-Fc` مضغوطة، تسمح باستعادة انتقائية (`-t جدول`)، وتدعم `pg_restore --jobs` للتوازي — وهي الصيغة الوحيدة الموصى بها لهذا الـ runbook.

### 2.2 الجدولة والاحتفاظ (retention)

| النوع | التكرار | الاحتفاظ | ملاحظات |
|---|---|---|---|
| نسخة كاملة (full) | **يوميًا** — 02:00 UTC (خارج ساعات الذروة) | 30 يومًا | الإجراء اليومي في §3 |
| نسخة أسبوعية | الأحد 01:00 UTC | 30 يومًا (تحسب ضمن نفس السلسلة) | نفس أمر اليومي — الغرض: نسخة مرجعية مُصدَّقة تُبقي أسبوعًا كاملًا قابلًا للاستعادة |
| بروفة استعادة (rehearsal) | **شهريًا** | — | §5 |

> **الحذف بعد 30 يومًا آليًا** بأمر `find ... -mtime +30` (§3.7) — على الخادم المحلي **وعلى الوجهة الخارجية** معًا.

### 2.3 أين نخزّن (الطبقة الثانية خارجية إلزاميًا)

1. **الطبقة المحلية:** `<DUMP_DIR>` على host خادم القاعدة (استعادة سريعة).
2. **الطبقة الخارجية (إلزامية):** `<OFFSITE_HOST>` مختلف فيزيائيًا/سحابيًا عن host القاعدة — نسخة احتياطية على نفس الخادم **لا تُعد** نسخة احتياطية عند فقد القرص أو اختراق الـ host.
3. صلاحيات الملفات `600` والمجلد `700`، والوصول مقصور على دور التشغيل (§7).

---

## 3. الإجراء اليومي — النسخ الاحتياطي (منفّذ: Ops، الزمن المتوقع: <10 دقائق)

نفّذ الخطوات بالترتيب. أي فشل في خطوة إلزامية ⇒ أوقف الإجراء وسجّل الحالة في جدول §3.8.

### 3.1 التهيئة والطابع الزمني (UTC)

```bash
DUMP_DIR="/var/backups/garment-erp"          # عدّل حسب بيئتك
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"           # مثال: 20260903T020001Z
DUMP_NAME="garment-erp_${STAMP}.dump"

mkdir -p "${DUMP_DIR}" && chmod 700 "${DUMP_DIR}"
```

> الاسم يحمل التاريخ/الوقت بتوقيت **UTC** دائمًا — يمنع الالتباس بين التوقيتات المحلية ويجعل الفرز الزمني ممكنًا.

### 3.2 النسخة الكاملة (pg_dump بصيغة custom)

```bash
pg_dump \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file="${DUMP_DIR}/${DUMP_NAME}" \
  "postgresql://<DB_USER>:<DB_PASSWORD>@<DB_HOST>:<DB_PORT>/<DB_NAME>"
```

- `--format=custom` = صيغة `-Fc` المضغوطة القابلة لـ `pg_restore`.
- `--no-owner --no-privileges`: الاستعادة لن تعتمد على تطابق أدوار المستخدمين بين البيئات (مطلوب عند الاستعادة داخل Railway/بروفة).
- نجاح الأمر = سطر حالة واحد (`pg_dump: dumping database "..."`) وخروج برمز `0`. تحقق:

```bash
echo "exit=$?"
```

### 3.3 الـ checksum (إلزامي)

```bash
cd "${DUMP_DIR}"
sha256sum "${DUMP_NAME}" > "${DUMP_NAME}.sha256"
sha256sum -c "${DUMP_NAME}.sha256"            # يجب أن يطبع: OK
```

> ملف `.sha256` يُنقل مع النسخة ويُستخدم للتحقق بعد أي نقل أو قبل أي استعادة.

### 3.4 التحقق من سلامة المحتوى (قبل النقل)

```bash
# 1) الملف قابل للقراءة بصيغة custom ويحوي TABLE DATA لكل الجداول:
pg_restore --list "${DUMP_DIR}/${DUMP_NAME}" | grep -c 'TABLE DATA'
#    القيمة المتوقعة: تساوي عدد جداول القاعدة (مرجع تقريبي: 50 نموذجًا + _prisma_migrations = 51؛
#    القيمة الحاكمة هي تطابقها مع مخرجات الفحص نفسه على النسخة اليوم السابق أو مع المصدر — انظر §3.5)

# 2) جدول الهجرات موجود في النسخة:
pg_restore --list "${DUMP_DIR}/${DUMP_NAME}" | grep -q '_prisma_migrations' && echo "migrations table: OK"
```

### 3.5 التحقق من الحجم المتوقع (كشف النسخ الفارغة/المبتورة)

```bash
ACTUAL_BYTES=$(stat -c%s "${DUMP_DIR}/${DUMP_NAME}")
PREV_BYTES=$(stat -c%s "$(ls -1t "${DUMP_DIR}"/garment-erp_*.dump 2>/dev/null | sed -n 2p)" 2>/dev/null || echo 0)
echo "current=${ACTUAL_BYTES} previous=${PREV_BYTES}"
```

**معايير القبول:**
1. `ACTUAL_BYTES > 0` — مطلقًا.
2. إن وُجدت نسخة سابقة: `ACTUAL_BYTES` بين **50% و 150%** من `PREV_BYTES` — خارج النطاق ⇒ تحقق يدويًا قبل الاعتماد (نمو مفاجئ أو سقوط نسخة مبتورة).
3. سجّل الحجم اليومي في جدول §3.8.

### 3.6 النقل إلى التخزين الخارجي (إلزامي)

**الخيار (أ) — rsync (مفضل، قابل للاستكمال):**

```bash
rsync -av --partial --chmod=600 \
  "${DUMP_DIR}/${DUMP_NAME}" "${DUMP_DIR}/${DUMP_NAME}.sha256" \
  "<BACKUP_USER>@<OFFSITE_HOST>:<OFFSITE_DIR>/"
```

**الخيار (ب) — scp (إن لم يتوفر rsync):**

```bash
scp -p "${DUMP_DIR}/${DUMP_NAME}" "${DUMP_DIR}/${DUMP_NAME}.sha256" \
  "<BACKUP_USER>@<OFFSITE_HOST>:<OFFSITE_DIR>/"
```

**تحقق بعد النقل (على الوجهة الخارجية):**

```bash
ssh "<BACKUP_USER>@<OFFSITE_HOST>" "cd <OFFSITE_DIR> && sha256sum -c ${DUMP_NAME}.sha256"
```

> إن لم يُطبع `OK` ⇒ النقل تالف — أعد §3.6. لا تحذف النسخة المحلية قبل نجاح هذا التحقق.

### 3.7 أرشفة مجلد migrations والأسرار (مرة يوميًا مع النسخة)

```bash
# مجلد migrations (نصي — صغير):
tar -czf "${DUMP_DIR}/migrations_${STAMP}.tar.gz" -C "<REPO_PATH>/backend/prisma" migrations
( cd "${DUMP_DIR}" && sha256sum "migrations_${STAMP}.tar.gz" > "migrations_${STAMP}.tar.gz.sha256" )

# أسرار البيئة — مشفرة بـ gpg (عبارة فك التشفير تُحفظ في خزنة الأسرار، لا في أي ملف):
gpg --batch --yes --symmetric --cipher-algo AES256 \
  --output "${DUMP_DIR}/backend_env_${STAMP}.gpg" \
  "<REPO_PATH>/backend/.env"

# انقل الثلاثة إلى الوجهة الخارجية كما في §3.6 ثم نظّف القديم (retention 30 يومًا):
find "${DUMP_DIR}" -maxdepth 1 -type f \( -name 'garment-erp_*.dump*' -o -name 'migrations_*.tar.gz*' -o -name 'backend_env_*.gpg' \) -mtime +30 -delete
```

> قارن عدد مجلدات الهجرات في الأرشيف مع `ls "<REPO_PATH>/backend/prisma/migrations" | grep -v migration_lock.toml | wc -l` — يجب التطابق (مرجع التحقق نفسه المستخدم في §4.4).

### 3.8 سجل النسخ اليومي

| التاريخ (UTC) | ملف النسخة | الحجم (bytes) | checksum OK | نقل خارجي OK | المنفّذ | ملاحظات |
|---|---|---|---|---|---|---|
| | | | | | | |

---

## 4. إجراء الاستعادة — DR Drill (قاعدة اختبار منفصلة)

> **تحذير:** لا تُنفَّذ هذه الخطوات على قاعدة الإنتاج (`fulfilling-serenity` — راجع `docs/RELEASE_READINESS_2026-08-27.md`). الهدف هنا قاعدة `garment_drill_<STAMP>` منفصلة تمامًا.
>
> الزمن المتوقع: 30–60 دقيقة. الأدوار: منفّذ Ops + مُراقب (يوقّع النتيجة).

### 4.1 حدد النسخة وتحقق من checksum قبل أي شيء

```bash
cd "<OFFSITE_DIR>"   # أو "${DUMP_DIR}" إن كانت النسخة محلية
SOURCE_STAMP="<STAMP_OF_CHOSEN_BACKUP>"
DUMP_NAME="garment-erp_${SOURCE_STAMP}.dump"
sha256sum -c "${DUMP_NAME}.sha256"     # يجب أن يطبع: OK
```

### 4.2 أنشئ قاعدة اختبار منفصلة

```bash
DRILL_DB="garment_drill_$(date -u +%Y%m%dT%H%M%SZ)"

psql --host=<DB_HOST> --port=<DB_PORT> --username=<DB_ADMIN_USER> --dbname=postgres \
  --command="CREATE DATABASE \"${DRILL_DB}\";"

# تأكد أنها قاعدة جديدة فارغة (لن نستخدم --clean على قاعدة فيها بيانات):
psql --host=<DB_HOST> --port=<DB_PORT> --username=<DB_ADMIN_USER> --dbname="${DRILL_DB}" \
  --command="SELECT COUNT(*) AS tables_before FROM pg_tables WHERE schemaname='public';"
# المتوقع: 0
```

### 4.3 الاستعادة (pg_restore)

```bash
pg_restore \
  --no-owner \
  --no-privileges \
  --verbose \
  --dbname="postgresql://<DB_USER>:<DB_PASSWORD>@<DB_HOST>:<DB_PORT>/${DRILL_DB}" \
  "${DUMP_NAME}" 2> "${DUMP_NAME}.restore.log"

echo "exit=$?"
grep -iE 'error|fatal' "${DUMP_NAME}.restore.log" || echo "no errors in restore log"
```

- الأعلام نفس مبدأ النسخ: `--no-owner --no-privileges` حتى لا تفشل الاستعادة بسبب أدوار مفقودة في بيئة البروفة.
- **تحذير:** لا تستخدم `--clean` إلا عند الاستعادة المتعمدة فوق قاعدة موجودة، وبعد موافقة موثقة — إسقاط الجداول (`DROP`) مدمر ولا يجرب إطلاقًا على الإنتاج.
- المتوقع: exit 0، وسجل `*.restore.log` بلا أخطاء (تحذيرات `COMMENT`/`OWNER TO` المعتادة من `--no-owner` مقبولة).

### 4.4 الفحوصات الإلزامية بعد الاستعادة (كلها يجب أن تنجح وإلا فالبروفة FAILED)

**فحص 1 — عدد الجداول:**

```bash
psql --host=<DB_HOST> --port=<DB_PORT> --username=<DB_USER> --dbname="${DRILL_DB}" \
  --command="SELECT COUNT(*) AS table_count FROM pg_tables WHERE schemaname='public';"
```

- القيمة الحاكمة: **تطابق المصدر** (سجّل العدد من قاعدة المصدر قبل النسخة إن أمكن). مرجع تقريبي عند كتابة هذا الدليل: **51** (50 جدولًا من نماذج Prisma + `_prisma_migrations`). فرق ⇒ راجع سجل الاستعادة.

**فحص 2 — عدّ الهجرات المسجلة في `_prisma_migrations`:**

```bash
psql --host=<DB_HOST> --port=<DB_PORT> --username=<DB_USER> --dbname="${DRILL_DB}" \
  --command='SELECT COUNT(*) AS applied_migrations FROM "_prisma_migrations";'
```

- **القيمة المرجعية للبوابة G9: 36.**
- القيمة الحاكمة: تساوي عدد مجلدات الهجرات في المستودع (`ls <REPO_PATH>/backend/prisma/migrations | grep -v migration_lock.toml | wc -l`). عند إعداد هذا الدليل كان HEAD `e72ee94` يحوي **35** مجلد هجرة (تحقق تجريبي: قاعدة مبنية من هجرات المستودع سجّلت 35 صفًا في `_prisma_migrations`)، وإصلاح wave 7 (P0) قيد الدمج — حدّث الرقم المرجعي في هذا البند عند دمج أي هجرة جديدة حتى يبلغ 36.
- إضافة إلزامية — لا هجرات فاشلة/معلقة:

```bash
psql --host=<DB_HOST> --port=<DB_PORT> --username=<DB_USER> --dbname="${DRILL_DB}" \
  --command='SELECT COUNT(*) AS unfinished FROM "_prisma_migrations" WHERE "finished_at" IS NULL;'
# المتوقع: 0
```

**فحص 3 — سلامة التطبيق: health / readiness (SELECT 1 عبر التطبيق):**

شغّل نسخة backend موصولة بقاعدة البروفة (متغيرات بيئة تجريبية، `DATABASE_URL` يشير إلى `${DRILL_DB}`):

```bash
cd "<REPO_PATH>/backend"
# DATABASE_URL يُمرر من .env تجريبي أو export مباشر (placeholder):
export DATABASE_URL="postgresql://<DB_USER>:<DB_PASSWORD>@<DB_HOST>:<DB_PORT>/${DRILL_DB}"
export JWT_SECRET="<RANDOM_32PLUS_CHAR_SECRET>"
npm run start:prod   # أو: npm run start:dev — حسب بيئة البروفة
```

ثم (من نافذة أخرى):

```bash
curl -s -o /dev/null -w 'health=%{http_code}\n'      "http://<DRILL_HOST>:<PORT>/health"       # المتوقع: health=200
curl -s -o /dev/null -w 'ready=%{http_code}\n'       "http://<DRILL_HOST>:<PORT>/health/ready" # المتوقع: ready=200
```

> `/health/ready` يعيد 200 فقط عند نجاح استعلام PostgreSQL فعلي (SELECT 1) — لذا هو دليل حي على أن الاستعادة قابلة للاستخدام، لا مجرد ملف سليم.

**فحص 4 — تسجيل دخول فعلي (login):**

```bash
curl -sS -X POST "http://<DRILL_HOST>:<PORT>/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"<UAT_ADMIN_EMAIL>","password":"<UAT_ADMIN_PASSWORD>"}'
```

- **المتوقع:** HTTP **200** وجسم JSON يحوي `access_token` و`refresh_token` و`user`.
- فشل 500/400 ⇒ القاعدة مستعادة لكنها غير صالحة تشغيليًا (مثل انحراف schema — راجع درس P0 في `worklog`) ⇒ البروفة FAILED.
- تحقق إضافي اختياري بجلسة صالحة: `curl -H "Authorization: Bearer <access_token>" http://<DRILL_HOST>:<PORT>/auth/me` ⇒ 200.

**فحص 5 — عيّنة بيانات (اختياري لكن موصى به):**

```bash
psql --host=<DB_HOST> --port=<DB_PORT> --username=<DB_USER> --dbname="${DRILL_DB}" \
  --command='SELECT (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM products) AS products, (SELECT COUNT(*) FROM "stock_ledger_entries") AS ledger_entries;'
```

قارن مع أعداد المصدر وقت النسخة — يجب التطابق.

### 4.5 ماذا نفعل عند الفشل

| العرَض | السبب الأرجح | الإجراء |
|---|---|---|
| `sha256sum -c` يفشل | نسخة تالفة أثناء النقل | أعد النقل من الطبقة الأخرى (محلي/خارجي)؛ إن فشلت كلتاهما استخدم النسخة السابقة |
| `pg_restore` أخطاء EOF | ملف مقطوع | تحقق من `stat -c%s` مقابل سجل الحجم اليومي؛ استخدم نسخة أقدم |
| login يعيد 500 رغم نجاح الاستعادة | انحراف schema (هجرات غير مسجلة) | قارن `_prisma_migrations` مع مجلد الهجرات (§4.4 فحص 2) — لا تشغّل `migrate reset` هنا |
| `/health/ready` يعيد 503 | DATABASE_URL خطأ أو القاعدة لم تُنشأ | راجع §4.2/§4.3 |

### 4.6 التنظيف بعد البروفة

```bash
# أوقف خادم البروفة (Ctrl-C) ثم احذف قاعدة البروفة:
psql --host=<DB_HOST> --port=<DB_PORT> --username=<DB_ADMIN_USER> --dbname=postgres \
  --command="DROP DATABASE IF EXISTS \"${DRILL_DB}\";"
```

---

## 5. اختبار الاستعادة الدوري (Rehearsal) — شهريًا على staging

- **التوقيت:** أول يوم عمل من كل شهر، قبل أي release للموجة القادمة.
- **النطاق:** تنفيذ §4 كاملًا على قاعدة **staging** (وليس الإنتاج) من نسخة احتياطية عمرها ≤ 7 أيام.
- **شرط النجاح:** الفحوصات الإلزامية الخمس (§4.4) كلها ناجحة + زمن التنفيذ الكامل مقاس ومسجل (يغذي مراجعة RTO).
- **التوثيق:** سجّل كل بروفة في الجدول أدناه، وأرفق بند «backup/restore مجربان» في handoff إغلاق G9→G10 بأحدث نتيجة.

### سجل بروفات الاستعادة

| # | التاريخ | مصدر البروفة (staging/النسخة المستخدمة) | النتيجة (PASS/FAIL) | الزمن الكلي (دقيقة) | المنفّذ | الملاحظات |
|---|---|---|---|---|---|---|
| 1 | | | | | | |
| 2 | | | | | | |
| 3 | | | | | | |

> **قاعدة:** بروفة فاشلة أو شهر بلا بروفة ⇒ يُعاد فتح بند «backup/restore مجربان» في بوابة G9→G10 حتى نجاح بروفة جديدة.

---

## 6. بيئة Railway (الإنتاج)

الإنتاج موصول على Railway (راجع `docs/RELEASE_READINESS_2026-08-27.md` — `garment-factory-erp-production.up.railway.app`).

1. **النسخ التلقائي:** توفر خدمة PostgreSQL على Railway نسخًا احتياطية تلقائية (تختلف الخطة/الاحتفاظ حسب اشتراك المشروع). **قبل الاعتماد عليها** تحقق من: خطة Backup مفعّلة على قاعدة الإنتاج (`fulfilling-serenity`)، نافذة الاستعادة المتاحة (أقدم نقطة استعادة)، وآلية request-restore، ووثّق ذلك في سجل البروفات — النسخة التلقائية التي لم يُتحقق من نافذتها لا تُحسب تغطية.
2. **التصدير اليدوي (إلزامي أسبوعيًا على الأقل):** خذ connection string الخدمة من لوحة Railway (Variables → `DATABASE_URL`) — **لا تكتبه في أي ملف أو مستند** — ونفّذ من جهاز لديه وصول شبكي للـ host العام:

```bash
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

pg_dump \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file="railway_garment-erp_${STAMP}.dump" \
  "postgresql://<RAILWAY_DB_USER>:<RAILWAY_DB_PASSWORD>@<RAILWAY_DB_HOST>:<RAILWAY_DB_PORT>/<RAILWAY_DB_NAME>?sslmode=require"

( cd . && sha256sum "railway_garment-erp_${STAMP}.dump" > "railway_garment-erp_${STAMP}.dump.sha256" )
```

- `sslmode=require` مطلوب للاتصال العام بخدمة قاعدة Railway.
- انقل النسخة فورًا إلى `<OFFSITE_HOST>` (§3.6) — النسخة على محطة العمل ليست تخزينًا خارجيًا.
- إن كنت داخل Railway (طبلية أو cron service بنفس الـ project) يمكن استخدام network address الداخلي بدل العام؛ الاتصال من الخارج يتطلب host القاعدة العامة.
- **ملاحظة RPO:** النسخ التلقائي اليومي على Railway + التصدير اليدوي الأسبوعي يعنيان أن أسوأ خسارة معتمدة للبيانات = نسخة تلقائية يوم واحد (راجع §8 RPO=24h) — إن لم تكن الخطة توفر يوميًا فطبّق §3 يوميًا عبر التصدير اليدوي.

---

## 7. القيود الأمنية (ملزمة)

1. **النسخة الاحتياطية بيانات حساسة مكثفة:** كلمات مرور المستخدمين **bcrypt**، ذمم العملاء والموردين (`balance`)، رواتب العمال وسلفهم، رصيد الخزائن — التعامل مع النسخة كبيانات إنتاج:
   - التخزين **مشفّر**: تشفير قرص كامل على `<OFFSITE_HOST>` أو تشفير الملفات نفسها (gpg كما في §3.7 للأسرار).
   - الصلاحيات: `chmod 600` للملفات و`700` للمجلد، ووصول مقصور على دور التشغيل فقط.
2. **ممنوع نهائيًا رفع أي نسخة (`*.dump`, `*.tar.gz`, `backend_env_*.gpg`) إلى Git** — أي مستودع أو مجلد عمل. مستودع الكود لا يُستخدم أبدًا وسيطة تخزين. (فحص secret-scan في CI يلتقط الأنماط النصية، لكن النسخ الثنائية يجب ألا تصل أصلًا.)
3. أسرار البيئة لا تُنسخ كنص صريح إلى خادم النسخ — فقط gpg/خزنة أسرار (§3.7).
4. بيانات دخول البروفة (§4.4 فحص 4) تؤخذ من حسابات staging التجريبية، ولا تُوثق كلمات مرور حقيقية في أي مستند.
5. سجلات البروفة (`*.restore.log`) قد تحوي أسماء جداول/مخططات — تخزن بجانب النسخ ولا تُرفع إلى Git.

---

## 8. RPO / RTO (أهداف مقترحة — تتطلب اعتماد المالك)

| المؤشر | القيمة المقترحة | الأساس التشغيلي | شرط التحقق |
|---|---|---|---|
| **RPO** (أقصى فقد بيانات مقبول) | **24 ساعة** | نسخة يومية كاملة (§3) + نسخ Railway التلقائي اليومي | مراجعة سنوية أو عند تغيّر حجم البيانات/الجدولة |
| **RTO** (زمن العودة للتشغيل) | **4 ساعات** | نسخة على الطبقة المحلية + إجراء §4 مجرَّب شهريًا | زمن بروفة §5 المقاس فعليًا ≤ 4 ساعات (بما فيه إعادة تشغيل الخدمة) |

> **تنبيه:** هاتان القيمتان **أهداف تشغيلية مقترحة** لموازنة الجهد مقابل المخاطر، ويلزم اعتمادهما خطيًا من **مالك المؤسسة** قبل اعتبارهما تعاقدًا مع بوابة G10→G11. إن لم يُعتمدا بعد، تعامل معهما كأقصى حدود تصميمية وقِس ضدهما في كل بروفة.

---

## 9. مسؤوليات ومصفوفة تدقيق سريعة

| النشاط | المسؤول | الدليل المطلوب في الـ handoff |
|---|---|---|
| النسخة اليومية + النقل الخارجي | Ops | صف في جدول §3.8 |
| بروفة الاستعادة الشهرية | Ops + مراقب | صف في جدول §5 |
| اعتماد RPO/RTO | مالك المؤسسة | موافقة موثقة تُرفق بـ RELEASE_GATES |
| مراجعة هذا الـ runbook | Ops | عند كل دمج هجرة جديدة أو تغيير host |
