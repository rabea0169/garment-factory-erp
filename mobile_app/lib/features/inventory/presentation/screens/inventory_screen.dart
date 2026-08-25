import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import '../../../../core/constants/app_colors.dart';
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

class _InventoryScreenViewState extends State<_InventoryScreenView> with SingleTickerProviderStateMixin {
  late TabController _tabController;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 3, vsync: this);
  }

  @override
  void dispose() {
    _tabController.dispose();
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
          labelStyle: const TextStyle(fontFamily: 'Cairo', fontWeight: FontWeight.bold),
          unselectedLabelStyle: const TextStyle(fontFamily: 'Cairo'),
          tabs: const [
            Tab(text: 'المواد الخام'),
            Tab(text: 'المنتجات التامة'),
            Tab(text: 'تنبيهات المخزون'),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.qr_code_scanner), 
            onPressed: () {
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('سيتم تفعيل الكاميرا للمسح...', style: TextStyle(fontFamily: 'Cairo'))),
              );
            }
          ),
          IconButton(icon: const Icon(Icons.refresh), onPressed: () {
            context.read<InventoryCubit>().fetchInventoryData();
          }),
        ],
      ),
      body: BlocBuilder<InventoryCubit, InventoryState>(
        builder: (context, state) {
          if (state is InventoryLoading) {
            return const Center(child: CircularProgressIndicator());
          } else if (state is InventoryError) {
            return Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Icon(Icons.error_outline, color: AppColors.error, size: 60),
                  const SizedBox(height: 16),
                  Text(state.message, style: const TextStyle(fontFamily: 'Cairo', color: AppColors.error)),
                  const SizedBox(height: 16),
                  ElevatedButton(
                    onPressed: () => context.read<InventoryCubit>().fetchInventoryData(),
                    child: const Text('إعادة المحاولة'),
                  )
                ],
              ),
            );
          } else if (state is InventoryLoaded) {
            return TabBarView(
              controller: _tabController,
              children: [
                _buildRawMaterialsTab(state.rawMaterials),
                _buildFinishedGoodsTab(state.finishedGoods),
                _buildLowStockTab(state.lowStockMaterials),
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

  Widget _buildRawMaterialsTab(List<dynamic> materials) {
    if (materials.isEmpty) {
      return const Center(child: Text('لا توجد مواد خام', style: TextStyle(fontFamily: 'Cairo')));
    }
    
    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: materials.length,
      itemBuilder: (context, index) {
        final item = materials[index];
        final isLow = double.parse(item['currentStock'].toString()) <= double.parse(item['minStockLevel'].toString());
        
        return Card(
          margin: const EdgeInsets.only(bottom: 12),
          child: ListTile(
            leading: CircleAvatar(
              backgroundColor: isLow ? AppColors.error.withValues(alpha: 0.1) : AppColors.primary.withValues(alpha: 0.1),
              child: Icon(Icons.category, color: isLow ? AppColors.error : AppColors.primary),
            ),
            title: Text(item['name'], style: Theme.of(context).textTheme.titleMedium),
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
                  const Text('مخزون منخفض', style: TextStyle(color: AppColors.error, fontSize: 10, fontFamily: 'Cairo')),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _buildFinishedGoodsTab(List<dynamic> goods) {
    if (goods.isEmpty) {
      return const Center(child: Text('لا توجد منتجات تامة', style: TextStyle(fontFamily: 'Cairo')));
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
            title: Text(product['name'], style: Theme.of(context).textTheme.titleMedium),
            subtitle: Text('المقاس: ${variant['size']} | اللون: ${variant['color']}'),
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
            Icon(Icons.check_circle_outline, color: AppColors.success, size: 60),
            SizedBox(height: 16),
            Text('جميع الأرصدة في مستويات آمنة', style: TextStyle(fontFamily: 'Cairo', color: AppColors.success, fontSize: 16)),
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
            leading: const Icon(Icons.warning_amber_rounded, color: AppColors.error),
            title: Text(item['name'], style: const TextStyle(fontFamily: 'Cairo', fontWeight: FontWeight.bold, color: AppColors.error)),
            subtitle: Text('الرصيد: ${item['currentStock']} | الحد الأدنى: ${item['minStockLevel']}', style: const TextStyle(fontFamily: 'Cairo')),
            trailing: ElevatedButton(
              style: ElevatedButton.styleFrom(backgroundColor: AppColors.error, padding: const EdgeInsets.symmetric(horizontal: 12)),
              onPressed: () {},
              child: const Text('طلب شراء', style: TextStyle(fontSize: 12)),
            ),
          ),
        );
      },
    );
  }

  void _showAddStockDialog(BuildContext context) {
    // This assumes context has the cubit, but dialogs create a new context root.
    // We pass the cubit explicitly.
    final cubit = context.read<InventoryCubit>();
    
    if (cubit.state is! InventoryLoaded) return;
    
    final materials = (cubit.state as InventoryLoaded).rawMaterials;
    String? selectedId;
    final qtyController = TextEditingController();
    final costController = TextEditingController();

    showDialog(
      context: context,
      builder: (dialogContext) {
        return StatefulBuilder(
          builder: (context, setState) {
            return AlertDialog(
              title: const Text('إضافة رصيد مادة خام', style: TextStyle(fontFamily: 'Cairo', fontSize: 18, fontWeight: FontWeight.bold)),
              content: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  DropdownButtonFormField<String>(
                    decoration: const InputDecoration(labelText: 'اختر المادة'),
                    initialValue: selectedId,
                    items: materials.map<DropdownMenuItem<String>>((m) {
                      return DropdownMenuItem<String>(
                        value: m['id'],
                        child: Text(m['name'], style: const TextStyle(fontFamily: 'Cairo')),
                      );
                    }).toList(),
                    onChanged: (v) => setState(() => selectedId = v),
                  ),
                  const SizedBox(height: 16),
                  TextField(
                    controller: qtyController,
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(labelText: 'الكمية المضافة'),
                  ),
                  const SizedBox(height: 16),
                  TextField(
                    controller: costController,
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(labelText: 'سعر الوحدة (ج.م)'),
                  ),
                ],
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.pop(dialogContext),
                  child: const Text('إلغاء', style: TextStyle(fontFamily: 'Cairo', color: AppColors.textSecondary)),
                ),
                ElevatedButton(
                  onPressed: () {
                    if (selectedId != null && qtyController.text.isNotEmpty && costController.text.isNotEmpty) {
                      cubit.addRawMaterialStock(
                        selectedId!,
                        double.parse(qtyController.text),
                        double.parse(costController.text),
                      );
                      Navigator.pop(dialogContext);
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(content: Text('تمت الإضافة بنجاح', style: TextStyle(fontFamily: 'Cairo'))),
                      );
                    }
                  },
                  child: const Text('إضافة', style: TextStyle(fontFamily: 'Cairo')),
                ),
              ],
            );
          }
        );
      },
    );
  }
}