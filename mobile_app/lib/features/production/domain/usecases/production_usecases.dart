import '../entities/stage_transition.dart';
import '../entities/work_order.dart';
import '../repositories/production_repository.dart';

class GetWorkOrders {
  const GetWorkOrders(this.repository);

  final ProductionRepository repository;

  Future<List<WorkOrder>> call({int page = 1, int limit = 20}) {
    return repository.getWorkOrders(page: page, limit: limit);
  }
}

class TransitionProductionStage {
  const TransitionProductionStage(this.repository);

  final ProductionRepository repository;

  Future<StageTransition> call({
    required String workOrderId,
    required ProductionStage toStage,
    String? reason,
    required String idempotencyKey,
  }) {
    return repository.transitionStage(
      workOrderId: workOrderId,
      toStage: toStage,
      reason: reason,
      idempotencyKey: idempotencyKey,
    );
  }
}
