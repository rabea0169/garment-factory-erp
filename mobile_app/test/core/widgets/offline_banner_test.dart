import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:garment_factory_erp/core/services/connectivity_service.dart';
import 'package:garment_factory_erp/core/widgets/offline_banner.dart';

/// GF-REMAINING-008: شريط حالة الاتصال — يظهر عند فقد الشبكة ويختفي
/// عند عودتها، دون أي استعلام شبكي من الشريط نفسه (مصدره الخدمة).
void main() {
  const bannerText = 'أنت غير متصل بالإنترنت — البيانات المعروضة قد تكون قديمة';

  testWidgets('banner is hidden while online', (tester) async {
    final service = _FakeConnectivityService(initial: true);
    await tester.pumpWidget(_wrap(service, const Text('المحتوى')));

    expect(find.text(bannerText), findsNothing);
    expect(find.text('المحتوى'), findsOneWidget);
    await service.close();
  });

  testWidgets('banner appears when the service reports offline', (tester) async {
    final service = _FakeConnectivityService(initial: true);
    await tester.pumpWidget(_wrap(service, const Text('المحتوى')));

    service.goOffline();
    await tester.pumpAndSettle();

    expect(find.text(bannerText), findsOneWidget);
    expect(find.byIcon(Icons.wifi_off), findsOneWidget);
    expect(find.text('المحتوى'), findsOneWidget);
    await service.close();
  });

  testWidgets('banner disappears when connectivity returns', (tester) async {
    final service = _FakeConnectivityService(initial: false);
    await tester.pumpWidget(_wrap(service, const Text('المحتوى')));

    expect(find.byIcon(Icons.wifi_off), findsOneWidget);

    service.goOnline();
    await tester.pumpAndSettle();

    expect(find.byIcon(Icons.wifi_off), findsNothing);
    expect(find.text('المحتوى'), findsOneWidget);
    await service.close();
  });

  testWidgets('stream errors keep the banner silent (degrade gracefully)',
      (tester) async {
    final service = _FakeConnectivityService(initial: true);
    await tester.pumpWidget(_wrap(service, const Text('المحتوى')));

    service.emitError();
    await tester.pumpAndSettle();

    expect(find.byIcon(Icons.wifi_off), findsNothing);
    expect(find.text('المحتوى'), findsOneWidget);
    await service.close();
  });
}

Widget _wrap(ConnectivityService service, Widget child) {
  return MaterialApp(
    home: Scaffold(
      body: OfflineBanner(service: service, child: child),
    ),
  );
}

/// نسخة وهمية من الخدمة: بثّ قابل للتحكم يدويًا دون أي platform channel.
class _FakeConnectivityService extends ConnectivityService {
  _FakeConnectivityService({required bool initial})
      : _controller = StreamController<bool>.broadcast() {
    isOnline = initial;
  }

  final StreamController<bool> _controller;

  @override
  Stream<bool> get onlineStream => _controller.stream;

  void goOffline() {
    isOnline = false;
    _controller.add(false);
  }

  void goOnline() {
    isOnline = true;
    _controller.add(true);
  }

  void emitError() => _controller.addError(StateError('platform fail'));

  Future<void> close() => _controller.close();
}
