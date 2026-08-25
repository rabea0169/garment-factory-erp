import 'package:dio/dio.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import '../../../../core/network/api_client.dart';
import 'production_state.dart';

class ProductionCubit extends Cubit<ProductionState> {
  ProductionCubit() : super(ProductionInitial());

  Future<void> fetchWorkOrders() => fetchWorkflowData();

  Future<void> fetchWorkflowData() async {
    final previous = state is ProductionLoaded ? state as ProductionLoaded : null;
    emit(ProductionLoading());
    try {
      final dio = ApiClient.instance.dio;
      final responses = await Future.wait([
        dio.get('/production/work-orders'),
        dio.get('/inventory/raw-materials'),
        dio.get('/inventory/warehouses'),
      ]);

      emit(
        ProductionLoaded(
          workOrders: ApiClient.extractPaginatedData(responses[0].data),
          rawMaterials: ApiClient.extractPaginatedData(responses[1].data),
          warehouses: ApiClient.extractPaginatedData(responses[2].data),
        ),
      );
    } catch (error) {
      emit(
        ProductionError(
          ApiClient.instance.messageFor(error),
          previousWorkOrders: previous?.workOrders ?? const [],
          previousRawMaterials: previous?.rawMaterials ?? const [],
          previousWarehouses: previous?.warehouses ?? const [],
        ),
      );
    }
  }

  Future<void> transitionStage(String workOrderId, String toStage) async {
    final loaded = _loadedState;
    _emitBusy(workOrderId);
    try {
      await ApiClient.instance.dio.post(
        '/production/work-orders/$workOrderId/stage-transitions',
        data: {'toStage': toStage},
        options: Options(
          headers: {
            'Idempotency-Key':
                'mobile-transition-$workOrderId-${DateTime.now().microsecondsSinceEpoch}',
          },
        ),
      );
      await fetchWorkflowData();
    } catch (error) {
      _emitError(error, loaded);
    }
  }

  Future<void> recordStageOutput(
    String workOrderId,
    Map<String, dynamic> payload,
  ) async {
    final loaded = _loadedState;
    _emitBusy(workOrderId);
    try {
      await ApiClient.instance.dio.post(
        '/production/work-orders/$workOrderId/stage-output',
        data: payload,
      );
      await fetchWorkflowData();
    } catch (error) {
      _emitError(error, loaded);
    }
  }

  Future<void> consumeMaterial(
    String workOrderId,
    Map<String, dynamic> payload,
  ) async {
    final loaded = _loadedState;
    _emitBusy(workOrderId);
    try {
      await ApiClient.instance.dio.post(
        '/production/work-orders/$workOrderId/material-consumptions',
        data: payload,
        options: Options(
          headers: {
            'Idempotency-Key':
                'mobile-consume-$workOrderId-${DateTime.now().microsecondsSinceEpoch}',
          },
        ),
      );
      await fetchWorkflowData();
    } catch (error) {
      _emitError(error, loaded);
    }
  }

  Future<void> finalizeCost(String workOrderId) async {
    final loaded = _loadedState;
    _emitBusy(workOrderId);
    try {
      await ApiClient.instance.dio.post(
        '/production/work-orders/$workOrderId/cost/finalize',
      );
      await fetchWorkflowData();
    } catch (error) {
      _emitError(error, loaded);
    }
  }

  Future<void> updateOrderStatus(String id, String newStatus) async {
    final loaded = _loadedState;
    _emitBusy(id);
    try {
      await ApiClient.instance.dio.patch(
        '/production/work-orders/$id/status',
        data: {'status': newStatus},
      );
      await fetchWorkflowData();
    } catch (error) {
      _emitError(error, loaded);
    }
  }

  ProductionLoaded? get _loadedState =>
      state is ProductionLoaded ? state as ProductionLoaded : null;

  void _emitBusy(String workOrderId) {
    final loaded = _loadedState;
    if (loaded == null) return;
    emit(
      ProductionLoaded(
        workOrders: loaded.workOrders,
        rawMaterials: loaded.rawMaterials,
        warehouses: loaded.warehouses,
        busyWorkOrderId: workOrderId,
      ),
    );
  }

  void _emitError(Object error, ProductionLoaded? previous) {
    emit(
      ProductionError(
        ApiClient.instance.messageFor(error),
        previousWorkOrders: previous?.workOrders ?? const [],
        previousRawMaterials: previous?.rawMaterials ?? const [],
        previousWarehouses: previous?.warehouses ?? const [],
      ),
    );
  }
}
