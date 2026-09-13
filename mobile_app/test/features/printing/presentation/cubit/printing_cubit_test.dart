import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:garment_factory_erp/features/printing/presentation/cubit/printing_cubit.dart';

/// PrintingCubit — عقود استجابات وحدة الطباعة:
///  - fetchTemplates: GET /printing/templates {items, total} بترقيم
///    الخادم الثابت (20/صفحة) — لا يرسل التطبيق limit هنا (عقد الوحدة).
///  - fetchLog: GET /printing/log {items, total} بحد 100.
///  - seed: POST /templates/seed idempotent يعيد {created, existing,
///    totalPairs} — عدد المنشأ يظهر في رسالة النجاح.
///  - setDefault: PATCH {isDefault: true} — الافتراضي الواحد لكل زوج
///    (مستند × ورق) يُفرض خادميًا.
/// Dio وهمي عبر اعتراض (نمط accounting_cubit_test) — بلا شبكة.
void main() {
  Map<String, dynamic> paginated(List<Map<String, dynamic>> items) =>
      <String, dynamic>{
        'items': items,
        'total': items.length,
        'page': 1,
        'limit': 20,
        'pages': 1,
      };

  const Map<String, dynamic> template = {
    'id': 'template-1',
    'name': 'فاتورة مبيعات — A4',
    'documentType': 'INVOICE',
    'paperSize': 'A4',
    'isDefault': false,
    'isActive': true,
    'config': {
      'styles': {'fontName': 'Cairo', 'fontSize': 12, 'direction': 'rtl'},
      'sections': ['header', 'items_table', 'totals', 'notes', 'footer'],
    },
    'createdAt': '2026-09-01T08:00:00.000Z',
  };

  final Map<String, dynamic> defaultTemplate = {
    ...template,
    'isDefault': true,
  };

  const Map<String, dynamic> logEntry = {
    'id': 'log-1',
    'userId': 'user-1',
    'userName': 'أمين الصندوق',
    'documentType': 'INVOICE',
    'documentId': 'sales-order-1',
    'documentNumber': 'INV-2026-0007',
    'templateId': 'template-1',
    'templateName': 'فاتورة مبيعات — A4',
    'channel': 'app_pdf',
    'paperSize': 'A4',
    'copies': 2,
    'isReprint': true,
    'createdAt': '2026-09-10T11:30:00.000Z',
  };

  Object? respondFor(RequestOptions options) => switch (options.path) {
        '/printing/templates' => paginated(const [template]),
        '/printing/templates/seed' => {
            'created': 32,
            'existing': 8,
            'totalPairs': 40,
          },
        '/printing/templates/template-1' => defaultTemplate,
        '/printing/log' => paginated(const [logEntry]),
        _ => throw StateError('طلب غير متوقع: ${options.path}'),
      };

  Dio stubDio({
    List<RequestOptions>? requests,
    Object? Function(RequestOptions)? respondWith,
    DioException? Function(RequestOptions)? rejectWith,
  }) {
    final instance = Dio(BaseOptions(baseUrl: 'https://erp.test'));
    instance.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) {
          requests?.add(options);
          final rejection = rejectWith?.call(options);
          if (rejection != null) {
            handler.reject(rejection, true);
            return;
          }
          handler.resolve(
            Response<Object>(
              requestOptions: options,
              statusCode: 200,
              data: (respondWith ?? respondFor).call(options),
            ),
          );
        },
      ),
    );
    return instance;
  }

  group('fetchTemplates — قوالب الطباعة', () {
    test('النجاح: القائمة بلا limit (ترقيم الخادم الثابت) ومرشح المستند',
        () async {
      final requests = <RequestOptions>[];
      final cubit = PrintingCubit(dio: stubDio(requests: requests));
      addTearDown(cubit.close);

      await cubit.fetchTemplates();

      final state = cubit.state;
      expect(state, isA<PrintingLoaded>());
      final loaded = state as PrintingLoaded;
      expect(loaded.templates.length, 1);
      expect(loaded.templates.first['name'], 'فاتورة مبيعات — A4');
      expect(loaded.templatesTotal, 1);

      // عقد الوحدة: الخادم يرقّم بـ 20/صفحة ثابتة — لا limit من العميل.
      expect(requests.single.path, '/printing/templates');
      expect(requests.single.queryParameters['limit'], isNull);
      expect(requests.single.queryParameters['documentType'], isNull);

      // مرشح نوع المستند يُرسل (والكل يعني بلا مرشح).
      await cubit.fetchTemplates(documentType: 'INVOICE');
      expect(requests.last.queryParameters['documentType'], 'INVOICE');
      await cubit.fetchTemplates(documentType: 'ALL');
      expect(requests.last.queryParameters['documentType'], isNull);
    });

    test('فشل القوالب: PrintingError', () async {
      final cubit = PrintingCubit(
        dio: stubDio(
          rejectWith: (options) => options.path == '/printing/templates'
              ? DioException(
                  requestOptions: options,
                  type: DioExceptionType.badResponse,
                  response: Response<Object>(
                    requestOptions: options,
                    statusCode: 403,
                    data: {'message': 'ليس لديك صلاحية'},
                  ),
                )
              : null,
        ),
      );
      addTearDown(cubit.close);

      await cubit.fetchTemplates();

      expect(cubit.state, isA<PrintingError>());
      expect((cubit.state as PrintingError).message, contains('صلاحية'));
    });
  });

  group('fetchLog — سجل الطباعة (تدقيق)', () {
    test('النجاح: السجل بحد 100 دون مساس القوالب', () async {
      final requests = <RequestOptions>[];
      final cubit = PrintingCubit(dio: stubDio(requests: requests));
      addTearDown(cubit.close);

      await cubit.fetchTemplates();
      await cubit.fetchLog();

      final loaded = cubit.state as PrintingLoaded;
      expect(loaded.logEntries.length, 1);
      expect(loaded.logEntries.first['documentNumber'], 'INV-2026-0007');
      expect(loaded.logEntries.first['isReprint'], isTrue);
      expect(loaded.logTotal, 1);
      // تبويب القوالب لم يُمس.
      expect(loaded.templates.length, 1);

      final logRequest =
          requests.firstWhere((r) => r.path == '/printing/log');
      expect(logRequest.queryParameters['limit'], 100);
    });

    test('فشل السجل: صامت — القوالب تبقى محمّلة', () async {
      final cubit = PrintingCubit(
        dio: stubDio(
          rejectWith: (options) => options.path == '/printing/log'
              ? DioException(
                  requestOptions: options,
                  type: DioExceptionType.connectionError,
                )
              : null,
        ),
      );
      addTearDown(cubit.close);

      await cubit.fetchTemplates();
      await cubit.fetchLog();

      final loaded = cubit.state as PrintingLoaded;
      expect(loaded.logEntries, isEmpty);
      expect(loaded.templates.length, 1);
    });
  });

  group('seed — تهيئة القوالب العربية', () {
    test('النجاح: يعيد عدد القوالب المنشأة من الاستجابة', () async {
      final requests = <RequestOptions>[];
      final cubit = PrintingCubit(dio: stubDio(requests: requests));
      addTearDown(cubit.close);

      final created = await cubit.seed();

      expect(created, 32);
      expect(cubit.lastActionError, isNull);
      final post = requests.single;
      expect(post.method, 'POST');
      expect(post.path, '/printing/templates/seed');
    });

    test('الفشل: null مع رسالة الخادم', () async {
      final cubit = PrintingCubit(
        dio: stubDio(
          rejectWith: (options) => options.path == '/printing/templates/seed'
              ? DioException(
                  requestOptions: options,
                  type: DioExceptionType.badResponse,
                  response: Response<Object>(
                    requestOptions: options,
                    statusCode: 403,
                    data: {'message': 'ليس لديك صلاحية'},
                  ),
                )
              : null,
        ),
      );
      addTearDown(cubit.close);

      final created = await cubit.seed();

      expect(created, isNull);
      expect(cubit.lastActionError, contains('صلاحية'));
    });
  });

  group('setDefault / deleteTemplate — إجراءات القوالب', () {
    test('تعيين افتراضي: PATCH {isDefault: true} ثم إعادة الجلب', () async {
      final requests = <RequestOptions>[];
      final cubit = PrintingCubit(dio: stubDio(requests: requests));
      addTearDown(cubit.close);

      final ok = await cubit.setDefault('template-1');

      expect(ok, isTrue);
      final patch = requests.first;
      expect(patch.method, 'PATCH');
      expect(patch.path, '/printing/templates/template-1');
      expect(patch.data['isDefault'], isTrue);
      // إعادة الجلب بعد التعيين.
      expect(
        requests.map((r) => r.path),
        contains('/printing/templates'),
      );
      expect(cubit.state, isA<PrintingLoaded>());
    });

    test('حذف ناعم: DELETE ثم إعادة الجلب', () async {
      final requests = <RequestOptions>[];
      final cubit = PrintingCubit(dio: stubDio(requests: requests));
      addTearDown(cubit.close);

      final ok = await cubit.deleteTemplate('template-1');

      expect(ok, isTrue);
      final delete = requests.first;
      expect(delete.method, 'DELETE');
      expect(delete.path, '/printing/templates/template-1');
      expect(cubit.state, isA<PrintingLoaded>());
    });
  });

  group('createTemplate — إنشاء قالب', () {
    test('النجاح: POST بالحمولة ثم إعادة الجلب', () async {
      final requests = <RequestOptions>[];
      final cubit = PrintingCubit(dio: stubDio(requests: requests));
      addTearDown(cubit.close);

      final ok = await cubit.createTemplate(
        name: 'فاتورة رسمية',
        documentType: 'INVOICE',
        paperSize: 'A4',
        isDefault: true,
      );

      expect(ok, isTrue);
      final post = requests.first;
      expect(post.method, 'POST');
      expect(post.path, '/printing/templates');
      expect(post.data['name'], 'فاتورة رسمية');
      expect(post.data['documentType'], 'INVOICE');
      expect(post.data['paperSize'], 'A4');
      expect(post.data['isDefault'], isTrue);
      expect(cubit.state, isA<PrintingLoaded>());
    });
  });
}
