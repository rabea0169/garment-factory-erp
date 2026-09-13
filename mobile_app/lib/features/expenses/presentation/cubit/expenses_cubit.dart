import 'package:dio/dio.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_parsing.dart';

/// حالات شاشة المصاريف وبنودها (SELIM-ERP W1).
abstract class ExpensesState {}

class ExpensesInitial extends ExpensesState {}

class ExpensesLoading extends ExpensesState {}

/// القائمة المحمّلة: المصاريف المفلترة + البنود + ملخص النطاق غير المفلتر
/// (بطاقة العنوان وشرائح البنود تبقى صحيحة مهما كان الفلتر — نمط
/// list+stats في عروض الأسعار).
class ExpensesLoaded extends ExpensesState {
  final List<Map<String, dynamic>> expenses;
  final List<Map<String, dynamic>> categories;
  final Map<String, dynamic> stats;

  ExpensesLoaded(
    this.expenses, {
    this.categories = const [],
    this.stats = const {},
  });
}

class ExpensesError extends ExpensesState {
  final String message;
  ExpensesError(this.message);
}

/// Cubit المصاريف وبنودها — يستدعي وحدة /expenses الخادمية (SELIM-B1)
/// المقلدة من Selim ERP.
///
/// عقد الخادم:
/// - GET /expenses?search&categoryId&from&to&page&limit →
///   {items, total, page, limit, pages, totals:{count,amount}}.
/// - GET /expenses/summary (بنفس المرشحات) → {totalCount, totalAmount,
///   byCategory:[{categoryId, categoryName, count, totalAmount}]}.
/// - GET /expenses/categories → قائمة خامًا (بلا ترقيم) مع _count.expenses.
/// - POST /expenses {categoryId, amount, date?, notes?, treasuryId?} —
///   مع خزينة: خصم رصيد + قيد Dr GENERAL_EXPENSE/Cr CASH.
/// - PATCH /expenses/:id — للمصروفات غير المقيدة فقط.
/// - DELETE /expenses/:id — يعكس القيد ويعيد رصيد الخزينة.
/// - POST /expenses/categories {name, notes?} — الاسم فريد؛ PATCH/DELETE
///   لبنود المصاريف.
class ExpensesCubit extends Cubit<ExpensesState> {
  /// dio يُحقن في الاختبارات (نمط AccountingCubit)؛ الافتراضي عميل التطبيق.
  ExpensesCubit({Dio? dio})
      : _injectedDio = dio,
        super(ExpensesInitial());

  final Dio? _injectedDio;

  Dio get _dio => _injectedDio ?? ApiClient.instance.dio;

  /// سقف limit المقبول خادميًا (الحد الأقصى 100).
  static const int _listLimit = 100;

  String _search = '';
  String _categoryId = 'ALL';

  /// جلب المصاريف المفلترة + البنود + الملخص غير المفلتر للبطاقة.
  Future<void> fetch({String? categoryId, String? search}) async {
    if (categoryId != null) _categoryId = categoryId;
    if (search != null) _search = search;
    emit(ExpensesLoading());
    try {
      final params = <String, dynamic>{'limit': _listLimit};
      if (_categoryId.isNotEmpty && _categoryId != 'ALL') {
        params['categoryId'] = _categoryId;
      }
      if (_search.trim().isNotEmpty) params['search'] = _search.trim();
      final listResponse =
          await _dio.get('/expenses', queryParameters: params);
      final expenses = _pageItems(listResponse.data);

      // الملخص غير المفلتر (بطاقة العنوان) — فشله صامت.
      Map<String, dynamic> stats = const {};
      try {
        final summaryResponse = await _dio.get('/expenses/summary');
        if (summaryResponse.data is Map<String, dynamic>) {
          stats = summaryResponse.data as Map<String, dynamic>;
        }
      } catch (_) {}

      // البنود (لكل من القائمة والملخص) — فشلها صامت أيضًا.
      List<Map<String, dynamic>> categories = const [];
      try {
        categories = await fetchCategories();
      } catch (_) {}

      emit(ExpensesLoaded(expenses,
          categories: categories, stats: stats));
    } catch (error) {
      emit(ExpensesError(ApiClient.instance.messageFor(error)));
    }
  }

  /// جلب بنود المصاريف (قائمة خامًا مع عدّاد الاستخدام) — عامة للنموذج
  /// والحوار وتبويب البنود.
  Future<List<Map<String, dynamic>>> fetchCategories() async {
    final response = await _dio.get('/expenses/categories');
    return ApiParsing.mapList(response.data, context: 'بنود المصاريف');
  }

  /// إنشاء بند مصروف — الاسم فريد (الازدواج → رسالة خادم عربية).
  Future<bool> createCategory(String name, {String? notes}) async {
    try {
      await _dio.post('/expenses/categories', data: {
        'name': name.trim(),
        if (notes != null && notes.trim().isNotEmpty) 'notes': notes.trim(),
      });
      await fetch();
      return true;
    } catch (_) {
      return false;
    }
  }

  /// تعديل بند مصروف — الاسم الجديد يظل فريدًا.
  Future<bool> updateCategory(String id, String name, {String? notes}) async {
    try {
      await _dio.patch('/expenses/categories/$id', data: {
        'name': name.trim(),
        if (notes != null && notes.trim().isNotEmpty) 'notes': notes.trim(),
      });
      await fetch();
      return true;
    } catch (_) {
      return false;
    }
  }

  /// حذف بند — ممنوع إن استُخدم في مصروفات (Restrict خادمي).
  Future<bool> deleteCategory(String id) async {
    try {
      await _dio.delete('/expenses/categories/$id');
      await fetch();
      return true;
    } catch (_) {
      return false;
    }
  }

  /// حذف مصروف — يعكس القيد ويعيد رصيد الخزينة داخل معاملة واحدة.
  Future<bool> deleteExpense(String id) async {
    try {
      await _dio.delete('/expenses/$id');
      await fetch();
      return true;
    } catch (_) {
      return false;
    }
  }

  /// إنشاء مصروف من خريطة JSON جاهزة (يبنيها حوار الإدخال) — الخطأ
  /// يُعاد رفعه ليعرض الحوار رسالة الخادم (رصيد الخزينة غير كاف...).
  Future<Map<String, dynamic>?> create(Map<String, dynamic> data) async {
    final response = await _dio.post('/expenses', data: data);
    await fetch();
    return (response.data is Map<String, dynamic>)
        ? response.data as Map<String, dynamic>
        : null;
  }

  /// استخراج صفحات القائمة بالتوافق مع عقدي الترقيم {items,...}/{data,...}.
  List<Map<String, dynamic>> _pageItems(Object? payload) {
    if (payload is Map && payload['items'] is List) {
      return ApiParsing.mapList(payload['items'], context: 'المصاريف');
    }
    return ApiParsing.paginatedMaps(payload, context: 'المصاريف');
  }
}
