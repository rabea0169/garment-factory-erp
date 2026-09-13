import 'package:flutter/material.dart';

/// بطاقة العنوان المتدرجة — قلب الهوية البصرية المقلدة من Selim ERP.
///
/// كل وحدة رئيسية تفتتح شاشتها ببطاقة متدرجة كبيرة تعرض الإجمالي
/// (رصيد الخزينة / إجمالي المبيعات / عدد العروض...) مع صف مؤشرات
/// فرعية تحتها (المدفوع والمتبقي والمرتجع...). اللون المميز لكل وحدة
/// هو ما يميزها بصريًا: الخزينة زمردية، المصاريف وردية، المشتريات
/// كهرمانية، المخزون بنفسجية، القص أرجوانية.
///
/// مثال الاستخدام:
/// ```dart
/// GradientHeroCard(
///   title: 'رصيد الخزينة الحالي',
///   value: '12,500.00 ج.م',
///   icon: Icons.account_balance_wallet_rounded,
///   gradient: AppColors.treasuryGradient,
///   stats: [
///     HeroStat('إيداعات اليوم', '3,000 ج.م', Icons.south_west_rounded),
///     HeroStat('سحوبات اليوم', '1,200 ج.م', Icons.north_east_rounded),
///   ],
/// )
/// ```
class GradientHeroCard extends StatelessWidget {
  const GradientHeroCard({
    super.key,
    required this.title,
    required this.value,
    required this.icon,
    required this.gradient,
    this.stats = const <HeroStat>[],
    this.onTap,
  });

  /// العنوان الوصفي فوق القيمة (مثل: "إجمالي المبيعات هذا الشهر").
  final String title;

  /// القيمة الكبيرة المعروضة بخط عريض أبيض.
  final String value;

  /// أيقونة الوحدة تظهر داخل دائرة شفافة يسار القيمة.
  final IconData icon;

  /// التدرج اللوني المميز للوحدة.
  final Gradient gradient;

  /// المؤشرات الفرعية (حتى 3 يظهرن بصف واحد على الموبايل).
  final List<HeroStat> stats;

  /// نقرة البطاقة (اختياري — تفتح تفاصيل الوحدة).
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(20),
        child: Ink(
          decoration: BoxDecoration(
            gradient: gradient,
            borderRadius: BorderRadius.circular(20),
            boxShadow: [
              BoxShadow(
                // ظل ناعم يحمل لون التدرج — يعطي عمقًا بلا حد صلب.
                color: (gradient.colors.first).withValues(alpha: 0.35),
                blurRadius: 16,
                offset: const Offset(0, 6),
              ),
            ],
          ),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(20, 18, 20, 14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(
                        color: Colors.white.withValues(alpha: 0.22),
                        shape: BoxShape.circle,
                      ),
                      child: Icon(icon, color: Colors.white, size: 22),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Text(
                        title,
                        style: const TextStyle(
                          fontFamily: 'Cairo',
                          color: Colors.white70,
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                // الأرقام تُعرض LTR دائمًا حتى لا تنقلب داخل النص العربي.
                Directionality(
                  textDirection: TextDirection.ltr,
                  child: SizedBox(
                    width: double.infinity,
                    child: Text(
                      value,
                      textAlign: TextAlign.right,
                      style: const TextStyle(
                        fontFamily: 'Cairo',
                        color: Colors.white,
                        fontSize: 28,
                        fontWeight: FontWeight.w700,
                        letterSpacing: -0.5,
                      ),
                    ),
                  ),
                ),
                if (stats.isNotEmpty) ...[
                  const SizedBox(height: 12),
                  const Divider(color: Colors.white24, height: 1),
                  const SizedBox(height: 10),
                  Row(
                    children: stats
                        .take(3)
                        .map(
                          (stat) => Expanded(
                            child: _HeroStatTile(stat: stat),
                          ),
                        )
                        .toList(),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _HeroStatTile extends StatelessWidget {
  const _HeroStatTile({required this.stat});

  final HeroStat stat;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsetsDirectional.only(start: 4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(stat.icon, color: Colors.white70, size: 13),
              const SizedBox(width: 4),
              Flexible(
                child: Text(
                  stat.label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontFamily: 'Cairo',
                    color: Colors.white60,
                    fontSize: 10.5,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 2),
          Directionality(
            textDirection: TextDirection.ltr,
            child: SizedBox(
              width: double.infinity,
              child: Text(
                stat.value,
                textAlign: TextAlign.right,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontFamily: 'Cairo',
                  color: Colors.white,
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// مؤشر فرعي داخل بطاقة العنوان.
class HeroStat {
  const HeroStat(this.label, this.value, this.icon);

  final String label;
  final String value;
  final IconData icon;
}
