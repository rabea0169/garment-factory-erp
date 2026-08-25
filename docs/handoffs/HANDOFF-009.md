# HANDOFF-009: المشتريات والمرتجعات وتحديث التكلفة (GF-0009)

## 1. الملخص
تم بناء موديول المشتريات `PurchasingModule` وفقاً لخطة Domain Foundation الصارمة، بحيث يدير دورة حياة أمر الشراء (Purchase Order) وحالاته، ولا يؤثر في أرصدة المخازن إلا عند تحوله لحالة `RECEIVED`. تم تنفيذ ذلك باستخدام المعاملات המوحدة (`$transaction`) لضمان تكامل القيود المخزنية وتحديث التكلفة المرجحة (Weighted Average Cost) بشكل سليم. كما تم إضافة مسار المرتجعات.

## 2. ما تم إنجازه
- **قاعدة البيانات (`schema.prisma`)**:
  - إضافة Enum `PurchaseOrderStatus` (`DRAFT`, `PENDING`, `RECEIVED`, `CANCELLED`).
  - إضافة حقل `status` لنموذج `PurchaseOrder`.
  - تطبيق مايجريشن `20260825123352_gf_0009_purchasing_status`.
- **מודيول المشتريات (`PurchasingModule`)**:
  - `PurchasingService.createPurchaseOrder`: إنشاء مسودة أمر شراء بالخامات المطلوبة.
  - `PurchasingService.receiveOrder`: تحديث حالة أمر الشراء إلى `RECEIVED` وحقن `InventoryService.receive` داخل الـ Transaction لإضافة الخامات وتحديث السعر المتوسط بالاستعانة بالـ Stock Ledger.
  - `PurchasingService.returnToSupplier`: سحب الخامات من المخزن بناءً على الفاتورة كـ `RETURN`.
- **المتحكم (`PurchasingController`)**:
  - توفير endpoints للمشتريات تحت المسار `/purchasing` محميّة بصلاحيات `INVENTORY_MANAGER` و `GENERAL_MANAGER`.

## 3. حالة المشروع (الاختبارات)
- **Unit Tests**: تغطية كاملة لخدمة المشتريات والكنترولر باستخدام Prisma Mocks (نجاح جميع اختبارات التطبيق وعددها 121).
- **E2E Tests**: نجاح اختبارات E2E بعد تصحيح الاستيرادات وإضافة الموديول لـ AppModule.
- **Lint & TypeScript**: الأكواد نظيفة ولا توجد أخطاء نوعية `tsc --noEmit` أو مخالفات تنسيق (تم معالجة تحذيرات `any`).

## 4. الخطوات القادمة
المرحلة القادمة ستكون GF-0010 (أوامر البيع، الصرف والتسعير، المرتجعات) والتي ستتبع نفس النمط لضمان خروج البضاعة وتحديث دفتر الاستاذ بأمان عبر الـ `InventoryService`.
