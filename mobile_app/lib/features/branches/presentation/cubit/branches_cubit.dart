import 'package:dio/dio.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_parsing.dart';

/// فرع شركة واحد (نقل CompanyBranch من المرجع — SPRINT 89).
class BranchEntry {
  const BranchEntry({
    required this.id,
    required this.name,
    required this.isMain,
    required this.isActive,
    required this.salesCount,
    required this.purchaseCount,
    required this.productsCount,
    this.address,
    this.phone,
    this.manager,
  });

  factory BranchEntry.fromJson(Map<String, dynamic> json) => BranchEntry(
        id: json['id']?.toString() ?? '',
        name: json['name']?.toString() ?? '—',
        address: json['address']?.toString(),
        phone: json['phone']?.toString(),
        manager: json['manager']?.toString(),
        isMain: json['isMain'] == true,
        isActive: json['isActive'] == true,
        salesCount: _intOf(json['salesCount']),
        purchaseCount: _intOf(json['purchaseCount']),
        productsCount: _intOf(json['productsCount']),
      );

  static int _intOf(Object? value) {
    if (value is num) return value.toInt();
    return int.tryParse(value?.toString() ?? '') ?? 0;
  }

  final String id;
  final String name;
  final String? address;
  final String? phone;
  final String? manager;
  final bool isMain;
  final bool isActive;
  final int salesCount;
  final int purchaseCount;
  final int productsCount;
}

abstract class BranchesState {}

class BranchesInitial extends BranchesState {}

class BranchesLoading extends BranchesState {}

class BranchesLoaded extends BranchesState {
  BranchesLoaded(this.branches);

  final List<BranchEntry> branches;
}

class BranchesSaving extends BranchesState {
  BranchesSaving(this.previous);

  /// القائمة الحالية تُعرض أثناء الحفظ (لا وميض فراغ).
  final List<BranchEntry> previous;
}

class BranchesError extends BranchesState {
  BranchesError(this.message);

  final String message;
}

/// SELIM-ERP W4 — cubit الفروع: قائمة (GET /branches) + إنشاء/تحديث/حذف
/// (GM/SA خادميًا) بنفس قواعد المرجع: رئيسي واحد فقط، لا حذف للرئيسي.
class BranchesCubit extends Cubit<BranchesState> {
  BranchesCubit({Dio? dio}) : _injectedDio = dio, super(BranchesInitial());

  final Dio? _injectedDio;

  Dio get _dio => _injectedDio ?? ApiClient.instance.dio;

  Future<void> load() async {
    emit(BranchesLoading());
    try {
      final response = await _dio.get<dynamic>('/branches');
      final branches = <BranchEntry>[];
      final body = response.data;
      // الاستجابة الكنونية { branches: [...] } — تسامح مع قائمة مباشرة.
      Object? rows = body is Map ? body['branches'] : body;
      if (rows is List) {
        for (final row in rows) {
          if (row is Map) {
            branches.add(
              BranchEntry.fromJson(ApiParsing.map(row, context: 'الفروع')),
            );
          }
        }
      }
      emit(BranchesLoaded(branches));
    } catch (error) {
      emit(BranchesError(ApiClient.instance.messageFor(error)));
    }
  }

  Future<bool> create({
    required String name,
    String? address,
    String? phone,
    String? manager,
    bool isMain = false,
  }) =>
      _save(
        () => _dio.post<dynamic>(
          '/branches',
          data: <String, dynamic>{
            'name': name.trim(),
            if (address != null && address.trim().isNotEmpty)
              'address': address.trim(),
            if (phone != null && phone.trim().isNotEmpty)
              'phone': phone.trim(),
            if (manager != null && manager.trim().isNotEmpty)
              'manager': manager.trim(),
            'isMain': isMain,
          },
        ),
      );

  Future<bool> update(
    String id, {
    String? name,
    String? address,
    String? phone,
    String? manager,
    bool? isMain,
    bool? isActive,
  }) =>
      _save(
        () => _dio.patch<dynamic>(
          '/branches/$id',
          data: <String, dynamic>{
            if (name != null && name.trim().isNotEmpty) 'name': name.trim(),
            // null صريح = مسح الحقل (نفس دلالة المرجع).
            if (address != null) 'address': address.trim(),
            if (phone != null) 'phone': phone.trim(),
            if (manager != null) 'manager': manager.trim(),
            if (isMain != null) 'isMain': isMain,
            if (isActive != null) 'isActive': isActive,
          },
        ),
      );

  Future<bool> remove(String id) => _save(
        () => _dio.delete<dynamic>('/branches/$id'),
      );

  /// تنفيذ عملية كتابة ثم إعادة تحميل القائمة (كما في المرجع بعد كل
  /// حفظ). رسالة الخطأ (مثل «لا يمكن حذف الفرع الرئيسي») تصل عبر state.
  Future<bool> _save(Future<Object?> Function() action) async {
    final previous =
        state is BranchesLoaded ? (state as BranchesLoaded).branches : const <BranchEntry>[];
    emit(BranchesSaving(previous));
    try {
      await action();
      await load();
      return true;
    } catch (error) {
      emit(BranchesError(ApiClient.instance.messageFor(error)));
      return false;
    }
  }
}
