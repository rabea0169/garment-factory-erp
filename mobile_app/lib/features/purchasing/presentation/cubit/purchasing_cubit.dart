import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/network/api_client.dart';

abstract class PurchasingState {}

class PurchasingInitial extends PurchasingState {}

class PurchasingLoading extends PurchasingState {}

class PurchasingLoaded extends PurchasingState {
  PurchasingLoaded({
    required this.orders,
    required this.suppliers,
    required this.rawMaterials,
  });

  final List<dynamic> orders;
  final List<dynamic> suppliers;
  final List<dynamic> rawMaterials;
}

class PurchasingError extends PurchasingState {
  PurchasingError(this.message);

  final String message;
}

class PurchasingCubit extends Cubit<PurchasingState> {
  PurchasingCubit() : super(PurchasingInitial());

  Future<void> fetchData() async {
    emit(PurchasingLoading());
    try {
      final responses = await Future.wait([
        ApiClient.instance.dio.get('/purchasing/orders'),
        ApiClient.instance.dio.get('/suppliers'),
        ApiClient.instance.dio.get('/inventory/raw-materials'),
      ]);
      emit(
        PurchasingLoaded(
          orders: ApiClient.extractPaginatedData(responses[0].data),
          suppliers: ApiClient.extractPaginatedData(responses[1].data),
          rawMaterials: ApiClient.extractPaginatedData(responses[2].data),
        ),
      );
    } catch (_) {
      emit(PurchasingError('تعذر تحميل أوامر الشراء والموردين والخامات'));
    }
  }

  Future<void> createPurchaseOrder({
    required String supplierId,
    required String paymentType,
    DateTime? dueDate,
    String? notes,
    required List<Map<String, dynamic>> items,
  }) async {
    await ApiClient.instance.dio.post('/purchasing', data: {
      'supplierId': supplierId,
      'paymentType': paymentType,
      if (dueDate != null) 'dueDate': dueDate.toUtc().toIso8601String(),
      if (notes != null && notes.isNotEmpty) 'notes': notes,
      'items': items,
    });
    await fetchData();
  }

  Future<void> receivePurchaseOrder({
    required String purchaseOrderId,
    required List<Map<String, dynamic>> items,
    String? notes,
  }) async {
    await ApiClient.instance.dio.post(
      '/purchasing/$purchaseOrderId/receipts',
      data: {
        'items': items,
        if (notes != null && notes.isNotEmpty) 'notes': notes,
      },
    );
    await fetchData();
  }
}
