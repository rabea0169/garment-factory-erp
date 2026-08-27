import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:garment_factory_erp/core/contacts/contact_import_service.dart';
import 'package:garment_factory_erp/features/sales/presentation/cubit/sales_cubit.dart';
import 'package:garment_factory_erp/features/sales/presentation/screens/sales_screen.dart';

class _FakeSalesCubit extends SalesCubit {
  _FakeSalesCubit({this.onCreate});

  final Future<void> Function()? onCreate;
  int createCalls = 0;
  int orderCreateCalls = 0;

  @override
  Future<void> fetchOrders() async {
    emit(SalesLoaded(const []));
  }

  @override
  Future<List<Map<String, dynamic>>> fetchCustomers() async => [
        {'id': 'customer-1', 'name': 'مصنع النور'},
      ];

  @override
  Future<List<Map<String, dynamic>>> fetchProducts() async => [
        {
          'id': 'product-1',
          'name': 'تيشيرت',
          'retailPrice': 100,
          'variants': [
            {'id': 'variant-1', 'size': 'L', 'color': 'أبيض'},
          ],
        },
      ];

  @override
  Future<void> createSalesOrder({
    required String customerId,
    required String paymentType,
    required double discount,
    required List<Map<String, dynamic>> items,
  }) async {
    orderCreateCalls++;
  }

  @override
  Future<void> createCustomer({
    required String name,
    String? phone,
    String? email,
    String? address,
  }) async {
    createCalls++;
    await onCreate?.call();
  }
}

class _FakeContactImportService extends ContactImportService {
  _FakeContactImportService(this.result);

  final ImportedContactData result;

  @override
  Future<ImportedContactData?> pickContact() async => result;
}

Future<void> _pumpSalesScreen(
  WidgetTester tester, {
  required _FakeSalesCubit cubit,
  ContactImportService? contactImportService,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      home: SalesScreen(
        cubit: cubit,
        contactImportService: contactImportService,
      ),
    ),
  );
  await tester.pump();
}

Future<void> _openCustomerDialog(WidgetTester tester) async {
  await tester.tap(find.text('إضافة عميل'));
  await tester.pumpAndSettle();
  expect(find.text('إضافة عميل جديد'), findsOneWidget);
}

void main() {
  testWidgets('validates customer and product before creating an order',
      (tester) async {
    final cubit = _FakeSalesCubit();
    await _pumpSalesScreen(tester, cubit: cubit);

    await tester.tap(find.text('أمر بيع جديد'));
    await tester.pumpAndSettle();
    expect(find.text('إنشاء أمر بيع جديد'), findsOneWidget);

    await tester.tap(find.text('حفظ'));
    await tester.pump();

    expect(find.text('اختر العميل'), findsOneWidget);
    expect(find.text('اختر المنتج'), findsOneWidget);
    expect(cubit.orderCreateCalls, 0);
  });

  testWidgets('requires a customer name before submitting', (tester) async {
    final cubit = _FakeSalesCubit();
    await _pumpSalesScreen(tester, cubit: cubit);
    await _openCustomerDialog(tester);

    await tester.tap(find.text('حفظ'));
    await tester.pump();

    expect(find.text('اسم العميل مطلوب'), findsOneWidget);
    expect(cubit.createCalls, 0);
  });

  testWidgets('disables save while the customer request is pending',
      (tester) async {
    final request = Completer<void>();
    final cubit = _FakeSalesCubit(onCreate: () => request.future);
    await _pumpSalesScreen(tester, cubit: cubit);
    await _openCustomerDialog(tester);

    await tester.enterText(find.byType(TextFormField).first, 'مصنع النور');
    await tester.tap(find.text('حفظ'));
    await tester.pump();

    expect(find.text('جاري الحفظ...'), findsOneWidget);
    final saveButton = tester.widget<FilledButton>(find.byType(FilledButton));
    expect(saveButton.onPressed, isNull);

    request.complete();
    await tester.pumpAndSettle();
    expect(find.text('إضافة عميل جديد'), findsNothing);
  });

  testWidgets('keeps the dialog open and explains API failure', (tester) async {
    final cubit = _FakeSalesCubit(
      onCreate: () async => throw StateError('request failed'),
    );
    await _pumpSalesScreen(tester, cubit: cubit);
    await _openCustomerDialog(tester);

    await tester.enterText(find.byType(TextFormField).first, 'مصنع النور');
    await tester.tap(find.text('حفظ'));
    await tester.pumpAndSettle();

    expect(find.text('إضافة عميل جديد'), findsOneWidget);
    expect(
      find.text(
          'تعذر حفظ العميل. تحقق من الصلاحيات والاتصال ثم حاول مرة أخرى.'),
      findsOneWidget,
    );
    expect(cubit.createCalls, 1);
  });

  testWidgets('fills customer fields from an imported contact', (tester) async {
    final cubit = _FakeSalesCubit();
    final contactService = _FakeContactImportService(
      const ImportedContactData(
        name: 'مصنع النور',
        phone: '+201001234567',
        email: 'sales@example.com',
        address: 'القاهرة',
      ),
    );
    await _pumpSalesScreen(
      tester,
      cubit: cubit,
      contactImportService: contactService,
    );
    await _openCustomerDialog(tester);

    await tester.tap(find.text('استيراد من جهات الاتصال'));
    await tester.pump();
    expect(find.text('مراجعة بيانات جهة الاتصال'), findsOneWidget);
    await tester.tap(find.text('استخدام البيانات'));
    await tester.pumpAndSettle();

    final fields = tester.widgetList<TextFormField>(find.byType(TextFormField));
    expect(fields.elementAt(0).controller?.text, 'مصنع النور');
    expect(fields.elementAt(1).controller?.text, '+201001234567');
    expect(fields.elementAt(2).controller?.text, 'sales@example.com');
    expect(fields.elementAt(3).controller?.text, 'القاهرة');
  });
}
