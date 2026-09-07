import 'package:dio/dio.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:uuid/uuid.dart';

import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_parsing.dart';

abstract class AccountingState {}

class AccountingInitial extends AccountingState {}

class AccountingLoading extends AccountingState {}

class AccountingError extends AccountingState {
  final String message;
  AccountingError(this.message);
}

/// الحالة المحمّلة للشاشة — الأساس (السندات/الحسابات/الخزائن) كما كان،
/// مع قسمين إضافيين يُحمّلان كسولاً بعد إصدار الحالة الأساسية:
///  - القيود المحاسبية (GET /accounting/journal-entries) وبنودها.
///  - ميزان المراجعة (GET /accounting/trial-balance) مع الإجماليات ومؤشر
///    التوازن من الخادم (balanced).
///
/// فشل القسمين الإضافيين (403 لأمين الصندوق مثلًا أو انقطاع شبكة) لا يُسقط
/// الشاشة: يُخزَّن كرسالة خطأ خاصة بالقسم ليعرضها تبويبه مع إعادة محاولة،
/// بينما تبقى قوائم السندات/الحسابات/الخزائن صالحة للعرض.
class AccountingLoaded extends AccountingState {
  AccountingLoaded(
    this.vouchers,
    this.accounts,
    this.treasuries, {
    this.journalEntries = const [],
    this.journalLoading = false,
    this.journalEntriesError,
    this.trialBalanceRows = const [],
    this.trialBalanceLoading = false,
    this.trialBalanceError,
    this.totalDebit = 0,
    this.totalCredit = 0,
    this.balanced,
  });

  final List<dynamic> vouchers;
  final List<dynamic> accounts;
  final List<dynamic> treasuries;

  /// قائمة قيود اليومية ببنودها (حقل lines داخل كل قيد حسب عقد الخادم).
  final List<dynamic> journalEntries;
  final bool journalLoading;
  final String? journalEntriesError;

  /// صفوف ميزان المراجعة: {code, name, totalDebit, totalCredit, balance}.
  final List<Map<String, dynamic>> trialBalanceRows;
  final bool trialBalanceLoading;
  final String? trialBalanceError;
  final double totalDebit;
  final double totalCredit;

  /// مؤشر التوازن من الخادم (null = لم يُحمّل بعد).
  final bool? balanced;

  /// قيمة حارسة للتمييز بين «لم تُمرَّر» و«مُرِّرت null» في copyWith.
  static const Object _unset = Object();

  AccountingLoaded copyWith({
    List<dynamic>? vouchers,
    List<dynamic>? accounts,
    List<dynamic>? treasuries,
    Object? journalEntries = _unset,
    bool? journalLoading,
    Object? journalEntriesError = _unset,
    Object? trialBalanceRows = _unset,
    bool? trialBalanceLoading,
    Object? trialBalanceError = _unset,
    double? totalDebit,
    double? totalCredit,
    bool? balanced,
  }) {
    return AccountingLoaded(
      vouchers ?? this.vouchers,
      accounts ?? this.accounts,
      treasuries ?? this.treasuries,
      journalEntries: identical(journalEntries, _unset)
          ? this.journalEntries
          : journalEntries as List<dynamic>,
      journalLoading: journalLoading ?? this.journalLoading,
      journalEntriesError: identical(journalEntriesError, _unset)
          ? this.journalEntriesError
          : journalEntriesError as String?,
      trialBalanceRows: identical(trialBalanceRows, _unset)
          ? this.trialBalanceRows
          : trialBalanceRows as List<Map<String, dynamic>>,
      trialBalanceLoading:
          trialBalanceLoading ?? this.trialBalanceLoading,
      trialBalanceError: identical(trialBalanceError, _unset)
          ? this.trialBalanceError
          : trialBalanceError as String?,
      totalDebit: totalDebit ?? this.totalDebit,
      totalCredit: totalCredit ?? this.totalCredit,
      balanced: balanced ?? this.balanced,
    );
  }
}

class AccountingCubit extends Cubit<AccountingState> {
  /// dio يُحقن في الاختبارات (نمط PayrollsCubit)؛ الافتراضي عميل التطبيق.
  AccountingCubit({Dio? dio, Uuid? uuid})
      : _injectedDio = dio,
        _uuid = uuid ?? const Uuid(),
        super(AccountingInitial());

  final Dio? _injectedDio;
  final Uuid _uuid;

  Dio get _dio => _injectedDio ?? ApiClient.instance.dio;

  /// سقف limit المقبول خادميًا لكل القوائم المقسمة (PaginationDto: Max(100)) —
  /// يرفع الغطاء العملي عن الـ 20 الافتراضية دون تجاوز العقد.
  static const int _listLimit = 100;

  /// مسارات جلب أطراف السند حسب النوع — تُستخدم للتحميل الكسول عند
  /// اختيار نوع الطرف في حوار السند (بدل لصق UUID يدويًا):
  ///  CUSTOMER → GET /sales/customers (كل العملاء)
  ///  SUPPLIER → GET /suppliers
  ///  WORKER   → GET /hr/workers
  static const Map<String, String> _counterpartyEndpoints = {
    'CUSTOMER': '/sales/customers',
    'SUPPLIER': '/suppliers',
    'WORKER': '/hr/workers',
  };

  Future<void> fetchData() async {
    emit(AccountingLoading());
    try {
      final responses = await Future.wait([
        _dio.get('/accounting/vouchers',
            queryParameters: {'limit': _listLimit}),
        _dio.get('/accounting/accounts',
            queryParameters: {'limit': _listLimit}),
        _dio.get('/accounting/treasuries',
            queryParameters: {'limit': _listLimit}),
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
      return;
    }
    // الأقسام الثانوية (القيود + ميزان المراجعة) تُحمّل بعد الحالة الأساسية —
    // فشلها (403/شبكة) يُسجل داخل الحالة ولا يبدّل الشاشة إلى وضع الخطأ.
    await Future.wait([fetchJournalEntries(), fetchTrialBalance()]);
  }

  /// ACC-8: قائمة قيود اليومية ببنودها — آخر 100 قيد (ترتيب الأحدث أولًا
  /// خادميًا). الخطأ يُخزَّن في [AccountingLoaded.journalEntriesError].
  Future<void> fetchJournalEntries() async {
    if (state is! AccountingLoaded) return;
    emit((state as AccountingLoaded)
        .copyWith(journalLoading: true, journalEntriesError: null));
    try {
      final response = await _dio.get(
        '/accounting/journal-entries',
        queryParameters: {'limit': _listLimit},
      );
      if (state is! AccountingLoaded) return;
      emit((state as AccountingLoaded).copyWith(
        journalLoading: false,
        journalEntries: ApiParsing.paginatedMaps(
          response.data,
          context: 'القيود',
        ),
      ));
    } catch (error) {
      if (state is! AccountingLoaded) return;
      emit((state as AccountingLoaded).copyWith(
        journalLoading: false,
        journalEntriesError: ApiClient.instance.messageFor(error),
      ));
    }
  }

  /// ACC-8: ميزان المراجعة — استجابة غير مقسمة {data, totalDebit,
  /// totalCredit, balanced}؛ الصفوف تُطبع بأسماء الأكواد من الخادم.
  Future<void> fetchTrialBalance() async {
    if (state is! AccountingLoaded) return;
    emit((state as AccountingLoaded)
        .copyWith(trialBalanceLoading: true, trialBalanceError: null));
    try {
      final response = await _dio.get('/accounting/trial-balance');
      final payload = ApiParsing.map(response.data, context: 'ميزان المراجعة');
      if (state is! AccountingLoaded) return;
      emit((state as AccountingLoaded).copyWith(
        trialBalanceLoading: false,
        trialBalanceRows: ApiParsing.mapList(
          payload['data'],
          context: 'ميزان المراجعة',
        ),
        totalDebit: _asDouble(payload['totalDebit']),
        totalCredit: _asDouble(payload['totalCredit']),
        balanced: payload['balanced'] is bool
            ? payload['balanced'] as bool
            : null,
      ));
    } catch (error) {
      if (state is! AccountingLoaded) return;
      emit((state as AccountingLoaded).copyWith(
        trialBalanceLoading: false,
        trialBalanceError: ApiClient.instance.messageFor(error),
      ));
    }
  }

  /// جلب أسماء الأطراف المقابلة عند اختيار نوع الطرف في حوار السند —
  /// قائمة {id, code, name} من endpoint النوع (حد 100 عنصر).
  Future<List<Map<String, dynamic>>> fetchCounterparties(
    String counterpartyType,
  ) async {
    final endpoint = _counterpartyEndpoints[counterpartyType];
    if (endpoint == null) {
      throw ArgumentError('نوع طرف مقابل غير معروف: $counterpartyType');
    }
    final response = await _dio.get(
      endpoint,
      queryParameters: {'limit': _listLimit},
    );
    return ApiParsing.paginatedMaps(
      response.data,
      context: 'الأطراف المقابلة',
    );
  }

  /// القيد المحاسبي المرتبط بسند: قائمة السندات تعيد journalEntry
  /// {id, code} فقط بلا بنود (select صريح في الخدمة)، لذا نبحث القيد في
  /// القائمة المحمّلة، وإن لم نجده نجلب القيود ثم نبحث بالمعرف ثم بالكود.
  Future<Map<String, dynamic>?> findJournalEntryForVoucher(
    Map<String, dynamic> voucher,
  ) async {
    String? entryId;
    String? entryCode;
    final entry = voucher['journalEntry'];
    if (entry is Map) {
      entryId = entry['id']?.toString();
      entryCode = entry['code']?.toString();
    }
    entryId ??= voucher['journalEntryId']?.toString();
    if (entryId == null && entryCode == null) return null;

    var found = _matchJournalEntry(entryId, entryCode);
    if (found != null) return found;
    // ليست محمّلة بعد (أو أُعيد التحديث) — جرّب جلب القيود ثم أعد البحث.
    await fetchJournalEntries();
    return _matchJournalEntry(entryId, entryCode);
  }

  Map<String, dynamic>? _matchJournalEntry(String? entryId, String? entryCode) {
    if (state is! AccountingLoaded) return null;
    for (final entry in (state as AccountingLoaded).journalEntries) {
      if (entry is! Map) continue;
      if (entryId != null && entry['id']?.toString() == entryId) {
        return Map<String, dynamic>.from(entry);
      }
      if (entryId == null &&
          entryCode != null &&
          entry['code']?.toString() == entryCode) {
        return Map<String, dynamic>.from(entry);
      }
    }
    return null;
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
      await _dio.post(
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
    } catch (error) {
      // UAT-FIX: فشل إنشاء السند لا يمسح القوائم المعروضة خلف الحوار —
      // الحوار يعرض رسالة الخادم الفعلية عبر rethrow.
      if (state is! AccountingLoaded) {
        emit(AccountingError(
            'تعذر حفظ السند: ${ApiClient.instance.messageFor(error)}'));
      }
      rethrow;
    }
  }

  static double _asDouble(Object? value) {
    if (value is num) return value.toDouble();
    if (value is String) {
      final parsed = double.tryParse(value);
      if (parsed != null) return parsed;
    }
    return 0;
  }
}
