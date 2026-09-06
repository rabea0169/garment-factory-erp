import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hive/hive.dart';

import 'package:garment_factory_erp/core/services/cache_service.dart';
import 'package:garment_factory_erp/features/production/data/datasources/production_remote_data_source.dart';
import 'package:garment_factory_erp/features/production/data/repositories/production_repository_impl.dart';
import 'package:garment_factory_erp/features/production/domain/entities/work_order.dart';
import 'package:garment_factory_erp/features/production/domain/repositories/production_repository.dart';
import 'package:garment_factory_erp/features/production/domain/usecases/production_usecases.dart';
import 'package:garment_factory_erp/features/production/presentation/cubit/production_cubit.dart';
import 'package:garment_factory_erp/features/production/presentation/cubit/production_state.dart';

/// MOB-3: تكامل شاشة الإنتاج أوفلاين — الطبقة الحقيقية كاملة
/// (data source → repository → usecases → cubit) فوق Dio يرمي
/// SocketException (كما يفعل المهايئ الحقيقي عند انقطاع الاتصال)،
/// مع كاش Hive حقيقي.
void main() {
  late Directory tempDir;
  late CacheService cache;
  late _ScriptedAdapter adapter;
  late Dio dio;

  setUpAll(() async {
    tempDir = await Directory.systemTemp.createTemp('gf_prod_offline_test_');
    Hive.init(tempDir.path);
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
    adapter = _ScriptedAdapter();
    dio = Dio(BaseOptions(baseUrl: 'https://erp.test'))
      ..httpClientAdapter = adapter;
  });

  ProductionCubit buildCubit() {
    final remote = ProductionRemoteDataSource(dio);
    final ProductionRepository repository = ProductionRepositoryImpl(remote);
    return ProductionCubit(
      getWorkOrders: GetWorkOrders(repository),
      transitionStage: TransitionProductionStage(repository),
      recordStageOutput: RecordProductionStageOutput(repository),
      consumeMaterial: ConsumeProductionMaterial(repository),
      finalizeCost: FinalizeProductionCost(repository),
      cache: cache,
    );
  }

  test('النجاح يخزن الكاش ثم انقطاع الاتصال يعرض الكاش مع الشارة', () async {
    // 1) متصل: جلب ناجح — يُخزن write-through.
    adapter.payload = {
      'data': [
        {
          'id': 'wo-1',
          'code': 'WO-0001',
          'quantity': 120,
          'status': 'PLANNED',
          'currentStage': null,
          'productVariant': {
            'size': 'L',
            'product': {'name': 'قميص قطني'},
          },
          'createdAt': '2026-08-26T10:00:00.000Z',
        },
      ],
    };
    var cubit = buildCubit();
    addTearDown(cubit.close);
    await cubit.fetchWorkOrders();
    expect(cubit.state, isA<ProductionLoaded>());
    expect((cubit.state as ProductionLoaded).fromCache, isFalse);

    // الكاش فعلًا مكتوب بالشكل المسطح.
    final snapshot = await cache.read('production_work_orders');
    expect(snapshot, isNotNull);
    expect((snapshot!.data as List).length, 1);

    // 2) انقطاع الاتصال (SocketException من المهايئ): cubit جديد يفتح
    //    الشاشة بلا شبكة → يعرض الكاش مع fromCache.
    adapter.socketDead = true;
    cubit = buildCubit();
    addTearDown(cubit.close);
    await cubit.fetchWorkOrders();

    expect(cubit.state, isA<ProductionLoaded>());
    final loaded = cubit.state as ProductionLoaded;
    expect(loaded.fromCache, isTrue);
    expect(loaded.cachedAt, isNotNull);
    expect(loaded.workOrders.single.id, 'wo-1');
    expect(loaded.workOrders.single.productName, 'قميص قطني');
    expect(loaded.workOrders.single.quantity, 120);
    expect(loaded.workOrders.single.status, WorkOrderStatus.planned);
  });

  test('انقطاع الاتصال بلا كاش → ProductionOffline', () async {
    adapter.socketDead = true;
    final cubit = buildCubit();
    addTearDown(cubit.close);

    final expectation = expectLater(
      cubit.stream,
      emitsInOrder([
        isA<ProductionLoading>(),
        isA<ProductionOffline>(),
      ]),
    );
    await cubit.fetchWorkOrders();
    await expectation;
  });

  test('خطأ خادم 500 (ليس انقطاعًا) → فشل خادم لا كاش', () async {
    adapter.serverErrorStatus = 500;
    final cubit = buildCubit();
    addTearDown(cubit.close);
    await cubit.fetchWorkOrders();
    expect(cubit.state, isA<ProductionFailure>());
    expect(cubit.state, isNot(isA<ProductionOffline>()));
  });
}

/// مهايئ مُبرمج: يرد بحمولة ناجحة، أو يرمي SocketException يحوّلها
/// DioException.connectionError — نفس تحويل المهايئ الحقيقي (io_adapter)
/// كي يمر الخطأ عبر mapProductionFailure كـ ProductionNetworkFailure.
class _ScriptedAdapter implements HttpClientAdapter {
  Object? payload;
  bool socketDead = false;
  int? serverErrorStatus;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    try {
      if (socketDead) {
        throw const SocketException('Network is unreachable');
      }
      if (serverErrorStatus != null) {
        return ResponseBody.fromString(
          '{"message": "internal"}',
          serverErrorStatus!,
          headers: {
            Headers.contentTypeHeader: [Headers.jsonContentType],
          },
        );
      }
      final body = payload;
      if (body is String) {
        return ResponseBody.fromString(body, 200, headers: {
          Headers.contentTypeHeader: [Headers.jsonContentType],
        });
      }
      if (body is Map || body is List) {
        // الحمولة كائن Dart — تُرمَّز JSON كما يفعل الخادم الحقيقي.
        return ResponseBody.fromString(jsonEncode(body), 200, headers: {
          Headers.contentTypeHeader: [Headers.jsonContentType],
        });
      }
      return ResponseBody.fromString('{}', 200, headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      });
    } on SocketException catch (error) {
      // مطابق لسلوك io_adapter: انقطاع الشبكة → connectionError.
      throw DioException.connectionError(
        requestOptions: options,
        reason: error.message,
        error: error,
      );
    }
  }

  @override
  void close({bool force = false}) {}
}
