abstract class ReportsState {}

class ReportsInitial extends ReportsState {}
class ReportsLoading extends ReportsState {}
class ReportsLoaded extends ReportsState {
  final Map<String, dynamic> data;
  ReportsLoaded(this.data);
}
class ReportsError extends ReportsState {
  final String message;
  ReportsError(this.message);
}
