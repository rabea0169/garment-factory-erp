import 'dart:async';

import 'package:flutter/material.dart';

import '../../../../core/services/nfc_service.dart';
import '../cubit/hr_cubit.dart';

/// MOB-4: زر NFC في شاشة العمال — يقرأ معرّف أول بطاقة تقترب ثم:
/// - إن وُجد عامل مرتبط بمعرّف البطاقة (nfcId/nfcTagId/tagId أو الكود)
///   يُعبّأ البحث باسمه ويعلن التطبيق أنه تعرّف عليه.
/// - وإلا يُعبّأ البحث بمعرّف البطاقة نفسه (أساس مطابقة يدوية بالكود).
///
/// فشل المنصة (جهاز بلا NFC / NFC معطّل / منصة غير مدعومة) يظهر كرسالة
/// واضحة — لا crash (انظر NfcService).
class WorkerNfcButton extends StatefulWidget {
  const WorkerNfcButton({
    required this.cubit,
    required this.searchController,
    this.service,
    super.key,
  });

  final HrCubit cubit;

  /// حقل البحث الذي يُعبّأ بعد القراءة (اسم العامل أو معرّف البطاقة).
  final TextEditingController searchController;

  /// يُحقن في الاختبارات؛ الافتراضي الخدمة المشتركة.
  final NfcService? service;

  @override
  State<WorkerNfcButton> createState() => _WorkerNfcButtonState();
}

class _WorkerNfcButtonState extends State<WorkerNfcButton> {
  NfcService get _service => widget.service ?? NfcService.instance;
  bool _busy = false;

  @override
  void dispose() {
    // مغادرة الشاشة والجلسة جارية → نوقفها كي لا يبقى قارئ NFC
    // نشطًا على الجهاز (بطارية + مؤشر نظام "قريب من بطاقة").
    unawaited(_service.stopReading());
    super.dispose();
  }

  Future<void> _startReading() async {
    if (_busy) return;
    setState(() => _busy = true);
    final messenger = ScaffoldMessenger.of(context);
    final cubit = widget.cubit;
    final controller = widget.searchController;
    await _service.startReading(
      (tagId) {
        if (!mounted) return;
        setState(() => _busy = false);
        // أولًا: عامل مرتبط بالبطاقة مباشرة (لو الخادم أرسل حقل nfcId).
        final worker = cubit.findWorkerByTagId(tagId);
        if (worker != null) {
          controller.text = worker['name']?.toString() ?? '';
          _announce(messenger, 'تم التعرف على العامل: ${controller.text}');
          return;
        }
        // ثانيًا: لا ربط — عبّئ البحث بالمعرّف ليطابق الكود يدويًا.
        controller.text = tagId;
        _announce(
          messenger,
          'لا يوجد عامل مرتبط بهذه البطاقة — عُبّئ البحث بمعرّفها',
        );
      },
      (message) {
        if (!mounted) return;
        setState(() => _busy = false);
        _announce(messenger, message);
      },
    );
    if (mounted && _service.isReading != true && _busy) {
      // startReading انتهى بلا قراءة ولا خطأ (إلغاء مثلًا) — حرّر الزر.
      setState(() => _busy = false);
    }
  }

  void _announce(ScaffoldMessengerState messenger, String message) {
    messenger
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: 'قراءة بطاقة NFC للعامل',
      child: IconButton(
        onPressed: _busy ? null : _startReading,
        icon: _busy
            ? const SizedBox(
                width: 20,
                height: 20,
                child: CircularProgressIndicator(strokeWidth: 2),
              )
            : const Icon(Icons.nfc),
      ),
    );
  }
}

/// أداة بحث العمال — تُستخدم أيضًا كوجهة تعبئة قراءة NFC.
/// تطابق الاسم أو الكود (غير حساسة لحالة الأحرف).
List<Map<String, dynamic>> filterWorkers(
  List<dynamic> workers,
  String query,
) {
  final trimmed = query.trim();
  if (trimmed.isEmpty) {
    return workers
        .whereType<Map>()
        .map((worker) => Map<String, dynamic>.from(worker))
        .toList(growable: false);
  }
  final normalized = trimmed.toUpperCase();
  return workers
      .whereType<Map>()
      .map((worker) => Map<String, dynamic>.from(worker))
      .where((worker) {
    final name = worker['name']?.toString() ?? '';
    final code = worker['code']?.toString() ?? '';
    return name.toUpperCase().contains(normalized) ||
        code.toUpperCase().contains(normalized);
  }).toList(growable: false);
}
