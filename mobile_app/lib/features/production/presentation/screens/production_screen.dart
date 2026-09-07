import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:intl/intl.dart';
import 'package:uuid/uuid.dart';

import '../../../../core/constants/app_colors.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/widgets/app_feedback.dart';
import '../../domain/entities/production_commands.dart';
import '../../domain/entities/work_order.dart';
import '../../production_module.dart';
import '../cubit/production_cubit.dart';
import '../cubit/production_state.dart';
import '../widgets/outbox_pending_badge.dart';

class ProductionScreen extends StatelessWidget {
  /// DEV-PQ1/2: حقن اختياري للحوارات والاختبارات — الافتراضي عميل
  /// التطبيق المشترك، و[cubit] يُستخدم في اختبارات الـ widget.
  const ProductionScreen({super.key, this.cubit, this.dio});

  final ProductionCubit? cubit;
  final Dio? dio;

  @override
  Widget build(BuildContext context) {
    final content = _ProductionView(dio: dio);
    if (cubit != null) {
      return BlocProvider<ProductionCubit>.value(
        value: cubit!,
        child: content,
      );
    }
    return BlocProvider(
      create: (_) => createProductionCubit()..fetchWorkOrders(),
      child: content,
    );
  }
}

class _ProductionView extends StatelessWidget {
  const _ProductionView({this.dio});

  final Dio? dio;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('الإنتاج وأوامر التشغيل'),
        actions: [
          // MOB-3: شارة عدد عمليات الطابور المعلّقة (مثل تسجيل إنتاج
          // محفوظ محليًا) — تظهر فقط عند وجود معلّق وتتحدث تلقائيًا.
          const OutboxPendingBadge(),
          IconButton(
            tooltip: 'تحديث',
            icon: const Icon(Icons.refresh),
            onPressed: () =>
                context.read<ProductionCubit>().fetchWorkOrders(refresh: true),
          ),
        ],
      ),
      // DEV-PQ1: إنشاء أمر تشغيل من التطبيق — الداتا لير كانت جاهزة بلا UI.
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _showCreateWorkOrderDialog(context),
        icon: const Icon(Icons.precision_manufacturing),
        label: const Text('أمر تشغيل جديد'),
      ),
      body: BlocConsumer<ProductionCubit, ProductionState>(
        listener: (context, state) {
          if (state is ProductionUnauthorized) {
            _showMessage(context, 'انتهت الجلسة، يرجى تسجيل الدخول مرة أخرى');
          } else if (state is ProductionOffline) {
            _showMessage(context, 'تعذر الاتصال بالخادم، تحقق من الشبكة');
          } else if (state is ProductionFailure) {
            _showMessage(context, state.failure.message);
          }
        },
        builder: (context, state) {
          if (state is ProductionLoading || state is ProductionInitial) {
            return const Center(child: CircularProgressIndicator());
          }
          if (state is ProductionEmpty) {
            return _EmptyProductionView(
              onRefresh: () =>
                  context.read<ProductionCubit>().fetchWorkOrders(),
            );
          }
          if (state is ProductionLoaded) {
            // MOB-3: بيانات من الكاش (لا اتصال) — شارة وضوح أعلى القائمة
            // مع استمرار العرض الطبيعي للأوامر.
            return Column(
              children: [
                if (state.fromCache && state.cachedAt != null)
                  AppCachedDataBanner(cachedAt: state.cachedAt!),
                Expanded(
                  child: Stack(
                    children: [
                      _WorkOrderList(orders: state.workOrders, dio: dio),
                      if (state.isRefreshing)
                        const Positioned(
                          top: 0,
                          left: 0,
                          right: 0,
                          child: LinearProgressIndicator(),
                        ),
                    ],
                  ),
                ),
              ],
            );
          }
          if (state is ProductionFailure) {
            return _ErrorProductionView(
              message: state.failure.message,
              onRetry: () => context.read<ProductionCubit>().fetchWorkOrders(),
            );
          }
          if (state is ProductionOffline) {
            return _ErrorProductionView(
              message: 'لا يوجد اتصال بالخادم',
              onRetry: () => context.read<ProductionCubit>().fetchWorkOrders(),
            );
          }
          if (state is ProductionUnauthorized) {
            return const Center(child: Text('يرجى تسجيل الدخول للمتابعة'));
          }
          return const SizedBox.shrink();
        },
      ),
    );
  }

  static void _showMessage(BuildContext context, String message) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

  Future<void> _showCreateWorkOrderDialog(BuildContext context) async {
    final createdCode = await showDialog<String>(
      context: context,
      builder: (_) => _CreateWorkOrderDialog(
        cubit: context.read<ProductionCubit>(),
        dio: dio,
      ),
    );
    if (createdCode == null || !context.mounted) return;
    _showMessage(context, 'تم إنشاء أمر التشغيل $createdCode بنجاح');
  }
}

class _WorkOrderList extends StatelessWidget {
  const _WorkOrderList({required this.orders, this.dio});

  final List<WorkOrder> orders;
  final Dio? dio;

  @override
  Widget build(BuildContext context) {
    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: orders.length,
      itemBuilder: (context, index) =>
          _WorkOrderCard(order: orders[index], dio: dio),
    );
  }
}

class _WorkOrderCard extends StatelessWidget {
  const _WorkOrderCard({required this.order, this.dio});

  final WorkOrder order;
  final Dio? dio;

  @override
  Widget build(BuildContext context) {
    final nextStage = _nextStage(order);
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: ExpansionTile(
        leading: _statusIcon(order.status),
        title: Text(
          '${order.productName} (مقاس: ${order.variantSize})',
          style: const TextStyle(fontWeight: FontWeight.bold),
        ),
        subtitle: Text(
          'الكمية: ${order.quantity} قطعة | الحالة: ${_statusLabel(order.status)}',
        ),
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'رقم الأمر: ${order.code}',
                  style: const TextStyle(fontWeight: FontWeight.w600),
                ),
                const SizedBox(height: 6),
                Text(
                  'تاريخ الإضافة: ${DateFormat('yyyy-MM-dd').format(order.createdAt)}',
                ),
                if (order.currentStage != null &&
                    order.status != WorkOrderStatus.completed &&
                    order.status != WorkOrderStatus.cancelled) ...[
                  const SizedBox(height: 14),
                  SizedBox(
                    width: double.infinity,
                    child: OutlinedButton.icon(
                      icon: const Icon(Icons.fact_check_outlined),
                      label: const Text('تسجيل مخرجات المرحلة'),
                      onPressed: () => showDialog<void>(
                        context: context,
                        builder: (_) => _RecordStageOutputDialog(
                          workOrder: order,
                          stage: order.currentStage!,
                          cubit: context.read<ProductionCubit>(),
                        ),
                      ),
                    ),
                  ),
                ],
                // DEV-PQ2: استهلاك خامات المرحلة — للأوامر الجارية (غير
                // المخططة/المكتملة/الملغاة) التي لها مرحلة حالية؛ الـ cubit
                // والـ remote datasource كانا جاهزين بلا أي UI.
                if (_canConsumeMaterials) ...[
                  const SizedBox(height: 14),
                  SizedBox(
                    width: double.infinity,
                    child: OutlinedButton.icon(
                      icon: const Icon(Icons.inventory_2_outlined),
                      label: const Text('استهلاك خامات'),
                      onPressed: () => _consumeMaterials(context, order, dio),
                    ),
                  ),
                ],
                if (nextStage != null) ...[
                  const SizedBox(height: 14),
                  SizedBox(
                    width: double.infinity,
                    child: ElevatedButton.icon(
                      icon: const Icon(Icons.arrow_forward),
                      label: Text('الانتقال إلى ${_stageLabel(nextStage)}'),
                      onPressed: () =>
                          context.read<ProductionCubit>().transitionStage(
                                workOrderId: order.id,
                                stage: nextStage,
                              ),
                    ),
                  ),
                ],
                if (order.status == WorkOrderStatus.completed) ...[
                  const SizedBox(height: 14),
                  SizedBox(
                    width: double.infinity,
                    child: OutlinedButton.icon(
                      icon: const Icon(Icons.calculate_outlined),
                      label: const Text('تثبيت تكلفة الإنتاج'),
                      onPressed: () => _finalizeCost(context, order.id),
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }

  static ProductionStage? _nextStage(WorkOrder order) {
    if (order.status == WorkOrderStatus.completed ||
        order.status == WorkOrderStatus.cancelled) {
      return null;
    }
    final currentStage = order.currentStage ?? _stageFromStatus(order.status);
    if (currentStage == null) return ProductionStage.cutting;
    switch (currentStage) {
      case ProductionStage.cutting:
        return ProductionStage.sewing;
      case ProductionStage.sewing:
        return ProductionStage.ironing;
      case ProductionStage.ironing:
        return ProductionStage.packing;
      case ProductionStage.packing:
        return null;
    }
  }

  static ProductionStage? _stageFromStatus(WorkOrderStatus status) {
    switch (status) {
      case WorkOrderStatus.cutting:
        return ProductionStage.cutting;
      case WorkOrderStatus.sewing:
        return ProductionStage.sewing;
      case WorkOrderStatus.ironing:
        return ProductionStage.ironing;
      case WorkOrderStatus.packing:
        return ProductionStage.packing;
      default:
        return null;
    }
  }

  static Icon _statusIcon(WorkOrderStatus status) {
    switch (status) {
      case WorkOrderStatus.planned:
        return const Icon(Icons.calendar_today, color: Colors.blue);
      case WorkOrderStatus.completed:
        return const Icon(Icons.check_circle, color: AppColors.success);
      case WorkOrderStatus.cancelled:
        return const Icon(Icons.cancel, color: AppColors.error);
      default:
        return const Icon(Icons.sync, color: AppColors.warning);
    }
  }

  static String _statusLabel(WorkOrderStatus status) {
    switch (status) {
      case WorkOrderStatus.planned:
        return 'مخطط';
      case WorkOrderStatus.cutting:
        return 'القص';
      case WorkOrderStatus.sewing:
        return 'الخياطة';
      case WorkOrderStatus.ironing:
        return 'الكي';
      case WorkOrderStatus.packing:
        return 'التغليف';
      case WorkOrderStatus.inProgress:
        return 'قيد التنفيذ';
      case WorkOrderStatus.completed:
        return 'مكتمل';
      case WorkOrderStatus.cancelled:
        return 'ملغى';
    }
  }

  /// DEV-PQ2: الاستهلاك متاح للأوامر الجارية فقط (IN_PROGRESS/CUTTING/
  /// SEWING/IRONING/PACKING) — الخادم يربط الاستهلاك بتشغيل مرحلة قائمة
  /// (stageRunId)، وأوامر PLANNED/COMPLETED/CANCELLED بلا تشغيل مراحل صالح.
  bool get _canConsumeMaterials =>
      order.currentStage != null &&
      switch (order.status) {
        WorkOrderStatus.planned ||
        WorkOrderStatus.completed ||
        WorkOrderStatus.cancelled =>
          false,
        _ => true,
      };

  static Future<void> _consumeMaterials(
    BuildContext context,
    WorkOrder order,
    Dio? dio,
  ) async {
    final consumed = await showDialog<bool>(
      context: context,
      builder: (_) => _ConsumeMaterialDialog(
        workOrder: order,
        cubit: context.read<ProductionCubit>(),
        dio: dio,
      ),
    );
    if (consumed != true || !context.mounted) return;
    _ProductionView._showMessage(context, 'تم تسجيل استهلاك الخامات بنجاح');
  }

  static Future<void> _finalizeCost(
    BuildContext context,
    String workOrderId,
  ) async {
    final result = await context.read<ProductionCubit>().finalizeCost(
          workOrderId: workOrderId,
        );
    if (!context.mounted) return;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(
            result == null
                ? 'تعذر تثبيت التكلفة، تحقق من اكتمال مراحل الإنتاج'
                : 'تم تثبيت تكلفة الإنتاج بنجاح',
          ),
        ),
      );
  }

  static String _stageLabel(ProductionStage stage) {
    switch (stage) {
      case ProductionStage.cutting:
        return 'القص';
      case ProductionStage.sewing:
        return 'الخياطة';
      case ProductionStage.ironing:
        return 'الكي';
      case ProductionStage.packing:
        return 'التغليف';
    }
  }
}

class _EmptyProductionView extends StatelessWidget {
  const _EmptyProductionView({required this.onRefresh});

  final VoidCallback onRefresh;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.factory_outlined, size: 56, color: Colors.grey),
          const SizedBox(height: 12),
          const Text('لا توجد أوامر تشغيل حالياً'),
          const SizedBox(height: 12),
          OutlinedButton.icon(
            onPressed: onRefresh,
            icon: const Icon(Icons.refresh),
            label: const Text('إعادة المحاولة'),
          ),
        ],
      ),
    );
  }
}

class _ErrorProductionView extends StatelessWidget {
  const _ErrorProductionView({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.error_outline, size: 52, color: AppColors.error),
            const SizedBox(height: 12),
            Text(message, textAlign: TextAlign.center),
            const SizedBox(height: 12),
            ElevatedButton.icon(
              onPressed: onRetry,
              icon: const Icon(Icons.refresh),
              label: const Text('إعادة المحاولة'),
            ),
          ],
        ),
      ),
    );
  }
}

class _RecordStageOutputDialog extends StatefulWidget {
  const _RecordStageOutputDialog({
    required this.workOrder,
    required this.stage,
    required this.cubit,
  });

  final WorkOrder workOrder;
  final ProductionStage stage;
  final ProductionCubit cubit;

  @override
  State<_RecordStageOutputDialog> createState() =>
      _RecordStageOutputDialogState();
}

class _RecordStageOutputDialogState extends State<_RecordStageOutputDialog> {
  final _formKey = GlobalKey<FormState>();
  final _inputController = TextEditingController();
  final _acceptedController = TextEditingController();
  final _rejectedController = TextEditingController(text: '0');
  final _wasteController = TextEditingController(text: '0');
  final _notesController = TextEditingController();
  bool _isSaving = false;

  @override
  void dispose() {
    _inputController.dispose();
    _acceptedController.dispose();
    _rejectedController.dispose();
    _wasteController.dispose();
    _notesController.dispose();
    super.dispose();
  }

  String? _requiredInteger(String? value, String label) {
    final parsed = int.tryParse(value?.trim() ?? '');
    if (parsed == null || parsed < 0) return '$label يجب أن يكون عددًا صحيحًا';
    return null;
  }

  Future<void> _save() async {
    if (_isSaving || !(_formKey.currentState?.validate() ?? false)) return;
    final inputQty = int.parse(_inputController.text.trim());
    final acceptedQty = int.parse(_acceptedController.text.trim());
    final rejectedQty = int.parse(_rejectedController.text.trim());
    final wasteQty = int.parse(_wasteController.text.trim());
    if (inputQty != acceptedQty + rejectedQty + wasteQty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content:
              Text('يجب أن تساوي الكمية الداخلة مجموع المقبول والرفض والهالك'),
        ),
      );
      return;
    }

    setState(() => _isSaving = true);
    final result = await widget.cubit.recordStageOutput(
          RecordStageOutputCommand(
            workOrderId: widget.workOrder.id,
            stage: widget.stage,
            inputQty: inputQty,
            acceptedQty: acceptedQty,
            rejectedQty: rejectedQty,
            wasteQty: wasteQty,
            idempotencyKey: const Uuid().v4(),
            notes: _notesController.text.trim().isEmpty
                ? null
                : _notesController.text.trim(),
          ),
        );
    if (!mounted) return;
    if (result == null) {
      setState(() => _isSaving = false);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('تعذر تسجيل مخرجات المرحلة')),
      );
      return;
    }
    Navigator.pop(context);
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text('مخرجات ${_WorkOrderCard._stageLabel(widget.stage)}'),
      content: Form(
        key: _formKey,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextFormField(
                controller: _inputController,
                decoration: const InputDecoration(labelText: 'الكمية الداخلة'),
                keyboardType: TextInputType.number,
                validator: (value) => _requiredInteger(value, 'الكمية الداخلة'),
              ),
              TextFormField(
                controller: _acceptedController,
                decoration: const InputDecoration(labelText: 'الكمية المقبولة'),
                keyboardType: TextInputType.number,
                validator: (value) =>
                    _requiredInteger(value, 'الكمية المقبولة'),
              ),
              TextFormField(
                controller: _rejectedController,
                decoration: const InputDecoration(labelText: 'الكمية المرفوضة'),
                keyboardType: TextInputType.number,
                validator: (value) =>
                    _requiredInteger(value, 'الكمية المرفوضة'),
              ),
              TextFormField(
                controller: _wasteController,
                decoration: const InputDecoration(labelText: 'كمية الهالك'),
                keyboardType: TextInputType.number,
                validator: (value) => _requiredInteger(value, 'كمية الهالك'),
              ),
              TextFormField(
                controller: _notesController,
                decoration:
                    const InputDecoration(labelText: 'ملاحظات (اختياري)'),
                maxLines: 2,
              ),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: _isSaving ? null : () => Navigator.pop(context),
          child: const Text('إلغاء'),
        ),
        FilledButton(
          onPressed: _isSaving ? null : _save,
          child: _isSaving
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Text('حفظ'),
        ),
      ],
    );
  }
}

/// DEV-PQ1: حوار إنشاء أمر تشغيل — المنتجات عبر GET /products?limit=100 ثم
/// التحميل البطيء لمتغيرات المنتج ووصفاته (BOM) عبر GET /products/:id عند
/// اختياره. الـ payload يطابق CreateWorkOrderDto حرفيًا: productVariantId +
/// bomVersionId + quantity (لا dueDate — DTO يرفض الحقول غير المعلنة).
class _CreateWorkOrderDialog extends StatefulWidget {
  const _CreateWorkOrderDialog({required this.cubit, this.dio});

  final ProductionCubit cubit;
  final Dio? dio;

  @override
  State<_CreateWorkOrderDialog> createState() => _CreateWorkOrderDialogState();
}

class _CreateWorkOrderDialogState extends State<_CreateWorkOrderDialog> {
  final _formKey = GlobalKey<FormState>();
  final _quantityController = TextEditingController();

  List<Map<String, dynamic>> _products = const [];
  List<Map<String, dynamic>> _variants = const [];
  List<Map<String, dynamic>> _bomVersions = const [];
  String? _selectedProductId;
  String? _selectedVariantId;
  String? _selectedBomVersionId;
  bool _loadingProducts = true;
  bool _loadingProductDetails = false;
  String? _productsError;
  String? _submitError;
  var _isSaving = false;

  Dio get _dio => widget.dio ?? ApiClient.instance.dio;

  @override
  void initState() {
    super.initState();
    _loadProducts();
  }

  @override
  void dispose() {
    _quantityController.dispose();
    super.dispose();
  }

  Future<void> _loadProducts() async {
    setState(() {
      _loadingProducts = true;
      _productsError = null;
    });
    try {
      final response = await _dio.get<dynamic>(
        '/products',
        queryParameters: {'limit': 100},
      );
      final products = ApiClient.extractPaginatedData(response.data)
          .whereType<Map>()
          .map((item) => Map<String, dynamic>.from(item))
          .where((product) => product['id'] != null)
          .toList(growable: false);
      if (!mounted) return;
      setState(() {
        _products = products;
        _loadingProducts = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loadingProducts = false;
        _productsError = ApiClient.instance.messageFor(error);
      });
    }
  }

  /// التحميل البطيء لمتغيرات المنتج وإصدارات BOM عند اختيار المنتج —
  /// استجابة GET /products/:id تشمل variants وbomVersions مع بنودهما.
  Future<void> _onProductChanged(String? productId) async {
    if (productId == null || productId == _selectedProductId) return;
    setState(() {
      _selectedProductId = productId;
      _selectedVariantId = null;
      _selectedBomVersionId = null;
      _variants = const [];
      _bomVersions = const [];
      _loadingProductDetails = true;
      _submitError = null;
    });
    try {
      final response = await _dio.get<dynamic>('/products/$productId');
      final product = response.data is Map
          ? Map<String, dynamic>.from(response.data as Map)
          : <String, dynamic>{};
      final variants = (product['variants'] as List? ?? const [])
          .whereType<Map>()
          .map((item) => Map<String, dynamic>.from(item))
          .where((variant) =>
              variant['id'] != null && variant['isActive'] != false)
          .toList(growable: false);
      final bomVersions = (product['bomVersions'] as List? ?? const [])
          .whereType<Map>()
          .map((item) => Map<String, dynamic>.from(item))
          .where((version) => version['id'] != null)
          .toList(growable: false)
        ..sort((a, b) {
          final activeA = a['isActive'] == true;
          final activeB = b['isActive'] == true;
          if (activeA != activeB) return activeA ? -1 : 1;
          final createdA = DateTime.tryParse('${a['createdAt'] ?? ''}');
          final createdB = DateTime.tryParse('${b['createdAt'] ?? ''}');
          if (createdA != null && createdB != null) {
            return createdB.compareTo(createdA);
          }
          return 0;
        });
      if (!mounted) return;
      setState(() {
        _variants = variants;
        _bomVersions = bomVersions;
        // تيسير الاختيار: متغير وحيد يُختار تلقائيًا، وأحدث إصدار وصفة
        // نشط هو الافتراضي (الخادم يحتسب تكلفة الجودة من بنود BOM).
        _selectedVariantId =
            variants.length == 1 ? variants.single['id'] as String? : null;
        _selectedBomVersionId =
            bomVersions.isNotEmpty ? bomVersions.first['id'] as String? : null;
        _loadingProductDetails = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loadingProductDetails = false;
        _submitError =
            'تعذر جلب متغيرات المنتج: ${ApiClient.instance.messageFor(error)}';
      });
    }
  }

  Future<void> _save() async {
    if (_isSaving || !(_formKey.currentState?.validate() ?? false)) return;
    setState(() {
      _isSaving = true;
      _submitError = null;
    });
    final created = await widget.cubit.createWorkOrder(
      CreateWorkOrderCommand(
        productVariantId: _selectedVariantId!,
        bomVersionId: _selectedBomVersionId!,
        quantity: int.parse(_quantityController.text.trim()),
      ),
    );
    if (!mounted) return;
    if (created == null) {
      setState(() {
        _isSaving = false;
        _submitError = _failureMessage();
      });
      return;
    }
    Navigator.pop(context, created.code ?? 'جديد');
  }

  /// رسالة الفشل من آخر حالة أصدرها الـ cubit (فشل تحقق/شبكة/جلسة) —
  /// يعرضها الحوار نصًا داخليًا بدل ابتلاعها خلف الحاجز النمطي.
  String _failureMessage() {
    final state = widget.cubit.state;
    if (state is ProductionWriteFailure) return state.failure.message;
    if (state is ProductionFailure) return state.failure.message;
    if (state is ProductionOffline) {
      return 'تعذر الاتصال بالخادم، تحقق من الشبكة وحاول مرة أخرى';
    }
    if (state is ProductionUnauthorized) {
      return 'انتهت الجلسة، يرجى تسجيل الدخول مرة أخرى';
    }
    return 'تعذر إنشاء أمر التشغيل، تحقق من البيانات والصلاحيات';
  }

  @override
  Widget build(BuildContext context) {
    Widget content;
    if (_loadingProducts) {
      content = const SizedBox(
        height: 220,
        child: AppLoadingView(message: 'جاري تحميل المنتجات...'),
      );
    } else if (_productsError != null) {
      content = SizedBox(
        height: 220,
        child: AppErrorView(message: _productsError!, onRetry: _loadProducts),
      );
    } else {
      content = Form(
        key: _formKey,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            DropdownButtonFormField<String>(
              initialValue: _selectedProductId,
              decoration: const InputDecoration(labelText: 'المنتج *'),
              items: _products
                  .map(
                    (product) => DropdownMenuItem<String>(
                      value: product['id'].toString(),
                      child: Text(
                        '${product['name'] ?? product['code'] ?? 'منتج'}'
                        '${product['code'] != null ? ' (${product['code']})' : ''}',
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  )
                  .toList(),
              onChanged: _isSaving ? null : _onProductChanged,
              validator: (value) => value == null ? 'اختر المنتج' : null,
            ),
            const SizedBox(height: 10),
            if (_loadingProductDetails)
              const LinearProgressIndicator(minHeight: 2),
            if (_loadingProductDetails) const SizedBox(height: 10),
            DropdownButtonFormField<String>(
              initialValue: _selectedVariantId,
              decoration: const InputDecoration(
                labelText: 'متغير المنتج (المقاس/اللون) *',
                helperText: 'يُجلب عند اختيار المنتج',
              ),
              items: _variants
                  .map(
                    (variant) => DropdownMenuItem<String>(
                      value: variant['id'].toString(),
                      child: Text(
                        '${variant['size'] ?? 'غير محدد'} - '
                        '${variant['color'] ?? 'غير محدد'}',
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  )
                  .toList(),
              onChanged: (_isSaving || _loadingProductDetails)
                  ? null
                  : (value) => setState(() => _selectedVariantId = value),
              validator: (value) => value == null
                  ? (_selectedProductId == null
                      ? 'اختر المنتج أولًا'
                      : 'اختر متغير المنتج')
                  : null,
            ),
            const SizedBox(height: 10),
            DropdownButtonFormField<String>(
              initialValue: _selectedBomVersionId,
              decoration: InputDecoration(
                labelText: 'إصدار الوصفة (BOM) *',
                helperText: _selectedProductId != null &&
                        _bomVersions.isEmpty &&
                        !_loadingProductDetails
                    ? 'لا يوجد إصدار وصفة لهذا المنتج'
                    : null,
              ),
              items: _bomVersions
                  .map(
                    (version) => DropdownMenuItem<String>(
                      value: version['id'].toString(),
                      child: Text(
                        '${version['versionName'] ?? 'إصدار'}'
                        '${version['isActive'] == true ? '' : ' (غير نشط)'}',
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  )
                  .toList(),
              onChanged: (_isSaving || _loadingProductDetails)
                  ? null
                  : (value) => setState(() => _selectedBomVersionId = value),
              validator: (value) => value == null
                  ? (_selectedProductId == null
                      ? 'اختر المنتج أولًا'
                      : 'لا يمكن الإنشاء بلا إصدار وصفة نشط')
                  : null,
            ),
            const SizedBox(height: 10),
            TextFormField(
              controller: _quantityController,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(
                labelText: 'الكمية المطلوب تصنيعها *',
                helperText: 'عدد صحيح موجب (قطع)',
              ),
              validator: (value) {
                final parsed = int.tryParse(value?.trim() ?? '');
                return parsed == null || parsed <= 0
                    ? 'أدخل عددًا صحيحًا موجبًا'
                    : null;
              },
            ),
            if (_submitError != null) ...[
              const SizedBox(height: 12),
              Text(
                _submitError!,
                style: const TextStyle(color: AppColors.error),
                textAlign: TextAlign.center,
              ),
            ],
          ],
        ),
      );
    }
    return AlertDialog(
      title: const Text('إنشاء أمر تشغيل جديد'),
      content: SizedBox(width: 460, child: content),
      actions: [
        TextButton(
          onPressed: _isSaving ? null : () => Navigator.pop(context),
          child: const Text('إلغاء'),
        ),
        FilledButton(
          onPressed: _isSaving || _loadingProducts ? null : _save,
          child: _isSaving
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Text('حفظ'),
        ),
      ],
    );
  }
}

/// DEV-PQ2: حوار استهلاك خامات المرحلة — الخامة من GET /inventory/
/// raw-materials?limit=100 والمخزن من GET /inventory/warehouses، وكميات
/// (مخططة/فعلية/هالك) ووحدة نصية مطابقة ConsumeMaterialDto. الربط بتشغيل
/// المرحلة (stageRunId) يقرأ من السجل المحلي المشترك لا بإدخال يدوي.
class _ConsumeMaterialDialog extends StatefulWidget {
  const _ConsumeMaterialDialog({
    required this.workOrder,
    required this.cubit,
    this.dio,
  });

  final WorkOrder workOrder;
  final ProductionCubit cubit;
  final Dio? dio;

  @override
  State<_ConsumeMaterialDialog> createState() => _ConsumeMaterialDialogState();
}

class _ConsumeMaterialDialogState extends State<_ConsumeMaterialDialog> {
  final _formKey = GlobalKey<FormState>();
  final _plannedController = TextEditingController();
  final _actualController = TextEditingController();
  final _wasteController = TextEditingController(text: '0');
  final _unitController = TextEditingController();

  List<Map<String, dynamic>> _rawMaterials = const [];
  List<Map<String, dynamic>> _warehouses = const [];
  String? _selectedRawMaterialId;
  String? _selectedWarehouseId;
  bool _loading = true;
  String? _loadError;
  String? _submitError;

  /// معرف تشغيل المرحلة الجارية من السجل المحلي — null يعني أن الانتقال
  /// لم يُنفَّذ من هذا الجهاز (لا مسار خادمي لجلب stageRuns).
  String? _stageRunId;
  var _isSaving = false;

  Dio get _dio => widget.dio ?? ApiClient.instance.dio;

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  @override
  void dispose() {
    _plannedController.dispose();
    _actualController.dispose();
    _wasteController.dispose();
    _unitController.dispose();
    super.dispose();
  }

  Future<void> _loadData() async {
    setState(() {
      _loading = true;
      _loadError = null;
    });
    final stage = widget.workOrder.currentStage;
    try {
      final results = await Future.wait<dynamic>([
        _dio.get<dynamic>(
          '/inventory/raw-materials',
          queryParameters: {'limit': 100},
        ),
        _dio.get<dynamic>(
          '/inventory/warehouses',
          queryParameters: {'limit': 100},
        ),
        if (stage != null)
          widget.cubit.stageRunIdFor(widget.workOrder.id, stage)
        else Future<String?>.value(),
      ]);
      final rawMaterials = ApiClient.extractPaginatedData(
        (results[0] as Response<dynamic>).data,
      )
          .whereType<Map>()
          .map((item) => Map<String, dynamic>.from(item))
          .where((material) =>
              material['id'] != null && material['isActive'] != false)
          .toList(growable: false);
      final warehouses = ApiClient.extractPaginatedData(
        (results[1] as Response<dynamic>).data,
      )
          .whereType<Map>()
          .map((item) => Map<String, dynamic>.from(item))
          .where((warehouse) =>
              warehouse['id'] != null && warehouse['isActive'] != false)
          .toList(growable: false);
      final stageRunId = results[2] as String?;
      if (!mounted) return;
      setState(() {
        _rawMaterials = rawMaterials;
        _warehouses = warehouses;
        _stageRunId = stageRunId;
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _loadError = ApiClient.instance.messageFor(error);
      });
    }
  }

  void _onRawMaterialChanged(String? rawMaterialId) {
    setState(() => _selectedRawMaterialId = rawMaterialId);
    final material = _rawMaterials
        .where((item) => item['id'] == rawMaterialId)
        .firstOrNull;
    final unit = material?['unit'];
    if (unit != null) {
      // الوحدة حرة النص (MaxLength 32 في DTO) — نملؤها بوحدة الخامة مترجمة.
      _unitController.text = _translateUnit('$unit');
    }
  }

  static String _translateUnit(String unit) => switch (unit) {
        'METER' => 'متر',
        'KILOGRAM' => 'كجم',
        'PIECE' => 'قطعة',
        'ROLL' => 'لفة',
        'DOZEN' => 'درزن',
        'LITER' => 'لتر',
        _ => unit,
      };

  double? _positiveDouble(String? value) {
    final parsed = double.tryParse(value?.trim() ?? '');
    return parsed == null || parsed <= 0 ? null : parsed;
  }

  Future<void> _save() async {
    if (_isSaving || !(_formKey.currentState?.validate() ?? false)) return;
    final planned = _positiveDouble(_plannedController.text)!;
    final actual = _positiveDouble(_actualController.text)!;
    final waste =
        double.tryParse(_wasteController.text.trim()) ?? double.nan;
    if (waste < 0 || waste > actual) {
      setState(() => _submitError = 'كمية الهالك يجب أن تكون بين 0 والكمية الفعلية');
      return;
    }
    setState(() {
      _isSaving = true;
      _submitError = null;
    });
    final result = await widget.cubit.consumeMaterial(
      ConsumeMaterialCommand(
        workOrderId: widget.workOrder.id,
        stageRunId: _stageRunId!,
        rawMaterialId: _selectedRawMaterialId!,
        warehouseId: _selectedWarehouseId!,
        plannedQuantity: planned,
        actualQuantity: actual,
        wasteQuantity: waste,
        unit: _unitController.text.trim(),
        idempotencyKey: const Uuid().v4(),
      ),
    );
    if (!mounted) return;
    if (result == null) {
      setState(() {
        _isSaving = false;
        _submitError = _failureMessage();
      });
      return;
    }
    Navigator.pop(context, true);
  }

  String _failureMessage() {
    final state = widget.cubit.state;
    if (state is ProductionWriteFailure) return state.failure.message;
    if (state is ProductionFailure) return state.failure.message;
    if (state is ProductionOffline) {
      return 'تعذر الاتصال بالخادم، تحقق من الشبكة وحاول مرة أخرى';
    }
    if (state is ProductionUnauthorized) {
      return 'انتهت الجلسة، يرجى تسجيل الدخول مرة أخرى';
    }
    return 'تعذر تسجيل استهلاك الخامات، تحقق من البيانات والصلاحيات';
  }

  @override
  Widget build(BuildContext context) {
    final stage = widget.workOrder.currentStage;
    Widget content;
    if (_loading) {
      content = const SizedBox(
        height: 220,
        child: AppLoadingView(message: 'جاري تحميل الخامات والمخازن...'),
      );
    } else if (_loadError != null) {
      content = SizedBox(
        height: 220,
        child: AppErrorView(message: _loadError!, onRetry: _loadData),
      );
    } else {
      content = Form(
        key: _formKey,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Align(
              alignment: AlignmentDirectional.centerStart,
              child: Text(
                'أمر التشغيل: ${widget.workOrder.code}'
                '${stage != null ? ' — مرحلة ${_WorkOrderCard._stageLabel(stage)}' : ''}',
                style: const TextStyle(fontWeight: FontWeight.w600),
              ),
            ),
            const SizedBox(height: 10),
            if (_stageRunId == null)
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    color: AppColors.warning.withValues(alpha: 0.14),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.all(10),
                    child: Row(
                      children: [
                        const Icon(Icons.info_outline,
                            color: AppColors.warning, size: 20),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            'معرف تشغيل المرحلة غير متوفر محليًا. نفّذ انتقال '
                            'المرحلة أو سجّل مخرجاتها من هذا التطبيق أولًا ثم '
                            'أعد المحاولة.',
                            style: const TextStyle(fontSize: 12),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            DropdownButtonFormField<String>(
              initialValue: _selectedRawMaterialId,
              decoration: const InputDecoration(labelText: 'الخامة *'),
              items: _rawMaterials
                  .map(
                    (material) => DropdownMenuItem<String>(
                      value: material['id'].toString(),
                      child: Text(
                        '${material['name'] ?? material['code'] ?? 'خامة'}'
                        '${material['code'] != null ? ' (${material['code']})' : ''}',
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  )
                  .toList(),
              onChanged: _isSaving ? null : _onRawMaterialChanged,
              validator: (value) => value == null ? 'اختر الخامة' : null,
            ),
            const SizedBox(height: 10),
            DropdownButtonFormField<String>(
              initialValue: _selectedWarehouseId,
              decoration: const InputDecoration(labelText: 'المخزن *'),
              items: _warehouses
                  .map(
                    (warehouse) => DropdownMenuItem<String>(
                      value: warehouse['id'].toString(),
                      child: Text(
                        '${warehouse['name'] ?? warehouse['code'] ?? 'مخزن'}'
                        '${warehouse['code'] != null ? ' (${warehouse['code']})' : ''}',
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  )
                  .toList(),
              onChanged: _isSaving
                  ? null
                  : (value) => setState(() => _selectedWarehouseId = value),
              validator: (value) => value == null ? 'اختر المخزن' : null,
            ),
            const SizedBox(height: 10),
            TextFormField(
              controller: _plannedController,
              keyboardType:
                  const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(labelText: 'الكمية المخططة *'),
              validator: (value) =>
                  _positiveDouble(value) == null ? 'أدخل كمية مخططة موجبة' : null,
            ),
            const SizedBox(height: 10),
            TextFormField(
              controller: _actualController,
              keyboardType:
                  const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(labelText: 'الكمية الفعلية *'),
              validator: (value) =>
                  _positiveDouble(value) == null ? 'أدخل كمية فعلية موجبة' : null,
            ),
            const SizedBox(height: 10),
            TextFormField(
              controller: _wasteController,
              keyboardType:
                  const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(
                labelText: 'كمية الهالك',
                helperText: 'ضمن الكمية الفعلية',
              ),
              validator: (value) {
                final parsed = double.tryParse(value?.trim() ?? '');
                return parsed == null || parsed < 0
                    ? 'أدخل كمية هالك غير سالبة'
                    : null;
              },
            ),
            const SizedBox(height: 10),
            TextFormField(
              controller: _unitController,
              decoration: const InputDecoration(
                labelText: 'الوحدة *',
                helperText: 'تُملأ تلقائيًا من الخامة (قابلة للتعديل)',
              ),
              validator: (value) {
                final unit = value?.trim() ?? '';
                return unit.isEmpty
                    ? 'الوحدة مطلوبة'
                    : unit.length > 32
                        ? 'الوحدة تتجاوز 32 حرفًا'
                        : null;
              },
            ),
            if (_submitError != null) ...[
              const SizedBox(height: 12),
              Text(
                _submitError!,
                style: const TextStyle(color: AppColors.error),
                textAlign: TextAlign.center,
              ),
            ],
          ],
        ),
      );
    }
    return AlertDialog(
      title: Text(stage != null
          ? 'استهلاك خامات — ${_WorkOrderCard._stageLabel(stage)}'
          : 'استهلاك خامات'),
      content: SizedBox(width: 460, child: content),
      actions: [
        TextButton(
          onPressed: _isSaving ? null : () => Navigator.pop(context),
          child: const Text('إلغاء'),
        ),
        FilledButton(
          onPressed: _isSaving || _loading || _stageRunId == null
              ? null
              : _save,
          child: _isSaving
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Text('حفظ'),
        ),
      ],
    );
  }
}
