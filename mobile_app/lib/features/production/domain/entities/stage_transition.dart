import 'work_order.dart';

class StageTransition {
  const StageTransition({
    required this.transitionId,
    required this.workOrderId,
    required this.fromStage,
    required this.toStage,
    required this.stageVersion,
    required this.replayed,
  });

  final String transitionId;
  final String workOrderId;
  final ProductionStage? fromStage;
  final ProductionStage toStage;
  final int stageVersion;
  final bool replayed;
}
