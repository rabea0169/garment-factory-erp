import 'package:flutter_bloc/flutter_bloc.dart';
import '../../../../core/network/api_client.dart';

abstract class SalesState {}

class SalesInitial extends SalesState {}

class SalesLoading extends SalesState {}

class SalesLoaded extends SalesState {
  final List<dynamic> orders;
  SalesLoaded(this.orders);
}

class SalesError extends SalesState {
  final String message;
  SalesError(this.message);
}

class SalesCubit extends Cubit<SalesState> {
  SalesCubit() : super(SalesInitial());

  Future<void> fetchOrders() async {
    emit(SalesLoading());
    try {
      final dio = ApiClient.instance.dio;
      final response = await dio.get('/sales/orders');
      emit(SalesLoaded(ApiClient.extractPaginatedData(response.data)));
    } catch (e) {
      emit(SalesError('حدث خطأ أثناء تحميل المبيعات: $e'));
    }
  }

  Future<List<dynamic>> fetchCustomers() async {
    final response = await ApiClient.instance.dio.get('/sales/customers');
    return ApiClient.extractPaginatedData(response.data);
  }

  Future<List<dynamic>> fetchProducts() async {
    final response = await ApiClient.instance.dio.get('/products');
    return ApiClient.extractPaginatedData(response.data);
  }

  Future<void> createCustomerPayment({
    required String customerId,
    String? salesOrderId,
    required double amount,
    String? notes,
  }) async {
    await ApiClient.instance.dio.post('/sales/customer-payments', data: {
      'customerId': customerId,
      if (salesOrderId != null) 'salesOrderId': salesOrderId,
      'amount': amount,
      if (notes != null && notes.isNotEmpty) 'notes': notes,
    });
    await fetchOrders();
  }

  Future<void> createSalesOrder({
    required String customerId,
    required String paymentType,
    required double discount,
    required List<Map<String, dynamic>> items,
  }) async {
    await ApiClient.instance.dio.post('/sales/orders', data: {
      'customerId': customerId,
      'paymentType': paymentType,
      'discount': discount,
      'items': items,
    });
    await fetchOrders();
  }

  Future<void> createCustomer({
    required String name,
    String? phone,
    String? email,
    String? address,
  }) async {
    final dio = ApiClient.instance.dio;
    await dio.post('/sales/customers', data: {
      'name': name,
      if (phone != null && phone.isNotEmpty) 'phone': phone,
      if (email != null && email.isNotEmpty) 'email': email,
      if (address != null && address.isNotEmpty) 'address': address,
    });
    await fetchOrders();
  }
}
