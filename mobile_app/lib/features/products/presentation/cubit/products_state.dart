import 'package:flutter_bloc/flutter_bloc.dart';

abstract class ProductsState {}

class ProductsInitial extends ProductsState {}

class ProductsLoading extends ProductsState {}

class ProductsLoaded extends ProductsState {
  final List<dynamic> products;
  ProductsLoaded(this.products);
}

class ProductsError extends ProductsState {
  final String message;
  ProductsError(this.message);
}
