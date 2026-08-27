import 'package:flutter_test/flutter_test.dart';

import 'package:garment_factory_erp/core/navigation/double_back_exit_guard.dart';

void main() {
  test('requires a second back press within the confirmation window', () {
    final guard = DoubleBackExitGuard();
    final firstPress = DateTime(2026, 8, 27, 12, 0);

    expect(guard.handleBack(now: firstPress), isFalse);
    expect(
      guard.handleBack(now: firstPress.add(const Duration(seconds: 1))),
      isTrue,
    );
  });

  test('starts a new confirmation window after the timeout', () {
    final guard = DoubleBackExitGuard();
    final firstPress = DateTime(2026, 8, 27, 12, 0);

    expect(guard.handleBack(now: firstPress), isFalse);
    expect(
      guard.handleBack(now: firstPress.add(const Duration(seconds: 3))),
      isFalse,
    );
    expect(
      guard.handleBack(now: firstPress.add(const Duration(seconds: 4))),
      isTrue,
    );
  });

  test('resets after an exit request', () {
    final guard = DoubleBackExitGuard();
    final firstPress = DateTime(2026, 8, 27, 12, 0);

    expect(guard.handleBack(now: firstPress), isFalse);
    expect(
      guard.handleBack(now: firstPress.add(const Duration(milliseconds: 500))),
      isTrue,
    );
    expect(
      guard.handleBack(now: firstPress.add(const Duration(seconds: 1))),
      isFalse,
    );
  });
}
