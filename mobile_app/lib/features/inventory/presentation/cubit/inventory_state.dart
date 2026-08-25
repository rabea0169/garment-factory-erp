// States
abstract class InventoryState {}

class InventoryInitial extends InventoryState {}

class InventoryLoading extends InventoryState {}

class InventoryLoaded extends InventoryState {
  final List<dynamic> rawMaterials;
  final List<dynamic> finishedGoods;
  final List<dynamic> lowStockMaterials;

  InventoryLoaded({
    required this.rawMaterials,
    required this.finishedGoods,
    required this.lowStockMaterials,
  });
}

class InventoryError extends InventoryState {
  final String message;
  InventoryError(this.message);
}
