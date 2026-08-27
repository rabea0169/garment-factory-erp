import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:uuid/uuid.dart';

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
  })  : _getWorkOrders = getWorkOrders,
        _transitionStage = transitionStage,
        _recordStageOutput = recordStageOutput,
        _consumeMaterial = consumeMaterial,
        _finalizeCost = finalizeCost,
        _createWorkOrder = createWorkOrder,
        _uuid = uuid ?? const Uuid(),
        super(const ProductionInitial());

  final GetWorkOrders _getWorkOrders;
  final TransitionProductionStage _transitionStage;
  final RecordProductionStageOutput _recordStageOutput;
  final ConsumeProductionMaterial _consumeMaterial;
  final FinalizeProductionCost _finalizeCost;
  final CreateWorkOrder? _createWorkOrder;
  final Uuid _uuid;
  int _page = 1;
  int _limit = 20;

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
      emit(
        orders.isEmpty
            ? const ProductionEmpty()
            : ProductionLoaded(workOrders: orders),
      );
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
}
