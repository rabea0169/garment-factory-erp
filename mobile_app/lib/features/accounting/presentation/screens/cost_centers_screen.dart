import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/constants/app_colors.dart';
import '../../../../core/widgets/selim/selim_shell.dart';
import '../cubit/cost_centers_cubit.dart';

/// SELIM-ERP W3 — شاشة مراكز التكلفة (نقل CostCentersView من المرجع):
/// قائمة + إنشاء + تعديل الاسم/الحالة + حذف (محصّن خادميًا للميزانيات).
class CostCentersScreen extends StatefulWidget {
  const CostCentersScreen({this.cubit, super.key});

  final CostCentersCubit? cubit;

  @override
  State<CostCentersScreen> createState() => _CostCentersScreenState();
}

class _CostCentersScreenState extends State<CostCentersScreen> {
  CostCentersCubit? _ownCubit;

  @override
  void dispose() {
    _ownCubit?.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final cubit = widget.cubit ?? (_ownCubit ??= CostCentersCubit()..load());
    return BlocProvider(
      create: (context) => cubit,
      child: BlocBuilder<CostCentersCubit, CostCentersState>(
        builder: (context, state) => SelimShellScaffold(
          title: 'مراكز التكلفة',
          fab: FloatingActionButton.extended(
            onPressed: state is CostCentersLoaded && !state.pendingAction
                ? () => _showCreateDialog(context, cubit)
                : null,
            icon: const Icon(Icons.add),
            label: const Text('مركز جديد'),
          ),
          body: _body(context, state),
        ),
      ),
    );
  }

  Widget _body(BuildContext context, CostCentersState state) {
    if (state is CostCentersLoading || state is CostCentersInitial) {
      return const Center(child: CircularProgressIndicator());
    }
    if (state is CostCentersError) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(state.message, style: const TextStyle(fontFamily: 'Cairo')),
            const SizedBox(height: 12),
            FilledButton(
              onPressed: () => context.read<CostCentersCubit>().load(),
              child: const Text('إعادة المحاولة'),
            ),
          ],
        ),
      );
    }
    final centers = (state as CostCentersLoaded).centers;
    if (centers.isEmpty) {
      return const Center(
        child: Text('لا مراكز تكلفة — أنشئ أول مركز',
            style: TextStyle(fontFamily: 'Cairo', fontSize: 15)),
      );
    }
    return ListView.builder(
      padding: const EdgeInsets.all(12),
      itemCount: centers.length,
      itemBuilder: (context, index) {
        final center = centers[index];
        return Card(
          margin: const EdgeInsets.symmetric(vertical: 4),
          child: ListTile(
            leading: CircleAvatar(
              backgroundColor: center.isActive
                  ? AppColors.primary.withOpacity(0.12)
                  : Colors.grey.shade300,
              child: Text(
                center.code,
                style: const TextStyle(fontFamily: 'Cairo', fontSize: 12),
              ),
            ),
            title: Text(
              center.name,
              style: const TextStyle(
                fontFamily: 'Cairo',
                fontWeight: FontWeight.w600,
              ),
            ),
            subtitle: Text(
              center.budgetsCount > 0
                  ? '${center.budgetsCount} ميزانية مرتبطة'
                  : 'بلا ميزانيات',
              style: const TextStyle(fontFamily: 'Cairo', fontSize: 12),
            ),
            trailing: PopupMenuButton<String>(
              onSelected: (value) => _onMenu(
                context,
                context.read<CostCentersCubit>(),
                center,
                value,
              ),
              itemBuilder: (context) => [
                const PopupMenuItem(
                  value: 'rename',
                  child: Text('تعديل الاسم'),
                ),
                PopupMenuItem(
                  value: 'toggle',
                  child: Text(center.isActive ? 'تعطيل' : 'تنشيط'),
                ),
                const PopupMenuItem(
                  value: 'delete',
                  child: Text('حذف'),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  Future<void> _onMenu(
    BuildContext context,
    CostCentersCubit cubit,
    CostCenterEntry center,
    String action,
  ) async {
    switch (action) {
      case 'rename':
        await _showRenameDialog(context, cubit, center);
        break;
      case 'toggle':
        final ok = await cubit
            .update(id: center.id, isActive: !center.isActive);
        if (!ok && mounted) _showError(context, cubit.lastError);
        break;
      case 'delete':
        final ok = await cubit.delete(center.id);
        if (!ok && mounted) _showError(context, cubit.lastError);
        break;
    }
  }

  void _showError(BuildContext context, String? message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          message ?? 'تعذر تنفيذ الإجراء',
          style: const TextStyle(fontFamily: 'Cairo'),
        ),
        backgroundColor: AppColors.error,
      ),
    );
  }

  Future<void> _showCreateDialog(
    BuildContext context,
    CostCentersCubit cubit,
  ) async {
    final code = TextEditingController();
    final name = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('مركز تكلفة جديد',
            style: TextStyle(fontFamily: 'Cairo')),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: code,
              decoration: const InputDecoration(
                labelText: 'الكود (مثل CC-01)',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: name,
              decoration: const InputDecoration(
                labelText: 'الاسم (مثل خط الإنتاج أ)',
                border: OutlineInputBorder(),
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('إلغاء'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('إنشاء'),
          ),
        ],
      ),
    );
    if (ok == true && code.text.trim().isNotEmpty) {
      final created = await cubit.create(
        code: code.text.trim(),
        name: name.text.trim(),
      );
      if (!created && mounted) _showError(context, cubit.lastError);
    }
  }

  Future<void> _showRenameDialog(
    BuildContext context,
    CostCentersCubit cubit,
    CostCenterEntry center,
  ) async {
    final name = TextEditingController(text: center.name);
    final ok = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('تعديل اسم المركز',
            style: TextStyle(fontFamily: 'Cairo')),
        content: TextField(
          controller: name,
          decoration: const InputDecoration(
            labelText: 'الاسم الجديد',
            border: OutlineInputBorder(),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('إلغاء'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('حفظ'),
          ),
        ],
      ),
    );
    if (ok == true && name.text.trim().isNotEmpty) {
      final updated =
          await cubit.update(id: center.id, name: name.text.trim());
      if (!updated && mounted) _showError(context, cubit.lastError);
    }
  }
}
