import 'package:dio/dio.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_parsing.dart';

/// سجل تدقيق واحد (من GET /system/audit-logs).
class AuditLogEntry {
  const AuditLogEntry({
    required this.id,
    required this.userName,
    required this.action,
    required this.module,
    required this.createdAt,
  });

  factory AuditLogEntry.fromJson(Map<String, dynamic> json) => AuditLogEntry(
        id: json['id']?.toString() ?? '',
        userName: json['userName']?.toString() ?? '—',
        action: json['action']?.toString() ?? '',
        module: json['module']?.toString() ?? '',
        createdAt: DateTime.tryParse(json['createdAt']?.toString() ?? '') ??
            DateTime.now(),
      );

  final String id;
  final String userName;
  final String action;
  final String module;
  final DateTime createdAt;
}

class AuditLogsPage {
  const AuditLogsPage({
    required this.logs,
    required this.total,
    required this.pageNumber,
    this.pageSize = 50,
  });

  final List<AuditLogEntry> logs;
  final int total;
  final int pageNumber;
  final int pageSize;

  /// عدد الصفوف المُجمَّع حتى الصفحة الحالية (للعرض التراكمي).
  int get cumulative => (pageNumber - 1) * pageSize + logs.length;

  /// هل توجد صفحات تالية؟ (مقارنة رقم الصفحة × حجمها بالإجمالي —
  /// مقارنة طول الصفحة الواحدة بالإجمالي كانت تجعل الزر مفعّلًا دائمًا).
  bool get hasMore => pageNumber * pageSize < total;
}

abstract class AuditLogsState {}

class AuditLogsInitial extends AuditLogsState {}

class AuditLogsLoading extends AuditLogsState {}

class AuditLogsLoaded extends AuditLogsState {
  AuditLogsLoaded(this.page, {this.module, this.action});

  /// الفلترة الحالية (null = الكل).
  final String? module;
  final String? action;
  final AuditLogsPage page;
}

class AuditLogsError extends AuditLogsState {
  AuditLogsError(this.message);

  final String message;
}

/// SELIM-ERP W3 — cubit سجل التدقيق (GET /system/audit-logs): ترقيم +
/// تصفية بالوحدة/الفعل. الرؤية خادمية (الإداري يرى الكل، البقية
/// مدخلاتهم).
class AuditLogsCubit extends Cubit<AuditLogsState> {
  AuditLogsCubit({Dio? dio}) : super(AuditLogsInitial()) {
    _dio = dio ?? ApiClient.instance.dio;
  }

  late final Dio _dio;

  int _page = 1;
  static const int pageSize = 50;

  Future<void> load({String? module, String? action, int page = 1}) async {
    emit(AuditLogsLoading());
    _page = page;
    try {
      final response = await _dio.get<dynamic>(
        '/system/audit-logs',
        queryParameters: <String, dynamic>{
          'page': page,
          'pageSize': pageSize,
          if (module != null && module.isNotEmpty) 'module': module,
          if (action != null && action.isNotEmpty) 'action': action,
        },
      );
      final data = response.data;
      if (data is! Map) throw Exception('استجابة سجل غير صالحة');
      // data هنا Map<dynamic,dynamic> — نمرّره عبر map() ليصبح
      // Map<String,dynamic> كما تتوقع integer().
      final typed = ApiParsing.map(data, context: 'سجل التدقيق');
      final logs = <AuditLogEntry>[];
      for (final row in (data['logs'] as List? ?? [])) {
        if (row is Map) {
          logs.add(
            AuditLogEntry.fromJson(
              ApiParsing.map(row, context: 'سجل التدقيق'),
            ),
          );
        }
      }
      emit(
        AuditLogsLoaded(
          AuditLogsPage(
            logs: logs,
            total: ApiParsing.integer(typed, 'total', context: 'سجل التدقيق'),
            pageNumber: page,
            pageSize: pageSize,
          ),
          module: module,
          action: action,
        ),
      );
    } catch (error) {
      emit(AuditLogsError(ApiClient.instance.messageFor(error)));
    }
  }

  Future<void> next() =>
      load(module: (state as AuditLogsLoaded?)?.module,
          action: (state as AuditLogsLoaded?)?.action, page: _page + 1);

  Future<void> previous() => _page > 1
      ? load(module: (state as AuditLogsLoaded?)?.module,
          action: (state as AuditLogsLoaded?)?.action, page: _page - 1)
      : Future.value();
}

/// وحدات التدقيق للفلترة السريعة (مرآة قيم module عندنا).
const List<String> kAuditLogModules = [
  'الكل',
  'SALES',
  'PURCHASING',
  'INVENTORY',
  'PRODUCTION',
  'HR',
  'ACCOUNTING',
  'TREASURY',
  'SYSTEM',
  'PRINTING',
  'CUTTING',
];
