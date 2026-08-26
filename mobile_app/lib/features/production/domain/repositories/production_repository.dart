import '../entities/stage_transition.dart';
import '../entities/work_order.dart';

abstract interface class ProductionRepository {
  Future<List<WorkOrder>> getWorkOrders({
    required int page,
    required int limit,
  });

  Future<StageTransition> transitionStage({
    required String workOrderId,
    required ProductionStage toStage,
    String? reason,
    required String idempotencyKey,
  });
}
