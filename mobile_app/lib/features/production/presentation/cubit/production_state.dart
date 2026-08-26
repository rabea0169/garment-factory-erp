import '../../domain/entities/work_order.dart';
import '../../domain/failures/production_failure.dart' as failures;

sealed class ProductionState {
  const ProductionState();
}

final class ProductionInitial extends ProductionState {
  const ProductionInitial();
}

final class ProductionLoading extends ProductionState {
  const ProductionLoading();
}

final class ProductionLoaded extends ProductionState {
  const ProductionLoaded({required this.workOrders, this.isRefreshing = false});

  final List<WorkOrder> workOrders;
  final bool isRefreshing;
}

final class ProductionEmpty extends ProductionState {
  const ProductionEmpty();
}

final class ProductionUnauthorized extends ProductionState {
  const ProductionUnauthorized();
}

final class ProductionOffline extends ProductionState {
  const ProductionOffline();
}

final class ProductionFailure extends ProductionState {
  const ProductionFailure(this.failure);

  final failures.ProductionFailure failure;
}
