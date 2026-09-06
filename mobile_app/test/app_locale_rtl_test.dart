import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:garment_factory_erp/app.dart';

/// MOB-6: القرار الصادق للغة — العربية المصرية (ar_EG) هي اللغة الوحيدة
/// المدعومة: التطبيق كله نصوص عربية مباشرة بلا طبقة ترجمة، فإعلان
/// supportedLocales: [ar_EG] فقط (بلا en_US الوهمية). اللإضافة لغة
/// لاحقًا تتطلب ARB + flutter gen-l10n (موثق بتعليق في app.dart).
///
/// الاختبار يثبت: (1) لغة MaterialApp الحالية والمسنودة = ar_EG فقط،
/// (2) الاتجاه المرئي RTL سليم عبر localizations، (3) مندوبات
/// التوطين العربية مثبتة.
void main() {
  testWidgets('MOB-6 — ar_EG هي اللغة الوحيدة والواجهة RTL سليمة',
      (tester) async {
    await tester.pumpWidget(const GarmentFactoryApp());
    await tester.pump();
    await tester.pump();

    final app = tester.widget<MaterialApp>(find.byType(MaterialApp));

    // (1) لغة واحدة فقط: ar_EG — لا en_US.
    expect(app.locale, const Locale('ar', 'EG'));
    expect(app.supportedLocales, const [Locale('ar', 'EG')]);

    // (2) الاتجاه المرئي داخل شجرة الراوتر RTL (من resolution اللغة
    // العربية عبر GlobalWidgetsLocalizations — لا hardcode اتجاه).
    // ملاحظة: Router مُنشأ بنوع عام (مثل Router<Object>) فنطابقه
    // بالنوع الأساسي عبر predicate.
    final routerContext = tester.element(
      find.byWidgetPredicate((widget) => widget is Router),
    );
    expect(Directionality.of(routerContext), TextDirection.rtl);

    // (3) اللغة المُحلولة فعليًا في الشجرة هي ar_EG.
    expect(
        Localizations.maybeLocaleOf(routerContext), const Locale('ar', 'EG'));

    // (4) مندوبات التوطين المشتركة مثبتة كما في app.dart.
    expect(
      app.localizationsDelegates,
      containsAll(const [
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ]),
    );
  });
}
