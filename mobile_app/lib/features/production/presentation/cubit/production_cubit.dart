import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:uuid/uuid.dart';

import '../../domain/entities/work_order.dart';
import '../../domain/failures/production_failure.dart' as failures;
import '../../domain/usecases/production_usecases.dart';
import 'production_state.dart';

class ProductionCubit extends Cubit<ProductionState> {
  ProductionCubit({
    required GetWorkOrders getWorkOrders,
    required TransitionProductionStage transitionStage,
    Uuid? uuid,
  })  : _getWorkOrders = getWorkOrders,
        _transitionStage = transitionStage,
        _uuid = uuid ?? const Uuid(),
        super(const ProductionInitial());

  final GetWorkOrders _getWorkOrders;
  final TransitionProductionStage _transitionStage;
  final Uuid _uuid;
  int _page = 1;
  int _limit = 20;

  Future<void> fetchWorkOrders({bool refresh = false}) async {
    if (refresh && state is ProductionLoaded) {
      final current = state as ProductionLoaded;
      emit(ProductionLoaded(workOrders: current.workOrders, isRefreshing: true));
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

  void setPageSize(int limit) {
    if (limit <= 0) return;
    _limit = limit;
    _page = 1;
  }
}
