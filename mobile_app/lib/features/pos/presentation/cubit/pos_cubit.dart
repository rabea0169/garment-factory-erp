import 'package:dio/dio.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:uuid/uuid.dart';

import '../../../../core/network/api_client.dart';
import '../../../../core/services/cache_service.dart';
import '../../../../core/services/outbox_service.dart';
import '../../../../core/services/qr_tlv.dart';

/// SELIM-ERP W2 — Cubit نقطة البيع (POS.tsx في Selim ERP).
///
/// التصميم:
/// - **الكتالوج**: يُجلب من GET /pos/catalog ويُخزن في CacheService
///   (read-through) — عند فقد الاتصال تعمل الشاشة من آخر نسخة ناجحة.
/// - **السلة**: أسعار خادمية معروضة فقط — الإجماليات محليًا للعرض
///   والخادم يعيد حسابها عند البيع (لا ثقة بالعميل).
/// - **البيع**: POST /pos/quick-sale بمفتاح idempotency — عند فقد
///   الاتصال يُدرج في طابور Outbox ويسلم لاحقًا بنفس المفتاح (offline).
/// - **الإيصار**: الرد الخادمي يركّب الحمولة كاملة؛ البيع المعلق يبني
///   إيصارًا محليًا مؤقتًا (QR نصي — TLV يحتاج بيانات التسجيل الخادمية).

/// بند سلة نقطة البيع.
class PosCartItem {
  const PosCartItem({
    required this.variantId,
    required this.name,
    required this.code,
    required this.size,
    required this.color,
    required this.unitPrice,
    required this.quantity,
    this.wholesalePrice,
    this.availableQty,
  });

  final String variantId;
  final String name;
  final String code;
  final String size;
  final String color;
  final double unitPrice;
  final int quantity;

  /// سعر الجملة من الكتالوج — يُستخدم عند تبديل مستوى السعر.
  final double? wholesalePrice;
  final int? availableQty;

  double get lineTotal => unitPrice * quantity;

  PosCartItem copyWith({int? quantity}) => PosCartItem(
        variantId: variantId,
        name: name,
        code: code,
        size: size,
        color: color,
        unitPrice: unitPrice,
        quantity: quantity ?? this.quantity,
        wholesalePrice: wholesalePrice,
        availableQty: availableQty,
      );

  Map<String, dynamic> toMap() => <String, dynamic>{
        'variantId': variantId,
        'name': name,
        'code': code,
        'size': size,
        'color': color,
        'unitPrice': unitPrice,
        'quantity': quantity,
        if (wholesalePrice != null) 'wholesalePrice': wholesalePrice,
        if (availableQty != null) 'availableQty': availableQty,
      };
}

/// مستوى السعر (قطاعي/جملة) — نفس PosPriceLevel الخادمي.
enum PosPriceLevel { retail, wholesale }

/// نتيجة إتمام البيع — إيصار جاهز للطباعة.
class PosReceipt {
  const PosReceipt({
    required this.code,
    required this.items,
    required this.subtotal,
    required this.discount,
    required this.vatAmount,
    required this.total,
    required this.qrPayload,
    required this.pendingOffline,
    this.customerName = 'عميل نقدي',
    this.createdAt,
  });

  final String code;
  final List<Map<String, dynamic>> items;
  final double subtotal;
  final double discount;
  final double vatAmount;
  final double total;
  final String qrPayload;
  final bool pendingOffline;
  final String customerName;
  final DateTime? createdAt;
}

/// حالات نقطة البيع.
abstract class PosState {}

class PosInitial extends PosState {}

class PosLoading extends PosState {}

/// جاهز: كتالوج محمّل (شبكة أو كاش) + سلة العمل الحالية.
class PosReady extends PosState {
  PosReady({
    required this.catalog,
    required this.cart,
    required this.fromCache,
    required this.priceLevel,
    this.discount = 0,
    this.message,
  });

  final List<PosCartItem> catalog;
  final List<PosCartItem> cart;
  final bool fromCache;
  final PosPriceLevel priceLevel;
  final double discount;
  final String? message;

  double get subtotal => cart.fold(0, (sum, item) => sum + item.lineTotal);
  double get vat => _round2((subtotal - discount) * 0.14);
  double get total => _round2(subtotal - discount + vat);
  int get itemCount => cart.fold(0, (sum, item) => sum + item.quantity);

  static double _round2(double value) =>
      (value * 100).roundToDouble() / 100;

  PosReady copyWith({
    List<PosCartItem>? catalog,
    List<PosCartItem>? cart,
    bool? fromCache,
    PosPriceLevel? priceLevel,
    double? discount,
    String? message,
    bool clearMessage = false,
  }) =>
      PosReady(
        catalog: catalog ?? this.catalog,
        cart: cart ?? this.cart,
        fromCache: fromCache ?? this.fromCache,
        priceLevel: priceLevel ?? this.priceLevel,
        discount: discount ?? this.discount,
        message: clearMessage ? null : (message ?? this.message),
      );
}

class PosError extends PosState {
  PosError(this.message);
  final String message;
}

class PosCubit extends Cubit<PosState> {
  PosCubit({
    Dio? dio,
    CacheService? cache,
    OutboxService? outbox,
    Uuid? uuid,
  })  : _dio = dio,
        _cache = cache ?? CacheService.instance,
        _outbox = outbox ?? OutboxService.instance,
        _uuid = uuid ?? const Uuid(),
        super(PosInitial());

  /// مفتاح كاش كتالوج نقطة البيع في CacheService.
  static const String catalogCacheKey = 'pos_catalog';

  /// ضريبة القيمة المضافة المعروضة محليًا (الخادم يحسم).
  static const double localVatRate = 0.14;

  final Dio? _dio;
  final CacheService _cache;
  final OutboxService _outbox;
  final Uuid _uuid;

  Dio get dio => _dio ?? ApiClient.instance.dio;

  /// جلب الكتالوج — شبكة أولًا ثم كاش عند فشل الاتصال.
  Future<void> loadCatalog() async {
    emit(PosLoading());
    try {
      final response = await dio.get(
        '/pos/catalog',
        queryParameters: <String, dynamic>{'limit': 300},
      );
      final items = _parseCatalog(response.data);
      // write-through: الكاش يُحدَّث لحظة نجاح الشبكة.
      await _cache.writeThrough(catalogCacheKey, {
        'items': items.map((item) => item.toMap()).toList(),
      });
      emit(PosReady(
        catalog: items,
        cart: _currentCart(),
        fromCache: false,
        priceLevel: PosPriceLevel.retail,
      ));
    } catch (error) {
      // سقوط الشبكة: آخر كتالوج ناجح (حتى أسبوع — نقطة البيع تحدّثه
      // أول الدوام عادة عند عودة الاتصال).
      final snapshot = await _cache.read(
        catalogCacheKey,
        maxAge: const Duration(days: 7),
      );
      if (snapshot != null && snapshot.data is Map) {
        emit(PosReady(
          catalog: _parseCatalog(snapshot.data),
          cart: const [],
          fromCache: true,
          priceLevel: PosPriceLevel.retail,
          message: 'بيانات مخزنة — بلا اتصال',
        ));
        return;
      }
      emit(PosError(ApiClient.instance.messageFor(error)));
    }
  }

  List<PosCartItem> _currentCart() {
    final state = this.state;
    return state is PosReady ? state.cart : const <PosCartItem>[];
  }

  List<PosCartItem> _parseCatalog(Object? data) {
    if (data is! Map) return const [];
    final rows = data['items'];
    if (rows is! List) return const [];
    final items = <PosCartItem>[];
    for (final row in rows) {
      if (row is! Map) continue;
      final variantId = row['variantId']?.toString();
      if (variantId == null || variantId.isEmpty) continue;
      items.add(PosCartItem(
        variantId: variantId,
        name: row['name']?.toString() ?? '',
        code: row['code']?.toString() ?? '',
        size: row['size']?.toString() ?? '',
        color: row['color']?.toString() ?? '',
        unitPrice: _asDouble(row['retailPrice']),
        quantity: 0,
        wholesalePrice: row['wholesalePrice'] == null
            ? null
            : _asDouble(row['wholesalePrice']),
        availableQty: row['availableQty'] is int
            ? row['availableQty'] as int
            : int.tryParse('${row['availableQty']}'),
      ));
    }
    return items;
  }

  static double _asDouble(Object? value) {
    if (value is num) return value.toDouble();
    return double.tryParse('${value ?? 0}') ?? 0;
  }

  /// إضافة صنف للسلة — يضيف للكمية إن كان موجودًا.
  void addToCart(PosCartItem item, {int quantity = 1}) {
    final state = this.state;
    if (state is! PosReady) return;
    final cart = [...state.cart];
    final index = cart.indexWhere((line) => line.variantId == item.variantId);
    if (index >= 0) {
      cart[index] =
          cart[index].copyWith(quantity: cart[index].quantity + quantity);
    } else {
      cart.add(item.copyWith(quantity: quantity));
    }
    emit(state.copyWith(cart: cart, clearMessage: true));
  }

  /// تعديل كمية بند (حذف عند الصفر أو أقل).
  void setQuantity(String variantId, int quantity) {
    final state = this.state;
    if (state is! PosReady) return;
    if (quantity <= 0) {
      removeLine(variantId);
      return;
    }
    final cart = [
      for (final line in state.cart)
        if (line.variantId == variantId)
          line.copyWith(quantity: quantity)
        else
          line,
    ];
    emit(state.copyWith(cart: cart, clearMessage: true));
  }

  /// حذف بند من السلة.
  void removeLine(String variantId) {
    final state = this.state;
    if (state is! PosReady) return;
    emit(state.copyWith(
      cart: state.cart.where((line) => line.variantId != variantId).toList(),
      clearMessage: true,
    ));
  }

  /// تفريغ السلة والخصم.
  void clearCart() {
    final state = this.state;
    if (state is! PosReady) return;
    emit(state.copyWith(cart: const [], discount: 0, clearMessage: true));
  }

  /// تبديل مستوى السعر (قطاعي/جملة) — يعيد تسعير السلة من الكتالوج
  /// (المصدر) لا من قيم محفوظة بالعميل.
  void togglePriceLevel() {
    final state = this.state;
    if (state is! PosReady) return;
    final next = state.priceLevel == PosPriceLevel.retail
        ? PosPriceLevel.wholesale
        : PosPriceLevel.retail;
    final catalogByVariant = {
      for (final item in state.catalog) item.variantId: item,
    };
    final cart = [
      for (final line in state.cart)
        if (catalogByVariant.containsKey(line.variantId))
          _pricedLine(catalogByVariant[line.variantId]!, next, line.quantity)
        else
          line,
    ];
    emit(state.copyWith(cart: cart, priceLevel: next, clearMessage: true));
  }

  PosCartItem _pricedLine(
    PosCartItem catalogItem,
    PosPriceLevel level,
    int quantity,
  ) {
    return PosCartItem(
      variantId: catalogItem.variantId,
      name: catalogItem.name,
      code: catalogItem.code,
      size: catalogItem.size,
      color: catalogItem.color,
      unitPrice: level == PosPriceLevel.wholesale
          ? (catalogItem.wholesalePrice ?? catalogItem.unitPrice)
          : catalogItem.unitPrice,
      quantity: quantity,
      wholesalePrice: catalogItem.wholesalePrice,
      availableQty: catalogItem.availableQty,
    );
  }

  /// خصم نقدي على الفاتورة (الخادم يعيد التحقق عند البيع).
  void setDiscount(double value) {
    final state = this.state;
    if (state is! PosReady) return;
    emit(state.copyWith(
      discount: value < 0 ? 0 : value,
      clearMessage: true,
    ));
  }

  /// حل الباركود: GET /pos/barcode/:code — عند فشل الاتصال يبحث في
  /// الكتالوج المحمّل (الكود أو ضمن الاسم).
  Future<PosCartItem?> resolveBarcode(String code) async {
    try {
      final response = await dio.get('/pos/barcode/$code');
      final row = response.data;
      if (row is! Map) return null;
      return PosCartItem(
        variantId: row['variantId']?.toString() ?? '',
        name: row['name']?.toString() ?? '',
        code: row['code']?.toString() ?? '',
        size: row['size']?.toString() ?? '',
        color: row['color']?.toString() ?? '',
        unitPrice: _asDouble(row['retailPrice']),
        quantity: 0,
        wholesalePrice: row['wholesalePrice'] == null
            ? null
            : _asDouble(row['wholesalePrice']),
      );
    } catch (_) {
      return _resolveFromCache(code);
    }
  }

  PosCartItem? _resolveFromCache(String code) {
    final state = this.state;
    if (state is! PosReady) return null;
    final normalized = code.trim();
    for (final item in state.catalog) {
      if (item.code == normalized || normalized.contains(item.code)) {
        return item;
      }
    }
    return null;
  }

  /// بحث نصي في الكتالوج المحمّل (اسم أو كود).
  List<PosCartItem> searchCatalog(String query) {
    final state = this.state;
    if (state is! PosReady) return const [];
    final q = query.trim();
    if (q.isEmpty) return state.catalog;
    return state.catalog
        .where((item) => item.name.contains(q) || item.code.contains(q))
        .toList();
  }

  /// إتمام البيع — شبكة أو طابور offline. يرجع إيصارًا جاهزًا للطباعة.
  Future<PosReceipt?> checkout() async {
    final state = this.state;
    if (state is! PosReady || state.cart.isEmpty) return null;
    final idempotencyKey = _uuid.v4();
    final body = <String, dynamic>{
      'items': [
        for (final line in state.cart)
          {
            'productVariantId': line.variantId,
            'quantity': line.quantity,
          }
      ],
      'discount': state.discount,
      'priceLevel':
          state.priceLevel == PosPriceLevel.wholesale ? 'WHOLESALE' : 'RETAIL',
    };

    try {
      final response = await dio.post(
        '/pos/quick-sale',
        data: body,
        options: Options(
          headers: <String, dynamic>{'Idempotency-Key': idempotencyKey},
        ),
      );
      final receipt = _receiptFromResponse(response.data);
      if (receipt != null) {
        clearCart();
      }
      return receipt;
    } catch (error) {
      // فقد الاتصال فقط → طابور offline؛ أخطاء الخادم (400/409) تظهر
      // للمستخدم مباشرة ولا تُصفّ في الطابور.
      if (_isConnectivityError(error)) {
        final enqueued = await _outbox.enqueue(
          method: 'POST',
          path: '/pos/quick-sale',
          body: body,
          idempotencyKey: idempotencyKey,
        );
        if (enqueued != null) {
          final receipt = _pendingReceipt(state);
          clearCart();
          return receipt;
        }
      }
      emit(PosError(ApiClient.instance.messageFor(error)));
      return null;
    }
  }

  bool _isConnectivityError(Object error) {
    if (error is! DioException) return false;
    switch (error.type) {
      case DioExceptionType.connectionError:
      case DioExceptionType.connectionTimeout:
      case DioExceptionType.receiveTimeout:
      case DioExceptionType.sendTimeout:
        return true;
      default:
        // أنواع الشبكة المتغايرة (SocketException داخل error).
        return '${error.error}'.contains('SocketException') ||
            '${error.error}'.contains('Connection');
    }
  }

  PosReceipt _pendingReceipt(PosReady state) {
    final now = DateTime.now();
    return PosReceipt(
      code: 'POS-PENDING-${now.millisecondsSinceEpoch}',
      items: [for (final line in state.cart) line.toMap()],
      subtotal: state.subtotal,
      discount: state.discount,
      vatAmount: state.vat,
      total: state.total,
      // بلا بيانات تسجيل خادمية offline → QR نصي (نفس سقوط الخادم).
      qrPayload: QrTlv.buildPayload(
        sellerName: '',
        vatNumber: '',
        code: 'POS-PENDING',
        total: state.total,
        vatAmount: state.vat,
        createdAt: now,
      ),
      pendingOffline: true,
      createdAt: now,
    );
  }

  PosReceipt? _receiptFromResponse(Object? data) {
    if (data is! Map) return null;
    final items = <Map<String, dynamic>>[];
    final rawItems = data['items'];
    if (rawItems is List) {
      for (final row in rawItems) {
        if (row is Map) {
          items.add(Map<String, dynamic>.from(row));
        }
      }
    }
    return PosReceipt(
      code: data['code']?.toString() ?? '',
      items: items,
      subtotal: _asDouble(data['subtotal']),
      discount: _asDouble(data['discount']),
      vatAmount: _asDouble(data['vatAmount']),
      total: _asDouble(data['total']),
      qrPayload: data['qrPayload']?.toString() ?? '',
      pendingOffline: false,
      customerName: data['customerName']?.toString() ?? 'عميل نقدي',
    );
  }
}
