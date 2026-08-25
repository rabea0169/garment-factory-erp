abstract class HrState {}

class HrInitial extends HrState {}
class HrLoading extends HrState {}
class HrLoaded extends HrState {
  final List<dynamic> workers;
  HrLoaded(this.workers);
}
class HrError extends HrState {
  final String message;
  HrError(this.message);
}
