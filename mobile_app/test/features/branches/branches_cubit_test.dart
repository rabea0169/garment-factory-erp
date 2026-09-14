import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:garment_factory_erp/features/branches/presentation/cubit/branches_cubit.dart';

/// SELIM-ERP W4 — cubit الفروع: قائمة مرتبة (الرئيسي أولًا) + إنشاء/تحديث/
/// حذف عبر Dio مبرمج، والفشل يصل كرسالة عربية عبر BranchesError.
void main() {
  late _ScriptedAdapter adapter;
  late Dio dio;

  setUp(() {
    adapter = _ScriptedAdapter();
    dio = Dio(BaseOptions(baseUrl: 'https://erp.test'))
      ..httpClientAdapter = adapter;
  });

  BranchesCubit newCubit() => BranchesCubit(dio: dio);

  group('load', () {
    test('يعيد الفروع بالشكل الكنوني { branches: [...] } مع العدادات', () async {
      adapter.nextBody = {
        'branches': [
          {
            'id': 'b-1',
            'name': 'الفرع الرئيسي',
            'isMain': true,
            'isActive': true,
            'salesCount': 5,
            'purchaseCount': 2,
            'productsCount': 9,
            'address': 'القاهرة',
          },
          {
            'id': 'b-2',
            'name': 'فرع الجيزة',
            'isMain': false,
            'isActive': false,
            'salesCount': 0,
            'purchaseCount': 0,
            'productsCount': 0,
          },
        ],
      };
      final cubit = newCubit();
      await cubit.load();
      final state = cubit.state;
      expect(state, isA<BranchesLoaded>());
      final branches = (state as BranchesLoaded).branches;
      expect(branches, hasLength(2));
      expect(branches.first.isMain, isTrue);
      expect(branches.first.salesCount, 5);
      expect(branches.first.address, 'القاهرة');
      expect(branches[1].isActive, isFalse);
      expect(adapter.requests.single.path, '/branches');
    });

    test('خطأ الشبكة → BranchesError برسالة', () async {
      adapter.throwOnNext = true;
      final cubit = newCubit();
      await cubit.load();
      expect(cubit.state, isA<BranchesError>());
      expect((cubit.state as BranchesError).message, isNotEmpty);
    });
  });

  group('create', () {
    test('يرسل الاسم المقصوص والحقول الموجبة فقط', () async {
      adapter.nextBody = {'branches': []};
      final cubit = newCubit();
      await cubit.load();
      final ok = await cubit.create(
        name: '  فرع الإسكندرية  ',
        address: '   ',
        phone: '0100',
        isMain: true,
      );
      expect(ok, isTrue);
      final request = adapter.requests[1];
      expect(request.method, 'POST');
      final body = request.data as Map<String, dynamic>;
      expect(body['name'], 'فرع الإسكندرية');
      expect(body['isMain'], isTrue);
      // الفراغ لا يُرسل (نفس trim في المرجع).
      expect(body.containsKey('address'), isFalse);
      expect(body['phone'], '0100');
    });
  });

  group('update', () {
    test('null صريح في الحقول النصية يمسحها (patch جزئي)', () async {
      adapter.nextBody = {'branches': []};
      final cubit = newCubit();
      await cubit.load();
      await cubit.update(
        'b-2',
        address: '',
        manager: null,
        isMain: true,
      );
      // الطلب ذو الفهرس 1 هو الـ PATCH نفسه (0 = التحميل الأولي،
      // 2 = إعادة التحميل بعد الحفظ — _save يعيد الجلب دائمًا).
      final request = adapter.requests[1];
      final body = request.data as Map<String, dynamic>;
      expect(body['address'], '');
      expect(body['manager'], isNull);
      expect(body['isMain'], isTrue);
      expect(request.path, '/branches/b-2');
    });
  });

  group('remove', () {
    test('يستدعي DELETE ثم يعيد التحميل', () async {
      adapter.nextBody = {'success': true};
      final cubit = newCubit();
      await cubit.load();
      final ok = await cubit.remove('b-2');
      expect(ok, isTrue);
      final delete = adapter.requests[1];
      expect(delete.method, 'DELETE');
      expect(delete.path, '/branches/b-2');
    });
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
    final body = nextBody ?? {'branches': []};
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
