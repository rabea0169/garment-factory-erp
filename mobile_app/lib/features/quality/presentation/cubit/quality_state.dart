abstract class QualityState {}

class QualityInitial extends QualityState {}
class QualityLoading extends QualityState {}
class QualityLoaded extends QualityState {
  final List<dynamic> qualityChecks;
  QualityLoaded(this.qualityChecks);
}
class QualityError extends QualityState {
  final String message;
  QualityError(this.message);
}
