import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:garment_factory_erp/features/users/presentation/cubit/users_cubit.dart';
import 'package:garment_factory_erp/features/users/presentation/cubit/users_state.dart';

/// CC-9: UsersCubit — قائمة المستخدمين (GET /users بعقد data[]/meta)
/// والكتابات (create/role/deactivate/activate) بمفتاح اندماجية مع
/// إعادة الجلب، والخطأ نصيًا (نمط return String?) دون مسح القائمة.
/// Dio وهمي عبر اعتراض (بلا شبكة).
void main() {
  Map<String, dynamic> user(String id, {String role = 'VIEWER', bool active = true}) =>
      <String, dynamic>{
        'id': id,
        'name': 'مستخدم $id',
        'email': 'user$id@factory.com',
        'role': role,
        'isActive': active,
        'createdAt': '2026-09-01T10:00:00.000Z',
      };

  final usersPayload = <String, dynamic>{
    'data': [
      user('u-1', role: 'SUPER_ADMIN'),
      user('u-2', role: 'ACCOUNTANT'),
      user('u-3', role: 'HR_MANAGER', active: false),
    ],
    'meta': {'total': 3, 'page': 1, 'pageSize': 100},
  };

  group('fetchUsers', () {
    test('النجاح: data[] تُحل → UsersLoaded', () async {
      final transport = _StubTransport()
        ..payloads['/users'] = (_) => usersPayload;
      final cubit = UsersCubit(dio: transport.dio);
      addTearDown(cubit.close);

      final expectation = expectLater(
        cubit.stream,
        emitsInOrder([
          isA<UsersLoading>(),
          predicate<UsersLoaded>((state) => state.users.length == 3),
        ]),
      );
      await cubit.fetchUsers();
      await expectation;

      // حد 100 (سقف PaginationDto الخادمي).
      expect(transport.requests.single.queryParameters['page'], 1);
      expect(transport.requests.single.queryParameters['limit'], 100);
    });

    test('خطأ 403 (غير SUPER_ADMIN) → UsersError برسالة messageFor',
        () async {
      final transport = _StubTransport()..errorStatus['/users'] = 403;
      final cubit = UsersCubit(dio: transport.dio);
      addTearDown(cubit.close);

      await cubit.fetchUsers();

      expect(cubit.state, isA<UsersError>());
      expect((cubit.state as UsersError).message, contains('صلاحية'));
    });
  });

  group('createUser', () {
    test('النجاح: POST بعقد CreateUserDto + مفتاح اندماجية + إعادة جلب',
        () async {
      final transport = _StubTransport()..payloads['/users'] = (_) => usersPayload;
      final cubit = UsersCubit(dio: transport.dio);
      addTearDown(cubit.close);
      await cubit.fetchUsers();

      final error = await cubit.createUser(
        name: 'سارة أحمد',
        email: 'sara@factory.com',
        password: 'Pass@1234',
        role: 'INVENTORY_MANAGER',
      );

      expect(error, isNull);
      final post = transport.requests.lastWhere((r) => r.method == 'POST');
      expect(post.path, '/users');
      final body = post.data as Map;
      expect(body['name'], 'سارة أحمد');
      expect(body['email'], 'sara@factory.com');
      expect(body['password'], 'Pass@1234');
      expect(body['role'], 'INVENTORY_MANAGER');
      expect(post.headers['Idempotency-Key'], isA<String>());
      // إعادة جلب القائمة بعد النجاح.
      expect(transport.requests.where((r) => r.method == 'GET').length, 2);
    });

    test('خطأ 409 (بريد مكرر) → رسالة نصية والقائمة لا تمس', () async {
      final transport = _StubTransport()..payloads['/users'] = (_) => usersPayload;
      transport.errorStatus['POST:/users'] = 409;
      final cubit = UsersCubit(dio: transport.dio);
      addTearDown(cubit.close);
      await cubit.fetchUsers();

      final error = await cubit.createUser(
        name: 'سارة',
        email: 'existing@factory.com',
        password: 'Pass@1234',
        role: 'VIEWER',
      );

      expect(error, isNotNull);
      expect(cubit.state, isA<UsersLoaded>());
    });
  });

  group('changeRole', () {
    test('النجاح: PATCH /users/:id/role بجسم {role}', () async {
      final transport = _StubTransport()..payloads['/users'] = (_) => usersPayload;
      final cubit = UsersCubit(dio: transport.dio);
      addTearDown(cubit.close);
      await cubit.fetchUsers();

      final error = await cubit.changeRole(userId: 'u-2', role: 'CASHIER');

      expect(error, isNull);
      final patch = transport.requests.lastWhere((r) => r.method == 'PATCH');
      expect(patch.path, '/users/u-2/role');
      expect((patch.data as Map)['role'], 'CASHIER');
      expect(patch.headers['Idempotency-Key'], isA<String>());
    });

    test('خطأ 409 (تغيير دورك) → رسالة نصية', () async {
      final transport = _StubTransport()..payloads['/users'] = (_) => usersPayload;
      transport.errorStatus['/users/u-1/role'] = 409;
      final cubit = UsersCubit(dio: transport.dio);
      addTearDown(cubit.close);
      await cubit.fetchUsers();

      final error = await cubit.changeRole(userId: 'u-1', role: 'VIEWER');

      expect(error, isNotNull);
      expect(cubit.state, isA<UsersLoaded>());
    });
  });

  group('setUserActive', () {
    test('تنشيط: PATCH /users/:id/activate', () async {
      final transport = _StubTransport()..payloads['/users'] = (_) => usersPayload;
      final cubit = UsersCubit(dio: transport.dio);
      addTearDown(cubit.close);
      await cubit.fetchUsers();

      expect(await cubit.setUserActive(userId: 'u-3', active: true), isNull);
      final patch = transport.requests.lastWhere((r) => r.method == 'PATCH');
      expect(patch.path, '/users/u-3/activate');
      expect(patch.headers['Idempotency-Key'], isA<String>());
    });

    test('تعطيل: PATCH /users/:id/deactivate', () async {
      final transport = _StubTransport()..payloads['/users'] = (_) => usersPayload;
      final cubit = UsersCubit(dio: transport.dio);
      addTearDown(cubit.close);
      await cubit.fetchUsers();

      expect(await cubit.setUserActive(userId: 'u-2', active: false), isNull);
      expect(
        transport.requests.lastWhere((r) => r.method == 'PATCH').path,
        '/users/u-2/deactivate',
      );
    });

    test('خطأ التعطيل الذاتي (409) → رسالة نصية', () async {
      final transport = _StubTransport()..payloads['/users'] = (_) => usersPayload;
      transport.errorStatus['/users/u-1/deactivate'] = 409;
      final cubit = UsersCubit(dio: transport.dio);
      addTearDown(cubit.close);
      await cubit.fetchUsers();

      final error =
          await cubit.setUserActive(userId: 'u-1', active: false);

      expect(error, isNotNull);
      expect(cubit.state, isA<UsersLoaded>());
    });
  });
}

/// نقل وهمي: يسجل الطلبات، يفصل خطأ GET/POST/PATCH بالمفتاح
/// "METHOD:path"، ويرد بالحمولة لكل مسار.
class _StubTransport {
  final List<RequestOptions> requests = <RequestOptions>[];

  final Map<String, Object? Function(int index)> payloads =
      <String, Object? Function(int index)>{};

  final Map<String, int> errorStatus = <String, int>{};

  Dio get dio {
    final instance = Dio(BaseOptions(baseUrl: 'https://erp.test'));
    instance.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) {
          requests.add(options);
          final methodKey = '${options.method}:${options.path}';
          final status = errorStatus[options.path] ?? errorStatus[methodKey];
          if (status != null) {
            handler.reject(
              DioException(
                requestOptions: options,
                type: DioExceptionType.badResponse,
                response: Response<Object>(
                  requestOptions: options,
                  statusCode: status,
                  data: {'message': 'خطأ من الخادم'},
                ),
              ),
              true,
            );
            return;
          }
          final index =
              requests.where((r) => r.path == options.path).length - 1;
          handler.resolve(
            Response<Object>(
              requestOptions: options,
              statusCode: 200,
              data: payloads[options.path]?.call(index),
            ),
          );
        },
      ),
    );
    return instance;
  }
}
