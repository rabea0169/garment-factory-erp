abstract class UsersState {
  const UsersState();
}

class UsersInitial extends UsersState {
  const UsersInitial();
}

class UsersLoading extends UsersState {
  const UsersLoading();
}

class UsersLoaded extends UsersState {
  UsersLoaded(this.users);

  /// عناصر GET /users — خرائط خام بحقول العقد الآمن للقراءة:
  /// {id, name, email, role, isActive, createdAt} (لا كلمة مرور أبدًا).
  final List<Map<String, dynamic>> users;
}

class UsersError extends UsersState {
  UsersError(this.message);

  final String message;
}
