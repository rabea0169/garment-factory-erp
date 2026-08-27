import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:garment_factory_erp/core/contacts/contact_import_service.dart';
import 'package:garment_factory_erp/features/suppliers/presentation/cubit/suppliers_cubit.dart';
import 'package:garment_factory_erp/features/suppliers/presentation/screens/suppliers_screen.dart';

class _FakeSuppliersCubit extends SuppliersCubit {
  _FakeSuppliersCubit() {
    emit(SuppliersLoaded(const []));
  }

  int createCalls = 0;

  @override
  Future<void> createSupplier({
    required String name,
    String? phone,
    String? email,
    String? address,
    String? notes,
  }) async {
    createCalls++;
  }
}

class _FakeContactService extends ContactImportService {
  _FakeContactService(this.data);

  final ImportedContactData data;

  @override
  Future<ImportedContactData?> pickContact() async => data;
}

Future<void> _pumpScreen(
  WidgetTester tester, {
  required _FakeSuppliersCubit cubit,
  ContactImportService? contactImportService,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      home: SuppliersScreen(
        cubit: cubit,
        contactImportService: contactImportService,
      ),
    ),
  );
  await tester.pump();
}

void main() {
  testWidgets('opens supplier form and validates required name',
      (tester) async {
    final cubit = _FakeSuppliersCubit();
    await _pumpScreen(tester, cubit: cubit);

    await tester.tap(find.text('إضافة مورد'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('حفظ'));
    await tester.pump();

    expect(find.text('اسم المورد مطلوب'), findsOneWidget);
    expect(cubit.createCalls, 0);
  });

  testWidgets('fills supplier fields from a contact', (tester) async {
    final cubit = _FakeSuppliersCubit();
    await _pumpScreen(
      tester,
      cubit: cubit,
      contactImportService: _FakeContactService(
        const ImportedContactData(
          name: 'شركة النسيج',
          phone: '+201001234567',
          email: 'supplier@example.com',
          address: 'القاهرة',
        ),
      ),
    );

    await tester.tap(find.text('إضافة مورد'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('استيراد من جهات الاتصال'));
    await tester.pump();
    expect(find.text('مراجعة بيانات جهة الاتصال'), findsOneWidget);
    await tester.tap(find.text('استخدام البيانات'));
    await tester.pumpAndSettle();

    final fields = tester.widgetList<TextFormField>(find.byType(TextFormField));
    expect(fields.elementAt(0).controller?.text, 'شركة النسيج');
    expect(fields.elementAt(1).controller?.text, '+201001234567');
    expect(fields.elementAt(2).controller?.text, 'supplier@example.com');
    expect(fields.elementAt(3).controller?.text, 'القاهرة');
  });
}
