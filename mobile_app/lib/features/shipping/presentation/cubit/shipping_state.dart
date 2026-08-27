abstract class ShippingState {}

class ShippingInitial extends ShippingState {}

class ShippingLoading extends ShippingState {}

class ShippingLoaded extends ShippingState {
  final List<dynamic> shipments;
  ShippingLoaded(this.shipments);
}

class ShippingError extends ShippingState {
  final String message;
  ShippingError(this.message);
}
