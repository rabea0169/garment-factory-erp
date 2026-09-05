import 'package:dio/dio.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:uuid/uuid.dart';

import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_parsing.dart';
import 'inventory_state.dart';

/// جلب قائمة مخزون من الـ API. يُحقن تنفيذ بديل في الاختبارات (بدون
/// مكتبات mock — نفس أسلوب الحقن في production feature عبر repository).
typedef InventoryListFetcher =
    Future<List<Map<String, dynamic>>> Function(String path, String context);

/// التنفيذ الافتراضي عبر singleton ApiClient (كما كان قبل GF-REMAINING-008).
Future<List<Map<String, dynamic>>> _apiListFetcher(
  String path,
  String context,
) async {
  final response = await ApiClient.instance.dio.get(path);
  return ApiParsing.paginatedMaps(response.data, context: context);
}

class InventoryCubit extends Cubit<InventoryState> {
  InventoryCubit({Uuid? uuid, InventoryListFetcher? listFetcher})
      : _uuid = uuid ?? const Uuid(),
        _listFetcher = listFetcher ?? _apiListFetcher,
        super(InventoryInitial());

  final Uuid _uuid;
  final InventoryListFetcher _listFetcher;

  // GF-REMAINING-008: كاش آخر قوائم ناجحة في الذاكرة فقط. Hive معلن في
  // pubspec لكنه غير مستخدم في أي ملف تحت lib/، لذا لا نُدخل بنية تخزين
  // جديدة؛ اللقطة تكفي لعرض "آخر بيانات" أثناء الانقطاع (لا mock صامت).
  InventoryLoaded? _lastLoaded;

  Future<void> fetchRawMaterials() => fetchInventoryData();

  Future<void> fetchInventoryData() async {
    emit(InventoryLoading());
    try {
      final responses = await Future.wait([
        _listFetcher('/inventory/raw-materials', 'المواد الخام'),
        _listFetcher('/inventory/finished-goods', 'المنتجات التامة'),
        _listFetcher('/inventory/raw-materials/low-stock', 'تنبيهات المخزون'),
        _listFetcher('/inventory/warehouses', 'المخازن'),
      ]);

      final loaded = InventoryLoaded(
        rawMaterials: responses[0],
        finishedGoods: responses[1],
        lowStockMaterials: responses[2],
        warehouses: responses[3],
      );
      _lastLoaded = loaded;
      emit(loaded);
    } catch (error) {
      if (_isUnauthorized(error)) {
        emit(InventoryUnauthorized());
      } else if (_isNetworkError(error)) {
        emit(InventoryOffline(snapshot: _lastLoaded));
      } else {
        emit(InventoryError(ApiClient.instance.messageFor(error)));
      }
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

  // 401: يميّز انتهاء الجلسة — ApiClient يمسح الجلسة ويعيد التوجيه للدخول.
  static bool _isUnauthorized(Object error) =>
      error is DioException && error.response?.statusCode == 401;

  // فشل الشبكة: نفس أنواع DioException في mapProductionFailure (production)
  // وmessageFor (ApiClient) — connectionError وكل أنواع timeout.
  static bool _isNetworkError(Object error) =>
      error is DioException &&
      (error.type == DioExceptionType.connectionError ||
          error.type == DioExceptionType.connectionTimeout ||
          error.type == DioExceptionType.sendTimeout ||
          error.type == DioExceptionType.receiveTimeout);
}
