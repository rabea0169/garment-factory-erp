import 'package:dio/dio.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_parsing.dart';

/// مركز تكلفة واحد (من GET /accounting/cost-centers).
class CostCenterEntry {
  const CostCenterEntry({
    required this.id,
    required this.code,
    required this.name,
    required this.isActive,
    required this.budgetsCount,
  });

  factory CostCenterEntry.fromJson(Map<String, dynamic> json) =>
      CostCenterEntry(
        id: json['id']?.toString() ?? '',
        code: json['code']?.toString() ?? '',
        name: json['name']?.toString() ?? '',
        isActive: json['isActive'] != false,
        budgetsCount:
            ApiParsing.integer(json, 'budgetsCount', context: 'مراكز التكلفة'),
      );

  final String id;
  final String code;
  final String name;
  final bool isActive;
  final int budgetsCount;
}

abstract class CostCentersState {}

class CostCentersInitial extends CostCentersState {}

class CostCentersLoading extends CostCentersState {}

class CostCentersLoaded extends CostCentersState {
  CostCentersLoaded(this.centers, this.pendingAction);

  final List<CostCenterEntry> centers;

  /// نداء إنشاء/تحديث/حذق جارٍ (زر الإجراء يعرض دورانًا).
  final bool pendingAction;
}

class CostCentersError extends CostCentersState {
  CostCentersError(this.message);

  final String message;
}

/// SELIM-ERP W3 — cubit مراكز التكلفة (CRUD /accounting/cost-centers).
class CostCentersCubit extends Cubit<CostCentersState> {
  CostCentersCubit({Dio? dio})
      : _injectedDio = dio,
        super(CostCentersInitial());

  final Dio? _injectedDio;

  /// يُحل عند أول نداء — بيئات الاختبار قد لا تهيئ ApiClient.
  Dio get _dio => _injectedDio ?? ApiClient.instance.dio;

  Future<void> load() async {
    emit(CostCentersLoading());
    try {
      final response = await _dio.get<dynamic>('/accounting/cost-centers');
      final centers = <CostCenterEntry>[];
      if (response.data is Map && response.data['centers'] is List) {
        for (final row in response.data['centers'] as List) {
          if (row is Map) {
            centers.add(
              CostCenterEntry.fromJson(
                ApiParsing.map(row, context: 'مراكز التكلفة'),
              ),
            );
          }
        }
      }
      emit(CostCentersLoaded(centers, false));
    } catch (error) {
      emit(CostCentersError(ApiClient.instance.messageFor(error)));
    }
  }

  Future<bool> create({required String code, required String name}) async {
    return _mutate(
      () => _dio.post<dynamic>(
        '/accounting/cost-centers',
        data: <String, dynamic>{'code': code, 'name': name},
      ),
    );
  }

  Future<bool> update({
    required String id,
    String? name,
    bool? isActive,
  }) async {
    return _mutate(
      () => _dio.patch<dynamic>(
        '/accounting/cost-centers/$id',
        data: <String, dynamic>{
          if (name != null) 'name': name,
          if (isActive != null) 'isActive': isActive,
        },
      ),
    );
  }

  Future<bool> delete(String id) async {
    return _mutate(() => _dio.delete<dynamic>('/accounting/cost-centers/$id'));
  }

  /// ينفذ نداء تغيير: يعيد true عند النجاح ويُعيد التحميل.
  Future<bool> _mutate(Future<dynamic> Function() call) async {
    final current = state;
    if (current is! CostCentersLoaded) return false;
    emit(CostCentersLoaded(current.centers, true));
    try {
      await call();
      await load();
      return true;
    } catch (error) {
      // أعد الحالة السابقة مع رسالة (رسالة الخطأ تُعرض من المستدعي).
      emit(CostCentersLoaded(current.centers, false));
      _lastError = ApiClient.instance.messageFor(error);
      return false;
    }
  }

  /// رسالة آخر فشل تغيير (يعرضها المستدعي في SnackBar).
  String? _lastError;
  String? get lastError => _lastError;
}
