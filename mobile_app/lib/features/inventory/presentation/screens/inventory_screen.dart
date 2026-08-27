import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/constants/app_colors.dart';
import '../../../../core/router/app_router.dart';
import '../../../../core/widgets/app_feedback.dart';
import '../cubit/inventory_cubit.dart';
import '../cubit/inventory_state.dart';

class InventoryScreen extends StatelessWidget {
  const InventoryScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (context) => InventoryCubit()..fetchInventoryData(),
      child: const _InventoryScreenView(),
    );
  }
}

class _InventoryScreenView extends StatefulWidget {
  const _InventoryScreenView();

  @override
  State<_InventoryScreenView> createState() => _InventoryScreenViewState();
}

class _InventoryScreenViewState extends State<_InventoryScreenView>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;
  final _searchController = TextEditingController();
  var _searchQuery = '';

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 3, vsync: this);
  }

  @override
  void dispose() {
    _tabController.dispose();
    _searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('المخزون'),
        bottom: TabBar(
          controller: _tabController,
          labelColor: Colors.white,
          unselectedLabelColor: Colors.white70,
          indicatorColor: AppColors.secondary,
          labelStyle:
              const TextStyle(fontFamily: 'Cairo', fontWeight: FontWeight.bold),
          unselectedLabelStyle: const TextStyle(fontFamily: 'Cairo'),
          tabs: const [
            Tab(text: 'المواد الخام'),
            Tab(text: 'المنتجات التامة'),
            Tab(text: 'تنبيهات المخزون'),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            tooltip: 'تحديث',
            onPressed: () =>
                context.read<InventoryCubit>().fetchInventoryData(),
          ),
        ],
      ),
      body: BlocBuilder<InventoryCubit, InventoryState>(
        builder: (context, state) {
          if (state is InventoryLoading || state is InventoryInitial) {
            return const AppLoadingView();
          } else if (state is InventoryError) {
            return AppErrorView(
              message: state.message,
              onRetry: () =>
                  context.read<InventoryCubit>().fetchInventoryData(),
            );
          } else if (state is InventoryLoaded) {
            return Column(
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
                  child: TextField(
                    controller: _searchController,
                    decoration: InputDecoration(
                      labelText: 'بحث في المخزون',
                      hintText: 'الاسم أو الكود',
                      prefixIcon: const Icon(Icons.search),
                      suffixIcon: _searchQuery.isEmpty
                          ? null
                          : IconButton(
                              tooltip: 'مسح البحث',
                              onPressed: () {
                                _searchController.clear();
                                setState(() => _searchQuery = '');
                              },
                              icon: const Icon(Icons.clear),
                            ),
                    ),
                    onChanged: (value) => setState(
                        () => _searchQuery = value.trim().toLowerCase()),
                  ),
                ),
                Expanded(
                  child: TabBarView(
                    controller: _tabController,
                    children: [
                      _buildRawMaterialsTab(_filterItems(state.rawMaterials)),
                      _buildFinishedGoodsTab(_filterItems(state.finishedGoods)),
                      _buildLowStockTab(_filterItems(state.lowStockMaterials)),
                    ],
                  ),
                ),
              ],
            );
          }
          return const SizedBox();
        },
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _showAddStockDialog(context),
        icon: const Icon(Icons.add),
        label: const Text('إضافة رصيد', style: TextStyle(fontFamily: 'Cairo')),
      ),
    );
  }

  List<dynamic> _filterItems(List<dynamic> items) {
    if (_searchQuery.isEmpty) return items;
    return items.where((item) {
      if (item is! Map) return false;
      final values = [item['name'], item['code'], item['sku']]
          .whereType<Object>()
          .map((value) => value.toString().toLowerCase());
      return values.any((value) => value.contains(_searchQuery));
    }).toList();
  }

  Widget _buildRawMaterialsTab(List<dynamic> materials) {
    if (materials.isEmpty) {
      return AppEmptyView(
        title: 'لا توجد مواد خام',
        actionLabel: 'إعادة التحميل',
        onAction: () => context.read<InventoryCubit>().fetchInventoryData(),
      );
    }

    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: materials.length,
      itemBuilder: (context, index) {
        final item = materials[index];
        final isLow = double.parse(item['currentStock'].toString()) <=
            double.parse(item['minStockLevel'].toString());

        return Card(
          margin: const EdgeInsets.only(bottom: 12),
          child: ListTile(
            leading: CircleAvatar(
              backgroundColor: isLow
                  ? AppColors.error.withValues(alpha: 0.1)
                  : AppColors.primary.withValues(alpha: 0.1),
              child: Icon(Icons.category,
                  color: isLow ? AppColors.error : AppColors.primary),
            ),
            title: Text(item['name'],
                style: Theme.of(context).textTheme.titleMedium),
            subtitle: Text('الكود: ${item['code']}'),
            trailing: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(
                  '${item['currentStock']} ${item['unit']}',
                  style: TextStyle(
                    fontFamily: 'Cairo',
                    fontWeight: FontWeight.bold,
                    color: isLow ? AppColors.error : AppColors.success,
                    fontSize: 14,
                  ),
                ),
                if (isLow)
                  const Text('مخزون منخفض',
                      style: TextStyle(
                          color: AppColors.error,
                          fontSize: 10,
                          fontFamily: 'Cairo')),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _buildFinishedGoodsTab(List<dynamic> goods) {
    if (goods.isEmpty) {
      return AppEmptyView(
        title: 'لا توجد منتجات تامة',
        actionLabel: 'إعادة التحميل',
        onAction: () => context.read<InventoryCubit>().fetchInventoryData(),
      );
    }

    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: goods.length,
      itemBuilder: (context, index) {
        final item = goods[index];
        final variant = item['variant'];
        final product = variant['product'];

        return Card(
          margin: const EdgeInsets.only(bottom: 12),
          child: ListTile(
            leading: CircleAvatar(
              backgroundColor: AppColors.secondary.withValues(alpha: 0.1),
              child: const Icon(Icons.checkroom, color: AppColors.secondary),
            ),
            title: Text(product['name'],
                style: Theme.of(context).textTheme.titleMedium),
            subtitle:
                Text('المقاس: ${variant['size']} | اللون: ${variant['color']}'),
            trailing: Text(
              '${item['quantity']} قطعة',
              style: const TextStyle(
                fontFamily: 'Cairo',
                fontWeight: FontWeight.bold,
                color: AppColors.primary,
                fontSize: 15,
              ),
            ),
          ),
        );
      },
    );
  }

  Widget _buildLowStockTab(List<dynamic> lowStock) {
    if (lowStock.isEmpty) {
      return const Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.check_circle_outline,
                color: AppColors.success, size: 60),
            SizedBox(height: 16),
            Text('جميع الأرصدة في مستويات آمنة',
                style: TextStyle(
                    fontFamily: 'Cairo',
                    color: AppColors.success,
                    fontSize: 16)),
          ],
        ),
      );
    }

    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: lowStock.length,
      itemBuilder: (context, index) {
        final item = lowStock[index];
        return Card(
          color: AppColors.error.withValues(alpha: 0.05),
          margin: const EdgeInsets.only(bottom: 12),
          child: ListTile(
            leading:
                const Icon(Icons.warning_amber_rounded, color: AppColors.error),
            title: Text(item['name'],
                style: const TextStyle(
                    fontFamily: 'Cairo',
                    fontWeight: FontWeight.bold,
                    color: AppColors.error)),
            subtitle: Text(
                'الرصيد: ${item['currentStock']} | الحد الأدنى: ${item['minStockLevel']}',
                style: const TextStyle(fontFamily: 'Cairo')),
            trailing: ElevatedButton(
              style: ElevatedButton.styleFrom(
                  backgroundColor: AppColors.error,
                  padding: const EdgeInsets.symmetric(horizontal: 12)),
              onPressed: () => context.push(AppRouter.purchasing),
              child:
                  const Text('فتح المشتريات', style: TextStyle(fontSize: 12)),
            ),
          ),
        );
      },
    );
  }

  Future<void> _showAddStockDialog(BuildContext context) async {
    final cubit = context.read<InventoryCubit>();
    final state = cubit.state;
    if (state is! InventoryLoaded) return;

    final saved = await showDialog<bool>(
      context: context,
      builder: (_) => _AddRawMaterialStockDialog(
        cubit: cubit,
        materials: state.rawMaterials,
      ),
    );
    if (saved == true && context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('تمت إضافة الرصيد بنجاح')),
      );
    }
  }
}

class _AddRawMaterialStockDialog extends StatefulWidget {
  const _AddRawMaterialStockDialog({
    required this.cubit,
    required this.materials,
  });

  final InventoryCubit cubit;
  final List<dynamic> materials;

  @override
  State<_AddRawMaterialStockDialog> createState() =>
      _AddRawMaterialStockDialogState();
}

class _AddRawMaterialStockDialogState
    extends State<_AddRawMaterialStockDialog> {
  final _formKey = GlobalKey<FormState>();
  final _quantityController = TextEditingController();
  final _costController = TextEditingController();
  String? _selectedId;
  var _isSaving = false;

  @override
  void dispose() {
    _quantityController.dispose();
    _costController.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    setState(() => _isSaving = true);
    try {
      await widget.cubit.addRawMaterialStock(
        _selectedId!,
        double.parse(_quantityController.text.trim()),
        double.parse(_costController.text.trim()),
      );
      if (mounted) Navigator.of(context).pop(true);
    } catch (_) {
      if (!mounted) return;
      setState(() => _isSaving = false);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
            content: Text('تعذر إضافة الرصيد. تحقق من البيانات والصلاحيات.')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('إضافة رصيد مادة خام'),
      content: Form(
        key: _formKey,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            DropdownButtonFormField<String>(
              initialValue: _selectedId,
              decoration: const InputDecoration(labelText: 'اختر المادة *'),
              items: widget.materials
                  .whereType<Map>()
                  .where((material) => material['id'] != null)
                  .map(
                    (material) => DropdownMenuItem<String>(
                      value: material['id'].toString(),
                      child: Text(
                          '${material['name'] ?? material['code'] ?? 'خامة'}'),
                    ),
                  )
                  .toList(),
              onChanged: _isSaving
                  ? null
                  : (value) => setState(() => _selectedId = value),
              validator: (value) => value == null ? 'اختر المادة' : null,
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _quantityController,
              keyboardType:
                  const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(labelText: 'الكمية المضافة *'),
              validator: (value) {
                final quantity = double.tryParse(value?.trim() ?? '');
                return quantity == null || quantity <= 0
                    ? 'أدخل كمية موجبة'
                    : null;
              },
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _costController,
              keyboardType:
                  const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(labelText: 'سعر الوحدة *'),
              validator: (value) {
                final cost = double.tryParse(value?.trim() ?? '');
                return cost == null || cost < 0 ? 'أدخل سعرًا صحيحًا' : null;
              },
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: _isSaving ? null : () => Navigator.of(context).pop(),
          child: const Text('إلغاء'),
        ),
        FilledButton(
          onPressed: _isSaving ? null : _save,
          child: Text(_isSaving ? 'جاري الحفظ...' : 'إضافة'),
        ),
      ],
    );
  }
}
