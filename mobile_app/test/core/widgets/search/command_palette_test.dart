import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

import 'package:garment_factory_erp/core/widgets/search/command_palette.dart';

/// لوحة الأوامر Ctrl+K — عقود GET /search الحرفية:
/// {query, groups:[{type, hits:[{type,id,title,subtitle,code}]}]}.
/// تُغطى: تجميع النتائج بالعربية وترتيبها وإهمال المجهول، وdebounce
/// الـ 300ms عند طول ≥ 2، والانتقال عبر GoRouter للمسارات الثابتة،
/// والإجراءات السريعة عند فراغ البحث، وشكل الحوار/الورقة حسب العرض.
/// Dio وهمي عبر اعتراض (نمط expenses_cubit_test) — بلا شبكة.
void main() {
  Map<String, dynamic> searchPayload() => <String, dynamic>{
        'query': 'قميص',
        'groups': [
          {
            'type': 'product',
            'hits': [
              {
                'type': 'product',
                'id': 'p-1',
                'title': 'قميص قطني',
                'subtitle': 'مخزون 120 قطعة',
                'code': 'P-001',
              },
              {'type': 'product', 'id': 'p-2', 'title': 'قميص صيفي'},
            ],
          },
          {
            'type': 'customer',
            'hits': [
              {
                'type': 'customer',
                'id': 'c-1',
                'title': 'مصنع القميص الذهبي',
                'subtitle': 'عميل جملة',
                'code': 'C-011',
              },
            ],
          },
          {
            // نوع مجهول بلا عنوان/أيقونة/مسار — يجب أن يُهمل.
            'type': 'legacyRow',
            'hits': [
              {'type': 'legacyRow', 'id': 'x-1', 'title': 'سجل قديم'},
            ],
          },
          {
            // مجموعة معروفة لكن فارغة — تُهمل أيضًا.
            'type': 'worker',
            'hits': <Map<String, dynamic>>[],
          },
        ],
      };

  Dio stubDio({
    List<RequestOptions>? requests,
    Object? Function(RequestOptions)? respondWith,
    DioException? Function(RequestOptions)? rejectWith,
  }) {
    final instance = Dio(BaseOptions(baseUrl: 'https://erp.test'));
    instance.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) {
          requests?.add(options);
          final rejection = rejectWith?.call(options);
          if (rejection != null) {
            handler.reject(rejection, true);
            return;
          }
          handler.resolve(
            Response<Object>(
              requestOptions: options,
              statusCode: 200,
              data: (respondWith ?? (_) => searchPayload()).call(options),
            ),
          );
        },
      ),
    );
    return instance;
  }

  group('groupSearchHits — تجميع النتائج', () {
    test('يرتب بالعربية حسب الخريطة الثابتة ويهمل المجهول والفارغ', () {
      final groups = groupSearchHits(searchPayload());

      // الترتيب بترتيب خريطة العناوين: عملاء قبل منتجات.
      expect(groups.map((group) => group.type).toList(),
          ['customer', 'product']);
      expect(groups.first.title, 'عملاء');
      expect(groups.last.title, 'منتجات');

      // المجموعة المجهولة (legacyRow) والفارغة (worker) أُهملتا.
      expect(groups.where((group) => group.type == 'legacyRow'), isEmpty);
      expect(groups.where((group) => group.type == 'worker'), isEmpty);

      // النتائج مكتملة الأنواع.
      final customerHit = groups.first.hits.single;
      expect(customerHit.type, 'customer');
      expect(customerHit.id, 'c-1');
      expect(customerHit.title, 'مصنع القميص الذهبي');
      expect(customerHit.subtitle, 'عميل جملة');
      expect(customerHit.code, 'C-011');

      final productHits = groups.last.hits;
      expect(productHits.length, 2);
      expect(productHits.first.code, 'P-001');
      // نتيجة بلا subtitle/code → null وليست نصًا فارغًا.
      expect(productHits.last.subtitle, isNull);
      expect(productHits.last.code, isNull);
    });

    test('حمولة غير متوقعة (لا groups) → قائمة فارغة', () {
      expect(groupSearchHits(null), isEmpty);
      expect(groupSearchHits(<String, dynamic>{'query': 'x'}), isEmpty);
      expect(groupSearchHits(<String, dynamic>{'groups': 'ليست قائمة'}),
          isEmpty);
    });
  });

  group('SearchDebouncer — مهلة 300ms', () {
    testWidgets('لا إطلاق فوريًا وبعد 299ms، وإطلاق عند 300ms', (tester) async {
      final fired = <String>[];
      final debouncer = SearchDebouncer();

      debouncer.schedule('قميص', fired.add);
      expect(fired, isEmpty);
      expect(debouncer.isScheduled, isTrue);

      await tester.pump(const Duration(milliseconds: 299));
      expect(fired, isEmpty);

      await tester.pump(const Duration(milliseconds: 1));
      expect(fired, ['قميص']);
      expect(debouncer.isScheduled, isFalse);

      debouncer.dispose();
    });

    testWidgets('ضغطة جديدة تعيد ضبط المؤقت — الأخيرة فقط تُطلق', (tester) async {
      final fired = <String>[];
      final debouncer = SearchDebouncer();

      debouncer.schedule('ق', fired.add);
      await tester.pump(const Duration(milliseconds: 200));
      debouncer.schedule('قم', fired.add);
      // 200ms أخرى = 400ms من الضغطة الأولى لكن 200ms فقط من الثانية.
      await tester.pump(const Duration(milliseconds: 200));
      expect(fired, isEmpty);

      await tester.pump(const Duration(milliseconds: 100));
      expect(fired, ['قم']);

      debouncer.dispose();
    });

    testWidgets('cancel يوقف البحث المجدول', (tester) async {
      final fired = <String>[];
      final debouncer = SearchDebouncer();

      debouncer.schedule('قميص', fired.add);
      debouncer.cancel();
      expect(debouncer.isScheduled, isFalse);

      await tester.pump(const Duration(seconds: 2));
      expect(fired, isEmpty);

      debouncer.dispose();
    });
  });

  group('CommandPaletteView — البحث والنتائج', () {
    testWidgets('فراغ البحث: الإجراءات السريعة الستة بلا أي طلب', (tester) async {
      final requests = <RequestOptions>[];
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(body: CommandPaletteView(dio: stubDio(requests: requests))),
      ));
      await tester.pumpAndSettle();

      expect(find.text('إجراءات سريعة'), findsOneWidget);
      for (final label in [
        'لوحة التحكم',
        'نقطة البيع',
        'معالج الاستيراد',
        'النسخ الاحتياطي',
        'مبيعات',
        'إنتاج',
      ]) {
        expect(find.text(label), findsOneWidget);
      }
      expect(requests, isEmpty);

      // حرف واحد (دون العتبة): لا طلب بعد تمرير الـ debounce كاملة.
      await tester.enterText(find.byType(TextField), 'ق');
      await tester.pumpAndSettle();
      await tester.pump(kPaletteDebounce);
      expect(requests, isEmpty);
    });

    testWidgets('debounce: لا طلب قبل 300ms ثم /search?q= ونتائج مجمعة',
        (tester) async {
      final requests = <RequestOptions>[];
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
            body: CommandPaletteView(dio: stubDio(requests: requests))),
      ));
      await tester.pumpAndSettle();

      await tester.enterText(find.byType(TextField), 'قميص');
      await tester.pump();
      // قبل انقضاء المدة: لم يُرسل شيء.
      await tester.pump(const Duration(milliseconds: 149));
      expect(requests, isEmpty);

      // بعد 300ms: طلب واحد بالاستعلام.
      await tester.pump(const Duration(milliseconds: 152));
      expect(requests, hasLength(1));
      expect(requests.single.method, 'GET');
      expect(requests.single.path, '/search');
      expect(requests.single.queryParameters['q'], 'قميص');

      await tester.pumpAndSettle();

      // النتائج مجمعة بالعربية: عملاء (قبل منتجات) + إهمال المجهول.
      expect(find.text('عملاء'), findsOneWidget);
      expect(find.text('منتجات'), findsOneWidget);
      expect(find.text('قميص قطني'), findsOneWidget);
      expect(find.text('مصنع القميص الذهبي'), findsOneWidget);
      expect(find.text('سجل قديم'), findsNothing);
      expect(find.text('P-001'), findsOneWidget);
      // الإجراءات السريعة اختفت خلف النتائج.
      expect(find.text('إجراءات سريعة'), findsNothing);
    });

    testWidgets('خطأ الشبكة: رسالة الاتصال بدل النتائج', (tester) async {
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: CommandPaletteView(
            dio: stubDio(
              rejectWith: (options) => DioException(
                requestOptions: options,
                type: DioExceptionType.connectionError,
              ),
            ),
          ),
        ),
      ));
      await tester.pumpAndSettle();

      await tester.enterText(find.byType(TextField), 'قميص');
      await tester.pump();
      await tester.pump(kPaletteDebounce + const Duration(milliseconds: 1));
      await tester.pumpAndSettle();

      expect(find.textContaining('تعذر الاتصال بالخادم'), findsOneWidget);
    });
  });

  group('showCommandPalette + التنقل', () {
    GoRouter buildRouter(Dio dio) => GoRouter(
          routes: [
            GoRoute(
              path: '/',
              builder: (context, state) => Scaffold(
                body: Center(
                  child: ElevatedButton(
                    // يفتح اللوحة كما سيفعل زر البحث في الـ AppBar لاحقًا.
                    onPressed: () => showCommandPalette(context, dio: dio),
                    child: const Text('افتح لوحة الأوامر'),
                  ),
                ),
              ),
            ),
            GoRoute(
              path: '/products',
              builder: (context, state) =>
                  const Scaffold(body: Center(child: Text('شاشة الكتالوج'))),
            ),
            GoRoute(
              path: '/dashboard',
              builder: (context, state) => const Scaffold(
                  body: Center(child: Text('شاشة لوحة التحكم'))),
            ),
          ],
        );

    testWidgets('النقر على نتيجة يغلق اللوحة وينتقل للمسار الثابت',
        (tester) async {
      final requests = <RequestOptions>[];
      final dio = stubDio(requests: requests);
      await tester.pumpWidget(MaterialApp.router(routerConfig: buildRouter(dio)));
      await tester.pumpAndSettle();

      await tester.tap(find.text('افتح لوحة الأوامر'));
      await tester.pumpAndSettle();

      // الجوال (800x600 < 1000): bottom sheet.
      expect(find.byType(CommandPaletteView), findsOneWidget);

      await tester.enterText(find.byType(TextField), 'قميص');
      await tester.pump();
      await tester.pump(kPaletteDebounce + const Duration(milliseconds: 1));
      await tester.pumpAndSettle();

      // نتيجة منتج → /products.
      await tester.tap(find.text('قميص قطني'));
      await tester.pumpAndSettle();

      expect(find.text('شاشة الكتالوج'), findsOneWidget);
      expect(find.byType(CommandPaletteView), findsNothing);
    });

    testWidgets('إجراء سريع عند فراغ البحث ينتقل لمساره', (tester) async {
      final dio = stubDio();
      await tester.pumpWidget(MaterialApp.router(routerConfig: buildRouter(dio)));
      await tester.pumpAndSettle();

      await tester.tap(find.text('افتح لوحة الأوامر'));
      await tester.pumpAndSettle();

      await tester.tap(find.text('لوحة التحكم'));
      await tester.pumpAndSettle();

      expect(find.text('شاشة لوحة التحكم'), findsOneWidget);
    });

    testWidgets('الديسكتوب (العرض ≥ 1000): حوار مركزي قابل للإغلاق',
        (tester) async {
      tester.view.physicalSize = const Size(1400, 900);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      final dio = stubDio();
      await tester.pumpWidget(MaterialApp.router(routerConfig: buildRouter(dio)));
      await tester.pumpAndSettle();

      await tester.tap(find.text('افتح لوحة الأوامر'));
      await tester.pumpAndSettle();

      expect(find.byType(Dialog), findsOneWidget);
      expect(find.byType(BottomSheet), findsNothing);

      // الإغلاق بالنقر خارج الحوار (barrierDismissible).
      await tester.tapAt(const Offset(20, 20));
      await tester.pumpAndSettle();
      expect(find.byType(Dialog), findsNothing);
    });
  });
}
