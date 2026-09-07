import 'package:flutter_test/flutter_test.dart';

import 'package:garment_factory_erp/core/services/cache_service.dart';
import 'package:garment_factory_erp/features/production/domain/entities/production_commands.dart';
import 'package:garment_factory_erp/features/production/domain/entities/stage_transition.dart';
import 'package:garment_factory_erp/features/production/domain/entities/work_order.dart';
import 'package:garment_factory_erp/features/production/domain/failures/production_failure.dart'
    as failures;
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
      recordStageOutput: RecordProductionStageOutput(repository),
      consumeMaterial: ConsumeProductionMaterial(repository),
      finalizeCost: FinalizeProductionCost(repository),
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
      recordStageOutput: RecordProductionStageOutput(repository),
      consumeMaterial: ConsumeProductionMaterial(repository),
      finalizeCost: FinalizeProductionCost(repository),
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

  group('DEV-PQ1 createWorkOrder', () {
    test('returns the created order identity and refetches the list',
        () async {
      final repository = FakeProductionRepository(workOrders: [order]);
      final cubit = ProductionCubit(
        getWorkOrders: GetWorkOrders(repository),
        createWorkOrder: CreateWorkOrder(repository),
        transitionStage: TransitionProductionStage(repository),
        recordStageOutput: RecordProductionStageOutput(repository),
        consumeMaterial: ConsumeProductionMaterial(repository),
        finalizeCost: FinalizeProductionCost(repository),
      );
      addTearDown(cubit.close);
      await cubit.fetchWorkOrders();

      final created = await cubit.createWorkOrder(
        const CreateWorkOrderCommand(
          productVariantId: 'variant-9',
          bomVersionId: 'bom-2',
          quantity: 50,
        ),
      );

      expect(created, isNotNull);
      expect(created!.code, 'WO-0009');
      expect(repository.createCommands.single.productVariantId, 'variant-9');
      expect(repository.createCommands.single.bomVersionId, 'bom-2');
      expect(repository.createCommands.single.quantity, 50);
      // القائمة أُعيد جلبها بعد الإنشاء (fetchCalls زادت).
      expect(repository.fetchCalls, 2);
      expect(cubit.state, isA<ProductionLoaded>());
    });

    test('failure returns null and emits the typed failure state', () async {
      final repository = FakeProductionRepository(
        workOrders: [order],
        createFailure: const failures.ProductionValidationFailure(
          'معرف النسخة يجب أن يكون UUID صالحًا',
        ),
      );
      final cubit = ProductionCubit(
        getWorkOrders: GetWorkOrders(repository),
        createWorkOrder: CreateWorkOrder(repository),
        transitionStage: TransitionProductionStage(repository),
        recordStageOutput: RecordProductionStageOutput(repository),
        consumeMaterial: ConsumeProductionMaterial(repository),
        finalizeCost: FinalizeProductionCost(repository),
      );
      addTearDown(cubit.close);
      await cubit.fetchWorkOrders();

      final created = await cubit.createWorkOrder(
        const CreateWorkOrderCommand(
          productVariantId: 'variant-9',
          bomVersionId: 'bom-2',
          quantity: 50,
        ),
      );

      expect(created, isNull);
      // فشل الكتابة مع قائمة محملة → ProductionWriteFailure (لا يمسح القائمة).
      expect(cubit.state, isA<ProductionWriteFailure>());
      expect(
        (cubit.state as ProductionWriteFailure).failure.message,
        'معرف النسخة يجب أن يكون UUID صالحًا',
      );
      expect((cubit.state as ProductionWriteFailure).workOrders, isNotEmpty);
    });

    test('without the optional use case it fails gracefully', () async {
      final repository = FakeProductionRepository(workOrders: [order]);
      final cubit = ProductionCubit(
        getWorkOrders: GetWorkOrders(repository),
        transitionStage: TransitionProductionStage(repository),
        recordStageOutput: RecordProductionStageOutput(repository),
        consumeMaterial: ConsumeProductionMaterial(repository),
        finalizeCost: FinalizeProductionCost(repository),
      );
      addTearDown(cubit.close);
      await cubit.fetchWorkOrders();

      final created = await cubit.createWorkOrder(
        const CreateWorkOrderCommand(
          productVariantId: 'variant-9',
          bomVersionId: 'bom-2',
          quantity: 50,
        ),
      );

      expect(created, isNull);
      expect(repository.createCalls, 0);
    });
  });

  group('DEV-PQ3 stage run registry', () {
    test('recordStageOutput remembers the stage run id for later lookups',
        () async {
      final repository = FakeProductionRepository(workOrders: [order]);
      final cache = _FakeCacheService();
      final cubit = ProductionCubit(
        getWorkOrders: GetWorkOrders(repository),
        transitionStage: TransitionProductionStage(repository),
        recordStageOutput: RecordProductionStageOutput(repository),
        consumeMaterial: ConsumeProductionMaterial(repository),
        finalizeCost: FinalizeProductionCost(repository),
        cache: cache,
      );
      addTearDown(cubit.close);
      await cubit.fetchWorkOrders();

      final result = await cubit.recordStageOutput(
        RecordStageOutputCommand(
          workOrderId: 'wo-1',
          stage: ProductionStage.cutting,
          inputQty: 10,
          acceptedQty: 8,
          rejectedQty: 1,
          wasteQty: 1,
          idempotencyKey: 'idem-1',
        ),
      );

      expect(result, isNotNull);
      expect(result!.stageRunId, 'stage-run-cutting');
      expect(
        await cubit.stageRunIdFor('wo-1', ProductionStage.cutting),
        'stage-run-cutting',
      );
      // مراحل أخرى لم تُسجل بعد.
      expect(
        await cubit.stageRunIdFor('wo-1', ProductionStage.sewing),
        isNull,
      );
      expect(
        await cubit.stageRunIdFor('wo-other', ProductionStage.cutting),
        isNull,
      );
    });

    test('transitionStage remembers the new stage run id', () async {
      final repository = FakeProductionRepository(workOrders: [order]);
      final cache = _FakeCacheService();
      final cubit = ProductionCubit(
        getWorkOrders: GetWorkOrders(repository),
        transitionStage: TransitionProductionStage(repository),
        recordStageOutput: RecordProductionStageOutput(repository),
        consumeMaterial: ConsumeProductionMaterial(repository),
        finalizeCost: FinalizeProductionCost(repository),
        cache: cache,
      );
      addTearDown(cubit.close);
      await cubit.fetchWorkOrders();

      await cubit.transitionStage(
        workOrderId: 'wo-1',
        stage: ProductionStage.cutting,
      );

      expect(
        await cubit.stageRunIdFor('wo-1', ProductionStage.cutting),
        'stage-run-1',
      );
    });

    test('registry lookups on a disabled cache return null (best-effort)',
        () async {
      final repository = FakeProductionRepository(workOrders: [order]);
      // كاش معطل (Hive غير مهيأ): كل قراءة null وكل كتابة no-op.
      final cubit = ProductionCubit(
        getWorkOrders: GetWorkOrders(repository),
        transitionStage: TransitionProductionStage(repository),
        recordStageOutput: RecordProductionStageOutput(repository),
        consumeMaterial: ConsumeProductionMaterial(repository),
        finalizeCost: FinalizeProductionCost(repository),
        cache: _DisabledCacheService(),
      );
      addTearDown(cubit.close);

      expect(
        await cubit.stageRunIdFor('wo-1', ProductionStage.cutting),
        isNull,
      );
    });
  });

  group('DEV-PQ2 consumeMaterial', () {
    test('passes the command through and returns the consumption', () async {
      final repository = FakeProductionRepository(workOrders: [order]);
      final cubit = ProductionCubit(
        getWorkOrders: GetWorkOrders(repository),
        transitionStage: TransitionProductionStage(repository),
        recordStageOutput: RecordProductionStageOutput(repository),
        consumeMaterial: ConsumeProductionMaterial(repository),
        finalizeCost: FinalizeProductionCost(repository),
      );
      addTearDown(cubit.close);

      final result = await cubit.consumeMaterial(
        ConsumeMaterialCommand(
          workOrderId: 'wo-1',
          stageRunId: 'stage-run-1',
          rawMaterialId: 'rm-1',
          warehouseId: 'wh-1',
          plannedQuantity: 10,
          actualQuantity: 12,
          wasteQuantity: 2,
          unit: 'متر',
          idempotencyKey: 'idem-2',
        ),
      );

      expect(result, isNotNull);
      expect(result!.consumptionId, 'consumption-1');
      expect(repository.consumeCommands.single.stageRunId, 'stage-run-1');
      expect(repository.consumeCommands.single.unit, 'متر');
    });

    test('consumeMaterial failure returns null with a typed state',
        () async {
      final repository = FakeProductionRepository(
        workOrders: [order],
        consumeFailure: const failures.ProductionValidationFailure(
          'الكمية المخططة يجب أن تكون موجبة',
        ),
      );
      final cubit = ProductionCubit(
        getWorkOrders: GetWorkOrders(repository),
        transitionStage: TransitionProductionStage(repository),
        recordStageOutput: RecordProductionStageOutput(repository),
        consumeMaterial: ConsumeProductionMaterial(repository),
        finalizeCost: FinalizeProductionCost(repository),
      );
      addTearDown(cubit.close);
      // قائمة محمّلة أولًا — فشل الكتابة بعدها يجب ألا يمسحها.
      await cubit.fetchWorkOrders();

      final result = await cubit.consumeMaterial(
        ConsumeMaterialCommand(
          workOrderId: 'wo-1',
          stageRunId: 'stage-run-1',
          rawMaterialId: 'rm-1',
          warehouseId: 'wh-1',
          plannedQuantity: 10,
          actualQuantity: 12,
          wasteQuantity: 2,
          unit: 'متر',
          idempotencyKey: 'idem-2',
        ),
      );

      expect(result, isNull);
      expect(cubit.state, isA<ProductionWriteFailure>());
      expect(
        (cubit.state as ProductionWriteFailure).failure.message,
        'الكمية المخططة يجب أن تكون موجبة',
      );
    });

    test('write failure with no loaded list emits the plain failure',
        () async {
      // لم تُجلب القائمة بعد: الحالة الأولية — الفشل يُصدر ProductionFailure.
      final repository = FakeProductionRepository(
        workOrders: [order],
        consumeFailure: const failures.ProductionServerFailure(),
      );
      final cubit = ProductionCubit(
        getWorkOrders: GetWorkOrders(repository),
        transitionStage: TransitionProductionStage(repository),
        recordStageOutput: RecordProductionStageOutput(repository),
        consumeMaterial: ConsumeProductionMaterial(repository),
        finalizeCost: FinalizeProductionCost(repository),
      );
      addTearDown(cubit.close);

      final result = await cubit.consumeMaterial(
        ConsumeMaterialCommand(
          workOrderId: 'wo-1',
          stageRunId: 'stage-run-1',
          rawMaterialId: 'rm-1',
          warehouseId: 'wh-1',
          plannedQuantity: 10,
          actualQuantity: 12,
          wasteQuantity: 2,
          unit: 'متر',
          idempotencyKey: 'idem-2',
        ),
      );

      expect(result, isNull);
      expect(cubit.state, isA<ProductionFailure>());
      expect(cubit.state, isNot(isA<ProductionWriteFailure>()));
    });
  });
}

class FakeProductionRepository implements ProductionRepository {
  FakeProductionRepository({
    this.workOrders = const [],
    this.failure,
    failures.ProductionFailure? createFailure,
    failures.ProductionFailure? consumeFailure,
  })  : _createFailure = createFailure,
        _consumeFailure = consumeFailure;

  final List<WorkOrder> workOrders;
  final failures.ProductionFailure? failure;
  final failures.ProductionFailure? _createFailure;
  final failures.ProductionFailure? _consumeFailure;

  int fetchCalls = 0;
  int createCalls = 0;
  final List<CreateWorkOrderCommand> createCommands = [];
  final List<ConsumeMaterialCommand> consumeCommands = [];

  @override
  Future<List<WorkOrder>> getWorkOrders({
    required int page,
    required int limit,
  }) async {
    fetchCalls++;
    if (failure != null) throw failure!;
    return workOrders;
  }

  @override
  Future<CreatedWorkOrder> createWorkOrder(CreateWorkOrderCommand command) async {
    createCalls++;
    createCommands.add(command);
    if (failure != null) throw failure!;
    if (_createFailure != null) throw _createFailure!;
    return const CreatedWorkOrder(id: 'wo-new', code: 'WO-0009');
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
      stageRunId: 'stage-run-${command.stage.name}',
    );
  }

  @override
  Future<MaterialConsumption> consumeMaterial(
    ConsumeMaterialCommand command,
  ) async {
    consumeCommands.add(command);
    if (failure != null) throw failure!;
    if (_consumeFailure != null) throw _consumeFailure!;
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

/// كاش فعلي في الذاكرة — نفس عقد CacheService (write-through/read) بلا Hive.
class _FakeCacheService extends CacheService {
  final Map<String, CachedSnapshot> _store = {};

  @override
  Future<void> writeThrough(String key, Object? data) async {
    _store[key] = CachedSnapshot(data: data, cachedAt: DateTime.now());
  }

  @override
  Future<CachedSnapshot?> read(String key, {Duration? maxAge}) async =>
      _store[key];
}

/// كاش معطل — يحاكي Hive غير المهيأ في الاختبارات (كل قراءة null).
class _DisabledCacheService extends CacheService {
  @override
  Future<bool> init() async => false;

  @override
  Future<CachedSnapshot?> read(String key, {Duration? maxAge}) async => null;

  @override
  Future<void> writeThrough(String key, Object? data) async {}
}
