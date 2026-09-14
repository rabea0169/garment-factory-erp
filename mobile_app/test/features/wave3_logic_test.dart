import 'package:flutter_test/flutter_test.dart';

import 'package:garment_factory_erp/features/financial_reports/presentation/cubit/party_statement_cubit.dart';
import 'package:garment_factory_erp/features/system/presentation/cubit/audit_logs_cubit.dart';
import 'package:garment_factory_erp/features/system/presentation/widgets/export_buttons.dart';

StatementMovement _m(int day) => StatementMovement(
      date: DateTime(2026, 9, day),
      type: 'INVOICE',
      ref: 'INV-$day',
      description: 'بيع',
      debit: 100,
      credit: 0,
      balanceAfter: 100.0 * day,
    );

/// SELIM-ERP W3 — اختبارات المنطق الصرف للموجة الثالثة:
/// تجزئة صفحات كشف الحساب + ترقيم سجل التدقيق + أدوار التصدير.
void main() {
  group('chunkStatementRows', () {
    test('فارغ → صفحة واحدة فارغة (PDF بلا حركات)', () {
      expect(chunkStatementRows([]).length, 1);
      expect(chunkStatementRows([]).single, isEmpty);
    });

    test('أقل من صفحة → صفحة واحدة', () {
      final pages = chunkStatementRows(List.generate(10, _m));
      expect(pages.length, 1);
      expect(pages.single.length, 10);
    });

    test('24 صفًا بالضبط → صفحة واحدة (الحد الآمن)', () {
      expect(chunkStatementRows(List.generate(24, _m)).length, 1);
    });

    test('25 صفًا → صفحتان (24 + 1)', () {
      final pages = chunkStatementRows(List.generate(25, _m));
      expect(pages.length, 2);
      expect(pages.first.length, 24);
      expect(pages.last.length, 1);
    });

    test('يحافظ على ترتيب الحركات عبر الصفحات', () {
      final rows = List.generate(50, (i) => _m(i + 1));
      final pages = chunkStatementRows(rows);
      expect(pages.first.first.ref, 'INV-1');
      expect(pages.last.last.ref, 'INV-50');
    });

    test('rowsPerPage غير صالح يرجع للافتراضي 24', () {
      expect(chunkStatementRows(List.generate(3, _m), rowsPerPage: 0).length, 1);
    });
  });

  group('AuditLogsPage', () {
    const page1 = AuditLogsPage(
      logs: [],
      total: 120,
      pageNumber: 1,
      pageSize: 50,
    );
    const page3 = AuditLogsPage(
      logs: [],
      total: 120,
      pageNumber: 3,
      pageSize: 50,
    );

    test('hasMore: صفحة×حجم < الإجمالي (الخطأ القديم: طول الصفحة < الإجمالي)', () {
      // 1×50 < 120 → تالي متاح.
      expect(page1.hasMore, isTrue);
      // 3×50 = 150 ≥ 120 → الأخيرة — الزر يتعطل (كان يبقى مفعّلًا).
      expect(page3.hasMore, isFalse);
    });

    test('cumulative: العدّاد التراكمي للعرض', () {
      const with20 = AuditLogsPage(
        logs: [],
        total: 120,
        pageNumber: 2,
        pageSize: 50,
      );
      // الصفحة 2 بلا صفوف (فارغة): (2-1)*50 + 0 = 50.
      expect(with20.cumulative, 50);
      expect(page3.cumulative, 100);
    });
  });

  group('canExportEntity (مرآة ENTITY_ROLES الخادمية)', () {
    test('SUPER_ADMIN يرى كل الكيانات', () {
      for (final entity in kExportEntityRoles.keys) {
        expect(canExportEntity(entity, 'SUPER_ADMIN'), isTrue,
            reason: entity);
      }
    });

    test('محاسب: مصاريف/مبيعات/عملاء/موردون/مشتريات — لا عمال/مخزون', () {
      expect(canExportEntity('expenses', 'ACCOUNTANT'), isTrue);
      expect(canExportEntity('sales', 'ACCOUNTANT'), isTrue);
      expect(canExportEntity('customers', 'ACCOUNTANT'), isTrue);
      expect(canExportEntity('purchases', 'ACCOUNTANT'), isTrue);
      expect(canExportEntity('workers', 'ACCOUNTANT'), isFalse);
      expect(canExportEntity('inventory', 'ACCOUNTANT'), isFalse);
    });

    test('مسؤول موارد بشرية: العمال فقط', () {
      expect(canExportEntity('workers', 'HR_MANAGER'), isTrue);
      expect(canExportEntity('products', 'HR_MANAGER'), isFalse);
    });

    test('VIEWER ودور مجهول لا يريان شيئًا — وكيان غير معروف يُرفض', () {
      expect(canExportEntity('sales', 'VIEWER'), isFalse);
      expect(canExportEntity('sales', null), isFalse);
      expect(canExportEntity('unknown', 'SUPER_ADMIN'), isFalse);
    });
  });
}
