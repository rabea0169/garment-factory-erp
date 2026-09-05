import 'dart:async';

import 'package:flutter/material.dart';

import '../constants/app_colors.dart';
import '../services/connectivity_service.dart';

/// GF-REMAINING-008: شريط حالة الاتصال أعلى التطبيق.
///
/// يلتفّ حول محتوى `MaterialApp` (عبر builder) فيظهر تلقائيًا على كل
/// الشاشات عند فقد الاتصال ويختفي عند عودته. يقرأ من
/// [ConnectivityService.onlineStream] فقط — لا يستعلم الشبكة بنفسه.
class OfflineBanner extends StatefulWidget {
  const OfflineBanner({
    required this.child,
    this.service,
    super.key,
  });

  final Widget child;

  /// يُحقن في الاختبارات؛ الافتراضي الخدمة المشتركة للتطبيق.
  final ConnectivityService? service;

  @override
  State<OfflineBanner> createState() => _OfflineBannerState();
}

class _OfflineBannerState extends State<OfflineBanner> {
  StreamSubscription<bool>? _subscription;
  bool _offline = false;

  @override
  void initState() {
    super.initState();
    _listen(widget.service ?? _defaultService);
  }

  @override
  void didUpdateWidget(OfflineBanner oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.service != widget.service) {
      _subscription?.cancel();
      _offline = false;
      _listen(widget.service ?? _defaultService);
    }
  }

  void _listen(ConnectivityService service) {
    _offline = !service.isOnline;
    _subscription = service.onlineStream.listen(
      (online) {
        if (mounted) setState(() => _offline = !online);
      },
      onError: (_) {
        // تعذّر قراءة المنصة: نبقى على الحالة الحالية (banner مخفي افتراضيًا).
      },
    );
  }

  @override
  void dispose() {
    _subscription?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (!_offline) return widget.child;
    return Column(
      children: [
        Material(
          color: AppColors.error.withValues(alpha: 0.92),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
            child: Row(
              children: [
                const Icon(Icons.wifi_off, color: Colors.white, size: 18),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'أنت غير متصل بالإنترنت — البيانات المعروضة قد تكون قديمة',
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 12,
                      fontFamily: 'Cairo',
                    ),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),
          ),
        ),
        Expanded(child: widget.child),
      ],
    );
  }
}

/// الخدمة المشتركة للتطبيق (تُبدأ عند أول بناء للشريط). تُستبدل بحقن
/// [OfflineBanner.service] في الاختبارات.
final ConnectivityService _defaultService = ConnectivityService()..start();
