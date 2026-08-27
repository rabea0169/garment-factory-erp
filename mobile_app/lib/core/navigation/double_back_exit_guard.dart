/// Controls the two-step back gesture used to exit from the app root.
///
/// The first back press starts a short confirmation window; a second press
/// within [confirmationWindow] requests app exit. The clock is injectable so
/// the behavior can be tested deterministically.
class DoubleBackExitGuard {
  DoubleBackExitGuard({
    this.confirmationWindow = const Duration(seconds: 2),
  });

  final Duration confirmationWindow;
  DateTime? _lastBackPress;

  /// Returns `true` when the caller should exit the app.
  bool handleBack({DateTime? now}) {
    final timestamp = now ?? DateTime.now();
    final lastPress = _lastBackPress;

    if (lastPress == null ||
        timestamp.difference(lastPress) > confirmationWindow) {
      _lastBackPress = timestamp;
      return false;
    }

    _lastBackPress = null;
    return true;
  }

  void reset() => _lastBackPress = null;
}
