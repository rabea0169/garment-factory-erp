import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:image_picker/image_picker.dart';
import 'dart:io';
import '../../../../core/constants/app_colors.dart';
import '../cubit/products_cubit.dart';
import '../../../inventory/presentation/cubit/inventory_cubit.dart';
import '../../../inventory/presentation/cubit/inventory_state.dart';

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

  XFile? _imageFile;
  final ImagePicker _picker = ImagePicker();

  List<Map<String, dynamic>> _variants = [];
  List<Map<String, dynamic>> _bomItems = [];

  @override
  void initState() {
    super.initState();
    // Fetch raw materials for BOM dropdowns
    context.read<InventoryCubit>().fetchRawMaterials();
  }

  Future<void> _pickImage() async {
    final picked = await _picker.pickImage(source: ImageSource.gallery);
    if (picked != null) {
      setState(() {
        _imageFile = picked;
      });
    }
  }

  void _addVariant() {
    final sizeCtrl = TextEditingController();
    final colorCtrl = TextEditingController();
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('إضافة مقاس ولون', style: TextStyle(fontFamily: 'Cairo')),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(controller: sizeCtrl, decoration: const InputDecoration(labelText: 'المقاس (M, L, XL)')),
            TextField(controller: colorCtrl, decoration: const InputDecoration(labelText: 'اللون')),
          ],
        ),
        actions: [
          ElevatedButton(
            onPressed: () {
              setState(() {
                _variants.add({'size': sizeCtrl.text, 'color': colorCtrl.text});
              });
              Navigator.pop(ctx);
            },
            child: const Text('إضافة'),
          )
        ],
      ),
    );
  }

  void _addBomItem(List<dynamic> rawMaterials) {
    String? selectedRm;
    final qtyCtrl = TextEditingController();
    final unitCtrl = TextEditingController(text: 'METER');

    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('إضافة مادة خام (BOM)', style: TextStyle(fontFamily: 'Cairo')),
        content: StatefulBuilder(
          builder: (ctx, setDialogState) => Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              DropdownButtonFormField<String>(
                value: selectedRm,
                hint: const Text('اختر المادة الخام'),
                items: rawMaterials.map((rm) {
                  return DropdownMenuItem<String>(
                    value: rm['id'],
                    child: Text('${rm['name']} (${rm['code']})'),
                  );
                }).toList(),
                onChanged: (v) => setDialogState(() => selectedRm = v),
              ),
              TextField(controller: qtyCtrl, decoration: const InputDecoration(labelText: 'الكمية المستهلكة للقطعة'), keyboardType: TextInputType.number),
              TextField(controller: unitCtrl, decoration: const InputDecoration(labelText: 'الوحدة (METER, PIECE, الخ)')),
            ],
          ),
        ),
        actions: [
          ElevatedButton(
            onPressed: () {
              if (selectedRm != null && qtyCtrl.text.isNotEmpty) {
                setState(() {
                  _bomItems.add({
                    'rawMaterialId': selectedRm,
                    'quantity': double.parse(qtyCtrl.text),
                    'unit': unitCtrl.text,
                    'name': rawMaterials.firstWhere((r) => r['id'] == selectedRm)['name']
                  });
                });
                Navigator.pop(ctx);
              }
            },
            child: const Text('إضافة'),
          )
        ],
      ),
    );
  }

  void _submit() {
    if (_formKey.currentState!.validate()) {
      context.read<ProductsCubit>().createFullProduct(
        productData: {
          'code': _codeController.text,
          'name': _nameController.text,
          'category': _categoryController.text,
          'retailPrice': double.parse(_retailController.text),
          'wholesalePrice': double.parse(_wholesaleController.text),
          // image upload logic to s3/local would be here.
        },
        variants: _variants,
        bomItems: _bomItems.map((b) => {
          'rawMaterialId': b['rawMaterialId'],
          'quantity': b['quantity'],
          'unit': b['unit'],
        }).toList(),
      );
      Navigator.pop(context);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('إضافة منتج جديد')),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            // Image picker
            GestureDetector(
              onTap: _pickImage,
              child: Container(
                height: 150,
                color: Colors.grey[200],
                child: _imageFile == null
                    ? const Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [Icon(Icons.add_a_photo, size: 40), Text('إضافة صورة')],
                      )
                    // For Web compatibility, Image.network or kIsWeb check is needed, but assuming mobile path here or generic.
                    : const Center(child: Text('تم اختيار الصورة بنجاح', style: TextStyle(color: AppColors.success))),
              ),
            ),
            const SizedBox(height: 16),
            TextFormField(controller: _codeController, decoration: const InputDecoration(labelText: 'كود المنتج'), validator: (v) => v!.isEmpty ? 'مطلوب' : null),
            const SizedBox(height: 16),
            TextFormField(controller: _nameController, decoration: const InputDecoration(labelText: 'اسم المنتج (مثال: تيشيرت صيفي)')),
            const SizedBox(height: 16),
            TextFormField(controller: _categoryController, decoration: const InputDecoration(labelText: 'التصنيف')),
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(child: TextFormField(controller: _retailController, decoration: const InputDecoration(labelText: 'سعر القطاعي'), keyboardType: TextInputType.number)),
                const SizedBox(width: 16),
                Expanded(child: TextFormField(controller: _wholesaleController, decoration: const InputDecoration(labelText: 'سعر الجملة'), keyboardType: TextInputType.number)),
              ],
            ),
            const Divider(height: 40),
            
            // Variants Section
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text('الألوان والمقاسات', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                TextButton.icon(onPressed: _addVariant, icon: const Icon(Icons.add), label: const Text('إضافة'))
              ],
            ),
            Wrap(
              spacing: 8,
              children: _variants.map((v) => Chip(label: Text('${v['size']} - ${v['color']}', style: const TextStyle(fontFamily: 'Cairo')), onDeleted: () {
                setState(() => _variants.remove(v));
              })).toList(),
            ),
            
            const Divider(height: 40),

            // BOM Section
            BlocBuilder<InventoryCubit, InventoryState>(
              builder: (context, state) {
                List<dynamic> rawMaterials = [];
                if (state is InventoryLoaded) rawMaterials = state.rawMaterials;
                
                return Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        const Text('شجرة التصنيع (BOM)', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                        TextButton.icon(onPressed: () => _addBomItem(rawMaterials), icon: const Icon(Icons.add), label: const Text('إضافة مادة'))
                      ],
                    ),
                    ..._bomItems.map((b) => ListTile(
                      title: Text(b['name'], style: const TextStyle(fontFamily: 'Cairo')),
                      subtitle: Text('${b['quantity']} ${b['unit']}'),
                      trailing: IconButton(icon: const Icon(Icons.delete, color: AppColors.error), onPressed: () {
                        setState(() => _bomItems.remove(b));
                      }),
                    )),
                  ],
                );
              }
            ),

            const SizedBox(height: 32),
            ElevatedButton(
              onPressed: _submit,
              style: ElevatedButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 16)),
              child: const Text('حفظ المنتج', style: TextStyle(fontSize: 18, fontFamily: 'Cairo')),
            )
          ],
        ),
      ),
    );
  }
}
