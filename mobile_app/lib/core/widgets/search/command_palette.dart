import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../constants/app_colors.dart';
import '../../network/api_client.dart';

/// لوحة الأوامر Ctrl+K (SELIM-ERP W2) — بحث شامل عبر GET /search?q=...
/// وعرض النتائج مجمعة بالعربية مع انتقال سريع للقسم المعني، وإجراءات
/// سريعة عند فراغ البحث. تُفتح من زر البحث في الـ AppBar.

/// عناوين المجموعات بالعربية لكل نوع نتيجة (ترتيب العرض).
const Map<String, String> kPaletteGroupTitles = {
  'customer': 'عملاء',
  'product': 'منتجات',
  'quotation': 'عروض أسعار',
  'salesOrder': 'أوامر بيع',
  'purchaseOrder': 'أوامر شراء',
  'supplier': 'موردون',
  'workOrder': 'أوامر تشغيل',
  'worker': 'عمال',
  'treasury': 'خزائن',
};

/// أيقونة كل نوع نتيجة في القائمة.
const Map<String, IconData> kPaletteTypeIcons = {
  'customer': Icons.person_rounded,
  'product': Icons.checkroom_rounded,
  'quotation': Icons.request_quote_rounded,
  'salesOrder': Icons.shopping_cart_rounded,
  'purchaseOrder': Icons.local_mall_rounded,
  'supplier': Icons.business_center_rounded,
  'workOrder': Icons.precision_manufacturing_rounded,
  'worker': Icons.engineering_rounded,
  'treasury': Icons.account_balance_wallet_rounded,
};

/// لون كل نوع نتيجة (لوحة ألوان الأقسام نفسها في SelimShell).
const Map<String, Color> kPaletteTypeColors = {
  'customer': Color(0xFF1565C0),
  'product': Color(0xFF5E35B1),
  'quotation': Color(0xFF3949AB),
  'salesOrder': Color(0xFF00897B),
  'purchaseOrder': Color(0xFFF57F17),
  'supplier': Color(0xFF00695C),
  'workOrder': Color(0xFFC62828),
  'worker': Color(0xFF6A1B9A),
  'treasury': Color(0xFF00838F),
};

/// مسار الانتقال الثابت لكل نوع نتيجة (GoRouter go).
const Map<String, String> kPaletteTypeRoutes = {
  'customer': '/sales',
  'product': '/products',
  'quotation': '/quotations',
  'salesOrder': '/sales',
  'purchaseOrder': '/purchasing',
  'supplier': '/suppliers',
  'workOrder': '/production',
  'worker': '/hr/workers',
  'treasury': '/treasury',
};

/// مدة الـ debounce قبل إطلاق البحث.
const Duration kPaletteDebounce = Duration(milliseconds: 300);

/// أقل طول نص (بعد التقليم) يبدأ عنده البحث.
const int kPaletteMinQueryLength = 2;

/// نتيجة بحث واحدة من GET /search — {type, id, title, subtitle, code}.
class PaletteHit {
  const PaletteHit({
    required this.type,
    required this.id,
    required this.title,
    this.subtitle,
    this.code,
  });

  factory PaletteHit.fromJson(Map<dynamic, dynamic> json) => PaletteHit(
        type: json['type']?.toString() ?? '',
        id: json['id']?.toString() ?? '',
        title: json['title']?.toString().trim() ?? '',
        subtitle: _optional(json['subtitle']),
        code: _optional(json['code']),
      );

  static String? _optional(Object? value) {
    final text = value?.toString().trim();
    return (text == null || text.isEmpty) ? null : text;
  }

  final String type;
  final String id;
  final String title;
  final String? subtitle;
  final String? code;
}

/// مجموعة نتائج لنوع واحد.
class PaletteGroup {
  const PaletteGroup({required this.type, required this.hits});

  /// نوع النتائج (مفتاح خرائط العناوين/الأيقونات/المسارات).
  final String type;
  final List<PaletteHit> hits;

  String get title => kPaletteGroupTitles[type] ?? type;
}

/// إجراء سريع يظهر عند فراغ البحث.
class PaletteQuickAction {
  const PaletteQuickAction(this.label, this.icon, this.route);

  final String label;
  final IconData icon;
  final String route;
}

/// الإجراءات السريعة عند فراغ حقل البحث.
const List<PaletteQuickAction> kPaletteQuickActions = [
  PaletteQuickAction('لوحة التحكم', Icons.dashboard_rounded, '/dashboard'),
  PaletteQuickAction('نقطة البيع', Icons.point_of_sale_rounded, '/pos'),
  PaletteQuickAction('معالج الاستيراد', Icons.upload_file_rounded, '/import'),
  PaletteQuickAction('النسخ الاحتياطي', Icons.backup_rounded, '/backup'),
  PaletteQuickAction('مبيعات', Icons.shopping_cart_rounded, '/sales'),
  PaletteQuickAction(
      'إنتاج', Icons.precision_manufacturing_rounded, '/production'),
];

/// تجميع حمولة /search الخام {query, groups:[{type, hits:[...]}]} إلى
/// مجموعات معروضة: يهمل الأنواع غير المعروفة والمجموعات الفارغة،
/// ويرتب الباقي بترتيب خريطة العناوين العربية الثابتة.
List<PaletteGroup> groupSearchHits(Object? payload) {
  if (payload is! Map) return const [];
  final groups = payload['groups'];
  if (groups is! List) return const [];
  final byType = <String, PaletteGroup>{};
  for (final raw in groups) {
    if (raw is! Map) continue;
    final type = raw['type']?.toString();
    // نوع بلا عنوان/أيقونة/مسار لا يُعرض (لا انتقال له).
    if (type == null || !kPaletteGroupTitles.containsKey(type)) continue;
    final hits = (raw['hits'] as List? ?? const [])
        .whereType<Map>()
        .map(PaletteHit.fromJson)
        .where((hit) => hit.title.isNotEmpty)
        .toList(growable: false);
    if (hits.isEmpty) continue;
    byType[type] = PaletteGroup(type: type, hits: hits);
  }
  return [
    for (final type in kPaletteGroupTitles.keys)
      if (byType.containsKey(type)) byType[type]!,
  ];
}

/// مؤقّت debounce قابل للاختبار — يطلق البحث بعد 300ms من آخر ضغطة،
/// وكل ضغطة جديدة تعيد ضبط المؤقت (إلغاء القديم).
class SearchDebouncer {
  SearchDebouncer({Duration delay = kPaletteDebounce}) : _delay = delay;

  final Duration _delay;
  Timer? _timer;

  /// هل يوجد بحث مجدول ينتظر انقضاء المدة؟
  bool get isScheduled => _timer?.isActive ?? false;

  /// جدولة القيمة — تُطلق عبر onFire بعد المدة دون ضغطات جديدة.
  void schedule(String value, void Function(String value) onFire) {
    _timer?.cancel();
    _timer = Timer(_delay, () => onFire(value));
  }

  /// إلغاء أي بحث مجدول (عند تقصير النص دون العتبة أو الإغلاق).
  void cancel() {
    _timer?.cancel();
    _timer = null;
  }

  void dispose() => cancel();
}

/// فتح لوحة الأوامر — Dialog على الديسكتوب (العرض ≥ 1000) قابل للإغلاق
/// بالنقر خارجه، وbottom sheet على الجوال.
Future<void> showCommandPalette(BuildContext context, {Dio? dio}) async {
  final isWide = MediaQuery.sizeOf(context).width >= 1000;
  if (isWide) {
    await showDialog<void>(
      context: context,
      barrierDismissible: true,
      builder: (dialogContext) => Dialog(
        child: CommandPaletteView(dio: dio),
      ),
    );
  } else {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      showDragHandle: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (sheetContext) => CommandPaletteView(dio: dio),
    );
  }
}

/// جسم لوحة الأوامر نفسه — يُستخدم مباشرة في الاختبارات.
class CommandPaletteView extends StatefulWidget {
  const CommandPaletteView({this.dio, super.key});

  /// يُحقن في الاختبارات؛ الافتراضي عميل التطبيق.
  final Dio? dio;

  @override
  State<CommandPaletteView> createState() => _CommandPaletteViewState();
}

class _CommandPaletteViewState extends State<CommandPaletteView> {
  final TextEditingController _controller = TextEditingController();
  final SearchDebouncer _debouncer = SearchDebouncer();

  String _query = '';
  bool _searching = false;
  List<PaletteGroup> _groups = const [];
  String? _error;

  @override
  void dispose() {
    _debouncer.dispose();
    _controller.dispose();
    super.dispose();
  }

  void _onChanged(String value) {
    final trimmed = value.trim();
    setState(() {
      _query = value;
      _searching = false;
      _error = null;
      _groups = const [];
    });
    // دون العتبة: أوقف أي بحث مجدول واعرض الإجراءات السريعة.
    if (trimmed.length < kPaletteMinQueryLength) {
      _debouncer.cancel();
      return;
    }
    _debouncer.schedule(trimmed, _runSearch);
  }

  Future<void> _runSearch(String query) async {
    setState(() => _searching = true);
    try {
      final dio = widget.dio ?? ApiClient.instance.dio;
      final response = await dio.get(
        '/search',
        queryParameters: {'q': query},
      );
      final groups = groupSearchHits(response.data);
      if (!mounted) return;
      setState(() {
        _searching = false;
        _groups = groups;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _searching = false;
        _error = ApiClient.instance.messageFor(error);
      });
    }
  }

  /// الانتقال إلى مسار النتيجة/الإجراء — يغلق اللوحة أولًا ثم go.
  void _go(String route) {
    final router = GoRouter.maybeOf(context);
    Navigator.of(context, rootNavigator: true).pop();
    router?.go(route);
  }

  @override
  Widget build(BuildContext context) {
    final trimmed = _query.trim();
    final showResults = trimmed.length >= kPaletteMinQueryLength;
    return Padding(
      // لوحة المفاتيح ترفع الحقل بدل أن تغطيه (bottom sheet).
      padding: EdgeInsets.only(
        bottom: MediaQuery.viewInsetsOf(context).bottom,
      ),
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxHeight: MediaQuery.sizeOf(context).height * 0.72,
          maxWidth: 640,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: const EdgeInsetsDirectional.fromSTEB(16, 8, 16, 8),
              child: _searchField(),
            ),
            if (!showResults)
              Flexible(child: _quickActionsView())
            else
              Flexible(child: _resultsView(trimmed)),
          ],
        ),
      ),
    );
  }

  Widget _searchField() {
    return TextField(
      controller: _controller,
      autofocus: true,
      onChanged: _onChanged,
      textInputAction: TextInputAction.search,
      decoration: InputDecoration(
        hintText: 'ابحث عن عميل، منتج، عرض سعر، أمر...',
        hintStyle: const TextStyle(fontFamily: 'Cairo', fontSize: 13),
        prefixIcon: const Icon(Icons.search_rounded),
        suffixIcon: _searching
            ? const Padding(
                padding: EdgeInsetsDirectional.all(12),
                child: SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
              )
            : (_query.isEmpty
                ? null
                : IconButton(
                    icon: const Icon(Icons.close_rounded),
                    tooltip: 'مسح',
                    onPressed: () {
                      _controller.clear();
                      _onChanged('');
                    },
                  )),
        filled: true,
        fillColor: AppColors.inputFill,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: BorderSide(color: Colors.grey.shade300),
        ),
      ),
    );
  }

  /// الإجراءات السريعة عند فراغ البحث (أقل من حرفين).
  Widget _quickActionsView() {
    return ListView(
      shrinkWrap: true,
      padding: const EdgeInsetsDirectional.fromSTEB(16, 0, 16, 16),
      children: [
        const Padding(
          padding: EdgeInsetsDirectional.only(bottom: 8),
          child: Text(
            'إجراءات سريعة',
            style: TextStyle(
              fontFamily: 'Cairo',
              fontWeight: FontWeight.w700,
              fontSize: 13,
              color: AppColors.textSecondary,
            ),
          ),
        ),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            for (final action in kPaletteQuickActions)
              ActionChip(
                avatar: Icon(action.icon, size: 18, color: AppColors.primary),
                label: Text(
                  action.label,
                  style: const TextStyle(fontFamily: 'Cairo', fontSize: 12),
                ),
                onPressed: () => _go(action.route),
              ),
          ],
        ),
      ],
    );
  }

  Widget _resultsView(String query) {
    if (_searching) {
      return const Padding(
        padding: EdgeInsetsDirectional.all(20),
        child: Center(child: CircularProgressIndicator()),
      );
    }
    if (_error != null) {
      return _messageView(Icons.cloud_off_rounded, AppColors.error, _error!);
    }
    if (_groups.isEmpty) {
      return _messageView(
          Icons.search_off_rounded, AppColors.textSecondary, 'لا توجد نتائج مطابقة لـ "$query"');
    }
    return ListView(
      shrinkWrap: true,
      padding: const EdgeInsetsDirectional.fromSTEB(16, 0, 16, 16),
      children: [
        for (final group in _groups) ...[
          _groupHeader(group),
          ...group.hits.map((hit) => _hitTile(group, hit)),
          const SizedBox(height: 6),
        ],
      ],
    );
  }

  Widget _messageView(IconData icon, Color color, String message) {
    return Padding(
      padding: const EdgeInsetsDirectional.all(20),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 36, color: color),
          const SizedBox(height: 8),
          Text(
            message,
            textAlign: TextAlign.center,
            style: TextStyle(
              fontFamily: 'Cairo',
              fontSize: 12,
              color: color,
            ),
          ),
        ],
      ),
    );
  }

  Widget _groupHeader(PaletteGroup group) {
    final color = kPaletteTypeColors[group.type] ?? AppColors.primary;
    return Padding(
      padding: const EdgeInsetsDirectional.only(top: 8, bottom: 4),
      child: Row(
        children: [
          Icon(kPaletteTypeIcons[group.type] ?? Icons.category_rounded,
              size: 16, color: color),
          const SizedBox(width: 6),
          Text(
            group.title,
            style: TextStyle(
              fontFamily: 'Cairo',
              fontWeight: FontWeight.w700,
              fontSize: 12,
              color: color,
            ),
          ),
          const SizedBox(width: 6),
          Text(
            '(${group.hits.length})',
            style: const TextStyle(
              fontFamily: 'Cairo',
              fontSize: 10,
              color: AppColors.textHint,
            ),
          ),
        ],
      ),
    );
  }

  Widget _hitTile(PaletteGroup group, PaletteHit hit) {
    final color = kPaletteTypeColors[group.type] ?? AppColors.primary;
    return InkWell(
      borderRadius: BorderRadius.circular(10),
      onTap: () {
        // التجميع يضمن الأنواع المعروفة — الحذر يبقى لسلامة التنقل.
        final route = kPaletteTypeRoutes[hit.type];
        if (route != null) _go(route);
      },
      child: Container(
        margin: const EdgeInsetsDirectional.only(bottom: 4),
        padding: const EdgeInsetsDirectional.symmetric(
            horizontal: 10, vertical: 8),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: AppColors.divider),
        ),
        child: Row(
          children: [
            Container(
              width: 34,
              height: 34,
              decoration: BoxDecoration(
                color: color.withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(9),
              ),
              child: Icon(
                kPaletteTypeIcons[hit.type] ?? Icons.category_rounded,
                size: 18,
                color: color,
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    hit.title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontFamily: 'Cairo',
                      fontWeight: FontWeight.w700,
                      fontSize: 13,
                    ),
                  ),
                  if (hit.subtitle != null)
                    Text(
                      hit.subtitle!,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontFamily: 'Cairo',
                        fontSize: 11,
                        color: AppColors.textSecondary,
                      ),
                    ),
                ],
              ),
            ),
            if (hit.code != null)
              Container(
                padding: const EdgeInsetsDirectional.symmetric(
                    horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: color.withValues(alpha: 0.08),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(
                  hit.code!,
                  style: TextStyle(
                    fontFamily: 'Cairo',
                    fontSize: 10,
                    fontWeight: FontWeight.w700,
                    color: color,
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
