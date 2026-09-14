import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:garment_factory_erp/features/hr/worker_report/presentation/cubit/worker_report_cubit.dart';
import 'package:garment_factory_erp/features/hr/worker_report/presentation/cubit/worker_report_state.dart';

/// SELIM-ERP W5 — cubit تقرير العامل: الجلب بنطاق التاريخ الصحيح
/// (YYYY-MM-DD) + الافتراضي بداية الشهر حتى اليوم + عقد الاستجابة
/// الملزم (worker/summary) + خطأ الشبكة برسالة عربية.
void main() {
  late _ScriptedAdapter adapter;
  late Dio dio;

  setUp(() {
    adapter = _ScriptedAdapter();
    dio = Dio(BaseOptions(baseUrl: 'https://erp.test'))
      ..httpClientAdapter = adapter;
  });

  Map<String, dynamic> reportBody() => {
        'worker': {
          'id': 'w-1',
          'code': 'WKR-0001',
          'name': 'عامل تجريبي',
          'pieceRate': 5.5,
        },
        'range': {'from': null, 'to': null},
        'summary': {
          'totalAdvances': 100,
          'totalReceipts': 30,
          'totalPieces': 10,
          'productionValue': 55,
          'closingNet': -840,
          'presentDays': 2,
          'absentDays': 1,
        },
        'advances': [],
        'receipts': [],
        'attendance': [],
        'productions': [],
        'payrolls': [],
      };

  test('الجلب الافتراضي: بداية الشهر الحالي حتى اليوم بصيغة YYYY-MM-DD',
      () async {
    adapter.nextBody = reportBody();
    final cubit = WorkerReportCubit(workerId: 'w-1', dio: dio);
    await cubit.fetchReport();

    final query = adapter.requests.single.queryParameters;
    final now = DateTime.now();
    expect(query['from'],
        '${now.year}-${now.month.toString().padLeft(2, '0')}-01');
    expect(query['to'], matches(RegExp(r'^\d{4}-\d{2}-\d{2}$')));
    expect(adapter.requests.single.path, '/hr/workers/w-1/report');
    expect(cubit.state, isA<WorkerReportLoaded>());
  });

  test('النطاق الصريح يمر كما هو وإعادة الجلب تحدّث الحالة', () async {
    adapter.nextBody = reportBody();
    final cubit = WorkerReportCubit(workerId: 'w-1', dio: dio);
    await cubit.fetchReport(from: DateTime(2026, 8, 1), to: DateTime(2026, 8, 31));

    final firstQuery = adapter.requests.first.queryParameters;
    expect(firstQuery['from'], '2026-08-01');
    expect(firstQuery['to'], '2026-08-31');

    adapter.nextBody = reportBody();
    await cubit.fetchReport(from: DateTime(2026, 9, 1), to: DateTime(2026, 9, 30));
    final secondQuery = adapter.requests.last.queryParameters;
    expect(secondQuery['from'], '2026-09-01');
    final state = cubit.state as WorkerReportLoaded;
    expect(state.from, DateTime(2026, 9, 1));
  });

  test('استجابة بلا worker/summary → FormatException كرسالة خطأ', () async {
    adapter.nextBody = {'advances': []};
    final cubit = WorkerReportCubit(workerId: 'w-1', dio: dio);
    await cubit.fetchReport();
    expect(cubit.state, isA<WorkerReportError>());
    expect((cubit.state as WorkerReportError).message, isNotEmpty);
  });

  test('خطأ الشبكة → WorkerReportError', () async {
    adapter.throwOnNext = true;
    final cubit = WorkerReportCubit(workerId: 'w-1', dio: dio);
    await cubit.fetchReport();
    expect(cubit.state, isA<WorkerReportError>());
    expect((cubit.state as WorkerReportError).message, isNotEmpty);
  });

  test('payload ليس Map → خطأ (عقد الاستجابة ملزم)', () async {
    adapter.nextBody = <dynamic>[1, 2];
    final cubit = WorkerReportCubit(workerId: 'w-1', dio: dio);
    await cubit.fetchReport();
    expect(cubit.state, isA<WorkerReportError>());
  });

  test('defaultFrom/defaultTo: بداية الشهر واليوم بلا وقت', () {
    final now = DateTime(2026, 9, 14, 18, 30);
    expect(WorkerReportCubit.defaultFrom(now), DateTime(2026, 9, 1));
    expect(WorkerReportCubit.defaultTo(now), DateTime(2026, 9, 14));
  });
}

class _ScriptedAdapter implements HttpClientAdapter {
  Object? nextBody;
  bool throwOnNext = false;
  final List<RequestOptions> requests = <RequestOptions>[];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<List<int>>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    requests.add(options);
    if (throwOnNext) {
      throw DioException.connectionError(
        requestOptions: options,
        reason: 'انقطاع الشبكة',
      );
    }
    final body = nextBody ?? const <String, dynamic>{};
    return ResponseBody.fromString(
      jsonEncode(body),
      200,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}
