import 'work_order.dart';

class StageTransition {
  const StageTransition({
    required this.transitionId,
    required this.workOrderId,
    required this.fromStage,
    required this.toStage,
    required this.stageRunId,
    required this.stageVersion,
    required this.replayed,
  });

  final String transitionId;
  final String workOrderId;
  final ProductionStage? fromStage;
  final ProductionStage toStage;
  final String stageRunId;
  final int stageVersion;
  final bool replayed;
}
