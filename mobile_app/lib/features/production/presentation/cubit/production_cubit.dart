import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:uuid/uuid.dart';

import '../../../../core/network/api_client.dart';
import '../../../../core/services/cache_service.dart';
import '../../domain/entities/production_commands.dart';
import '../../domain/entities/work_order.dart';
import '../../domain/failures/production_failure.dart' as failures;
import '../../domain/usecases/production_usecases.dart';
import '../../stage_run_registry.dart';
import 'production_state.dart';

class ProductionCubit extends Cubit<ProductionState> {
  ProductionCubit({
    required GetWorkOrders getWorkOrders,
    required TransitionProductionStage transitionStage,
    required RecordProductionStageOutput recordStageOutput,
    required ConsumeProductionMaterial consumeMaterial,
    required FinalizeProductionCost finalizeCost,
    CreateWorkOrder? createWorkOrder,
    Uuid? uuid,
    CacheService? cache,
  })  : _getWorkOrders = getWorkOrders,
        _transitionStage = transitionStage,
        _recordStageOutput = recordStageOutput,
        _consumeMaterial = consumeMaterial,
        _finalizeCost = finalizeCost,
        _createWorkOrder = createWorkOrder,
        _uuid = uuid ?? const Uuid(),
        _cache = cache ?? CacheService.instance,
        super(const ProductionInitial());

  final GetWorkOrders _getWorkOrders;
  final TransitionProductionStage _transitionStage;
  final RecordProductionStageOutput _recordStageOutput;
  final ConsumeProductionMaterial _consumeMaterial;
  final FinalizeProductionCost _finalizeCost;
  final CreateWorkOrder? _createWorkOrder;
  final Uuid _uuid;

  /// MOB-3: كاش قراءة أوامر التشغيل — آخر حالة ناجحة تُعرض عند فقد
  /// الاتصال مع شارة "بيانات مخزنة".
  final CacheService _cache;
  int _page = 1;
  // P1 (audit-FE2): 20 افتراضيًا كان يقطع قائمة الإنتاج في مصنع حقيقي.
  int _limit = 100;

  static const String _workOrdersCacheKey = 'production_work_orders';

  Future<void> fetchWorkOrders({bool refresh = false}) async {
    if (refresh && state is ProductionLoaded) {
      final current = state as ProductionLoaded;
      emit(
          ProductionLoaded(workOrders: current.workOrders, isRefreshing: true));
    } else {
      emit(const ProductionLoading());
    }

    try {
      final orders = await _getWorkOrders(page: _page, limit: _limit);
      // MOB-3: write-through بعد كل نجاح — يتحدث الكاش فورًا.
      await _cache.writeThrough(
        _workOrdersCacheKey,
        orders.map(workOrderToCacheJson).toList(growable: false),
      );
      emit(
        orders.isEmpty
            ? const ProductionEmpty()
            : ProductionLoaded(workOrders: orders),
      );
    } on failures.ProductionNetworkFailure {
      // MOB-3: بلا اتصال — اعرض آخر حالة ناجحة من الكاش إن وُجدت،
      // وإلا فحالة لا-اتصال الصريحة.
      final snapshot = await _cache.read(_workOrdersCacheKey);
      final cachedOrders = _ordersFromCache(snapshot?.data);
      if (cachedOrders != null && cachedOrders.isNotEmpty) {
        emit(ProductionLoaded(
          workOrders: cachedOrders,
          fromCache: true,
          cachedAt: snapshot?.cachedAt,
        ));
      } else {
        emit(const ProductionOffline());
      }
    } on failures.ProductionUnauthorizedFailure {
      emit(const ProductionUnauthorized());
    } on failures.ProductionFailure catch (failure) {
      emit(ProductionFailure(failure));
    } catch (_) {
      emit(const ProductionFailure(failures.ProductionServerFailure()));
    }
  }

  /// DEV-PQ1: ينشئ أمر التشغيل ويعيد هوية الأمر الجديد (رمزه للـ snackbar)
  /// أو null عند الفشل. الاستدعاء يمر بالـ use case الموجود والقائمة
  /// تُعاد جلبًا تلقائيًا عند النجاح (نفس سلوك transitionStage).
  Future<CreatedWorkOrder?> createWorkOrder(CreateWorkOrderCommand command) async {
    final createWorkOrder = _createWorkOrder;
    if (createWorkOrder == null) return null;
    try {
      final created = await createWorkOrder(command);
      await fetchWorkOrders(refresh: true);
      return created;
    } on failures.ProductionUnauthorizedFailure {
      emit(const ProductionUnauthorized());
    } on failures.ProductionFailure catch (failure) {
      _emitWriteFailure(failure);
    } catch (_) {
      _emitWriteFailure(const failures.ProductionServerFailure());
    }
    return null;
  }

  /// فشل الكتابة لا يهدم القائمة المعروضة: مع قائمة محملة نُصدر
  /// [ProductionWriteFailure] (ترث Loaded) ليقرأ الحوار رسالة الخادم
  /// ويعرضها داخل الحوار — وبلا قائمة نُصدر الفشل العادي.
  void _emitWriteFailure(failures.ProductionFailure failure) {
    final current = state;
    if (current is ProductionLoaded) {
      emit(ProductionWriteFailure(workOrders: current.workOrders, failure: failure));
    } else {
      emit(ProductionFailure(failure));
    }
  }

  Future<void> transitionStage({
    required String workOrderId,
    required ProductionStage stage,
  }) async {
    try {
      final transition = await _transitionStage(
        workOrderId: workOrderId,
        toStage: stage,
        idempotencyKey: _uuid.v4(),
      );
      // DEV-PQ3: الانتقال أنشأ تشغيل المرحلة الجديدة — سجّل معرفه محليًا.
      await rememberStageRun(
        _cache,
        workOrderId: workOrderId,
        stageApiValue: transition.toStage.apiValue,
        stageRunId: transition.stageRunId,
      );
      await fetchWorkOrders(refresh: true);
    } on failures.ProductionUnauthorizedFailure {
      emit(const ProductionUnauthorized());
    } on failures.ProductionNetworkFailure {
      emit(const ProductionOffline());
    } on failures.ProductionFailure catch (failure) {
      emit(ProductionFailure(failure));
    } catch (_) {
      emit(const ProductionFailure(failures.ProductionServerFailure()));
    }
  }

  Future<StageOutputResult?> recordStageOutput(
    RecordStageOutputCommand command,
  ) async {
    try {
      final result = await _recordStageOutput(command);
      // DEV-PQ3: تسجيل المخرجات أكمل تشغيل المرحلة — سجّل معرفه محليًا
      // ليستطيع فحص الجودة الربط به (الجودة ترفض المراحل غير المكتملة).
      await rememberStageRun(
        _cache,
        workOrderId: result.workOrderId,
        stageApiValue: result.stage.apiValue,
        stageRunId: result.stageRunId,
      );
      await fetchWorkOrders(refresh: true);
      return result;
    } on failures.ProductionUnauthorizedFailure {
      emit(const ProductionUnauthorized());
    } on failures.ProductionNetworkFailure {
      emit(const ProductionOffline());
    } on failures.ProductionFailure catch (failure) {
      emit(ProductionFailure(failure));
    } catch (_) {
      emit(const ProductionFailure(failures.ProductionServerFailure()));
    }
    return null;
  }

  Future<MaterialConsumption?> consumeMaterial(
    ConsumeMaterialCommand command,
  ) async {
    try {
      return await _consumeMaterial(command);
    } on failures.ProductionUnauthorizedFailure {
      emit(const ProductionUnauthorized());
    } on failures.ProductionFailure catch (failure) {
      _emitWriteFailure(failure);
    } catch (_) {
      _emitWriteFailure(const failures.ProductionServerFailure());
    }
    return null;
  }

  Future<ProductionCostSnapshot?> finalizeCost({
    required String workOrderId,
  }) async {
    try {
      return await _finalizeCost(workOrderId: workOrderId);
    } on failures.ProductionUnauthorizedFailure {
      emit(const ProductionUnauthorized());
    } on failures.ProductionNetworkFailure {
      emit(const ProductionOffline());
    } on failures.ProductionFailure catch (failure) {
      emit(ProductionFailure(failure));
    } catch (_) {
      emit(const ProductionFailure(failures.ProductionServerFailure()));
    }
    return null;
  }

  void setPageSize(int limit) {
    if (limit <= 0) return;
    _limit = limit;
    _page = 1;
  }

  /// DEV-PQ3 + audit-FE2 (P1): يعيد معرف تشغيل المرحلة (workOrderId+stage)
  /// بمسارين: المحلي أولًا ثم الخادم عبر
  /// GET /production/work-orders/:id/stage-runs عند غيابه محليًا (تعدد
  /// الأجهزة)، أو null عند فشل الخطين — الحوارات تعرض تلميحًا واضحًا.
  Future<String?> stageRunIdFor(
    String workOrderId,
    ProductionStage stage,
  ) {
    return resolveStageRunIdFromRegistry(
      _cache,
      workOrderId: workOrderId,
      stageApiValue: stage.apiValue,
      fetchStageRuns: _fetchStageRunsFromServer,
    );
  }

  /// audit-FE2 (P1): جلب تشغيلات مراحل أمر من الخادم — الاستجابة
  /// { workOrderId, code, stageRuns: [...] }.
  Future<List<Map<String, dynamic>>> _fetchStageRunsFromServer(
    String workOrderId,
  ) async {
    final response = await ApiClient.instance.dio
        .get('/production/work-orders/$workOrderId/stage-runs');
    final data = response.data;
    if (data is Map<String, dynamic>) {
      final runs = data['stageRuns'];
      if (runs is List) {
        return runs.whereType<Map<String, dynamic>>().toList();
      }
    }
    return <Map<String, dynamic>>[];
  }

  /// يحوّل قيمة الكاش (List بروابط dynamic) إلى أوامر تشغيل — null عند
  /// أي تلف (يُعامل كـ "لا كاش").
  List<WorkOrder>? _ordersFromCache(Object? data) {
    if (data is! List) return null;
    try {
      return data
          .whereType<Map>()
          .map(
              (item) => workOrderFromCacheJson(Map<String, dynamic>.from(item)))
          .toList(growable: false);
    } catch (_) {
      return null;
    }
  }
}
