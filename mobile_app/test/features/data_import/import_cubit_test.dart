import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:garment_factory_erp/features/data_import/presentation/cubit/import_cubit.dart';

/// ImportCubit — عقود استجابات وحدة /import الخادمية الحرفية:
///  - GET /import/entities → مصفوفة {type,title,columns,uniqueKeys}.
///  - POST /import/preview (FormData {file, entity} + ?entity=) →
///    {entityType, headers, unmappedHeaders, missingRequiredColumns,
///     rows:[{row,data,valid,errors}], validCount, invalidCount}.
///  - POST /import/commit (JSON {entityType, rows} + Idempotency-Key) →
///    {entityType, total, created, skipped, results}.
/// Dio وهمي عبر اعتراض (نمط expenses_cubit_test) — بلا شبكة.
void main() {
  // ملف CSV مؤقت حقيقي — MultipartFile.fromFile يقرأه فعليًا.
  late Directory tempDir;
  late String csvPath;

  setUpAll(() async {
    tempDir = await Directory.systemTemp.createTemp('gf_import_test_');
    csvPath =
        '${tempDir.path}${Platform.pathSeparator}products.csv';
    await File(csvPath).writeAsString('code,name,price\nP-001,قميص,150\n');
  });

  tearDownAll(() async {
    await tempDir.delete(recursive: true);
  });

  const entities = <Map<String, dynamic>>[
    {
      'type': 'product',
      'title': 'منتجات',
      'columns': [
        {
          'key': 'code',
          'header': 'الكود',
          'required': true,
          'type': 'text',
          'hint': 'كود المنتج الفريد',
        },
        {
          'key': 'name',
          'header': 'الاسم',
          'required': true,
          'type': 'text',
        },
        {'key': 'price', 'header': 'السعر', 'required': false, 'type': 'number'},
      ],
      'uniqueKeys': ['code'],
    },
    {
      'type': 'customer',
      'title': 'عملاء',
      'columns': [
        {'key': 'name', 'header': 'الاسم', 'required': true, 'type': 'text'},
        {'key': 'phone', 'header': 'الهاتف', 'required': false, 'type': 'text'},
      ],
      'uniqueKeys': ['phone'],
    },
  ];

  /// معاينة بصفين صالحين وصف فاسد — الصف الفاسد بلا كود (خطأ إلزامي).
  Map<String, dynamic> previewPayload({List<String> missing = const []}) =>
      <String, dynamic>{
        'entityType': 'product',
        'headers': ['الكود', 'الاسم', 'السعر'],
        'unmappedHeaders': const ['ملاحظات'],
        'missingRequiredColumns': missing,
        'rows': [
          {
            'row': 1,
            'data': {'code': 'P-001', 'name': 'قميص قطن', 'price': '150'},
            'valid': true,
            'errors': const <Map<String, dynamic>>[],
          },
          {
            'row': 2,
            'data': {'code': 'P-002', 'name': 'بنطلون', 'price': '220'},
            'valid': true,
            'errors': const <Map<String, dynamic>>[],
          },
          {
            'row': 3,
            'data': {'code': '', 'name': 'بلا كود', 'price': '30'},
            'valid': false,
            'errors': [
              {
                'row': 3,
                'field': 'code',
                'message': 'الكود مطلوب ولا يمكن أن يكون فارغًا',
              },
            ],
          },
        ],
        'validCount': 2,
        'invalidCount': 1,
      };

  Object? respondFor(RequestOptions options) => switch (options.path) {
        '/import/entities' => entities,
        '/import/preview' => previewPayload(),
        '/import/commit' => const <String, dynamic>{
            'entityType': 'product',
            'total': 2,
            'created': 1,
            'skipped': 1,
            'results': [
              {'row': 1, 'status': 'CREATED', 'code': 'P-001', 'errors': []},
              {
                'row': 2,
                'status': 'SKIPPED',
                'code': 'P-002',
                'errors': [
                  {'row': 2, 'field': 'code', 'message': 'موجود مسبقًا'}
                ],
              },
            ],
          },
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

  group('loadEntities — الخطوة أ', () {
    test('النجاح: كيانات بأعمدتها ومفاتيحها الفريدة', () async {
      final requests = <RequestOptions>[];
      final cubit = ImportCubit(dio: stubDio(requests: requests));
      addTearDown(cubit.close);

      await cubit.loadEntities();

      final state = cubit.state;
      expect(state, isA<ImportEntitiesLoaded>());
      final loaded = state as ImportEntitiesLoaded;
      expect(loaded.entities.length, 2);

      final product = loaded.entities.first;
      expect(product.type, 'product');
      expect(product.title, 'منتجات');
      expect(product.columns.length, 3);
      expect(product.columns.first.key, 'code');
      expect(product.columns.first.header, 'الكود');
      expect(product.columns.first.isRequired, isTrue);
      expect(product.columns.first.type, 'text');
      expect(product.columns.first.hint, 'كود المنتج الفريد');
      expect(product.columns[2].isRequired, isFalse);
      expect(product.uniqueKeys, ['code']);
      expect(product.requiredColumnsCount, 2);

      expect(requests.single.method, 'GET');
      expect(requests.single.path, '/import/entities');
    });

    test('خطأ الشبكة: ImportError برسالة الاتصال', () async {
      final cubit = ImportCubit(
        dio: stubDio(
          rejectWith: (options) => DioException(
            requestOptions: options,
            type: DioExceptionType.connectionError,
          ),
        ),
      );
      addTearDown(cubit.close);

      await cubit.loadEntities();

      expect(cubit.state, isA<ImportError>());
      expect((cubit.state as ImportError).message, contains('الاتصال'));
    });
  });

  group('previewFile — الخطوة ج', () {
    test('النجاح: FormData بالملف والكيان + query entity', () async {
      final requests = <RequestOptions>[];
      final cubit = ImportCubit(dio: stubDio(requests: requests));
      addTearDown(cubit.close);

      await cubit.loadEntities();
      cubit.selectEntity(
          (cubit.state as ImportEntitiesLoaded).entities.first);
      await cubit.previewFile(
          filePath: csvPath, fileName: 'products.csv');

      final request = requests
          .firstWhere((request) => request.path == '/import/preview');
      expect(request.method, 'POST');
      // الكيان في الاستعلام (الخادم يقرأه من query) وفي الجسم معًا.
      expect(request.queryParameters['entity'], 'product');
      final formData = request.data as FormData;
      final fields = Map.fromEntries(
        formData.fields.map((entry) => MapEntry(entry.key, entry.value)),
      );
      expect(fields['entity'], 'product');
      expect(formData.files, hasLength(1));
      expect(formData.files.single.key, 'file');
      expect(formData.files.single.value.filename, 'products.csv');

      // الحالة: معاينة تفصل الصالح عن الفاسد.
      final state = cubit.state;
      expect(state, isA<ImportPreviewReady>());
      final preview = state as ImportPreviewReady;
      expect(preview.entityType, 'product');
      expect(preview.entityTitle, 'منتجات');
      expect(preview.fileName, 'products.csv');
      expect(preview.headers, ['الكود', 'الاسم', 'السعر']);
      expect(preview.unmappedHeaders, ['ملاحظات']);
      expect(preview.missingRequiredColumns, isEmpty);
      expect(preview.rows.length, 3);
      expect(preview.validCount, 2);
      expect(preview.invalidCount, 1);
      expect(preview.canImport, isTrue);

      final invalid = preview.rows[2];
      expect(invalid.valid, isFalse);
      expect(invalid.errors, hasLength(1));
      expect(invalid.errors.first.field, 'code');
      expect(invalid.errors.first.message, contains('مطلوب'));
    });

    test('أعمدة إلزامية مفقودة: canImport = false', () async {
      final cubit = ImportCubit(
        dio: stubDio(
          respondWith: (options) => options.path == '/import/preview'
              ? previewPayload(missing: const ['الكود'])
              : respondFor(options),
        ),
      );
      addTearDown(cubit.close);

      await cubit.loadEntities();
      cubit.selectEntity(
          (cubit.state as ImportEntitiesLoaded).entities.first);
      await cubit.previewFile(
          filePath: csvPath, fileName: 'products.csv');

      final preview = cubit.state as ImportPreviewReady;
      expect(preview.missingRequiredColumns, ['الكود']);
      expect(preview.canImport, isFalse);
    });

    test('بلا كيان مختار: لا طلب والحالة كما هي', () async {
      final requests = <RequestOptions>[];
      final cubit = ImportCubit(dio: stubDio(requests: requests));
      addTearDown(cubit.close);

      await cubit.previewFile(
          filePath: csvPath, fileName: 'products.csv');

      expect(cubit.state, isA<ImportInitial>());
      expect(requests, isEmpty);
    });
  });

  group('commitValidRows — الخطوة هـ', () {
    test('يرسل الصفوف الصالحة فقط كخرائط نصية مع Idempotency-Key (uuid v4)',
        () async {
      final requests = <RequestOptions>[];
      final cubit = ImportCubit(dio: stubDio(requests: requests));
      addTearDown(cubit.close);

      await cubit.loadEntities();
      cubit.selectEntity(
          (cubit.state as ImportEntitiesLoaded).entities.first);
      await cubit.previewFile(
          filePath: csvPath, fileName: 'products.csv');
      await cubit.commitValidRows();

      final request = requests
          .firstWhere((request) => request.path == '/import/commit');
      expect(request.method, 'POST');
      expect(request.headers['Idempotency-Key'], isNotNull);
      // uuid v4 حرفيًا (المقاطع والنسخة 4).
      expect(
        request.headers['Idempotency-Key'],
        matches(RegExp(
            r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')),
      );

      // الصفوف الصالحة فقط (الصف الفاسد رقم 3 مستبعد) وكل قيمة نص.
      final body = request.data as Map<String, dynamic>;
      expect(body['entityType'], 'product');
      final rows = body['rows'] as List;
      expect(rows, hasLength(2));
      expect(rows.first, isA<Map<String, String>>());
      expect(rows.first['code'], 'P-001');
      expect(rows.first['price'], '150');
      expect(
        rows.where((row) => (row as Map)['code'] == ''),
        isEmpty,
      );

      // ملخص النتيجة من الخادم.
      final state = cubit.state;
      expect(state, isA<ImportDone>());
      final summary = (state as ImportDone).summary;
      expect(summary.entityType, 'product');
      expect(summary.total, 2);
      expect(summary.created, 1);
      expect(summary.skipped, 1);
      expect(summary.results, hasLength(2));
      expect(summary.results.first['status'], 'CREATED');
      expect(summary.results.first['code'], 'P-001');
    });

    test('فشل الالتزام: ImportError دون فقدان المعاينة السابقة في الذاكرة',
        () async {
      final cubit = ImportCubit(
        dio: stubDio(
          rejectWith: (options) => options.path == '/import/commit'
              ? DioException(
                  requestOptions: options,
                  type: DioExceptionType.badResponse,
                  response: Response<Object>(
                    requestOptions: options,
                    statusCode: 400,
                    data: {'message': 'الملف يحت صفوفًا غير قابلة للإدراج'},
                  ),
                )
              : null,
        ),
      );
      addTearDown(cubit.close);

      await cubit.loadEntities();
      cubit.selectEntity(
          (cubit.state as ImportEntitiesLoaded).entities.first);
      await cubit.previewFile(
          filePath: csvPath, fileName: 'products.csv');
      await cubit.commitValidRows();

      expect(cubit.state, isA<ImportError>());
      expect((cubit.state as ImportError).message,
          'الملف يحت صفوفًا غير قابلة للإدراج');
    });

    test('بلا معاينة جاهزة: لا طلب', () async {
      final requests = <RequestOptions>[];
      final cubit = ImportCubit(dio: stubDio(requests: requests));
      addTearDown(cubit.close);

      await cubit.commitValidRows();

      expect(cubit.state, isA<ImportInitial>());
      expect(requests, isEmpty);
    });
  });

  group('reset — استيراد جديد', () {
    test('يمسح الكيان المختار ويعود للحالة الأولية', () async {
      final cubit = ImportCubit(dio: stubDio());
      addTearDown(cubit.close);

      await cubit.loadEntities();
      cubit.selectEntity(
          (cubit.state as ImportEntitiesLoaded).entities.first);
      cubit.reset();

      expect(cubit.state, isA<ImportInitial>());
      expect(cubit.selectedEntity, isNull);
    });
  });
}
