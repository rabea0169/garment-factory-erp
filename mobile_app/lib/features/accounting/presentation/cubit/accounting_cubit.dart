import 'package:dio/dio.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:uuid/uuid.dart';

import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_parsing.dart';

abstract class AccountingState {}

class AccountingInitial extends AccountingState {}

class AccountingLoading extends AccountingState {}

class AccountingLoaded extends AccountingState {
  final List<dynamic> vouchers;
  final List<dynamic> accounts;
  final List<dynamic> treasuries;

  AccountingLoaded(this.vouchers, this.accounts, [this.treasuries = const []]);
}

class AccountingError extends AccountingState {
  final String message;
  AccountingError(this.message);
}

class AccountingCubit extends Cubit<AccountingState> {
  AccountingCubit({Uuid? uuid})
      : _uuid = uuid ?? const Uuid(),
        super(AccountingInitial());

  final Uuid _uuid;

  Future<void> fetchData() async {
    emit(AccountingLoading());
    try {
      final dio = ApiClient.instance.dio;
      final responses = await Future.wait([
        dio.get('/accounting/vouchers'),
        dio.get('/accounting/accounts'),
        dio.get('/accounting/treasuries'),
      ]);
      emit(
        AccountingLoaded(
          ApiParsing.paginatedMaps(
            responses[0].data,
            context: 'السندات',
          ),
          ApiParsing.paginatedMaps(
            responses[1].data,
            context: 'الحسابات',
          ),
          ApiParsing.paginatedMaps(
            responses[2].data,
            context: 'الخزائن',
          ),
        ),
      );
    } catch (error) {
      emit(AccountingError(ApiClient.instance.messageFor(error)));
    }
  }

  Future<void> createVoucher({
    required String type,
    required double amount,
    required String description,
    required String treasuryId,
    String? reference,
    String? counterpartyType,
    String? counterpartyId,
  }) async {
    try {
      await ApiClient.instance.dio.post(
        '/accounting/vouchers',
        data: {
          'type': type,
          'amount': amount,
          'description': description,
          'treasuryId': treasuryId,
          if (reference != null && reference.isNotEmpty) 'reference': reference,
          if (counterpartyType != null && counterpartyType.isNotEmpty)
            'counterpartyType': counterpartyType,
          if (counterpartyId != null && counterpartyId.isNotEmpty)
            'counterpartyId': counterpartyId,
        },
        options: Options(headers: {'Idempotency-Key': _uuid.v4()}),
      );
      await fetchData();
    } catch (_) {
      emit(AccountingError(
          'تعذر حفظ السند. تحقق من الخزينة والمبلغ والصلاحيات.'));
      rethrow;
    }
  }
}
