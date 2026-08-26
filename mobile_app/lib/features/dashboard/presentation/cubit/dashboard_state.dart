import 'package:equatable/equatable.dart';

/// MOBILE-F03 (Flutter side): state حقيقي للوحة التحكم بدلاً من بيانات hardcoded.
class DashboardStats {
  const DashboardStats({
    required this.date,
    required this.salesToday,
    required this.productionToday,
    required this.inventoryValue,
    required this.pendingWorkOrders,
    required this.treasuryBalance,
    required this.lowStockMaterials,
    required this.recentTransactions,
  });

  /// ISO-8601 timestamp من الخادم — يُنسَّق عربيًا في الـ UI.
  final String date;
  final double salesToday;
  final int productionToday;
  final double inventoryValue;
  final int pendingWorkOrders;
  final double treasuryBalance;
  final int lowStockMaterials;
  final List<DashboardTransaction> recentTransactions;

  factory DashboardStats.fromJson(Map<String, dynamic> json) {
    final today = (json['today'] as Map<String, dynamic>?) ?? const {};
    final inventory = (json['inventory'] as Map<String, dynamic>?) ?? const {};
    final recent = json['recentTransactions'];
    return DashboardStats(
      date: (today['date'] as String?) ?? '',
      salesToday: toDouble(today['salesTotal']),
      productionToday: toInt(today['productionPieces']),
      inventoryValue: toDouble(inventory['inventoryValue']),
      pendingWorkOrders: toInt(json['pendingWorkOrders']),
      treasuryBalance: toDouble(json['treasuryBalance']),
      lowStockMaterials: toInt(inventory['lowStockMaterials']),
      recentTransactions: recent is List
          ? recent
              .map((e) => DashboardTransaction.fromJson(
                  Map<String, dynamic>.from(e as Map)))
              .toList(growable: false)
          : const [],
    );
  }

  static double toDouble(Object? value) {
    if (value is num) return value.toDouble();
    if (value is String) return double.tryParse(value) ?? 0;
    return 0;
  }

  static int toInt(Object? value) {
    if (value is int) return value;
    if (value is num) return value.toInt();
    if (value is String) return int.tryParse(value) ?? 0;
    return 0;
  }
}

class DashboardTransaction extends Equatable {
  const DashboardTransaction({
    required this.code,
    required this.description,
    required this.amount,
    required this.type,
    required this.date,
  });

  final String code;
  final String description;
  final double amount;
  final String type; // RECEIPT | PAYMENT
  final String date; // ISO-8601

  factory DashboardTransaction.fromJson(Map<String, dynamic> json) {
    return DashboardTransaction(
      code: (json['code'] as String?) ?? '',
      description: (json['description'] as String?) ?? '',
      amount: DashboardStats.toDouble(json['amount']),
      type: (json['type'] as String?) ?? '',
      date: (json['date'] as String?) ?? '',
    );
  }

  @override
  List<Object?> get props => [code, description, amount, type, date];
}

abstract class DashboardState extends Equatable {
  const DashboardState();

  @override
  List<Object?> get props => const [];
}

class DashboardInitial extends DashboardState {
  const DashboardInitial();
}

class DashboardLoading extends DashboardState {
  const DashboardLoading();
}

class DashboardLoaded extends DashboardState {
  const DashboardLoaded(this.stats);

  final DashboardStats stats;

  @override
  List<Object?> get props => [stats];
}

class DashboardError extends DashboardState {
  const DashboardError(this.message);

  final String message;

  @override
  List<Object?> get props => [message];
}

class DashboardEmpty extends DashboardState {
  const DashboardEmpty();
}
