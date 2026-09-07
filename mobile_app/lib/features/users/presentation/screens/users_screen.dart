import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/constants/app_colors.dart';
import '../../../../core/widgets/app_feedback.dart';
import '../../domain/user_roles.dart';
import '../cubit/users_cubit.dart';
import '../cubit/users_state.dart';
import '../widgets/change_role_dialog.dart';
import '../widgets/create_user_dialog.dart';

/// CC-9: شاشة إدارة المستخدمين — قائمة (GET /users)، إنشاء (POST
/// /users)، تغيير دور (PATCH /users/:id/role)، وتعطيل/تنشيط (PATCH
/// /users/:id/deactivate | activate). المسار مقصور خادميًا على
/// SUPER_ADMIN — غيره يرى رسالة 403 العربية.
class UsersScreen extends StatelessWidget {
  const UsersScreen({this.cubit, super.key});

  /// يُحقن في الاختبارات؛ الافتراضي cubit جديد يبدأ الجلب فورًا.
  final UsersCubit? cubit;

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => cubit ?? (UsersCubit()..fetchUsers()),
      child: const _UsersView(),
    );
  }
}

class _UsersView extends StatelessWidget {
  const _UsersView();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('المستخدمون'),
        actions: [
          Builder(
            builder: (ctx) => IconButton(
              icon: const Icon(Icons.refresh),
              tooltip: 'تحديث',
              onPressed: () => ctx.read<UsersCubit>().fetchUsers(),
            ),
          ),
        ],
      ),
      body: BlocBuilder<UsersCubit, UsersState>(
        builder: (context, state) {
          if (state is UsersLoading || state is UsersInitial) {
            return const AppLoadingView(message: 'جاري تحميل المستخدمين...');
          }
          if (state is UsersError) {
            return AppErrorView(
              message: state.message,
              onRetry: () => context.read<UsersCubit>().fetchUsers(),
            );
          }
          if (state is UsersLoaded) {
            if (state.users.isEmpty) {
              return AppEmptyView(
                title: 'لا يوجد مستخدمون',
                message: 'أنشئ أول مستخدم من زر "مستخدم جديد"',
                actionLabel: 'إعادة التحميل',
                onAction: () => context.read<UsersCubit>().fetchUsers(),
              );
            }
            return RefreshIndicator(
              onRefresh: () => context.read<UsersCubit>().fetchUsers(),
              child: ListView.separated(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.all(16),
                itemCount: state.users.length,
                separatorBuilder: (_, __) => const SizedBox(height: 12),
                itemBuilder: (context, index) => _UserCard(
                  user: state.users[index],
                  cubit: context.read<UsersCubit>(),
                ),
              ),
            );
          }
          return const SizedBox.shrink();
        },
      ),
      // CC-9: إنشاء مستخدم جديد (POST /users).
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _showCreateUserDialog(context),
        icon: const Icon(Icons.person_add_alt),
        label: const Text('مستخدم جديد'),
      ),
    );
  }

  Future<void> _showCreateUserDialog(BuildContext context) async {
    final cubit = context.read<UsersCubit>();
    final created = await showDialog<bool>(
      context: context,
      builder: (_) => CreateUserDialog(cubit: cubit),
    );
    if (created == true && context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('تم إنشاء المستخدم بنجاح')),
      );
    }
  }
}

/// بطاقة مستخدم — الاسم/البريد/الدور/حالة النشاط + تغيير الدور
/// وتعطيل/تنشيط.
class _UserCard extends StatefulWidget {
  const _UserCard({required this.user, required this.cubit});

  final Map<String, dynamic> user;
  final UsersCubit cubit;

  @override
  State<_UserCard> createState() => _UserCardState();
}

class _UserCardState extends State<_UserCard> {
  bool _isRunning = false;

  String? get _id => widget.user['id']?.toString();

  String get _name => widget.user['name']?.toString() ?? '';

  String get _role => widget.user['role']?.toString() ?? '';

  bool get _isActive => widget.user['isActive'] == true;

  Future<void> _changeRole() async {
    final id = _id;
    if (id == null) return;
    final changed = await showDialog<bool>(
      context: context,
      builder: (_) => ChangeUserRoleDialog(
        cubit: widget.cubit,
        userId: id,
        currentRole: _role,
        userName: _name.isEmpty ? 'المستخدم' : _name,
      ),
    );
    if (changed == true && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('تم تغيير دور المستخدم بنجاح')),
      );
    }
  }

  Future<void> _toggleActive() async {
    final id = _id;
    if (id == null) return;
    final target = !_isActive;
    if (!target) {
      // التعطيل تدميري — تأكيد أولًا (الخادم يحمي ذاتيًا من تعطيل نفسك).
      final confirmed = await confirmAppAction(
        context,
        title: 'تعطيل المستخدم',
        message: 'سيُمنع "${_name.isEmpty ? 'هذا المستخدم' : _name}" من '
            'تسجيل الدخول حتى يُنشَّط مجددًا. هل أنت متأكد؟',
        confirmLabel: 'تعطيل',
      );
      if (!confirmed || !mounted) return;
    }
    setState(() => _isRunning = true);
    final error = await widget.cubit.setUserActive(userId: id, active: target);
    if (!mounted) return;
    setState(() => _isRunning = false);
    final messenger = ScaffoldMessenger.of(context);
    if (error != null) {
      messenger.showSnackBar(
        SnackBar(content: Text(error), duration: const Duration(seconds: 4)),
      );
    } else {
      messenger.showSnackBar(
        SnackBar(content: Text(target ? 'تم تنشيط المستخدم' : 'تم تعطيل المستخدم')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final hasActions = _id != null;
    return Card(
      margin: EdgeInsets.zero,
      child: Column(
        children: [
          ListTile(
            leading: CircleAvatar(
              backgroundColor: _isActive ? AppColors.primary : Colors.grey,
              child: Icon(Icons.person, color: Colors.white),
            ),
            title: Text(
              _name.isEmpty ? 'مستخدم' : _name,
              style: const TextStyle(
                  fontWeight: FontWeight.bold, fontFamily: 'Cairo'),
            ),
            subtitle: Text(
              '${widget.user['email'] ?? ''}\n'
              'الدور: ${userRoleLabel(_role)}',
            ),
            isThreeLine: true,
            trailing: _ActiveBadge(isActive: _isActive),
          ),
          if (hasActions) ...[
            const Divider(height: 1),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  Padding(
                    padding: const EdgeInsetsDirectional.only(start: 8),
                    child: FilledButton.tonalIcon(
                      onPressed: _isRunning ? null : _changeRole,
                      icon: const Icon(Icons.published_with_changes,
                          size: 18),
                      label: const Text('تغيير الدور'),
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsetsDirectional.only(start: 8),
                    child: _isActive
                        ? TextButton.icon(
                            onPressed: _isRunning ? null : _toggleActive,
                            icon: const Icon(Icons.block, size: 18),
                            label: const Text('تعطيل'),
                            style: TextButton.styleFrom(
                              foregroundColor: AppColors.error,
                            ),
                          )
                        : TextButton.icon(
                            onPressed: _isRunning ? null : _toggleActive,
                            icon: const Icon(Icons.check_circle_outline,
                                size: 18),
                            label: const Text('تنشيط'),
                            style: TextButton.styleFrom(
                              foregroundColor: AppColors.success,
                            ),
                          ),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// شارة حالة النشاط — "نشط" (أخضر) / "معطّل" (رمادي).
class _ActiveBadge extends StatelessWidget {
  const _ActiveBadge({required this.isActive});

  final bool isActive;

  @override
  Widget build(BuildContext context) {
    final color = isActive ? AppColors.success : AppColors.textSecondary;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Text(
        isActive ? 'نشط' : 'معطّل',
        style: TextStyle(
          color: color,
          fontSize: 12,
          fontWeight: FontWeight.bold,
          fontFamily: 'Cairo',
        ),
      ),
    );
  }
}
