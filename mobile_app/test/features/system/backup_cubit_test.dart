import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:cross_file/cross_file.dart';
import 'package:dio/dio.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hive/hive.dart';
import 'package:plugin_platform_interface/plugin_platform_interface.dart';

import 'package:garment_factory_erp/core/widgets/selim/format.dart';
import 'package:garment_factory_erp/features/auth/presentation/cubit/auth_cubit.dart';
import 'package:garment_factory_erp/features/system/presentation/cubit/backup_cubit.dart';
import 'package:garment_factory_erp/features/system/presentation/screens/backup_screen.dart';

/// BackupCubit + شاشة النسخ الاحتياطي — عقود /system الحرفية:
///  - GET /system/backup/summary → {tables, totalRows, counts, formatVersion}.
///  - GET /system/backup → {meta:{exportedAt,totalRows,counts}, data:{}} —
///    يُحفظ في ملف JSON داخل مجلد مستندات (مجلد مؤقت هنا).
///  - POST /system/restore (FormData {file, confirm}) →
///    {restored, tables, totalRows}.
/// تاريخ آخر نسخة يُخزن في Hive (gf_settings / last_backup_at).
/// Dio وهمي عبر اعتراض (نمط expenses_cubit_test) — بلا شبكة، وHive حقيقي
/// في مجلد مؤقت (نمط cache_service_test).
void main() {
  late Directory tempDir;

  setUpAll(() async {
    tempDir = await Directory.systemTemp.createTemp('gf_backup_test_');
    Hive.init(tempDir.path);
  });

  tearDownAll(() async {
    await Hive.close();
    await tempDir.delete(recursive: true);
  });

  setUp(() async {
    // عزل بين الاختبارات: تفريغ صندوق الإعدادات إن كان مفتوحًا.
    if (Hive.isBoxOpen(BackupCubit.settingsBoxName)) {
      await Hive.box(BackupCubit.settingsBoxName).clear();
    }
  });

  const summaryPayload = <String, dynamic>{
    'tables': 51,
    'totalRows': 1200,
    'counts': {'users': 3, 'customers': 42, 'products': 200},
    'formatVersion': 2,
  };

  Map<String, dynamic> backupPayload() => <String, dynamic>{
        'meta': {
          'exportedAt': '2026-09-20T10:30:00.000Z',
          'totalRows': 1200,
          'counts': {'users': 3, 'customers': 42, 'products': 200},
        },
        'data': {
          'users': [
            {'id': 'u-1', 'username': 'admin'},
          ],
          'customers': [
            {'id': 'c-1', 'name': 'مصنع النيل'},
          ],
        },
      };

  Object? respondFor(RequestOptions options) => switch (options.path) {
        '/system/backup/summary' => summaryPayload,
        '/system/backup' => backupPayload(),
        '/system/restore' => const <String, dynamic>{
            'restored': true,
            'tables': 51,
            'totalRows': 1200,
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

  /// ملف نسخة احتياطية حقيقي في المجلد المؤقت — MultipartFile يقرأه فعليًا.
  File restoreFile() {
    final file = File(
      '${tempDir.path}${Platform.pathSeparator}backup-2026.json',
    );
    return file..writeAsStringSync(jsonEncode(backupPayload()));
  }

  group('loadSummary — بطاقة الإحصائيات', () {
    test('النجاح: الجداول والصفوف والعدادات وآخر نسخة null أولًا', () async {
      final requests = <RequestOptions>[];
      final cubit = BackupCubit(
        dio: stubDio(requests: requests),
        documentsDirectory: () async => tempDir,
      );
      addTearDown(cubit.close);

      await cubit.loadSummary();

      final state = cubit.state;
      expect(state, isA<BackupSummaryLoaded>());
      final loaded = state as BackupSummaryLoaded;
      expect(loaded.summary.tables, 51);
      expect(loaded.summary.totalRows, 1200);
      expect(loaded.summary.formatVersion, 2);
      expect(loaded.summary.counts['customers'], 42);
      // لم تُنشأ نسخة بعد → لا تاريخ.
      expect(loaded.lastBackupAt, isNull);

      expect(requests.single.method, 'GET');
      expect(requests.single.path, '/system/backup/summary');
    });

    test('خطأ الشبكة: BackupError برسالة الاتصال', () async {
      final cubit = BackupCubit(
        dio: stubDio(
          rejectWith: (options) => DioException(
            requestOptions: options,
            type: DioExceptionType.connectionError,
          ),
        ),
        documentsDirectory: () async => tempDir,
      );
      addTearDown(cubit.close);

      await cubit.loadSummary();

      expect(cubit.state, isA<BackupError>());
      expect((cubit.state as BackupError).message, contains('الاتصال'));
    });
  });

  group('createBackup — إنشاء النسخة وحفظها', () {
    test('يحفظ الحمولة كاملة في ملف بالاسم الصحيح ويختم تاريخ آخر نسخة',
        () async {
      final requests = <RequestOptions>[];
      final cubit = BackupCubit(
        dio: stubDio(requests: requests),
        documentsDirectory: () async => tempDir,
      );
      addTearDown(cubit.close);

      await cubit.createBackup();

      final state = cubit.state;
      expect(state, isA<BackupCreated>());
      final created = state as BackupCreated;

      // المسار: garment-erp-backup-<yyyyMMdd-HHmmss>.json في مجلد المستندات.
      expect(created.filePath,
          contains('garment-erp-backup-'));
      expect(
        created.filePath.split(Platform.pathSeparator).last,
        matches(RegExp(r'^garment-erp-backup-\d{8}-\d{6}\.json$')),
      );
      expect(created.filePath.startsWith(tempDir.path), isTrue);

      // الملف موجود ومحتواه = حمولة الخادم كما هي (بعد decode).
      final saved = File(created.filePath);
      expect(await saved.exists(), isTrue);
      final decoded = jsonDecode(await saved.readAsString());
      expect(decoded, backupPayload());

      // الحجم المسجل = الحجم الفعلي على القرص.
      expect(created.sizeBytes, await saved.length());
      expect(created.sizeBytes, greaterThan(0));

      // Hive: ختم لحظة النسخ باسم الملف الصحيح.
      final box = await Hive.openBox(BackupCubit.settingsBoxName);
      final stamped = box.get(BackupCubit.lastBackupAtKey);
      expect(stamped, isA<String>());
      final moment = DateTime.parse(stamped as String);
      expect(moment.difference(DateTime.now()).abs(),
          lessThan(const Duration(minutes: 1)));

      // إعادة فتح الشاشة لاحقًا تظهر تاريخ آخر نسخة.
      await cubit.loadSummary();
      final reloaded = cubit.state as BackupSummaryLoaded;
      expect(reloaded.lastBackupAt, isNotNull);

      // طلب واحد فقط لإنشاء النسخة (تنزيل JSON).
      expect(
        requests.where((request) => request.path == '/system/backup').length,
        1,
      );
    });

    test('رفض الخادم: BackupError مع بقاء الملخص مرفقًا', () async {
      final cubit = BackupCubit(
        dio: stubDio(
          rejectWith: (options) => options.path == '/system/backup'
              ? DioException(
                  requestOptions: options,
                  type: DioExceptionType.badResponse,
                  response: Response<Object>(
                    requestOptions: options,
                    statusCode: 403,
                    data: {'message': 'ليس لديك صلاحية لتنفيذ هذا الإجراء'},
                  ),
                )
              : null,
        ),
        documentsDirectory: () async => tempDir,
      );
      addTearDown(cubit.close);

      await cubit.loadSummary();
      await cubit.createBackup();

      final state = cubit.state;
      expect(state, isA<BackupError>());
      expect((state as BackupError).message, 'ليس لديك صلاحية لتنفيذ هذا الإجراء');
      expect(state.summary?.tables, 51);
    });
  });

  group('restore — الاستعادة', () {
    test('النجاح: FormData بالملف وconfirm ونتيجة الجداول والصفوف', () async {
      final requests = <RequestOptions>[];
      final cubit = BackupCubit(
        dio: stubDio(requests: requests),
        documentsDirectory: () async => tempDir,
      );
      addTearDown(cubit.close);

      final file = restoreFile();
      final ok = await cubit.restore(
        filePath: file.path,
        fileName: 'backup-2026.json',
        phrase: 'استعادة',
      );

      expect(ok, isTrue);
      final state = cubit.state;
      expect(state, isA<BackupRestored>());
      final restored = state as BackupRestored;
      expect(restored.restored, isTrue);
      expect(restored.tables, 51);
      expect(restored.totalRows, 1200);

      final request = requests.single;
      expect(request.method, 'POST');
      expect(request.path, '/system/restore');
      final formData = request.data as FormData;
      final fields = Map.fromEntries(
        formData.fields.map((entry) => MapEntry(entry.key, entry.value)),
      );
      expect(fields['confirm'], 'استعادة');
      expect(formData.files, hasLength(1));
      expect(formData.files.single.key, 'file');
      expect(formData.files.single.value.filename, 'backup-2026.json');
    });

    test('رفض الخادم: false مع BackupError برسالة الخادم', () async {
      final cubit = BackupCubit(
        dio: stubDio(
          rejectWith: (options) => options.path == '/system/restore'
              ? DioException(
                  requestOptions: options,
                  type: DioExceptionType.badResponse,
                  response: Response<Object>(
                    requestOptions: options,
                    statusCode: 400,
                    data: {'message': 'ملف النسخة غير صالح أو تالف'},
                  ),
                )
              : null,
        ),
        documentsDirectory: () async => tempDir,
      );
      addTearDown(cubit.close);

      final file = restoreFile();
      final ok = await cubit.restore(
        filePath: file.path,
        fileName: 'backup-2026.json',
        phrase: 'استعادة',
      );

      expect(ok, isFalse);
      expect(cubit.state, isA<BackupError>());
      expect((cubit.state as BackupError).message, 'ملف النسخة غير صالح أو تالف');
    });
  });

  group('شاشة الاستعادة — تفعيل الزر بكلمة «استعادة» فقط', () {
    testWidgets('الزر معطل بلا ملف/عبارة ويفعّل بعد اختيار الملف وكتابة الكلمة',
        (tester) async {
      // شاشة طويلة: نوسّع نافذة الاختبار بدل التمرير (أزرار الاستعادة أسفل).
      await tester.binding.setSurfaceSize(const Size(800, 1800));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      final requests = <RequestOptions>[];
      final cubit = BackupCubit(
        dio: stubDio(requests: requests),
        documentsDirectory: () async => tempDir,
      );
      // testWidgets يعمل في FakeAsync — عمليات الملفات/Hive الحقيقية
      // (openBox داخل loadSummary) لا تكتمل خارج حلقة الأحداث الحقيقية.
      // runAsync يفتح نافذة حلقة حقيقية لإتمامها.
      await tester.runAsync(() => cubit.loadSummary());
      final file = restoreFile();

      // منصة اختيار الملفات وهمية تعيد ملف النسخة الحقيقي.
      final previousPicker = FilePickerPlatform.instance;
      FilePickerPlatform.instance = _FakePickerPlatform([_FakePlatformFile(
        name: 'backup-2026.json',
        path: file.path,
      )]);
      addTearDown(() => FilePickerPlatform.instance = previousPicker);

      await tester.pumpWidget(
        BlocProvider<AuthCubit>(
          create: (_) => _StaticAuthCubit(),
          child: MaterialApp(home: BackupScreen(cubit: cubit)),
        ),
      );
      await tester.pumpAndSettle();

      // الملخص ظاهر.
      expect(find.textContaining('جدولًا في قاعدة البيانات'), findsOneWidget);
      expect(find.textContaining('إجمالي الصفوف'), findsOneWidget);
      expect(find.textContaining('لم تُنشأ نسخة بعد'), findsOneWidget);

      // 1) لا ملف ولا عبارة → معطل: الضغط لا يفتح حوار التأكيد.
      await tester.tap(find.text('تنفيذ الاستعادة'));
      await tester.pumpAndSettle();
      expect(find.text('تأكيد الاستعادة النهائي'), findsNothing);

      // 2) اختيار الملف ثم عبارة خاطئة → يبقى معطلًا.
      // الشاشة طويلة (شريط تمرير): تأكيد ظهور الزر قبل النقر.
      await tester.ensureVisible(find.text('اختيار ملف النسخة (JSON)'));
      await tester.tap(find.text('اختيار ملف النسخة (JSON)'));
      await tester.pumpAndSettle();
      expect(find.text('backup-2026.json'), findsOneWidget);

      await tester.enterText(
        find.widgetWithText(
            TextField, 'اكتب كلمة «استعادة» لتأكيد التنفيذ'),
        'استعاده',
      );
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('تنفيذ الاستعادة'));
      await tester.tap(find.text('تنفيذ الاستعادة'));
      await tester.pumpAndSettle();
      expect(find.text('تأكيد الاستعادة النهائي'), findsNothing);

      // 3) كتابة «استعادة» حرفيًا → يتفعل ويفتح حوار التأكيد النهائي.
      await tester.enterText(
        find.widgetWithText(
            TextField, 'اكتب كلمة «استعادة» لتأكيد التنفيذ'),
        'استعادة',
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('تنفيذ الاستعادة'));
      await tester.pumpAndSettle();
      expect(find.text('تأكيد الاستعادة النهائي'), findsOneWidget);

      // 4) التأكيد يشرح الاستبدال الكامل ثم ينفّذ الاستعادة.
      expect(find.textContaining('استبدال كل بيانات النظام'), findsOneWidget);
      await tester.tap(find.text('استبدال البيانات والاستعادة'));
      // الاستعادة تقرأ ملف النسخة (IO حقيقي داخل MultipartFile) — نافذة
      // حلقة حقيقية لإتمامه ثم مضخات لالتقاط الحالة النهائية. بلا
      // pumpAndSettle هنا: مؤشر التقدم الدوار أثناء الاستعادة لا يستقر.
      await tester.pump();
      await tester.runAsync(
        () async => Future<void>.delayed(const Duration(milliseconds: 300)),
      );
      await tester.pump();
      await tester.pump(const Duration(seconds: 1));

      // الحوار أُغلق وطلب الاستعادة أُرسل بالملف والعبارة.
      expect(find.text('تأكيد الاستعادة النهائي'), findsNothing);
      final restoreRequest = requests
          .firstWhere((request) => request.path == '/system/restore');
      final formData = restoreRequest.data as FormData;
      final fields = Map.fromEntries(
        formData.fields.map((entry) => MapEntry(entry.key, entry.value)),
      );
      expect(fields['confirm'], 'استعادة');
      expect(formData.files.single.value.filename, 'backup-2026.json');

      // النتيجة: بطاقة الاستعادة + snackbar النجاح.
      expect(find.textContaining('تمت الاستعادة'), findsWidgets);
      expect(find.text('تمت الاستعادة بنجاح'), findsOneWidget);
      expect(
        find.textContaining('${count(51)} جدولًا و${count(1200)} صفًا'),
        findsOneWidget,
      );
    });
  });
}

/// cubit مصادقة ثابت (SUPER_ADMIN) — selim_shell يقرأ الدور لشريط التنقل.
class _StaticAuthCubit extends AuthCubit {
  _StaticAuthCubit() : super() {
    emit(AuthAuthenticated(<String, dynamic>{
      'id': 'u-1',
      'username': 'admin',
      'role': 'SUPER_ADMIN',
    }));
  }
}

/// منصة file_picker وهمية (MockPlatformInterfaceMixin) ترجع ملفًا ثابتًا.
class _FakePickerPlatform extends FilePickerPlatform
    with MockPlatformInterfaceMixin {
  _FakePickerPlatform(this.files);

  final List<PlatformFile> files;

  @override
  Future<List<PlatformFile>> pickFiles({
    String? dialogTitle,
    String? initialDirectory,
    FileType type = FileType.any,
    List<String>? allowedExtensions,
    Function(FilePickerStatus)? onFileLoading,
    int compressionQuality = 0,
    AndroidOptions androidOptions = const AndroidOptions(),
    DarwinOptions darwinOptions = const DarwinOptions(),
    WindowsOptions windowsOptions = const WindowsOptions(),
    LinuxOptions linuxOptions = const LinuxOptions(),
    WebOptions webOptions = const WebOptions(),
  }) async => files;
}

/// ملف منصة وهمي بمسار حقيقي على القرص (اسم + مسار فقط).
base class _FakePlatformFile extends PlatformFile {

  _FakePlatformFile({required this.name, required this.path});

  @override
  final String name;

  /// المسار المحلي الحقيقي للملف.
  @override
  final String path;

  @override
  Uri get uri => Uri.file(path);

  @override
  XFile get xFile => XFile(path);

  @override
  int? lengthSync() => null;

  @override
  Future<int> length() async => 0;

  @override
  Future<Uint8List> readAsBytes() async => Uint8List(0);

  @override
  Stream<Uint8List> readAsByteStream() => const Stream.empty();
}
