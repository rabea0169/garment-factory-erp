import 'package:dio/dio.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:uuid/uuid.dart';

import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_parsing.dart';

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
  PurchasingCubit({Uuid? uuid})
      : _uuid = uuid ?? const Uuid(),
        super(PurchasingInitial());

  final Uuid _uuid;

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
          orders: ApiParsing.paginatedMaps(
            responses[0].data,
            context: 'أوامر الشراء',
          ),
          suppliers: ApiParsing.paginatedMaps(
            responses[1].data,
            context: 'الموردين',
          ),
          rawMaterials: ApiParsing.paginatedMaps(
            responses[2].data,
            context: 'المواد الخام',
          ),
        ),
      );
    } catch (error) {
      emit(PurchasingError(ApiClient.instance.messageFor(error)));
    }
  }

  Future<void> createPurchaseOrder({
    required String supplierId,
    required String paymentType,
    DateTime? dueDate,
    String? notes,
    required List<Map<String, dynamic>> items,
  }) async {
    await ApiClient.instance.dio.post(
      '/purchasing',
      data: {
        'supplierId': supplierId,
        'paymentType': paymentType,
        if (dueDate != null) 'dueDate': dueDate.toUtc().toIso8601String(),
        if (notes != null && notes.isNotEmpty) 'notes': notes,
        'items': items,
      },
      options: Options(headers: {'Idempotency-Key': _uuid.v4()}),
    );
    await fetchData();
  }

  Future<void> returnToSupplier({
    required String purchaseOrderId,
    required String purchaseOrderItemId,
    required double quantity,
    String? notes,
  }) async {
    await ApiClient.instance.dio.post(
      '/purchasing/$purchaseOrderId/return',
      data: {
        'purchaseOrderItemId': purchaseOrderItemId,
        'quantity': quantity,
        if (notes != null && notes.trim().isNotEmpty) 'notes': notes.trim(),
      },
      options: Options(headers: {'Idempotency-Key': _uuid.v4()}),
    );
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
      options: Options(headers: {'Idempotency-Key': _uuid.v4()}),
    );
    await fetchData();
  }
}
