import 'package:dio/dio.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:uuid/uuid.dart';

import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_parsing.dart';
import 'users_state.dart';

/// CC-9: إدارة المستخدمين (وحدة users الخلفية كاملة) — كل مسارات
/// /users مقصورة خادميًا على SUPER_ADMIN (403 لغيره برسالة عربية).
///
/// القراءة: GET /users?page=1&limit=100 (عقد data[]/meta). الكتابات
/// (create/role/deactivate/activate) كلها بمفتاح اندماجية UUID v4
/// وتُعيد رسالة خطأ نصية عبر messageFor أو null عند النجاح (نمط
/// UAT-FIX: فشل الكتابة لا يمسح القائمة المعروضة — الحوار يعرض
/// الرسالة)، مع إعادة جلب القائمة بعد كل نجاح.
class UsersCubit extends Cubit<UsersState> {
  UsersCubit({Dio? dio, Uuid? uuid})
      : _injectedDio = dio,
        _uuid = uuid ?? const Uuid(),
        super(const UsersInitial());

  final Dio? _injectedDio;
  final Uuid _uuid;

  Dio get _dio => _injectedDio ?? ApiClient.instance.dio;

  /// قائمة المستخدمين — حد 100 (سقف PaginationDto الخادمي).
  Future<void> fetchUsers() async {
    emit(const UsersLoading());
    try {
      final response = await _dio.get<dynamic>(
        '/users',
        queryParameters: <String, dynamic>{'page': 1, 'limit': 100},
      );
      final users = ApiParsing.paginatedMaps(
        response.data,
        context: 'المستخدمين',
      );
      emit(UsersLoaded(users));
    } catch (error) {
      emit(UsersError(ApiClient.instance.messageFor(error)));
    }
  }

  /// إنشاء مستخدم (POST /users) — عقد CreateUserDto: name/email/
  /// password/role. كلمة المرور تُخزَّن bcrypt خادميًا ولا تُعاد أبدًا.
  Future<String?> createUser({
    required String name,
    required String email,
    required String password,
    required String role,
  }) async {
    try {
      await _dio.post(
        '/users',
        data: <String, dynamic>{
          'name': name,
          'email': email,
          'password': password,
          'role': role,
        },
        options: Options(headers: {'Idempotency-Key': _uuid.v4()}),
      );
      await fetchUsers();
      return null;
    } catch (error) {
      return ApiClient.instance.messageFor(error);
    }
  }

  /// تغيير دور مستخدم (PATCH /users/:id/role) — الخادم يرفض تغيير
  /// دورك الخاص بـ 409 برسالة عربية.
  Future<String?> changeRole({
    required String userId,
    required String role,
  }) async {
    try {
      await _dio.patch(
        '/users/$userId/role',
        data: <String, dynamic>{'role': role},
        options: Options(headers: {'Idempotency-Key': _uuid.v4()}),
      );
      await fetchUsers();
      return null;
    } catch (error) {
      return ApiClient.instance.messageFor(error);
    }
  }

  /// تعطيل/تنشيط مستخدم (PATCH /users/:id/deactivate | activate) —
  /// التعطيل محمي ذاتيًا خادميًا (لا يمكنك تعطيل نفسك — 409).
  Future<String?> setUserActive({
    required String userId,
    required bool active,
  }) async {
    final action = active ? 'activate' : 'deactivate';
    try {
      await _dio.patch(
        '/users/$userId/$action',
        options: Options(headers: {'Idempotency-Key': _uuid.v4()}),
      );
      await fetchUsers();
      return null;
    } catch (error) {
      return ApiClient.instance.messageFor(error);
    }
  }
}
