abstract class ProductionState {}

class ProductionInitial extends ProductionState {}

class ProductionLoading extends ProductionState {}

class ProductionLoaded extends ProductionState {
  final List<dynamic> workOrders;
  final List<dynamic> rawMaterials;
  final List<dynamic> warehouses;
  final String? busyWorkOrderId;

  ProductionLoaded({
    required this.workOrders,
    this.rawMaterials = const [],
    this.warehouses = const [],
    this.busyWorkOrderId,
  });

  bool isBusy(String workOrderId) => busyWorkOrderId == workOrderId;
}

class ProductionError extends ProductionState {
  final String message;
  final List<dynamic> previousWorkOrders;
  final List<dynamic> previousRawMaterials;
  final List<dynamic> previousWarehouses;

  ProductionError(
    this.message, {
    this.previousWorkOrders = const [],
    this.previousRawMaterials = const [],
    this.previousWarehouses = const [],
  });
}
