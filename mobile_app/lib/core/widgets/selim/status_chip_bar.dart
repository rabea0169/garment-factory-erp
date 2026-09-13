import 'package:flutter/material.dart';

/// صف شرائح الحالة مع العدادات — نمط قوائم Selim ERP.
///
/// يحل محل بطاقات KPI في رأس قوائم الحالات (أوامر القص / التسويات /
/// عروض الأسعار): شريحة لكل حالة مع عدّادها، والفلترة بنقرة واحدة.
/// الشريحة النشطة تتلون بلون حالتها والباقي رمادي.
///
/// ```dart
/// StatusChipBar(
///   chips: [
///     StatusChip(label: 'الكل', count: 24, color: AppColors.info, value: 'ALL'),
///     StatusChip(label: 'مسودة', count: 6, color: AppColors.statusPlanned, value: 'DRAFT'),
///     StatusChip(label: 'معتمد', count: 12, color: AppColors.success, value: 'APPROVED'),
///   ],
///   selected: 'ALL',
///   onSelected: (v) => context.read<Cubit>().filter(v),
/// )
/// ```
class StatusChipBar extends StatelessWidget {
  const StatusChipBar({
    super.key,
    required this.chips,
    required this.selected,
    required this.onSelected,
  });

  final List<StatusChip> chips;

  /// قيمة الشريحة المحددة حاليًا (value لأقرب شريحة).
  final String selected;

  final ValueChanged<String> onSelected;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 40,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsetsDirectional.only(end: 4),
        itemCount: chips.length,
        separatorBuilder: (context, index) => const SizedBox(width: 8),
        itemBuilder: (context, index) {
          final chip = chips[index];
          final active = chip.value == selected;
          return _ChipButton(
            chip: chip,
            active: active,
            onTap: () => onSelected(chip.value),
          );
        },
      ),
    );
  }
}

class _ChipButton extends StatelessWidget {
  const _ChipButton({required this.chip, required this.active, required this.onTap});

  final StatusChip chip;
  final bool active;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: active ? chip.color.withValues(alpha: 0.16) : Colors.grey.shade100,
      borderRadius: BorderRadius.circular(20),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(20),
        child: Padding(
          padding: const EdgeInsetsDirectional.symmetric(horizontal: 12),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 7,
                height: 7,
                decoration: BoxDecoration(color: chip.color, shape: BoxShape.circle),
              ),
              const SizedBox(width: 6),
              Text(
                chip.label,
                style: TextStyle(
                  fontFamily: 'Cairo',
                  fontSize: 12.5,
                  fontWeight: active ? FontWeight.w700 : FontWeight.w600,
                  color: active ? chip.color : Colors.black54,
                ),
              ),
              const SizedBox(width: 6),
              Container(
                padding: const EdgeInsetsDirectional.symmetric(horizontal: 7, vertical: 1),
                decoration: BoxDecoration(
                  color: active ? chip.color : Colors.grey.shade300,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Text(
                  '${chip.count}',
                  // العدّاد أرقام لاتينية داخل كبسولة LTR صغيرة.
                  style: const TextStyle(
                    fontFamily: 'Cairo',
                    fontSize: 10.5,
                    fontWeight: FontWeight.w700,
                    color: Colors.white,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class StatusChip {
  const StatusChip({
    required this.label,
    required this.count,
    required this.color,
    required this.value,
  });

  /// التسمية العربية المعروضة.
  final String label;

  /// عدد السجلات في هذه الحالة.
  final int count;

  /// لون الحالة (نقطة + خلفية نشطة).
  final Color color;

  /// قيمة الفلتر التي تُمرر للـ Cubit.
  final String value;
}
