import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/constants/app_colors.dart';
import '../../../../core/widgets/selim/selim_shell.dart';
import '../cubit/branches_cubit.dart';

/// SELIM-ERP W4 — شاشة إدارة الفروع (نقل CompanySettingsView/branches من
/// المرجع SPRINT 89): قائمة الفروع (الرئيسي أولًا) مع عدادات مستندات كل
/// فرع + إنشاء/تحرير/تعطيل/حذف (حذف الرئيسي مرفوض خادميًا).
class BranchesScreen extends StatefulWidget {
  const BranchesScreen({this.cubit, super.key});

  final BranchesCubit? cubit;

  @override
  State<BranchesScreen> createState() => _BranchesScreenState();
}

class _BranchesScreenState extends State<BranchesScreen> {
  BranchesCubit? _ownCubit;

  @override
  void dispose() {
    _ownCubit?.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final cubit = widget.cubit ?? (_ownCubit ??= BranchesCubit()..load());
    return BlocProvider(
      create: (context) => cubit,
      child: BlocConsumer<BranchesCubit, BranchesState>(
        listener: (context, state) {
          if (state is BranchesError) {
            ScaffoldMessenger.of(context)
              ..hideCurrentSnackBar()
              ..showSnackBar(
                SnackBar(content: Text(state.message)),
              );
          }
        },
        builder: (context, state) => SelimShellScaffold(
          title: 'فروع الشركة',
          fab: FloatingActionButton.extended(
            onPressed: () => _openForm(context),
            icon: const Icon(Icons.add),
            label: const Text('فرع جديد'),
          ),
          actions: [
            IconButton(
              tooltip: 'تحديث',
              icon: const Icon(Icons.refresh),
              onPressed: cubit.load,
            ),
          ],
          body: _body(context, state),
        ),
      ),
    );
  }

  Widget _body(BuildContext context, BranchesState state) {
    final branches = state is BranchesLoaded
        ? state.branches
        : state is BranchesSaving
            ? state.previous
            : const <BranchEntry>[];
    final isLoading = state is BranchesLoading || state is BranchesInitial;

    if (isLoading) {
      return const Center(child: CircularProgressIndicator());
    }
    if (branches.isEmpty) {
      return const Center(
        child: Text(
          'لا فروع بعد — أضف أول فرع بزر «فرع جديد»',
          style: TextStyle(fontFamily: 'Cairo', fontSize: 15),
        ),
      );
    }
    return RefreshIndicator(
      onRefresh: () => context.read<BranchesCubit>().load(),
      child: ListView.builder(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(12),
        itemCount: branches.length,
        itemBuilder: (context, index) =>
            _branchCard(context, branches[index]),
      ),
    );
  }

  Widget _branchCard(BuildContext context, BranchEntry branch) {
    final cubit = context.read<BranchesCubit>();
    return Card(
      margin: const EdgeInsets.symmetric(vertical: 4),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(
                  branch.isMain
                      ? Icons.star_rounded
                      : Icons.store_outlined,
                  color: branch.isMain ? Colors.amber : AppColors.primary,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    branch.name,
                    style: const TextStyle(
                      fontFamily: 'Cairo',
                      fontWeight: FontWeight.w700,
                      fontSize: 15,
                    ),
                  ),
                ),
                if (branch.isMain)
                  _chip(context, 'الرئيسي', Colors.amber)
                else if (!branch.isActive)
                  _chip(context, 'معطّل', Colors.grey),
              ],
            ),
            if ((branch.address ?? '').isNotEmpty ||
                (branch.manager ?? '').isNotEmpty ||
                (branch.phone ?? '').isNotEmpty) ...[
              const SizedBox(height: 6),
              Text(
                [
                  if ((branch.address ?? '').isNotEmpty) branch.address,
                  if ((branch.manager ?? '').isNotEmpty)
                    'المسؤول: ${branch.manager}',
                  if ((branch.phone ?? '').isNotEmpty) branch.phone,
                ].whereType<String>().join(' · '),
                style: const TextStyle(
                  fontFamily: 'Cairo',
                  fontSize: 12,
                  color: Colors.black54,
                ),
              ),
            ],
            const SizedBox(height: 8),
            Text(
              '${branch.salesCount} فاتورة بيع · '
              '${branch.purchaseCount} أمر شراء · '
              '${branch.productsCount} صنف',
              style: const TextStyle(
                fontFamily: 'Cairo',
                fontSize: 12,
                color: AppColors.primary,
              ),
            ),
            const SizedBox(height: 8),
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                TextButton.icon(
                  onPressed: () => _openForm(context, branch: branch),
                  icon: const Icon(Icons.edit_outlined, size: 18),
                  label: const Text('تحرير'),
                ),
                if (!branch.isMain)
                  TextButton.icon(
                    onPressed: () => cubit.update(
                      branch.id,
                      isActive: !branch.isActive,
                    ),
                    icon: Icon(
                      branch.isActive
                          ? Icons.toggle_off_outlined
                          : Icons.toggle_on_outlined,
                      size: 18,
                    ),
                    label: Text(branch.isActive ? 'تعطيل' : 'تنشيط'),
                  ),
                if (!branch.isMain)
                  TextButton.icon(
                    style: TextButton.styleFrom(
                      foregroundColor: Colors.redAccent,
                    ),
                    onPressed: () => _confirmDelete(context, branch),
                    icon: const Icon(Icons.delete_outline, size: 18),
                    label: const Text('حذف'),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _chip(BuildContext context, String label, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: color,
        borderRadius: BorderRadius.circular(10),
      ),
      child: Text(
        label,
        style: const TextStyle(
          fontFamily: 'Cairo',
          fontSize: 10,
          color: Colors.white,
        ),
      ),
    );
  }

  void _confirmDelete(BuildContext context, BranchEntry branch) {
    showDialog<void>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('حذف الفرع',
            style: TextStyle(fontFamily: 'Cairo')),
        content: Text(
          'سيُحذف «${branch.name}» — مستنداته المرتبطة تبقى بلا فرع (لا تُفقد '
          'أي فاتورة أو صنف). متابعة؟',
          style: const TextStyle(fontFamily: 'Cairo'),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: const Text('إلغاء'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: Colors.redAccent,
            ),
            onPressed: () {
              Navigator.of(dialogContext).pop();
              context.read<BranchesCubit>().remove(branch.id);
            },
            child: const Text('حذف'),
          ),
        ],
      ),
    );
  }

  void _openForm(BuildContext context, {BranchEntry? branch}) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (sheetContext) => _BranchFormSheet(
        cubit: context.read<BranchesCubit>(),
        branch: branch,
      ),
    );
  }
}

/// نموذج إنشاء/تحرير فرع — حقول المرجع: الاسم (إلزامي) + العنوان +
/// الهاتف + المسؤول + «رئيسي» (تعيينه يلغي رئيسية غيره خادميًا).
class _BranchFormSheet extends StatefulWidget {
  const _BranchFormSheet({required this.cubit, this.branch});

  final BranchesCubit cubit;
  final BranchEntry? branch;

  @override
  State<_BranchFormSheet> createState() => _BranchFormSheetState();
}

class _BranchFormSheetState extends State<_BranchFormSheet> {
  late final TextEditingController _name;
  late final TextEditingController _address;
  late final TextEditingController _phone;
  late final TextEditingController _manager;
  late bool _isMain;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    final branch = widget.branch;
    _name = TextEditingController(text: branch?.name ?? '');
    _address = TextEditingController(text: branch?.address ?? '');
    _phone = TextEditingController(text: branch?.phone ?? '');
    _manager = TextEditingController(text: branch?.manager ?? '');
    _isMain = branch?.isMain ?? false;
  }

  @override
  void dispose() {
    _name.dispose();
    _address.dispose();
    _phone.dispose();
    _manager.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final name = _name.text.trim();
    if (name.length < 2) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('اسم الفرع مطلوب (حرفان على الأقل)')),
      );
      return;
    }
    setState(() => _saving = true);
    final branch = widget.branch;
    final ok = branch == null
        ? await widget.cubit.create(
            name: name,
            address: _address.text,
            phone: _phone.text,
            manager: _manager.text,
            isMain: _isMain,
          )
        : await widget.cubit.update(
            branch.id,
            name: name,
            address: _address.text,
            phone: _phone.text,
            manager: _manager.text,
            isMain: _isMain,
          );
    if (!mounted) return;
    setState(() => _saving = false);
    if (ok) Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final isEdit = widget.branch != null;
    return Padding(
      padding: EdgeInsets.only(
        left: 16,
        right: 16,
        top: 16,
        bottom: MediaQuery.viewInsetsOf(context).bottom + 16,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            isEdit ? 'تحرير الفرع' : 'فرع جديد',
            style: const TextStyle(
              fontFamily: 'Cairo',
              fontSize: 18,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _name,
            decoration: const InputDecoration(
              labelText: 'اسم الفرع *',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: _address,
            decoration: const InputDecoration(
              labelText: 'العنوان',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: _phone,
            keyboardType: TextInputType.phone,
            decoration: const InputDecoration(
              labelText: 'الهاتف',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: _manager,
            decoration: const InputDecoration(
              labelText: 'مسؤول الفرع',
              border: OutlineInputBorder(),
            ),
          ),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('الفرع الرئيسي',
                style: TextStyle(fontFamily: 'Cairo')),
            subtitle: const Text(
              'تعيينه يلغي رئيسية الفروع الأخرى',
              style: TextStyle(fontFamily: 'Cairo', fontSize: 11),
            ),
            value: _isMain,
            onChanged: (value) => setState(() => _isMain = value),
          ),
          const SizedBox(height: 8),
          SizedBox(
            width: double.infinity,
            child: FilledButton.icon(
              onPressed: _saving ? null : _submit,
              icon: _saving
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.save_outlined),
              label: Text(isEdit ? 'حفظ التعديلات' : 'إضافة الفرع'),
            ),
          ),
        ],
      ),
    );
  }
}
