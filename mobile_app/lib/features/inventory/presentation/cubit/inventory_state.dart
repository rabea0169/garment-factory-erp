// States
abstract class InventoryState {}

class InventoryInitial extends InventoryState {}

class InventoryLoading extends InventoryState {}

class InventorySaving extends InventoryState {}

class InventoryLoaded extends InventoryState {
  final List<dynamic> rawMaterials;
  final List<dynamic> finishedGoods;
  final List<dynamic> lowStockMaterials;
  final List<dynamic> warehouses;

  InventoryLoaded({
    required this.rawMaterials,
    required this.finishedGoods,
    required this.lowStockMaterials,
    this.warehouses = const [],
  });
}

class InventoryError extends InventoryState {
  final String message;
  InventoryError(this.message);
}
