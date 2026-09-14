import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/constants/app_colors.dart';
import '../cubit/alerts_cubit.dart';

/// SELIM-ERP W3 — جرس التنبيهات الذكية في AppBar (نفس Bell في Header
/// عند المرجع): شارة العدد + لوحة سفلية ملونة عند الضغط.
///
/// يُحمّل عند أول بناء (مرة كل فتح شاشة — كافٍ لتنبيهات لوحة تحكم).
class AlertsBell extends StatefulWidget {
  const AlertsBell({this.cubit, super.key});

  /// يُحقن في الاختبارات.
  final AlertsCubit? cubit;

  @override
  State<AlertsBell> createState() => _AlertsBellState();
}

class _AlertsBellState extends State<AlertsBell> {
  AlertsCubit? _ownCubit;

  @override
  void dispose() {
    _ownCubit?.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final cubit = widget.cubit ?? (_ownCubit ??= AlertsCubit()..load());
    return BlocBuilder<AlertsCubit, AlertsState>(
      bloc: cubit,
      builder: (context, state) {
        final count = state is AlertsLoaded ? state.count : 0;
        return IconButton(
          tooltip: 'التنبيهات',
          icon: Badge(
            backgroundColor: AppColors.error,
            textColor: Colors.white,
            isLabelVisible: count > 0,
            label: Text('$count'),
            child: const Icon(Icons.notifications_outlined),
          ),
          onPressed: () => _openPanel(context, cubit),
        );
      },
    );
  }

  void _openPanel(BuildContext context, AlertsCubit cubit) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (sheetContext) => DraggableScrollableSheet(
        initialChildSize: 0.55,
        minChildSize: 0.3,
        maxChildSize: 0.9,
        expand: false,
        builder: (sheetContext, scrollController) => Container(
          decoration: BoxDecoration(
            color: Theme.of(sheetContext).scaffoldBackgroundColor,
            borderRadius:
                const BorderRadius.vertical(top: Radius.circular(20)),
          ),
          child:
              _AlertsPanelBody(cubit: cubit, scrollController: scrollController),
        ),
      ),
    );
  }
}

/// جسم لوحة التنبيهات (نفس بنية AlertsPanel في المرجع: بطاقات ملونة
/// حسب الخطورة + زر إجراء ينتقل للقسم المعني).
class _AlertsPanelBody extends StatelessWidget {
  const _AlertsPanelBody({
    required this.cubit,
    required this.scrollController,
  });

  final AlertsCubit cubit;
  final ScrollController scrollController;

  @override
  Widget build(BuildContext context) {
    return BlocBuilder<AlertsCubit, AlertsState>(
      bloc: cubit,
      builder: (context, state) {
        return Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
              child: Row(
                children: [
                  const Expanded(
                    child: Text(
                      'التنبيهات',
                      style: TextStyle(
                        fontFamily: 'Cairo',
                        fontSize: 18,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                  IconButton(
                    tooltip: 'تحديث',
                    icon: const Icon(Icons.refresh),
                    onPressed: cubit.load,
                  ),
                  IconButton(
                    tooltip: 'إغلاق',
                    icon: const Icon(Icons.close),
                    onPressed: () => Navigator.of(context).pop(),
                  ),
                ],
              ),
            ),
            const Divider(height: 1),
            Expanded(child: _body(context, state)),
          ],
        );
      },
    );
  }

  Widget _body(BuildContext context, AlertsState state) {
    if (state is AlertsLoading) {
      return const Center(child: CircularProgressIndicator());
    }
    if (state is AlertsError) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Text(
            state.message,
            textAlign: TextAlign.center,
            style: const TextStyle(fontFamily: 'Cairo'),
          ),
        ),
      );
    }
    if (state is AlertsLoaded && state.alerts.isEmpty) {
      return const Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.check_circle_outline, size: 56, color: AppColors.success),
            SizedBox(height: 12),
            Text(
              'لا توجد تنبيهات — كل شيء سليم',
              style: TextStyle(fontFamily: 'Cairo', fontSize: 15),
            ),
          ],
        ),
      );
    }
    if (state is AlertsLoaded) {
      return ListView.builder(
        controller: scrollController,
        padding: const EdgeInsets.all(12),
        itemCount: state.alerts.length,
        itemBuilder: (context, index) =>
            _AlertCard(alert: state.alerts[index]),
      );
    }
    return const SizedBox.shrink();
  }
}

/// ألوان الخطورة (نفس خريطة المرجع: amber/blue/rose/emerald).
Map<AlertSeverity, ({Color bg, Color border, Color text})> get _styles => {
      AlertSeverity.warning: (
        bg: const Color(0xFFFFFBEB),
        border: const Color(0xFFFDE68A),
        text: const Color(0xFFB45309),
      ),
      AlertSeverity.info: (
        bg: const Color(0xFFEFF6FF),
        border: const Color(0xFFBFDBFE),
        text: const Color(0xFF1D4ED8),
      ),
      AlertSeverity.danger: (
        bg: const Color(0xFFFFF1F2),
        border: const Color(0xFFFECDD3),
        text: const Color(0xFFBE123C),
      ),
      AlertSeverity.success: (
        bg: const Color(0xFFECFDF5),
        border: const Color(0xFFA7F3D0),
        text: const Color(0xFF047857),
      ),
    };

class _AlertCard extends StatelessWidget {
  const _AlertCard({required this.alert});

  final SmartAlert alert;

  @override
  Widget build(BuildContext context) {
    final style = _styles[alert.severity]!;
    return Card(
      color: style.bg,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: style.border),
      ),
      margin: const EdgeInsets.symmetric(vertical: 6),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: alert.actionRoute != null
            ? () {
                Navigator.of(context).pop();
                context.go(alert.actionRoute!);
              }
            : null,
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(alert.icon, style: const TextStyle(fontSize: 22)),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      alert.title,
                      style: TextStyle(
                        fontFamily: 'Cairo',
                        fontWeight: FontWeight.w700,
                        color: style.text,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      alert.message,
                      style: const TextStyle(
                        fontFamily: 'Cairo',
                        fontSize: 13,
                        height: 1.4,
                      ),
                    ),
                    if (alert.actionLabel != null) ...[
                      const SizedBox(height: 6),
                      Text(
                        '${alert.actionLabel} ›',
                        style: TextStyle(
                          fontFamily: 'Cairo',
                          fontSize: 12,
                          fontWeight: FontWeight.w700,
                          color: style.text,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
