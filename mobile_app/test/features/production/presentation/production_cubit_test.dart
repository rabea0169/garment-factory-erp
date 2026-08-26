import 'package:flutter_test/flutter_test.dart';

import 'package:garment_factory_erp/features/production/domain/entities/production_commands.dart';
import 'package:garment_factory_erp/features/production/domain/entities/stage_transition.dart';
import 'package:garment_factory_erp/features/production/domain/entities/work_order.dart';
import 'package:garment_factory_erp/features/production/domain/failures/production_failure.dart' as failures;
import 'package:garment_factory_erp/features/production/domain/repositories/production_repository.dart';
import 'package:garment_factory_erp/features/production/domain/usecases/production_usecases.dart';
import 'package:garment_factory_erp/features/production/presentation/cubit/production_cubit.dart';
import 'package:garment_factory_erp/features/production/presentation/cubit/production_state.dart';

void main() {
  final order = WorkOrder(
    id: 'wo-1',
    code: 'WO-0001',
    quantity: 120,
    status: WorkOrderStatus.planned,
    currentStage: null,
    productName: 'قميص قطني',
    variantSize: 'L',
    createdAt: DateTime.utc(2026, 8, 26),
  );

  test('emits typed loading and loaded states', () async {
    final repository = FakeProductionRepository(workOrders: [order]);
    final cubit = ProductionCubit(
      getWorkOrders: GetWorkOrders(repository),
      transitionStage: TransitionProductionStage(repository),
    );
    addTearDown(cubit.close);

    final expectation = expectLater(
      cubit.stream,
      emitsInOrder([
        isA<ProductionLoading>(),
        predicate<ProductionLoaded>(
          (state) => state.workOrders.single.id == 'wo-1',
        ),
      ]),
    );

    await cubit.fetchWorkOrders();
    await expectation;
  });

  test('maps a network failure to an offline state', () async {
    final repository = FakeProductionRepository(
      failure: const failures.ProductionNetworkFailure(),
    );
    final cubit = ProductionCubit(
      getWorkOrders: GetWorkOrders(repository),
      transitionStage: TransitionProductionStage(repository),
    );
    addTearDown(cubit.close);

    final expectation = expectLater(
      cubit.stream,
      emitsInOrder([
        isA<ProductionLoading>(),
        isA<ProductionOffline>(),
      ]),
    );

    await cubit.fetchWorkOrders();
    await expectation;
  });
}

class FakeProductionRepository implements ProductionRepository {
  FakeProductionRepository({this.workOrders = const [], this.failure});

  final List<WorkOrder> workOrders;
  final failures.ProductionFailure? failure;

  @override
  Future<List<WorkOrder>> getWorkOrders({
    required int page,
    required int limit,
  }) async {
    if (failure != null) throw failure!;
    return workOrders;
  }

  @override
  Future<StageTransition> transitionStage({
    required String workOrderId,
    required ProductionStage toStage,
    String? reason,
    required String idempotencyKey,
  }) async {
    if (failure != null) throw failure!;
    return StageTransition(
      transitionId: 'transition-1',
      workOrderId: workOrderId,
      fromStage: null,
      toStage: toStage,
      stageRunId: 'stage-run-1',
      stageVersion: 1,
      replayed: false,
    );
  }

  @override
  Future<StageOutputResult> recordStageOutput(
    RecordStageOutputCommand command,
  ) async {
    if (failure != null) throw failure!;
    return StageOutputResult(
      workOrderId: command.workOrderId,
      stage: command.stage,
      status: 'COMPLETED',
    );
  }

  @override
  Future<MaterialConsumption> consumeMaterial(
    ConsumeMaterialCommand command,
  ) async {
    if (failure != null) throw failure!;
    return MaterialConsumption(
      consumptionId: 'consumption-1',
      workOrderId: command.workOrderId,
      stageRunId: command.stageRunId,
      stockLedgerEntryId: 'ledger-1',
      actualQuantity: command.actualQuantity,
      wasteQuantity: command.wasteQuantity,
      unitCost: 1,
      totalCost: command.actualQuantity,
      wasteCost: command.wasteQuantity,
      replayed: false,
    );
  }

  @override
  Future<ProductionCostSnapshot> finalizeCost({
    required String workOrderId,
  }) async {
    if (failure != null) throw failure!;
    return ProductionCostSnapshot(
      id: 'cost-1',
      workOrderId: workOrderId,
      status: 'FINALIZED',
      materialCost: 100,
      wasteCost: 5,
      totalCost: 100,
      acceptedQty: 10,
      unitCost: 10,
    );
  }
}
