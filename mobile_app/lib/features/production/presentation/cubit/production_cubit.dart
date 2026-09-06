import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:uuid/uuid.dart';

import '../../../../core/services/cache_service.dart';
import '../../domain/entities/production_commands.dart';
import '../../domain/entities/work_order.dart';
import '../../domain/failures/production_failure.dart' as failures;
import '../../domain/usecases/production_usecases.dart';
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
  int _limit = 20;

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

  Future<bool> createWorkOrder(CreateWorkOrderCommand command) async {
    final createWorkOrder = _createWorkOrder;
    if (createWorkOrder == null) return false;
    try {
      await createWorkOrder(command);
      await fetchWorkOrders(refresh: true);
      return true;
    } on failures.ProductionUnauthorizedFailure {
      emit(const ProductionUnauthorized());
    } on failures.ProductionNetworkFailure {
      emit(const ProductionOffline());
    } on failures.ProductionFailure catch (failure) {
      emit(ProductionFailure(failure));
    } catch (_) {
      emit(const ProductionFailure(failures.ProductionServerFailure()));
    }
    return false;
  }

  Future<void> transitionStage({
    required String workOrderId,
    required ProductionStage stage,
  }) async {
    try {
      await _transitionStage(
        workOrderId: workOrderId,
        toStage: stage,
        idempotencyKey: _uuid.v4(),
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
    } on failures.ProductionNetworkFailure {
      emit(const ProductionOffline());
    } on failures.ProductionFailure catch (failure) {
      emit(ProductionFailure(failure));
    } catch (_) {
      emit(const ProductionFailure(failures.ProductionServerFailure()));
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
