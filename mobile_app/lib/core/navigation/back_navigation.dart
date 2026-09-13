import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../router/app_router.dart';

/// سلوك «زر الرجوع» الموحد للتطبيق — العودة الذكية إلى لوحة التحكم.
///
/// **المشكلة التي يعالجها هذا الملف:** التنقل بين الأقسام من الشريط
/// السفلي أو درج «المزيد» يستخدم `context.go` (الاستبدال الصحيح للمكدس
/// في go_router حتى لا ينمو بلا حدود) — لكن نتيجة ذلك كانت: أي شاشة
/// قسم تصبح قاع المكدس، فيُخرِج زر الرجوع الفيزيائي (Android) المستخدم
/// من التطبيق فورًا، وكثير من الشاشات القديمة بلا أي زر رجوع ظاهر
/// في الـ AppBar أصلًا.
///
/// **القواعد الآن (سلوك تطبيقات الشريط السفلي القياسي):**
/// 1. الشاشة مفتوحة بـ `push` (توجد شاشة تحتها) → الرجوع يُخرجها
///    طبيعيًا إلى ما قبلها — سواء الزر الظاهر أو إيماءة الرجوع.
/// 2. شاشة قسم وصلت عبر `go` من الشريط/الدرج → الرجوع يعود إلى لوحة
///    التحكم بدل الخروج من التطبيق.
/// 3. لوحة التحكم نفسها تحتفظ بسلوكها الخاص: ضغطتان متتاليتان للخروج
///    (`DoubleBackExitGuard` داخل شاشة لوحة التحكم — بلا تغيير).
void smartBack(BuildContext context) {
  final navigator = Navigator.maybeOf(context);
  if (navigator != null && navigator.canPop()) {
    // maybePop (لا pop): نفس مسار زر الرجوع الفيزيائي — تحترم PopScope.
    navigator.maybePop();
    return;
  }
  // قاع المكدس (وصلنا عبر go) → العودة إلى لوحة التحكم.
  // maybeOf: شاشات تُختبر بلا GoRouter فوقها لا تفعل شيئًا بدل الانهيار.
  GoRouter.maybeOf(context)?.go(AppRouter.dashboard);
}

/// زر الرجوع الظاهر في الـ AppBar — RTL-aware.
///
/// في الاتجاه العربي (RTL) يعرض `arrow_forward` لأن «الخلف» بصريًا
/// جهة اليمين — نفس سلوك `BackButton` التلقائي في Flutter.
class GfBackButton extends StatelessWidget {
  const GfBackButton({super.key});

  @override
  Widget build(BuildContext context) {
    final isRtl = Directionality.of(context) == TextDirection.rtl;
    return IconButton(
      tooltip: MaterialLocalizations.of(context).backButtonTooltip,
      icon: Icon(
        isRtl ? Icons.arrow_forward_rounded : Icons.arrow_back_rounded,
      ),
      onPressed: () => smartBack(context),
    );
  }
}

/// يعترض زر الرجوع الفيزيائي/إيماءة الرجوع حين تكون الشاشة قاع المكدس
/// ويعيد المستخدم إلى لوحة التحكم بدل الخروج من التطبيق.
///
/// يُستخدم داخل `app_router.dart` حول بُناة كل المسارات **عدا** تسجيل
/// الدخول (الرجوع فيه يترك التطبيق — سلوك قياسي) ولوحة التحكم (لها
/// حارسها الخاص بالضغطتين). حين تكون الشاشة مفتوحة بـ `push` يمر
/// الرجوع طبيعيًا (`canPop` محسوبة ديناميكيًا من حالة الملاح).
class BackGuard extends StatelessWidget {
  const BackGuard({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    final navigator = Navigator.maybeOf(context);
    return PopScope(
      canPop: navigator != null && navigator.canPop(),
      onPopInvokedWithResult: (didPop, result) {
        if (didPop) return;
        GoRouter.maybeOf(context)?.go(AppRouter.dashboard);
      },
      child: child,
    );
  }
}
