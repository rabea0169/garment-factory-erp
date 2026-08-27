import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:garment_factory_erp/core/contacts/contact_import_service.dart';
import 'package:garment_factory_erp/features/hr/presentation/cubit/hr_cubit.dart';
import 'package:garment_factory_erp/features/hr/presentation/widgets/create_worker_dialog.dart';

class _FakeHrCubit extends HrCubit {
  int createCalls = 0;

  @override
  Future<void> createWorker({
    required String name,
    String? phone,
    String? nationalId,
    required String specialty,
    double? pieceRate,
    DateTime? hireDate,
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

Future<void> _pumpDialog(
  WidgetTester tester, {
  required _FakeHrCubit cubit,
  ContactImportService? contactImportService,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: CreateWorkerDialog(
          cubit: cubit,
          contactImportService: contactImportService,
        ),
      ),
    ),
  );
  await tester.pump();
}

void main() {
  testWidgets('requires a worker name', (tester) async {
    final cubit = _FakeHrCubit();
    await _pumpDialog(tester, cubit: cubit);

    await tester.tap(find.text('حفظ'));
    await tester.pump();

    expect(find.text('اسم العامل مطلوب'), findsOneWidget);
    expect(cubit.createCalls, 0);
  });

  testWidgets('fills worker name and phone from a contact', (tester) async {
    final cubit = _FakeHrCubit();
    await _pumpDialog(
      tester,
      cubit: cubit,
      contactImportService: _FakeContactService(
        const ImportedContactData(
          name: 'أحمد محمود',
          phone: '+201001234567',
          email: '',
        ),
      ),
    );

    await tester.tap(find.text('استيراد من جهات الاتصال'));
    await tester.pump();
    expect(find.text('مراجعة بيانات جهة الاتصال'), findsOneWidget);
    await tester.tap(find.text('استخدام البيانات'));
    await tester.pumpAndSettle();

    final fields = tester.widgetList<TextFormField>(find.byType(TextFormField));
    expect(fields.elementAt(0).controller?.text, 'أحمد محمود');
    expect(fields.elementAt(1).controller?.text, '+201001234567');
  });
}
