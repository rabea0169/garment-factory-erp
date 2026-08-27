import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/constants/app_colors.dart';
import '../../../inventory/presentation/cubit/inventory_cubit.dart';
import '../../../inventory/presentation/cubit/inventory_state.dart';
import '../cubit/products_cubit.dart';

class AddProductScreen extends StatefulWidget {
  const AddProductScreen({super.key});

  @override
  State<AddProductScreen> createState() => _AddProductScreenState();
}

class _AddProductScreenState extends State<AddProductScreen> {
  final _formKey = GlobalKey<FormState>();
  final _codeController = TextEditingController();
  final _nameController = TextEditingController();
  final _categoryController = TextEditingController();
  final _retailController = TextEditingController();
  final _wholesaleController = TextEditingController();

  final List<Map<String, dynamic>> _variants = [];
  final List<Map<String, dynamic>> _bomItems = [];
  bool _isSaving = false;

  @override
  void initState() {
    super.initState();
    context.read<InventoryCubit>().fetchRawMaterials();
  }

  @override
  void dispose() {
    _codeController.dispose();
    _nameController.dispose();
    _categoryController.dispose();
    _retailController.dispose();
    _wholesaleController.dispose();
    super.dispose();
  }

  Future<void> _addVariant() async {
    final sizeController = TextEditingController();
    final colorController = TextEditingController();
    try {
      await showDialog<void>(
        context: context,
        builder: (dialogContext) {
          String? errorMessage;
          return StatefulBuilder(
            builder: (context, setDialogState) => AlertDialog(
              title: const Text(
                'إضافة مقاس ولون',
                style: TextStyle(fontFamily: 'Cairo'),
              ),
              content: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  TextField(
                    controller: sizeController,
                    decoration: const InputDecoration(
                      labelText: 'المقاس (M, L, XL)',
                    ),
                  ),
                  TextField(
                    controller: colorController,
                    decoration: const InputDecoration(labelText: 'اللون'),
                  ),
                  if (errorMessage != null) ...[
                    const SizedBox(height: 8),
                    Text(
                      errorMessage!,
                      style: const TextStyle(color: AppColors.error),
                    ),
                  ],
                ],
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.pop(dialogContext),
                  child: const Text('إلغاء'),
                ),
                ElevatedButton(
                  onPressed: () {
                    final size = sizeController.text.trim();
                    final color = colorController.text.trim();
                    if (size.isEmpty || color.isEmpty) {
                      setDialogState(
                          () => errorMessage = 'المقاس واللون مطلوبان');
                      return;
                    }
                    final duplicate = _variants.any(
                      (variant) =>
                          variant['size'].toString().trim().toLowerCase() ==
                              size.toLowerCase() &&
                          variant['color'].toString().trim().toLowerCase() ==
                              color.toLowerCase(),
                    );
                    if (duplicate) {
                      setDialogState(
                        () => errorMessage = 'هذا المقاس واللون مضافان بالفعل',
                      );
                      return;
                    }
                    setState(() => _variants.add({
                          'size': size,
                          'color': color,
                        }));
                    Navigator.pop(dialogContext);
                  },
                  child: const Text('إضافة'),
                ),
              ],
            ),
          );
        },
      );
    } finally {
      sizeController.dispose();
      colorController.dispose();
    }
  }

  Future<void> _addBomItem(List<Map<String, dynamic>> rawMaterials) async {
    String? selectedRawMaterialId;
    final quantityController = TextEditingController();
    final unitController = TextEditingController(text: 'METER');
    try {
      await showDialog<void>(
        context: context,
        builder: (dialogContext) {
          String? errorMessage;
          return StatefulBuilder(
            builder: (context, setDialogState) => AlertDialog(
              title: const Text(
                'إضافة مادة خام (BOM)',
                style: TextStyle(fontFamily: 'Cairo'),
              ),
              content: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  DropdownButtonFormField<String>(
                    initialValue: selectedRawMaterialId,
                    hint: const Text('اختر المادة الخام'),
                    items: rawMaterials.map((rawMaterial) {
                      return DropdownMenuItem<String>(
                        value: rawMaterial['id']?.toString(),
                        child: Text(
                          '${rawMaterial['name'] ?? 'خامة'} '
                          '(${rawMaterial['code'] ?? '-'})',
                        ),
                      );
                    }).toList(),
                    onChanged: (value) => setDialogState(
                      () => selectedRawMaterialId = value,
                    ),
                  ),
                  TextField(
                    controller: quantityController,
                    decoration: const InputDecoration(
                      labelText: 'الكمية المستهلكة للقطعة',
                    ),
                    keyboardType: const TextInputType.numberWithOptions(
                      decimal: true,
                    ),
                  ),
                  TextField(
                    controller: unitController,
                    decoration: const InputDecoration(
                      labelText: 'الوحدة (METER, PIECE، إلخ)',
                    ),
                  ),
                  if (errorMessage != null) ...[
                    const SizedBox(height: 8),
                    Text(
                      errorMessage!,
                      style: const TextStyle(color: AppColors.error),
                    ),
                  ],
                ],
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.pop(dialogContext),
                  child: const Text('إلغاء'),
                ),
                ElevatedButton(
                  onPressed: () {
                    final quantity =
                        double.tryParse(quantityController.text.trim());
                    final unit = unitController.text.trim();
                    if (selectedRawMaterialId == null) {
                      setDialogState(() => errorMessage = 'اختر المادة الخام');
                      return;
                    }
                    if (quantity == null || quantity <= 0) {
                      setDialogState(
                        () => errorMessage = 'الكمية يجب أن تكون رقمًا موجبًا',
                      );
                      return;
                    }
                    if (unit.isEmpty) {
                      setDialogState(() => errorMessage = 'الوحدة مطلوبة');
                      return;
                    }
                    if (_bomItems.any(
                      (item) => item['rawMaterialId'] == selectedRawMaterialId,
                    )) {
                      setDialogState(
                        () => errorMessage = 'هذه الخامة مضافة بالفعل إلى BOM',
                      );
                      return;
                    }
                    final rawMaterial = rawMaterials.firstWhere(
                      (item) => item['id']?.toString() == selectedRawMaterialId,
                    );
                    setState(() => _bomItems.add({
                          'rawMaterialId': selectedRawMaterialId,
                          'quantity': quantity,
                          'unit': unit,
                          'name': rawMaterial['name'] ?? 'خامة',
                        }));
                    Navigator.pop(dialogContext);
                  },
                  child: const Text('إضافة'),
                ),
              ],
            ),
          );
        },
      );
    } finally {
      quantityController.dispose();
      unitController.dispose();
    }
  }

  String? _required(String? value, String label) {
    if (value == null || value.trim().isEmpty) return '$label مطلوب';
    return null;
  }

  String? _positiveNumber(String? value, String label) {
    final parsed = double.tryParse(value?.trim() ?? '');
    if (parsed == null || parsed <= 0) return '$label يجب أن يكون رقمًا موجبًا';
    return null;
  }

  Future<void> _submit() async {
    if (_isSaving || !(_formKey.currentState?.validate() ?? false)) return;

    final retailPrice = double.tryParse(_retailController.text.trim());
    final wholesalePrice = double.tryParse(_wholesaleController.text.trim());
    if (retailPrice == null || wholesalePrice == null) return;

    setState(() => _isSaving = true);
    try {
      await context.read<ProductsCubit>().createFullProduct(
        productData: {
          'code': _codeController.text.trim(),
          'name': _nameController.text.trim(),
          'category': _categoryController.text.trim(),
          'retailPrice': retailPrice,
          'wholesalePrice': wholesalePrice,
        },
        variants: _variants
            .map((variant) => <String, dynamic>{
                  'size': variant['size'].toString(),
                  'color': variant['color'].toString(),
                })
            .toList(),
        bomItems: _bomItems
            .map((item) => <String, dynamic>{
                  'rawMaterialId': item['rawMaterialId'],
                  'quantity': item['quantity'],
                  'unit': item['unit'].toString(),
                })
            .toList(),
      );
      if (mounted) Navigator.pop(context, true);
    } catch (_) {
      if (!mounted) return;
      setState(() => _isSaving = false);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
              'تعذر حفظ المنتج. تحقق من الصلاحيات والاتصال ثم حاول مرة أخرى.'),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('إضافة منتج جديد')),
      body: Form(
        key: _formKey,
        autovalidateMode: AutovalidateMode.onUserInteraction,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Container(
              height: 110,
              color: Colors.grey[200],
              child: const Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.image_not_supported_outlined, size: 36),
                  SizedBox(height: 6),
                  Text('رفع صور المنتجات سيُفعّل بعد ربط خدمة التخزين'),
                ],
              ),
            ),
            const SizedBox(height: 16),
            TextFormField(
              controller: _codeController,
              decoration: const InputDecoration(labelText: 'كود المنتج'),
              validator: (value) => _required(value, 'كود المنتج'),
            ),
            const SizedBox(height: 16),
            TextFormField(
              controller: _nameController,
              decoration: const InputDecoration(labelText: 'اسم المنتج'),
              validator: (value) => _required(value, 'اسم المنتج'),
            ),
            const SizedBox(height: 16),
            TextFormField(
              controller: _categoryController,
              decoration: const InputDecoration(labelText: 'التصنيف'),
              validator: (value) => _required(value, 'التصنيف'),
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(
                  child: TextFormField(
                    controller: _retailController,
                    decoration: const InputDecoration(labelText: 'سعر التجزئة'),
                    keyboardType: const TextInputType.numberWithOptions(
                      decimal: true,
                    ),
                    validator: (value) => _positiveNumber(value, 'سعر التجزئة'),
                  ),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: TextFormField(
                    controller: _wholesaleController,
                    decoration: const InputDecoration(labelText: 'سعر الجملة'),
                    keyboardType: const TextInputType.numberWithOptions(
                      decimal: true,
                    ),
                    validator: (value) => _positiveNumber(value, 'سعر الجملة'),
                  ),
                ),
              ],
            ),
            const Divider(height: 40),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text(
                  'الألوان والمقاسات',
                  style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                ),
                TextButton.icon(
                  onPressed: _isSaving ? null : _addVariant,
                  icon: const Icon(Icons.add),
                  label: const Text('إضافة'),
                ),
              ],
            ),
            Wrap(
              spacing: 8,
              children: _variants
                  .map(
                    (variant) => Chip(
                      label: Text(
                        '${variant['size']} - ${variant['color']}',
                        style: const TextStyle(fontFamily: 'Cairo'),
                      ),
                      onDeleted: _isSaving
                          ? null
                          : () => setState(() => _variants.remove(variant)),
                    ),
                  )
                  .toList(),
            ),
            const Divider(height: 40),
            BlocBuilder<InventoryCubit, InventoryState>(
              builder: (context, state) {
                final rawMaterials = state is InventoryLoaded
                    ? state.rawMaterials
                        .whereType<Map>()
                        .map((item) => Map<String, dynamic>.from(item))
                        .toList()
                    : const <Map<String, dynamic>>[];
                return Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        const Text(
                          'شجرة التصنيع (BOM)',
                          style: TextStyle(
                            fontWeight: FontWeight.bold,
                            fontSize: 16,
                          ),
                        ),
                        TextButton.icon(
                          onPressed: _isSaving
                              ? null
                              : () => _addBomItem(rawMaterials),
                          icon: const Icon(Icons.add),
                          label: const Text('إضافة مادة'),
                        ),
                      ],
                    ),
                    ..._bomItems.map(
                      (item) => ListTile(
                        title: Text(
                          item['name'].toString(),
                          style: const TextStyle(fontFamily: 'Cairo'),
                        ),
                        subtitle: Text('${item['quantity']} ${item['unit']}'),
                        trailing: IconButton(
                          icon: const Icon(
                            Icons.delete,
                            color: AppColors.error,
                          ),
                          onPressed: _isSaving
                              ? null
                              : () => setState(() => _bomItems.remove(item)),
                        ),
                      ),
                    ),
                  ],
                );
              },
            ),
            const SizedBox(height: 32),
            ElevatedButton(
              onPressed: _isSaving ? null : _submit,
              style: ElevatedButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: 16),
              ),
              child: _isSaving
                  ? const SizedBox(
                      height: 22,
                      width: 22,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text(
                      'حفظ المنتج',
                      style: TextStyle(fontSize: 18, fontFamily: 'Cairo'),
                    ),
            ),
          ],
        ),
      ),
    );
  }
}
