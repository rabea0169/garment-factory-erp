import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/constants/app_colors.dart';
import '../../../../core/widgets/selim/format.dart';
import '../../../../core/widgets/selim/selim_shell.dart';
import '../cubit/audit_logs_cubit.dart';

/// SELIM-ERP W3 — شاشة سجل التدقيق (نقل AuditLogsView من Selim): قائمة
/// زمنية تنازلية بأفعال المستخدمين + فلترة بالوحدة + ترقيم.
class AuditLogsScreen extends StatefulWidget {
  const AuditLogsScreen({this.cubit, super.key});

  final AuditLogsCubit? cubit;

  @override
  State<AuditLogsScreen> createState() => _AuditLogsScreenState();
}

class _AuditLogsScreenState extends State<AuditLogsScreen> {
  AuditLogsCubit? _ownCubit;
  String _moduleFilter = 'الكل';

  @override
  void dispose() {
    _ownCubit?.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final cubit = widget.cubit ?? (_ownCubit ??= AuditLogsCubit()..load());
    return BlocProvider(
      create: (context) => cubit,
      child: BlocBuilder<AuditLogsCubit, AuditLogsState>(
        builder: (context, state) => SelimShellScaffold(
          title: 'سجل التدقيق',
          body: Column(
            children: [
              _moduleFilterRow(context, cubit),
              Expanded(child: _body(context, state, cubit)),
            ],
          ),
        ),
      ),
    );
  }

  Widget _moduleFilterRow(BuildContext context, AuditLogsCubit cubit) {
    return SizedBox(
      height: 48,
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        children: [
          for (final module in kAuditLogModules)
            Padding(
              padding: const EdgeInsetsDirectional.only(end: 8),
              child: ChoiceChip(
                label: Text(
                  module,
                  style: const TextStyle(fontFamily: 'Cairo', fontSize: 12),
                ),
                selected: _moduleFilter == module,
                onSelected: (_) {
                  setState(() => _moduleFilter = module);
                  cubit.load(module: module == 'الكل' ? null : module);
                },
              ),
            ),
        ],
      ),
    );
  }

  Widget _body(
    BuildContext context,
    AuditLogsState state,
    AuditLogsCubit cubit,
  ) {
    if (state is AuditLogsLoading || state is AuditLogsInitial) {
      return const Center(child: CircularProgressIndicator());
    }
    if (state is AuditLogsError) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(state.message, style: const TextStyle(fontFamily: 'Cairo')),
            const SizedBox(height: 12),
            FilledButton(
              onPressed: () => cubit.load(
                module: _moduleFilter == 'الكل' ? null : _moduleFilter,
              ),
              child: const Text('إعادة المحاولة'),
            ),
          ],
        ),
      );
    }
    final loaded = state as AuditLogsLoaded;
    if (loaded.page.logs.isEmpty) {
      return const Center(
        child: Text('لا مدخلات مطابقة',
            style: TextStyle(fontFamily: 'Cairo', fontSize: 15)),
      );
    }
    return Column(
      children: [
        Expanded(
          child: ListView.builder(
            padding: const EdgeInsets.fromLTRB(12, 4, 12, 12),
            itemCount: loaded.page.logs.length,
            itemBuilder: (context, index) {
              final log = loaded.page.logs[index];
              return Card(
                margin: const EdgeInsets.symmetric(vertical: 4),
                child: ListTile(
                  leading: CircleAvatar(
                    backgroundColor: AppColors.primary.withValues(alpha: 0.12),
                    child: Text(
                      log.userName.isEmpty ? '؟' : log.userName.characters.first,
                      style: const TextStyle(fontFamily: 'Cairo'),
                    ),
                  ),
                  title: Text(
                    log.action,
                    style: const TextStyle(
                      fontFamily: 'Cairo',
                      fontWeight: FontWeight.w600,
                      fontSize: 14,
                    ),
                  ),
                  subtitle: Text(
                    '${log.userName} · ${log.module}',
                    style: const TextStyle(fontFamily: 'Cairo', fontSize: 12),
                  ),
                  trailing: Text(
                    dateTime(log.createdAt),
                    style: const TextStyle(fontFamily: 'Cairo', fontSize: 11),
                  ),
                ),
              );
            },
          ),
        ),
        _pager(context, loaded, cubit),
      ],
    );
  }

  Widget _pager(
    BuildContext context,
    AuditLogsLoaded loaded,
    AuditLogsCubit cubit,
  ) {
    final loadedPage = loaded.page;
    return Padding(
      padding: const EdgeInsets.all(12),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          OutlinedButton(
            onPressed: loadedPage.pageNumber > 1 ? () => cubit.previous() : null,
            child: const Text('السابق'),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Text(
              '${loadedPage.cumulative} من ${loadedPage.total}',
              style: const TextStyle(fontFamily: 'Cairo'),
            ),
          ),
          OutlinedButton(
            onPressed: loadedPage.hasMore ? () => cubit.next() : null,
            child: const Text('التالي'),
          ),
        ],
      ),
    );
  }
}
