import 'package:flutter_bloc/flutter_bloc.dart';
import '../../../../core/network/api_client.dart';

abstract class AccountingState {}

class AccountingInitial extends AccountingState {}
class AccountingLoading extends AccountingState {}
class AccountingLoaded extends AccountingState {
  final List<dynamic> vouchers;
  final List<dynamic> accounts;
  AccountingLoaded(this.vouchers, this.accounts);
}
class AccountingError extends AccountingState {
  final String message;
  AccountingError(this.message);
}

class AccountingCubit extends Cubit<AccountingState> {
  AccountingCubit() : super(AccountingInitial());

  Future<void> fetchData() async {
    emit(AccountingLoading());
    try {
      final dio = ApiClient.instance.dio;
      final vouchersRes = await dio.get('/accounting/vouchers');
      final accountsRes = await dio.get('/accounting/accounts');
      emit(AccountingLoaded(vouchersRes.data, accountsRes.data));
    } catch (e) {
      emit(AccountingError('حدث خطأ أثناء تحميل الحسابات: $e'));
    }
  }
}
