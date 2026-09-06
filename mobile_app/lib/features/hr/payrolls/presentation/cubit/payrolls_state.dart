import 'payrolls_cubit.dart';

/// MOB-8: حالات شاشة كشوف الرواتب — كل حالة تحمل المرشح الحالي كي
/// تبقى الشرائح صحيحة أثناء التحميل/الخطأ (بلا وميض).
sealed class PayrollsState {
  const PayrollsState({required this.filter});

  final PayrollStatusFilter filter;
}

final class PayrollsInitial extends PayrollsState {
  const PayrollsInitial({required super.filter});
}

final class PayrollsLoading extends PayrollsState {
  const PayrollsLoading({required super.filter});
}

final class PayrollsLoaded extends PayrollsState {
  const PayrollsLoaded({
    required this.payrolls,
    required super.filter,
    this.isRefreshing = false,
  });

  /// عناصر GET /hr/payrolls — خرائط خام بالحقول المعلنة:
  /// {id, workerId, periodStart, periodEnd, grossAmount,
  ///  advanceDeduct, absenceDeduct, netAmount, status, createdAt,
  ///  worker: {id, name, code}} (worker متداخل حرفيًا بالعقد).
  final List<Map<String, dynamic>> payrolls;
  final bool isRefreshing;
}

final class PayrollsEmpty extends PayrollsState {
  const PayrollsEmpty({required super.filter});
}

final class PayrollsError extends PayrollsState {
  const PayrollsError({required this.message, required super.filter});

  final String message;
}
