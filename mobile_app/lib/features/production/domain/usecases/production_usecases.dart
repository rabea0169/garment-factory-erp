import '../entities/production_commands.dart';
import '../entities/stage_transition.dart';
import '../entities/work_order.dart';
import '../repositories/production_repository.dart';

class CreateWorkOrder {
  const CreateWorkOrder(this.repository);

  final ProductionRepository repository;

  Future<void> call(CreateWorkOrderCommand command) {
    return repository.createWorkOrder(command);
  }
}

class GetWorkOrders {
  const GetWorkOrders(this.repository);

  final ProductionRepository repository;

  Future<List<WorkOrder>> call({int page = 1, int limit = 20}) {
    return repository.getWorkOrders(page: page, limit: limit);
  }
}

class RecordProductionStageOutput {
  const RecordProductionStageOutput(this.repository);

  final ProductionRepository repository;

  Future<StageOutputResult> call(RecordStageOutputCommand command) {
    return repository.recordStageOutput(command);
  }
}

class ConsumeProductionMaterial {
  const ConsumeProductionMaterial(this.repository);

  final ProductionRepository repository;

  Future<MaterialConsumption> call(ConsumeMaterialCommand command) {
    return repository.consumeMaterial(command);
  }
}

class FinalizeProductionCost {
  const FinalizeProductionCost(this.repository);

  final ProductionRepository repository;

  Future<ProductionCostSnapshot> call({required String workOrderId}) {
    return repository.finalizeCost(workOrderId: workOrderId);
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
