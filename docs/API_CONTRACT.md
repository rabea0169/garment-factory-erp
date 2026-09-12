# API_CONTRACT — عقد الـ API

> **تحديث GF-0004:** كل مسارات الكتابة (POST/PATCH) تستقبل الآن DTO مع class-validator: 400 على أي حقل غير معروف (forbidNonWhitelisted)، enum غير صالح، كمية/سعر غير موجب، تاريخ غير صالح، أو UUID غير صالح. **تحديث audit (2026-09-12):** ParseUUIDPipe أصبح على **كل** معاملات مسار UUID في كل المتحكمات (كان قاصرًا على products/inventory/production) — أي معرف مسار غير صالح يرد 400 لا 500. حقول الهوية (userId/createdById/creatorId) في body تُرفض بـ 400 — لا تُقبل مطلقًا.

**Base URL:** `http://<host>:3005` (PORT من البيئة — ADR-0004) · **Docs:** `/api/docs` · **Auth:** `Authorization: Bearer <JWT>`

## قواعد التحقق الموحدة (GF-0004)

| القاعدة | أمثلة مرفوضة بـ 400 |
|---|---|
| حقل غير معروف في body | `userId`, `createdById`, `creatorId`, أي حقل خارج الـ DTO |
| enum غير صالح | `paymentType: 'X'`, `type`, `stage`, `status`, `rejectionReason`, `AccountType` |
| كمية/سعر غير موجب | `quantity: -2/0`, `unitPrice: 0`, `amount: -50`, `retailPrice: 0` |
| عدد صحيح مطلوب | `quantity: 1.5` (في الكميات والقطع) |
| UUID غير صالح | `customerId: 'not-a-uuid'` + **أي معرف مسار UUID في كل المتحكمات** (audit) |
| تاريخ غير صالح | `date: 'not-a-date'` (ISO 8601) |
| مصفوفة بنود فارغة | `items: []` |

## المصادقة — `/auth`

| Method | Path | الوظيفة | الحماية | الأدوار |
|---|---|---|---|---|
| POST | `/auth/login` | تسجيل دخول وإرجاع token وuser | 🌐 **عام** (throttle 10/min) | — |
| GET | `/auth/me` | إرجاع profile المستخدم الحالي والتحقق من الجلسة | 🔒 JWT | — |
| POST | `/auth/refresh` | تدوير refresh token صالح وإصدار access جديد | 🌐 **عام** (throttle 30/min) | — |
| POST | `/auth/logout` | إبطال الجلسة الحالية (رفع jwtVersion + سحب refresh tokens) | 🌐 **عام** (throttle 30/min) | — |

SEC-F04: دورة refresh rotation كاملة — refresh token صالح مرة واحدة فقط؛ إعادة استعمال token مستهلَك تُسجل محاولة إعادة استخدام وتُبطل السلسلة. logout يرفع `jwtVersion` فيرفض الخادم أي access token سابق بـ 401.

## المستخدمون — `/users` (CC-9)

| Method | Path | الوظيفة | الحماية | الأدوار |
|---|---|---|---|---|
| GET | `/users` | قائمة المستخدمين مع pagination وفلتر role/isActive | 🔒 JWT | SUPER_ADMIN |
| POST | `/users` | إنشاء مستخدم (name/email/password/role/phone) | 🔒 JWT | SUPER_ADMIN |
| PATCH | `/users/:id/role` | تغيير دور مستخدم | 🔒 JWT | SUPER_ADMIN؛ `:id` UUID |
| PATCH | `/users/:id/deactivate` | تعطيل مستخدم (يرفض تعطيل آخر SUPER_ADMIN نشط) | 🔒 JWT | SUPER_ADMIN؛ `:id` UUID |
| PATCH | `/users/:id/activate` | إعادة تنشيط مستخدم | 🔒 JWT | SUPER_ADMIN؛ `:id` UUID |

كلمة المرور bcrypt(10) ولا تُعاد في أي قراءة. تغيير الدور لا يبطل جلسات المستخدم الحالية فورًا (تُبطل عند أول refresh).

## المنتجات — `/products`

| Method | Path | الوظيفة | الحماية | الأدوار |
|---|---|---|---|---|
| GET | `/products` | قائمة المنتجات | 🔒 JWT | أي مستخدم موثّق |
| GET | `/products/:id` | منتج واحد | 🔒 JWT | أي مستخدم موثّق |
| GET | `/products/seasons` | المواسم | 🔒 JWT | أي مستخدم موثّق |
| POST | `/products` | إنشاء منتج | 🔒 JWT | GENERAL_MANAGER, PRODUCTION_MANAGER |
| POST | `/products/full` | إنشاء منتج مع المتغيرات وBOM داخل transaction واحدة | 🔒 JWT | GENERAL_MANAGER, PRODUCTION_MANAGER |
| POST | `/products/:id/variants` | إضافة مقاس/لون | 🔒 JWT | GENERAL_MANAGER, PRODUCTION_MANAGER؛ `:id` UUID |
| POST | `/products/:id/bom` | إضافة/تحديث مادة في BOM | 🔒 JWT | GENERAL_MANAGER, PRODUCTION_MANAGER؛ `:id` UUID |
| POST | `/products/bom/:bomId/delete` | حذف مادة من BOM | 🔒 JWT | GENERAL_MANAGER, PRODUCTION_MANAGER؛ `:bomId` UUID |

## المخزون — `/inventory`

| Method | Path | الوظيفة | الحماية | الأدوار |
|---|---|---|---|---|
| GET | `/inventory/raw-materials` | الخامات (التكلفة تُخفى لغير الأدوار المالية INV-2) | 🔒 JWT | أي مستخدم موثّق |
| GET | `/inventory/raw-materials/low-stock` | تنبيه النقص | 🔒 JWT | أي مستخدم موثّق |
| POST | `/inventory/raw-materials/:id/add-stock` | إضافة رصيد (مسار legacy — **يرحّل قيد GL من audit-2026-09-12**) | 🔒 JWT | INVENTORY_MANAGER |
| GET | `/inventory/raw-materials/:id/balance-by-warehouse` | رصيد الخامة موزعاً على المستودعات | 🔒 JWT | أي مستخدم موثّق؛ `:id` UUID |
| GET | `/inventory/finished-goods` | المنتج التام (unitCost حسب الدور) | 🔒 JWT | أي مستخدم موثّق |
| GET | `/inventory/summary` | ملخص المخزون | 🔒 JWT | أي مستخدم موثّق |
| GET | `/inventory/warehouses` | المستودعات النشطة | 🔒 JWT | أي مستخدم موثّق |
| GET | `/inventory/ledger` | دفتر حركات المخزون بمرشحات خامة/مخزن/نوع/فترة | 🔒 JWT | INVENTORY_MANAGER, ACCOUNTANT, GENERAL_MANAGER (SA يتجاوز) |
| POST | `/inventory/movements/receive` | استلام خامات في مخزن (متوسط مرجح + قيد Dr INVENTORY / Cr INVENTORY_ADJUSTMENT_INCOME) | 🔒 JWT | INVENTORY_MANAGER |
| POST | `/inventory/movements/issue` | صرف خامات (قيد Dr INVENTORY_ADJUSTMENT_EXPENSE / Cr INVENTORY) | 🔒 JWT | INVENTORY_MANAGER |
| POST | `/inventory/movements/adjust` | تسوية جرد ± (قيد موجب/سالب) | 🔒 JWT | INVENTORY_MANAGER |
| POST | `/inventory/movements/waste` | هدر خامات (قيد Dr WASTE_EXPENSE / Cr INVENTORY) | 🔒 JWT | INVENTORY_MANAGER |
| POST | `/inventory/return` | مرتجع خامات من الإنتاج للمخزن (مرتجع داخلي بلا قيد — ADR-0020) | 🔒 JWT | INVENTORY_MANAGER |
| POST | `/inventory/movements/waste-finished-good` | هدر منتج تام (قيد Dr WASTE_EXPENSE / Cr FINISHED_GOOD_STOCK) | 🔒 JWT | INVENTORY_MANAGER |

**تحديث audit (2026-09-12):** مسار `add-stock` legacy أصبح يمرر `postGl: true` — إضافة مخزون يدوية بدون قيد كانت تُنحرف بميزان المراجعة عن قيمة المخزون الفعلية. كل حركات المخزون اليدوية ترحّل GL داخل نفس المعاملة.

يعيد `/inventory/raw-materials/:id/balance-by-warehouse` رصيد كل مستودع من `SUM(stock_ledger_entries.quantityDelta)`، وليس من آخر `balanceAfter`. وفي استجابة حركات المخزون، يمثل `balanceAfter` الرصيد بعد الحركة داخل `warehouseId` المحدد؛ أما `RawMaterial.currentStock` فيبقى الإجمالي عبر المستودعات. معرف غير صالح يرد `400`.

## Dashboard — `/dashboard`

| Method | Path | الوظيفة | الحماية | المدخلات |
|---|---|---|---|---|
| GET | `/dashboard/stats` | KPIs المبيعات والإنتاج والعمال والمخزون من قاعدة البيانات | 🔒 JWT | `from` و`to` اختياريان بصيغة ISO-8601 |

يعيد المسار `filters`, `generatedAt`, و`sales` كسلسلة شهرية من `SalesOrder.totalAmount` للطلبات غير الملغاة، و`production` كسلسلة يومية من `DailyProduction.piecesCount`، و`topWorkers` لأعلى خمسة عمال في الفترة، و`inventory` من جداول الخامات والمخزون التام. لا توجد بيانات ثابتة أو mock fallback. إذا أُرسلت `from` بعد `to` أو بصيغة غير صالحة يرد الخادم بـ400. كل رقم يرافقه تعريف في `definitions` داخل الاستجابة.

## الإنتاج — `/production`

| Method | Path | الوظيفة | الحماية | الأدوار |
|---|---|---|---|---|
| GET | `/production/work-orders` | أوامر التشغيل | 🔒 JWT | أي مستخدم موثّق |
| POST | `/production/work-orders` | إنشاء أمر تشغيل | 🔒 JWT | PRODUCTION_MANAGER, GENERAL_MANAGER |
| GET | `/production/work-orders/:id/stage-runs` | مراحل أمر التشغيل مع تفاصيلها | 🔒 JWT | PRODUCTION_MANAGER, GENERAL_MANAGER, SUPER_ADMIN |
| PATCH | `/production/work-orders/:id/status` | تحديث الحالة legacy | 🔒 JWT | PRODUCTION_MANAGER, GENERAL_MANAGER |
| POST | `/production/work-orders/:id/stage-transitions` | نقل الأمر إلى المرحلة التالية | 🔒 JWT | PRODUCTION_MANAGER, GENERAL_MANAGER |
| POST | `/production/work-orders/:id/stage-output` | تسجيل مخرجات المرحلة وإغلاقها وتسجيل actor | 🔒 JWT | PRODUCTION_MANAGER, GENERAL_MANAGER؛ `:id` UUID |
| POST | `/production/work-orders/:id/material-consumptions` | صرف خامة فعلي لمرحلة | 🔒 JWT | PRODUCTION_MANAGER, INVENTORY_MANAGER, GENERAL_MANAGER |
| POST | `/production/work-orders/:id/cost/finalize` | تثبيت لقطة تكلفة المواد | 🔒 JWT | PRODUCTION_MANAGER, GENERAL_MANAGER |

مسارات GF-0013 الجديدة تمرر هوية الفاعل من JWT إلى `ProductionWorkflowService`. يدعم `stage-transitions` و`stage-output` و`material-consumptions` رأس `Idempotency-Key` اختياريًا؛ تكرار المفتاح مع نفس المحتوى يعيد النتيجة دون أثر إضافي، واستخدامه مع payload مختلف أو نطاق مختلف يرد بـ409. يعيد `stage-output` الحقول الحالية `workOrderId`, `stage`, `status` مع `replayed` و`stageRunId`. لا تُرسل `actorId` أو `createdById` في body.

**قاعدة إلغاء أوامر التشغيل (audit 2026-09-12):** `PATCH /production/work-orders/:id/status` بـ `CANCELLED` مسموح **فقط من PLANNED** — أمر داخل مسار عمل نشط (IN_PROGRESS/CUTTING/…) رحّل قيود WIP واستهلك خامات ولا مسار لعكسها هنا، فالإلغاء يُرفض بـ 409 مع إرشاد لإتمام الإنتاج (مرحلة PACKING) أو عكس القيود عبر المحاسبة. حتى من PLANNED يُرفض الإلغاء إن وُجد سجل مراحل أو استهلاك خامات (فحص دفاعي).

**ملاحظة GF-0002:** `creatorId` لم يعد يُقبل من body — يُستخرج من الجلسة (`@CurrentUser('id')`).

### قواعد مراحل GF-0013

المراحل المسموحة بالترتيب هي `CUTTING`, ثم `SEWING`, ثم `IRONING`, ثم `PACKING`. لا يقبل API القفز بين المراحل، ولا تسجيل مخرج لمرحلة غير `currentStage`. يجب أن تحقق مخرجات المرحلة `inputQty = acceptedQty + rejectedQty + wasteQty` قبل إغلاقها. أما تكلفة الوحدة فتستخدم accepted output لآخر مرحلة مكتملة، وتبقى التكلفة الحالية تكلفة مواد فقط إلى أن تعتمد مكونات العمالة والمصاريف العامة.

## الجودة والهالك — `/quality` (GF-0014)

| Method | Path | الوظيفة | الحماية | الأدوار |
|---|---|---|---|---|
| GET | `/quality` | سجل الفحوصات مع pagination وبيانات المرحلة والفاعل | 🔒 JWT | PRODUCTION_MANAGER, GENERAL_MANAGER, SUPER_ADMIN (QLT-6) |
| GET | `/quality/kpis` | تجميع كميات ومعدلات الجودة للفحوصات المكتملة | 🔒 JWT | PRODUCTION_MANAGER, GENERAL_MANAGER, SUPER_ADMIN (QLT-6) |
| POST | `/quality` | تسجيل فحص مكتمل مرتبط بـWorkOrder وProductionStageRun | 🔒 JWT | PRODUCTION_MANAGER, GENERAL_MANAGER |

يجب أن يحتوي POST على `workOrderId`, `stageRunId`, `stage`, `checkedQty`, `passedQty`, `rejectedQty`, و`wasteQty`. يفرض الخادم وقاعدة البيانات أن تكون الكميات أعدادًا صحيحة غير سالبة وأن تحقق `checkedQty = passedQty + rejectedQty + wasteQty`. يلزم `rejectionReason` عند وجود رفض، و`wasteReason` عند وجود هالك. تُحسب `unitCost` و`wasteCost` على الخادم، ويمرر actor من JWT؛ لا تُرسل هوية الفاعل أو التكلفة في body.

يدعم POST رأس `Idempotency-Key` اختياريًا. تكرار المفتاح مع نفس المحتوى يعيد نفس الفحص دون إنشاء أثر جديد، أما استخدامه مع محتوى مختلف فيُرفض بـ409. لا يمكن تسجيل فحص لمرحلة غير مطابقة لـ`stageRun` أو لمرحلة غير مكتملة، ولا تُعدل نتيجة مكتملة مباشرة. يرفض النظام فحصًا ثانيًا لنفس `stageRunId` بـ409.

يدعم GET `/quality/kpis` المرشحات الاختيارية `stage`, `workOrderId`, `from`, و`to`. يعيد `totals` لـ`checkedQty`, `passedQty`, `rejectedQty`, `wasteQty`, و`wasteCost`، إضافة إلى `rates` كنسب مئوية ذات منزلتين: `passRate`, `rejectionRate`, و`wasteRate`. تعتمد النتائج على السجلات ذات `status = COMPLETED` فقط، ويُرفض نطاق تاريخ يبدأ بعد نهايته بـ400.

## الموارد البشرية — `/hr`

| Method | Path | الوظيفة | الحماية | الأدوار |
|---|---|---|---|---|
| GET | `/hr/workers` | العمال (حقول الهوية تُخفى لغير HR-8) | 🔒 JWT | أي مستخدم موثّق |
| POST | `/hr/workers` | إنشاء عامل جديد | 🔒 JWT | HR_MANAGER, GENERAL_MANAGER |
| GET | `/hr/workers/:id` | عامل واحد | 🔒 JWT | أي مستخدم موثّق |
| POST | `/hr/attendance` | تسجيل حضور عامل ليوم | 🔒 JWT | HR_MANAGER, GENERAL_MANAGER |
| POST | `/hr/production` | تسجيل إنتاج يومي | 🔒 JWT | PRODUCTION_MANAGER, HR_MANAGER, GENERAL_MANAGER |
| GET | `/hr/production` | قائمة إنتاج يومي بمرشح workerId | 🔒 JWT | HR_MANAGER, GENERAL_MANAGER |
| POST | `/hr/advances` | صرف سلفة | 🔒 JWT | HR_MANAGER |
| GET | `/hr/advances` | قائمة السلف بمرشح workerId | 🔒 JWT | HR_MANAGER, GENERAL_MANAGER |
| POST | `/hr/payrolls` | إنشاء كشف راتب DRAFT محسوب خادميًا | 🔒 JWT | HR_MANAGER, GENERAL_MANAGER |
| GET | `/hr/payrolls` | قائمة كشوف الرواتب بفلتر status/workerId | 🔒 JWT | HR_MANAGER, GENERAL_MANAGER |
| POST | `/hr/payrolls/:id/approve` | اعتماد كشف راتب دون دفع أو ترحيل | 🔒 JWT | HR_MANAGER, GENERAL_MANAGER |
| POST | `/hr/payrolls/:id/pay` | دفع كشف راتب معتمد وترحيله من الخزينة | 🔒 JWT | HR_MANAGER, GENERAL_MANAGER, ACCOUNTANT, CASHIER (الدافع ≠ المعتمد) |
| POST | `/hr/payrolls/:id/cancel` | إلغاء كشف DRAFT/معتمد غير مدفوع | 🔒 JWT | HR_MANAGER, GENERAL_MANAGER |

`POST /hr/payrolls` يستقبل `workerId`, `periodStart`, `periodEnd`, و`notes` فقط. يحسب الخادم `grossAmount` من مجموع `DailyProduction.totalAmount` داخل الفترة، ويحسب `advanceDeduct` من السلف داخل الفترة بحد أقصى gross، ويجعل `absenceDeduct = 0` في MVP وفق ADR-0015. لا يقبل `grossAmount` أو `netAmount` أو الخصومات من العميل، و`netAmount = grossAmount - advanceDeduct - absenceDeduct`. الفترة شاملة لطرفيها، وسجل العامل والفترة فريد.

يدعم الإنشاء والاعتماد والدفع رأس `Idempotency-Key` اختياريًا. نفس المفتاح ونفس المحتوى يعيدان الاستجابة المخزنة دون أثر ثانٍ، والمحتوى المختلف أو التكرار المتزامن يُرفض بـ409. الإنشاء يسجل `createdById` والاعتماد يسجل `approvedById` و`approvedAt` من JWT. لا يسمح اعتماد سجل معتمد. يتطلب الدفع كشفًا بحالة `APPROVED` وغير مدفوع، و`treasuryId` لخزينة نشطة، ويحسب الخادم المبلغ من `netAmount` ولا يقبل مبلغًا من العميل. **تصويب audit (كان العقد يقول GENERAL_EXPENSE → CASH):** الدفع يرحّل `Dr SALARIES_PAYABLE / Cr CASH` بصافي المبلغ **و`Dr SALARIES_PAYABLE / Cr WORKER_ADVANCES`** بالسلف المستقطعة (تنفيذ COMM-F03 الأدق محاسبيًا)، ويخفض الخزينة داخل transaction واحدة. **تصويب audit للأدوار:** الدفع متاح أيضًا لـ ACCOUNTANT وCASHIER مع فرض فصل واجبات (الدافع ≠ المعتمد) — الإعتماد يظل HR/GM فقط. لا تُقبل دفعة لصافي مبلغ غير موجب ولا يُعاد تنفيذ الأثر عند replay. السلفة ترحّل `Dr WORKER_ADVANCES / Cr CASH` فقط عند تحديد `treasuryId` (بخزينة)؛ بدونها سلفة بلا قيد نقدي.

## الموردون — `/suppliers`

| Method | Path | الوظيفة | الحماية | الأدوار |
|---|---|---|---|---|
| GET | `/suppliers` | الموردون النشطون مع pagination | 🔒 JWT | أي مستخدم موثّق |
| POST | `/suppliers` | إنشاء مورد جديد | 🔒 JWT | INVENTORY_MANAGER, GENERAL_MANAGER |
| PATCH | `/suppliers/:id` | تحديث بيانات مورد | 🔒 JWT | INVENTORY_MANAGER, GENERAL_MANAGER؛ `:id` UUID |
| PATCH | `/suppliers/:id/deactivate` | تعطيل مورد (يرفض مع رصيد دائن غير صفري) | 🔒 JWT | INVENTORY_MANAGER, GENERAL_MANAGER؛ `:id` UUID |
| PATCH | `/suppliers/:id/activate` | إعادة تنشيط مورد | 🔒 JWT | INVENTORY_MANAGER, GENERAL_MANAGER؛ `:id` UUID |

يستقبل `POST /suppliers` الحقول `name` الإلزامي، و`phone` و`email` و`address` و`notes` الاختيارية. يتحقق الخادم من البريد الإلكتروني، يطبع النصوص، يولد code يبدأ بـ`SUP-`، ولا يغير `balance` عند الإنشاء. تستخدم القائمة `page` و`limit` وتستبعد الموردين ذوي `deletedAt` أو `isActive = false`.

## المشتريات — `/purchasing`

| Method | Path | الوظيفة | الحماية | الأدوار |
|---|---|---|---|---|
| GET | `/purchasing/orders` | أوامر الشراء مع pagination | 🔒 JWT | أي مستخدم موثّق |
| POST | `/purchasing` | إنشاء أمر شراء DRAFT | 🔒 JWT | INVENTORY_MANAGER, GENERAL_MANAGER |
| POST | `/purchasing/:id/approve` | اعتماد أمر شراء (فصل واجبات: المنشئ ≠ المعتمد) | 🔒 JWT | INVENTORY_MANAGER, GENERAL_MANAGER؛ `:id` UUID |
| POST | `/purchasing/:id/cancel` | إلغاء أمر DRAFT/PENDING | 🔒 JWT | INVENTORY_MANAGER, GENERAL_MANAGER؛ `:id` UUID |
| POST | `/purchasing/:id/receipts` | استلام جزئي أو كامل إلى مخزن الخامات | 🔒 JWT | INVENTORY_MANAGER, GENERAL_MANAGER |
| PUT | `/purchasing/:id/receive` | استلام legacy كامل | 🔒 JWT | INVENTORY_MANAGER, GENERAL_MANAGER |
| POST | `/purchasing/:id/return` | مرتجع إلى المورد | 🔒 JWT | INVENTORY_MANAGER, GENERAL_MANAGER |

يتطلب `POST /purchasing/:id/receipts` قائمة غير فارغة بلا تكرار لبند أمر الشراء. يتحقق الخادم من الكمية المتبقية، وينشئ receipt وحركات `RECEIVE` في `StockLedgerEntry`، ويرحل قيداً آلياً متوازناً (مدين مخزون / دائن حسابات دائنة) ويحدّث رصيد المورد وحالة الأمر داخل transaction واحدة؛ لا تُؤخذ الكمية أو التكلفة من حقيقة يرسلها العميل خارج عناصر أمر الشراء. يدعم الرأس الاختياري `Idempotency-Key`، وتكرار المفتاح مع نفس المحتوى يعيد الاستجابة دون receipt أو ledger أو قيد إضافي، بينما المحتوى المختلف يُرفض بـ409. مسار المرتجع يعكس المخزون والقيد والذمم داخل transaction واحدة، ويمنع سباق مرتجعين يتجاوزان الكمية المستلمة. يجب إثبات اختبارات PostgreSQL على CI قبل التشغيل المشترك.

## المبيعات — `/sales`

| Method | Path | الوظيفة | الحماية | الأدوار |
|---|---|---|---|---|
| GET | `/sales/customers` | العملاء | 🔒 JWT | أي مستخدم موثّق |
| POST | `/sales/customers` | عميل جديد | 🔒 JWT | CASHIER, GENERAL_MANAGER |
| PATCH | `/sales/customers/:id` | تحديث بيانات عميل (COMM-F07) | 🔒 JWT | CASHIER, GENERAL_MANAGER؛ `:id` UUID |
| PATCH | `/sales/customers/:id/credit` | ضبط الحد الائتماني وشروط السداد (امتيازي، بتدقيق منفصل) | 🔒 JWT | GENERAL_MANAGER فقط؛ `:id` UUID |
| GET | `/sales/orders` | أوامر البيع | 🔒 JWT | أي مستخدم موثّق |
| POST | `/sales/orders` | إنشاء أمر بيع | 🔒 JWT | CASHIER, GENERAL_MANAGER |
| POST | `/sales/orders/:id/confirm` | تأكيد أمر البيع وصرف المخزون وترحيل القيود | 🔒 JWT | CASHIER, GENERAL_MANAGER؛ `:id` UUID |
| POST | `/sales/orders/:id/cancel` | إلغاء أمر بيع مسودة قبل التأكيد | 🔒 JWT | CASHIER, GENERAL_MANAGER |
| POST | `/sales/orders/:id/void` | إبطال أمر مؤكد بلا مرتجعات — عكس القيد وإعادة المخزون (SAL-7) | 🔒 JWT | GENERAL_MANAGER فقط؛ `:id` UUID |
| POST | `/sales/orders/:id/return` | مرتجع جزئي أو كامل لأمر بيع مؤكد/مشحون | 🔒 JWT | CASHIER, GENERAL_MANAGER |
| POST | `/sales/customer-payments` | تحصيل دفعة من العميل | 🔒 JWT | CASHIER, GENERAL_MANAGER |

يستقبل `POST /sales/customers` body بالحقول `name` الإلزامي، و`phone` و`email` و`address` الاختيارية، وجميعها نصوص؛ لا تُقبل الحقول غير المعروفة. يحفظ الخادم `email` كما يصل من Contact Picker أو الإدخال اليدوي. في Sprint 1 يقتصر تدفق الهاتف على إنشاء العميل الفعلي؛ استيراد جهات الاتصال للموردين والموظفين مؤجل حتى توفير APIs حقيقية لإنشائهم.

يدعم `POST /sales/orders` و`POST /sales/orders/:id/cancel` رأس `Idempotency-Key` اختياريًا. نفس المفتاح ونفس payload يعيدان النتيجة نفسها، وإعادة استخدام المفتاح بمحتوى مختلف تُرفض بـ409. الإلغاء متاح للمسودة فقط قبل التأكيد؛ أما الأمر المؤكد فلا يُلغى بهذا المسار حفاظًا على المخزون والـLedger.

يستقبل `POST /sales/orders/:id/return` قائمة `items` تحتوي `salesOrderItemId` و`quantity`، مع `reason` اختياري. يتحقق الخادم من حالة الأمر ومن الكمية التي لم تُرجع سابقًا، ويعيد الكمية إلى مخزن المنتج التام عبر `InventoryService`، وينشئ `SalesReturn` و`SalesReturnItem`، ويعكس إيراد/VAT/COGS ويرد المدفوع نقدًا أو يخفض الذمم بحسب ما تم تحصيله، داخل transaction واحدة. يدعم `Idempotency-Key` ويمنع تكرار البند أو تجاوز الكمية.

يستقبل `POST /sales/customer-payments` `customerId` و`amount` الموجب، مع `salesOrderId` و`notes` اختياريين. يتحقق الخادم من العميل النشط ومن الرصيد المتبقي، ويحدّث `CustomerPayment` و`SalesOrder.paidAmount` عند ربط الدفعة بأمر، ثم يرحل قيدًا متوازنًا `Dr CASH / Cr ACCOUNTS_RECEIVABLE` ويخفض رصيد العميل داخل transaction واحدة. لا تقبل الدفعة الزائدة أو أمر البيع غير المؤكد، وتُحفظ هوية الفاعل من JWT في القيد.

**ملاحظة GF-0002:** `userId` لم يعد يُقبل من body — من الجلسة.

## الشحن — `/shipping`

| Method | Path | الوظيفة | الحماية | الأدوار |
|---|---|---|---|---|
| GET | `/shipping` | الشحنات مع pagination | 🔒 JWT | أي مستخدم موثّق |
| POST | `/shipping` | إنشاء شحنة | 🔒 JWT | CASHIER, GENERAL_MANAGER |
| PATCH | `/shipping/:id/status` | انتقال حالة شحنة | 🔒 JWT | CASHIER, GENERAL_MANAGER |

تُقبل انتقالات الشحنة فقط وفق `PREPARING → SHIPPED → IN_TRANSIT → DELIVERED`، مع `IN_TRANSIT → RETURNED` أو `DELIVERED → RETURNED`، **و`PREPARING → CANCELLED`** (تصويب audit — كان العقد يغفلها) مع عكس قيد تكلفة الشحنة وإعادة الأمر إلى CONFIRMED داخل المعاملة. يتطلب `DELIVERED` حقل `proofOfDelivery` غير فارغ، ويأخذ الخادم `deliveredById` و`deliveredAt` من الجلسة/الخادم. التحديث الذري المشروط بالحالة السابقة يمنع سباق الانتقالات ويسجل ActivityLog. يتم صرف المنتج التام عند تأكيد أمر البيع في `POST /sales/orders/:id/confirm`؛ مسارات الشحن الحالية تغيّر lifecycle الشحنة فقط ولا تصرف المخزون مرة أخرى.

يدعم `POST /shipping` رأس `Idempotency-Key` اختياريًا. نفس المفتاح مع نفس body وactor يعيد الشحنة دون إنشاء جديد، وإعادة استخدامه بمحتوى مختلف تُرفض بـ409. actor مأخوذ من JWT ولا يُقبل من body.

## المحاسبة — `/accounting`

| Method | Path | الوظيفة | الحماية | الأدوار |
|---|---|---|---|---|
| GET | `/accounting/accounts` | شجرة الحسابات | 🔒 JWT | ACCOUNTANT, GENERAL_MANAGER |
| GET | `/accounting/treasuries` | الخزائن النشطة مع الرصيد | 🔒 JWT | ACCOUNTANT, GENERAL_MANAGER |
| POST | `/accounting/accounts` | حساب جديد | 🔒 JWT | ACCOUNTANT |
| GET | `/accounting/vouchers` | السندات | 🔒 JWT | ACCOUNTANT, GENERAL_MANAGER, CASHIER |
| POST | `/accounting/vouchers` | سند قبض/صرف جديد | 🔒 JWT | ACCOUNTANT, CASHIER |
| GET | `/accounting/journal-entries` | قائمة القيود بفلتر فترة/عكس | 🔒 JWT | ACCOUNTANT, GENERAL_MANAGER, SUPER_ADMIN |
| GET | `/accounting/accounts/:id/statement` | كشف حساب (بنود القيود مدين/دائن مع الرصيد الجاري) | 🔒 JWT | ACCOUNTANT, GENERAL_MANAGER, SUPER_ADMIN؛ `:id` UUID |
| GET | `/accounting/trial-balance` | ميزان المراجعة من أرصدة الحسابات | 🔒 JWT | ACCOUNTANT, GENERAL_MANAGER, SUPER_ADMIN |
| POST | `/accounting/journal-entries/:id/reverse` | عكس قيد مالي مرة واحدة | 🔒 JWT | ACCOUNTANT, GENERAL_MANAGER |
| POST | `/accounting/fiscal-periods` | إنشاء فترة مالية مفتوحة | 🔒 JWT | ACCOUNTANT, GENERAL_MANAGER |
| PATCH | `/accounting/fiscal-periods/:id/close` | إغلاق فترة مالية | 🔒 JWT | ACCOUNTANT, GENERAL_MANAGER |
| POST | `/accounting/journal-entries` | إنشاء قيد متعدد البنود داخل فترة مفتوحة | 🔒 JWT | ACCOUNTANT, GENERAL_MANAGER |

يدعم إنشاء السند رأس `Idempotency-Key` اختياريًا. نفس المفتاح ونفس المحتوى يعيدان النتيجة دون إنشاء قيد أو سند مكرر، أما إعادة استخدام المفتاح بمحتوى مختلف فتُرفض بـ409. إنشاء الـVoucher والقيد وتحديث الخزينة والذمم يتم داخل transaction واحدة. يعتمد نموذج الهاتف على خزينة نشطة من `GET /accounting/treasuries`، ويقتصر الطرف المقابل التشغيلي في السند على `CUSTOMER` و`SUPPLIER`؛ صرف العمال يتم عبر دورة Payroll المخصصة.

الفترات المالية لا تتداخل، ويُمنع الترحيل في فترة CLOSED أو بتاريخ خارج حدود الفترة. يقبل `POST /accounting/journal-entries` `description`, `reference`, `fiscalPeriodId`, `date` الاختياري، و`lines[]` الموجبة؛ يتحقق المحرك من الحسابات النشطة وتوازن المدين/الدائن ويأخذ `createdById` من JWT. إغلاق الفترة مشروط بحالتها الحالية ويسجل ActivityLog، ولا توجد كتابة دفع أو VAT آلية في هذا المسار.

**ملاحظة GF-0002:** `createdById` لم يعد يُقبل من body — من الجلسة.

## الصحة والتشغيل — `/health`

| Method | Path | الوظيفة | الحماية |
|---|---|---|---|
| GET | `/health` | فحص liveness للعملية فقط | 🌐 عام |
| GET | `/health/ready` | فحص readiness واتصال PostgreSQL | 🌐 عام |

`/health/ready` يعيد 200 فقط عند نجاح استعلام قاعدة البيانات، ويعيد 503 دون كشف تفاصيل الاتصال عند عدم الجاهزية.

## الجذر

| Method | Path | الوظيفة | الحماية |
|---|---|---|---|
| GET | `/` | رسالة ترحيب | 🌐 عام |

**إصلاح GF-0002:** كان `AppController` غير مسجّل في `AppModule` (GET / يرجع 404) — خلل قديم أُصلح.

## قواعد الحماية العامة (مفعّلة)

1. `SUPER_ADMIN` يتجاوز كل قيود `@Roles()`.
2. التوكن المنتهي/الغير صالح/لمستخدم موقوف → 401.
3. أي مسار جديد يُضاف لاحقًا **محمي افتراضيًا** — لا حاجة لتذكر الحماية؛ فقط أضف `@Public()` إن كان عامًا فعلًا (وبأقصى تضييق).
4. مصادقة الإقلاع fail-closed: غياب `JWT_SECRET`/`DATABASE_URL` (وفي الإنتاج: سر <32 حرفًا أو CORS مفتوح) → فشل إقلاع فوري.

## عقد Pagination الموحد (GF-0012)

كل endpoint يعيد قائمة يجب أن يستخدم query parameters التالية ما لم يُذكر استثناء صريح:

| Parameter | Default | Limit | Validation |
|---|---:|---:|---|
| `page` | 1 | — | integer >= 1 |
| `limit` | 20 | 100 | integer between 1 and 100 |

شكل الاستجابة الموحد هو:

```json
{
  "data": [],
  "meta": {
    "total": 0,
    "page": 1,
    "pageSize": 20,
    "totalPages": 0,
    "hasNextPage": false,
    "hasPreviousPage": false
  }
}
```

تطبّق القوائم الحالية هذا العقد على المنتجات، المواسم، الخامات، المخازن، ledger، المنتجات التامة، أوامر التشغيل، أوامر الشراء، العملاء، أوامر البيع، العمال، الجودة، الشحن، الحسابات، والسندات. أما endpoints الملخصات والتفاصيل المفردة فلا تستخدم pagination.

## ثغرات العقد المتبقية (تُغلق تباعًا)

1. ~~**لا endpoint للـ Dashboard/Reports**~~ — ✅ **أُغلقت** بـ`GET /dashboard/stats` (GF-0019) + KPIs الجودة والميزان.
2. ~~**لا pagination** في القوائم~~ — ✅ **أُغلقت في GF-0012** بعقد موحد واختبارات حدودية.
3. ~~**لا DTOs** في معظم مسارات الكتابة~~ — ✅ **أُغلقت في GF-0004**.
4. ~~**لا معالج أخطاء موحد**~~ — ✅ **أُغلق في Cluster 4** عبر Global Exception Filter؛ يجب إضافة اختبارات عقدية لأي أخطاء جديدة.
5. ~~**قاعدة المجال المؤجلة**: `checked = passed + rejected` في فحص الجودة~~ — ✅ تُفرض في GF-0014 مع فصل `wasteQty` و`wasteReason` وربط `stageRun`.

**تحديث audit (2026-09-12) — مُزامنة كاملة:** أُضيف للعقد كل المسارات المنفذة غير الموثقة سابقًا (auth refresh/logout، موديول users كاملًا، مسارات حركات المخزون، stage-runs، مسارات HR الناقصة، تحديث الموردين، approve/cancel الشراء، تحديث العملاء والحد الائتماني، confirm/void البيع، مسارات المحاسبة الثلاثة الناقصة) وصُححت 4 انحرافات سلوكية (قيود دفع الرواتب، انتقال إلغاء الشحنة، أدوار قراءة الجودة، أدوار دفع الرواتب). مسارات CRUD شركات الشحن غير موجودة بعد (النموذج قائم بلا مسارات — P2).

## أمثلة Payloads الصحيحة (GF-0004)

> **تنبيه:** أمثلة القوائم تستخدم `GET /path?page=1&limit=20` وتعيد العقد الموحد أعلاه. سعر بند البيع لا يُرسل من العميل؛ الخادم يقرأ السعر من المنتج.

```jsonc
// POST /sales/orders
{
  "customerId": "uuid", "paymentType": "CASH", "discount": 0,
  "items": [{ "productVariantId": "uuid", "quantity": 2 }]
}
// POST /accounting/vouchers  { "type": "PAYMENT", "amount": 500, "description": "صرف نثريات" }
// POST /production/work-orders  { "productVariantId": "uuid", "bomVersionId": "uuid", "quantity": 100 }
// PATCH /production/work-orders/:uuid/status  { "status": "SEWING" }
// POST /production/work-orders/:uuid/stage-transitions
// Header: Idempotency-Key: transition-2026-001
// Body: { "toStage": "CUTTING", "reason": "بدء القص" }
// POST /production/work-orders/:uuid/stage-output
// Body: { "stage": "CUTTING", "inputQty": 100, "acceptedQty": 95, "rejectedQty": 3, "wasteQty": 2 }
// POST /production/work-orders/:uuid/material-consumptions
// Header: Idempotency-Key: consumption-2026-001
// Body: { "stageRunId": "uuid", "rawMaterialId": "uuid", "warehouseId": "uuid", "plannedQuantity": 50, "actualQuantity": 52, "wasteQuantity": 2, "unit": "METER", "wasteReason": "CUTTING_LOSS" }
// POST /production/work-orders/:uuid/cost/finalize
// Body: {}
// POST /inventory/raw-materials/:uuid/add-stock  { "quantity": 50, "costPerUnit": 45.5 }
// POST /hr/workers  { "name": "أحمد محمود", "phone": "01000000000", "nationalId": "اختياري", "specialty": "SEWING", "pieceRate": 5.5, "hireDate": "2026-08-27" }
// POST /hr/production  { "workerId": "uuid", "workOrderId": "uuid?", "date": "2026-08-25T00:00:00.000Z", "piecesCount": 100 }
// POST /hr/advances  { "workerId": "uuid", "amount": 200, "notes": "اختياري" }
// POST /hr/payrolls  { "workerId": "uuid", "periodStart": "2026-08-01", "periodEnd": "2026-08-31", "notes": "اختياري" }
// POST /hr/payrolls/:id/approve  Header: Idempotency-Key: payroll-approve-2026-08
// POST /hr/payrolls/:id/pay  Header: Idempotency-Key: payroll-pay-2026-08
// Body: { "treasuryId": "uuid", "paymentDate": "2026-08-31", "notes": "اختياري" }
// POST /quality  { "workOrderId": "uuid", "stage": "SEWING", "checkedQty": 100, "passedQty": 95, "rejectedQty": 5 }
// POST /products  { "code": "PRD-T01", "name": "تيشيرت", "category": "تيشيرت", "retailPrice": 250, "wholesalePrice": 180, "seasonId": "uuid?" }
// POST /suppliers  { "name": "شركة النسيج", "phone": "01000000000", "email": "supplier@example.com", "address": "القاهرة", "notes": "اختياري" }
// POST /sales/customers  { "name": "عميل", "phone": "اختياري", "email": "customer@example.com", "address": "اختياري" }
// POST /shipping  { "salesOrderId": "uuid", "shippingCost": 75, "trackingNumber": "اختياري" }
// POST /accounting/accounts  { "code": "1000", "name": "الصندوق", "type": "ASSET", "parentId": "uuid?", "isGroup": false }
```

