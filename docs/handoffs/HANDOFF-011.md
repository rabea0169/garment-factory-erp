# HANDOFF-011: المبيعات - منع البيع فوق المتاح وحساب الإجماليات خادميًا (GF-0011)

## 1. الملخص
تم بناء موديول المبيعات (`SalesModule`) لضمان تسعير المنتجات وحساب إجماليات أمر البيع من جهة الخادم (Server-side) فقط دون الاعتماد على مدخلات العميل. كما تم تفعيل آلية `confirmOrder` للتأكد من توفر رصيد كافٍ من المنتج التام قبل الخصم وإضافة حركة دفتر الأستاذ (`StockLedgerEntry`) داخل `Prisma.$transaction` ذرية.

## 2. ما تم إنجازه
- **قاعدة البيانات (`schema.prisma`)**:
  - إضافة Enum `SalesOrderStatus` (DRAFT, CONFIRMED, SHIPPED, CANCELLED).
  - إضافة حقل `status` لنموذج `SalesOrder` بالوضع الافتراضي `DRAFT`.
  - تطبيق الـ Migration رقم `gf_0011_sales_status`.
- **מודيول المبيعات (`SalesModule`)**:
  - تحديث الـ DTO `CreateSalesOrderItemDto` لحذف `unitPrice`.
  - **`createSalesOrder`**: قراءة السعر `retailPrice` مباشرة من `ProductVariant` وتوليد الفاتورة كمسودة.
  - **`confirmOrder`**: فحص توفر كمية `FinishedGood`، خصم الكمية، كتابة `StockLedgerEntry` كـ `ISSUE`، كل هذا بتحديث ذري لتأكيد البيع ومنع البيع فوق المتاح.
- **التكامل**:
  - استيراد `InventoryModule` واستخدام `InventoryService` إذا لزم، رغم أن صرف التام يُدار يدوياً داخل المعاملة في المبيعات الآن بناءً على قرار عدم ربط التام بـ `InventoryService` حتى الآن.
- **الاختبارات**:
  - تحديث وتجاوز Unit Tests الخاصة بـ `SalesService` و `SalesController`.
  - اجتياز `test:e2e` الكامل للمشروع (36 اختبار).

## 3. الخطوات القادمة
حسب `MASTER_BACKLOG.md`، المهمة التالية المتبقية في Phase 3 (الأساس) هي:
- **GF-0012**: التصفح المقسّم (Pagination) لكل القوائم (وضع حدود افتراضية مع استجابة مخصصة).
