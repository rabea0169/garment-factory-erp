import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:garment_factory_erp/app.dart';

void main() {
  testWidgets('App renders without errors', (WidgetTester tester) async {
    await tester.pumpWidget(const GarmentFactoryApp());
    expect(find.byType(MaterialApp), findsOneWidget);
  });
}
