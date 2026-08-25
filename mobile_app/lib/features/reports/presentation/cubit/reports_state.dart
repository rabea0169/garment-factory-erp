abstract class ReportsState {
  const ReportsState();
}

class ReportsInitial extends ReportsState {
  const ReportsInitial();
}

class ReportsLoading extends ReportsState {
  const ReportsLoading();
}

class ReportsLoaded extends ReportsState {
  const ReportsLoaded(this.data);

  final Map<String, dynamic> data;
}

class ReportsError extends ReportsState {
  const ReportsError(this.message);

  final String message;
}
