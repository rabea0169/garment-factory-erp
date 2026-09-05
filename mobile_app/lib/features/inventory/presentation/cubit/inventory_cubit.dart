import 'package:dio/dio.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:uuid/uuid.dart';

import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_parsing.dart';
import 'inventory_state.dart';

class InventoryCubit extends Cubit<InventoryState> {
  /// [dio] يُحقن في الاختبارات؛ الافتراضي عميل التطبيق المشترك.
  InventoryCubit({Uuid? uuid, Dio? dio})
      : _uuid = uuid ?? const Uuid(),
        _injectedDio = dio,
        super(InventoryInitial());

  final Uuid _uuid;
  final Dio? _injectedDio;

  Dio get _dio => _injectedDio ?? ApiClient.instance.dio;

  Future<void> fetchRawMaterials() => fetchInventoryData();

  Future<void> fetchInventoryData() async {
    emit(InventoryLoading());
    try {
      final dio = _dio;
      final responses = await Future.wait([
        dio.get('/inventory/raw-materials'),
        dio.get('/inventory/finished-goods'),
        dio.get('/inventory/raw-materials/low-stock'),
        dio.get('/inventory/warehouses'),
      ]);

      emit(
        InventoryLoaded(
          rawMaterials: ApiParsing.paginatedMaps(
            responses[0].data,
            context: 'المواد الخام',
          ),
          finishedGoods: ApiParsing.paginatedMaps(
            responses[1].data,
            context: 'المنتجات التامة',
          ),
          lowStockMaterials: ApiParsing.paginatedMaps(
            responses[2].data,
            context: 'تنبيهات المخزون',
          ),
          warehouses: ApiParsing.paginatedMaps(
            responses[3].data,
            context: 'المخازن',
          ),
        ),
      );
    } catch (error) {
      // GF-REMAINING-008: انقطاع الشبكة له حالة مخصصة حتى تظهر الواجهة
      // شاشة "لا يوجد اتصال" بدل خطأ عام غير مفهوم.
      if (ApiClient.isNetworkError(error)) {
        emit(InventoryOffline());
        return;
      }
      emit(InventoryError(ApiClient.instance.messageFor(error)));
    }
  }

  Future<void> addRawMaterialStock(
    String id,
    double quantity,
    double cost,
  ) async {
    emit(InventorySaving());
    try {
      await ApiClient.instance.dio.post(
        '/inventory/raw-materials/$id/add-stock',
        data: {'quantity': quantity, 'costPerUnit': cost},
        options: Options(headers: {'Idempotency-Key': _uuid.v4()}),
      );
      await fetchInventoryData();
    } catch (error) {
      emit(InventoryError(ApiClient.instance.messageFor(error)));
      rethrow;
    }
  }

  Future<void> receiveStock({
    required String rawMaterialId,
    required String warehouseId,
    required double quantity,
    required double unitCost,
    String? reference,
    String? notes,
  }) async {
    await _movement(
      '/inventory/movements/receive',
      {
        'rawMaterialId': rawMaterialId,
        'warehouseId': warehouseId,
        'quantity': quantity,
        'unitCost': unitCost,
        if (reference != null && reference.trim().isNotEmpty)
          'reference': reference.trim(),
        if (notes != null && notes.trim().isNotEmpty) 'notes': notes.trim(),
      },
    );
  }

  Future<void> issueStock({
    required String rawMaterialId,
    required String warehouseId,
    required double quantity,
    String? reference,
    String? notes,
  }) async {
    await _movement(
      '/inventory/movements/issue',
      {
        'rawMaterialId': rawMaterialId,
        'warehouseId': warehouseId,
        'quantity': quantity,
        if (reference != null && reference.trim().isNotEmpty)
          'reference': reference.trim(),
        if (notes != null && notes.trim().isNotEmpty) 'notes': notes.trim(),
      },
    );
  }

  Future<void> adjustStock({
    required String rawMaterialId,
    required String warehouseId,
    required double quantityDelta,
    required String reason,
    String? reference,
  }) async {
    await _movement(
      '/inventory/movements/adjust',
      {
        'rawMaterialId': rawMaterialId,
        'warehouseId': warehouseId,
        'quantityDelta': quantityDelta,
        'reason': reason.trim(),
        if (reference != null && reference.trim().isNotEmpty)
          'reference': reference.trim(),
      },
    );
  }

  Future<void> wasteStock({
    required String rawMaterialId,
    required String warehouseId,
    required double quantity,
    required String reason,
    String? reference,
  }) async {
    await _movement(
      '/inventory/movements/waste',
      {
        'rawMaterialId': rawMaterialId,
        'warehouseId': warehouseId,
        'quantity': quantity,
        'reason': reason.trim(),
        if (reference != null && reference.trim().isNotEmpty)
          'reference': reference.trim(),
      },
    );
  }

  Future<void> _movement(String path, Map<String, dynamic> data) async {
    emit(InventorySaving());
    try {
      await ApiClient.instance.dio.post(
        path,
        data: data,
        options: Options(
          headers: {'Idempotency-Key': _uuid.v4()},
        ),
      );
      await fetchInventoryData();
    } catch (error) {
      emit(InventoryError(ApiClient.instance.messageFor(error)));
      rethrow;
    }
  }
}
