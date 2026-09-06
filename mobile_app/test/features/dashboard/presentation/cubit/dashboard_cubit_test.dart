import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hive/hive.dart';

import 'package:garment_factory_erp/core/network/api_client.dart';
import 'package:garment_factory_erp/core/services/cache_service.dart';
import 'package:garment_factory_erp/core/storage/auth_storage.dart';
import 'package:garment_factory_erp/features/dashboard/presentation/cubit/dashboard_cubit.dart';
import 'package:garment_factory_erp/features/dashboard/presentation/cubit/dashboard_state.dart';

/// MOB-7: تغطية DashboardCubit — تحميل/نجاح/فراغ/خطأ (+ MOB-3: أوفلاين مع
/// كاش/بلا كاش) عبر ApiClient كامل التركيب (retry/refresh) بمحول مُبرمج
/// بلا شبكة حقيقية، وكاش Hive حقيقي في مجلد مؤقت.

/// تخزين آمن وهمي في الذاكرة — نفس توقيعات flutter_secure_storage 11.
class _InMemorySecureStorage extends FlutterSecureStorage {
  _InMemorySecureStorage(this._store);

  final Map<String, String> _store;

  @override
  Future<String?> read({
    required String key,
    AppleOptions? iOptions,
    AndroidOptions? aOptions,
    LinuxOptions? lOptions,
    WebOptions? webOptions,
    AppleOptions? mOptions,
    WindowsOptions? wOptions,
  }) async =>
      _store[key];

  @override
  Future<void> write({
    required String key,
    required String? value,
    AppleOptions? iOptions,
    AndroidOptions? aOptions,
    LinuxOptions? lOptions,
    WebOptions? webOptions,
    AppleOptions? mOptions,
    WindowsOptions? wOptions,
  }) async {
    if (value == null) {
      _store.remove(key);
    } else {
      _store[key] = value;
    }
  }

  @override
  Future<void> delete({
    required String key,
    AppleOptions? iOptions,
    AndroidOptions? aOptions,
    LinuxOptions? lOptions,
    WebOptions? webOptions,
    AppleOptions? mOptions,
    WindowsOptions? wOptions,
  }) async {
    _store.remove(key);
  }
}

/// محول مُبرمج: يقرر الاستجابة من دالة السكربت.
///
/// ⚠️ السكربت الذي يرمي DioException يجب أن يبنيها بـ `requestOptions`
/// نفسها الواردة إلى fetch — تمامًا كما تفعلdio وأدواتها (io_adapter يرمي
/// connectionError بالخيارات الحقيقية؛ badResponse يُبنى بالطلب الفعلي).
/// بناؤها بـ RequestOptions جديدة (بلا extra) يفقد معالج retry في
/// ApiClient عدّاد المحاولات (يُخزَّن في extra['retryAttempt']) فيدور بلا
/// نهاية — سلوك لا يحدث مع الأخطاء الحقيقية أبدًا.
class _ScriptedAdapter implements HttpClientAdapter {
  _ScriptedAdapter(Object Function(RequestOptions options) script)
      : _script = script;

  final Object Function(RequestOptions options) _script;
  final List<RequestOptions> requests = <RequestOptions>[];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    requests.add(options);
    final result = _script(options);
    if (result is ResponseBody) return result;
    if (result is DioException) throw result;
    throw StateError('سكربت غير متوقع: $result');
  }

  @override
  void close({bool force = false}) {}
}

void main() {
  late Directory tempDir;
  late CacheService cache;
  late Map<String, String> store;

  final validStats = <String, dynamic>{
    'generatedAt': '2026-09-01T10:00:00.000Z',
    'sales': [
      {'period': '2026-08', 'amount': 12000.5},
    ],
    'production': [
      {'period': '2026-08-25', 'pieces': 120},
    ],
    'topWorkers': [
      {'name': 'أحمد', 'pieces': 50},
    ],
    'inventory': {
      'totalMaterials': 2,
      'lowStockMaterials': 1,
      'totalFinishedGoodsTypes': 3,
    },
  };

  final emptyStats = <String, dynamic>{
    'generatedAt': '2026-09-01T10:00:00.000Z',
    'sales': <dynamic>[],
    'production': <dynamic>[],
    'topWorkers': <dynamic>[],
    'inventory': {
      'totalMaterials': 0,
      'lowStockMaterials': 0,
      'totalFinishedGoodsTypes': 0,
    },
  };

  setUpAll(() async {
    tempDir = await Directory.systemTemp.createTemp('gf_dashboard_cubit_test_');
    Hive.init(tempDir.path);
    store = <String, String>{};
    // تهيئة واحدة للعميل الكامل — نفس ما يحدث في main.dart.
    ApiClient.instance.init(
      authStorage: AuthStorage(storage: _InMemorySecureStorage(store)),
      onUnauthorized: () {},
    );
  });

  tearDownAll(() async {
    await Hive.close();
    await tempDir.delete(recursive: true);
  });

  setUp(() async {
    if (Hive.isBoxOpen(CacheService.boxName)) {
      await Hive.box(CacheService.boxName).clear();
    }
    cache = CacheService();
    await cache.init();
  });

  DashboardCubit buildCubit() =>
      DashboardCubit(apiClient: ApiClient.instance, cache: cache);

  test('MOB-7 — تحميل ثم نجاح: بيانات كاملة → DashboardLoaded + كاش', () async {
    ApiClient.instance.dio.httpClientAdapter = _ScriptedAdapter(
      (options) => ResponseBody.fromString(
        jsonEncode(validStats),
        200,
        headers: _jsonHeaders,
      ),
    );
    final cubit = buildCubit();
    addTearDown(cubit.close);

    final expectation = expectLater(
      cubit.stream,
      emitsInOrder([
        isA<DashboardLoading>(),
        predicate<DashboardLoaded>(
          (state) => !state.fromCache && state.stats['sales'] is List,
        ),
      ]),
    );
    await cubit.fetchStats();
    await expectation;

    // MOB-3: آخر حالة ناجحة خُزنت write-through.
    final snapshot = await cache.read('dashboard_stats');
    expect(snapshot, isNotNull);
    expect(snapshot!.data, isA<Map>());
  });

  test('MOB-7 — فراغ: كل السلاسل فارغة والأصفار → DashboardEmpty', () async {
    ApiClient.instance.dio.httpClientAdapter = _ScriptedAdapter(
      (options) => ResponseBody.fromString(
        jsonEncode(emptyStats),
        200,
        headers: _jsonHeaders,
      ),
    );
    final cubit = buildCubit();
    addTearDown(cubit.close);

    final expectation = expectLater(
      cubit.stream,
      emitsInOrder([isA<DashboardLoading>(), isA<DashboardEmpty>()]),
    );
    await cubit.fetchStats();
    await expectation;
  });

  test('MOB-7 — payload ليس خريطة → DashboardError عربي', () async {
    ApiClient.instance.dio.httpClientAdapter = _ScriptedAdapter(
      (options) =>
          ResponseBody.fromString('[1,2,3]', 200, headers: _jsonHeaders),
    );
    final cubit = buildCubit();
    addTearDown(cubit.close);

    final expectation = expectLater(
      cubit.stream,
      emitsInOrder([
        isA<DashboardLoading>(),
        predicate<DashboardError>((state) =>
            state.message == 'استجابة لوحة التحكم من الخادم غير صالحة'),
      ]),
    );
    await cubit.fetchStats();
    await expectation;
  });

  test('MOB-7 — بيانات ناقصة (سلسلة مفقودة) → DashboardError عربي', () async {
    final incomplete = Map<String, dynamic>.from(validStats)
      ..remove('topWorkers');
    ApiClient.instance.dio.httpClientAdapter = _ScriptedAdapter(
      (options) => ResponseBody.fromString(
        jsonEncode(incomplete),
        200,
        headers: _jsonHeaders,
      ),
    );
    final cubit = buildCubit();
    addTearDown(cubit.close);

    final expectation = expectLater(
      cubit.stream,
      emitsInOrder([
        isA<DashboardLoading>(),
        predicate<DashboardError>((state) =>
            state.message == 'بيانات لوحة التحكم غير مكتملة أو غير متوافقة'),
      ]),
    );
    await cubit.fetchStats();
    await expectation;
  });

  test('MOB-7 — خطأ خادم 500 → DashboardError (ليس فراغًا ولا كاشًا)',
      () async {
    // 500 عبر ResponseBody (لا رمي يدوي) — نفس مسار dio الحقيقي.
    ApiClient.instance.dio.httpClientAdapter = _ScriptedAdapter(
      (options) => ResponseBody.fromString(
        '{"message": "خطأ داخلي"}',
        500,
        headers: _jsonHeaders,
      ),
    );
    final cubit = buildCubit();
    addTearDown(cubit.close);

    final expectation = expectLater(
      cubit.stream,
      emitsInOrder([
        isA<DashboardLoading>(),
        predicate<DashboardError>((state) => state.message.contains('خطأ')),
      ]),
    );
    await cubit.fetchStats();
    await expectation;
    expect(cubit.state, isA<DashboardError>());
    // لا كاش كُتب (لا نجاح).
    final snapshot = await cache.read('dashboard_stats');
    expect(snapshot, isNull);
  });

  test('MOB-3 — انقطاع الاتصال مع كاش → DashboardLoaded من الكاش بشارة',
      () async {
    // اكتب كاشًا يدويًا (آخر حالة ناجحة سابقة).
    await cache.writeThrough('dashboard_stats', validStats);
    // connectionError بالخيارات الحقيقية — كما يرميها io_adapter عند
    // انقطاع الشبكة (SocketException → DioException.connectionError).
    ApiClient.instance.dio.httpClientAdapter = _ScriptedAdapter(
      (options) => throw DioException.connectionError(
        requestOptions: options,
        reason: 'Network is unreachable',
      ),
    );
    final cubit = buildCubit();
    addTearDown(cubit.close);

    final expectation = expectLater(
      cubit.stream,
      emitsInOrder([
        isA<DashboardLoading>(),
        predicate<DashboardLoaded>(
            (state) => state.fromCache && state.cachedAt != null),
      ]),
    );
    await cubit.fetchStats();
    await expectation;
  });

  test('MOB-3 — انقطاع الاتصال بلا كاش → DashboardError برسالة الشبكة',
      () async {
    ApiClient.instance.dio.httpClientAdapter = _ScriptedAdapter(
      (options) => throw DioException.connectionError(
        requestOptions: options,
        reason: 'Network is unreachable',
      ),
    );
    final cubit = buildCubit();
    addTearDown(cubit.close);

    final expectation = expectLater(
      cubit.stream,
      emitsInOrder([
        isA<DashboardLoading>(),
        predicate<DashboardError>(
          (state) => state.message.contains('تعذر الاتصال'),
        ),
      ]),
    );
    await cubit.fetchStats();
    await expectation;
  });
}

const _jsonHeaders = <String, List<String>>{
  Headers.contentTypeHeader: <String>[Headers.jsonContentType],
};
