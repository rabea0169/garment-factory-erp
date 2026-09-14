import 'package:dio/dio.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_parsing.dart';

/// حركة واحدة في كشف الحساب (نفس شكل حركات الخادم).
class StatementMovement {
  const StatementMovement({
    required this.date,
    required this.type,
    required this.ref,
    required this.description,
    required this.debit,
    required this.credit,
    required this.balanceAfter,
  });

  factory StatementMovement.fromJson(Map<String, dynamic> json) =>
      StatementMovement(
        date: DateTime.tryParse(json['date']?.toString() ?? '') ??
            DateTime.now(),
        type: json['type']?.toString() ?? '',
        ref: json['ref']?.toString() ?? '',
        description: json['description']?.toString() ?? '',
        debit: ApiParsing.number(json, 'debit', context: 'كشف الحساب'),
        credit: ApiParsing.number(json, 'credit', context: 'كشف الحساب'),
        balanceAfter: ApiParsing.number(json, 'balanceAfter',
            context: 'كشف الحساب'),
      );

  final DateTime date;
  final String type;
  final String ref;
  final String description;
  final double debit;
  final double credit;
  final double balanceAfter;

  /// تسمية الحركة بالعربية (نفس تسميات الخادم).
  String get typeLabel {
    switch (type) {
      case 'INVOICE':
        return 'فاتورة';
      case 'RECEIPT':
        return 'سند';
      case 'RETURN':
        return 'مرتجع';
      default:
        return type;
    }
  }
}

/// كشف حساب كامل (عميل أو مورد) — نفس بنية استجابة الخادم.
class PartyStatement {
  const PartyStatement({
    required this.partyType,
    required this.id,
    required this.code,
    required this.name,
    required this.phone,
    required this.currentBalance,
    required this.openingBalance,
    required this.closingBalance,
    required this.totalDebit,
    required this.totalCredit,
    required this.movementsCount,
    required this.movements,
    required this.from,
    required this.to,
  });

  factory PartyStatement.fromJson(Map<String, dynamic> json) {
    final party = json['party'] is Map
        ? ApiParsing.map(json['party'], context: 'كشف الحساب')
        : const <String, dynamic>{};
    final totals = json['totals'] is Map
        ? ApiParsing.map(json['totals'], context: 'كشف الحساب')
        : const <String, dynamic>{};
    final movements = <StatementMovement>[];
    if (json['movements'] is List) {
      for (final row in json['movements'] as List) {
        if (row is Map) {
          movements.add(
            StatementMovement.fromJson(
              ApiParsing.map(row, context: 'كشف الحساب'),
            ),
          );
        }
      }
    }
    return PartyStatement(
      partyType: party['type']?.toString() ?? 'customer',
      id: party['id']?.toString() ?? '',
      code: party['code']?.toString() ?? '',
      name: party['name']?.toString() ?? '',
      phone: party['phone']?.toString(),
      currentBalance: ApiParsing.number(party, 'currentBalance',
          context: 'كشف الحساب'),
      openingBalance: ApiParsing.number(json, 'openingBalance',
          context: 'كشف الحساب'),
      closingBalance: ApiParsing.number(json, 'closingBalance',
          context: 'كشف الحساب'),
      totalDebit:
          ApiParsing.number(totals, 'debit', context: 'كشف الحساب'),
      totalCredit:
          ApiParsing.number(totals, 'credit', context: 'كشف الحساب'),
      movementsCount:
          ApiParsing.integer(totals, 'count', context: 'كشف الحساب'),
      movements: movements,
      from: DateTime.tryParse(json['from']?.toString() ?? '') ?? DateTime.now(),
      to: DateTime.tryParse(json['to']?.toString() ?? '') ?? DateTime.now(),
    );
  }

  final String partyType;
  final String id;
  final String code;
  final String name;
  final String? phone;
  final double currentBalance;
  final double openingBalance;
  final double closingBalance;
  final double totalDebit;
  final double totalCredit;
  final int movementsCount;
  final List<StatementMovement> movements;
  final DateTime from;
  final DateTime to;

  bool get isCustomer => partyType == 'customer';
}

/// تجزئة حركات الكشف إلى صفحات للطباعة (PDF صفحة A4 لكل دفعة).
///
/// [rowsPerPage] عدد الصفوف بكل صفحة (24 يترك مساحة آمنة للترويسة).
List<List<StatementMovement>> chunkStatementRows(
  List<StatementMovement> rows, {
  int rowsPerPage = 24,
}) {
  if (rowsPerPage < 1) rowsPerPage = 24;
  final pages = <List<StatementMovement>>[];
  for (var i = 0; i < rows.length; i += rowsPerPage) {
    pages.add(rows.sublist(i, (i + rowsPerPage).clamp(0, rows.length)));
  }
  return pages.isEmpty ? const [[]] : pages;
}

abstract class PartyStatementState {}

class PartyStatementInitial extends PartyStatementState {}

class PartyStatementLoading extends PartyStatementState {}

class PartyStatementLoaded extends PartyStatementState {
  PartyStatementLoaded(this.statement, {required this.from, required this.to});

  final PartyStatement statement;
  final DateTime from;
  final DateTime to;
}

class PartyStatementError extends PartyStatementState {
  PartyStatementError(this.message);

  final String message;
}

/// SELIM-ERP W3 — cubit كشف حساب الطرف (GET /financial-reports/
/// customer-statement/:id أو supplier-statement/:id).
class PartyStatementCubit extends Cubit<PartyStatementState> {
  PartyStatementCubit({Dio? dio, this.isCustomer = true})
      : _injectedDio = dio,
        super(PartyStatementInitial());

  final bool isCustomer;
  final Dio? _injectedDio;

  /// يُحل عند أول نداء — بيئات الاختبار قد لا تهيئ ApiClient.
  Dio get _dio => _injectedDio ?? ApiClient.instance.dio;

  Future<void> load(
    String partyId, {
    DateTime? from,
    DateTime? to,
  }) async {
    emit(PartyStatementLoading());
    final endpoint =
        isCustomer ? 'customer-statement' : 'supplier-statement';
    try {
      final response = await _dio.get<dynamic>(
        '/financial-reports/$endpoint/$partyId',
        queryParameters: <String, dynamic>{
          'from': _iso(from ?? DateTime.now().subtract(const Duration(days: 90))),
          'to': _iso(to ?? DateTime.now()),
        },
      );
      if (response.data is! Map) {
        throw Exception('استجابة كشف حساب غير صالحة');
      }
      emit(
        PartyStatementLoaded(
          PartyStatement.fromJson(
            ApiParsing.map(response.data, context: 'كشف الحساب'),
          ),
          from: from ?? DateTime.now().subtract(const Duration(days: 90)),
          to: to ?? DateTime.now(),
        ),
      );
    } catch (error) {
      emit(PartyStatementError(ApiClient.instance.messageFor(error)));
    }
  }

  static String _iso(DateTime date) => date.toIso8601String().substring(0, 10);
}
