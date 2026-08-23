import 'package:flutter_bloc/flutter_bloc.dart';

abstract class ProductionState {}

class ProductionInitial extends ProductionState {}

class ProductionLoading extends ProductionState {}

class ProductionLoaded extends ProductionState {
  final List<dynamic> workOrders;

  ProductionLoaded(this.workOrders);
}

class ProductionError extends ProductionState {
  final String message;
  ProductionError(this.message);
}
