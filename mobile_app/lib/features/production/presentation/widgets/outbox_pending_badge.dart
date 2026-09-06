import 'package:flutter/material.dart';

import '../../../../core/constants/app_colors.dart';
import '../../../../core/services/outbox_service.dart';

/// MOB-3: شارة حالة طابور الإرسال — تعرض عدد العمليات المعلّقة
/// (المحفوظة محليًا بانتظار عودة الاتصال). تختفي تمامًا عند 0.
///
/// تستمع إلى [OutboxService] (ChangeNotifier) فتتحدث لحظة الإدراج
/// ولحظة نجاح الإرسال المتأخر — بلا أي منطق في الشاشات نفسها.
class OutboxPendingBadge extends StatelessWidget {
  const OutboxPendingBadge({this.service, this.onTap, super.key});

  /// يُحقن في الاختبارات؛ الافتراضي الخدمة المشتركة للتطبيق.
  final OutboxService? service;

  /// نداء اختياري عند الضغط (لفتح شرح الطابور مثلًا).
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final outbox = service ?? OutboxService.instance;
    return ListenableBuilder(
      listenable: outbox,
      builder: (context, _) {
        final count = outbox.pendingCount;
        if (count <= 0) return const SizedBox.shrink();
        return Semantics(
          label: 'عدد العمليات المحفوظة محليًا بانتظار الاتصال: $count',
          child: Tooltip(
            message: 'عمليات محفوظة محليًا وسترسل تلقائيًا عند عودة الاتصال',
            child: IconButton(
              onPressed: onTap,
              icon: Badge(
                backgroundColor: AppColors.warning,
                textColor: Colors.white,
                label: Text('$count'),
                child: const Icon(Icons.cloud_upload_outlined),
              ),
            ),
          ),
        );
      },
    );
  }
}
