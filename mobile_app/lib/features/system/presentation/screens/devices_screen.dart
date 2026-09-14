import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/constants/app_colors.dart';
import '../../../../core/widgets/selim/format.dart';
import '../../../../core/widgets/selim/selim_shell.dart';
import '../cubit/devices_cubit.dart';

/// SELIM-ERP W3 — شاشة الأجهزة المسجلة (نقل DevicesView من المرجع):
/// آخر ظهور لكل جهاز + مستخدمه + منصته + إصدار التطبيق.
class DevicesScreen extends StatefulWidget {
  const DevicesScreen({this.cubit, super.key});

  final DevicesCubit? cubit;

  @override
  State<DevicesScreen> createState() => _DevicesScreenState();
}

class _DevicesScreenState extends State<DevicesScreen> {
  DevicesCubit? _ownCubit;

  @override
  void dispose() {
    _ownCubit?.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final cubit = widget.cubit ?? (_ownCubit ??= DevicesCubit()..load());
    return BlocProvider(
      create: (context) => cubit,
      child: BlocBuilder<DevicesCubit, DevicesState>(
        builder: (context, state) => SelimShellScaffold(
          title: 'الأجهزة المسجلة',
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

  Widget _body(BuildContext context, DevicesState state) {
    if (state is DevicesLoading || state is DevicesInitial) {
      return const Center(child: CircularProgressIndicator());
    }
    if (state is DevicesError) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(state.message, style: const TextStyle(fontFamily: 'Cairo')),
            const SizedBox(height: 12),
            FilledButton(
              onPressed: () => context.read<DevicesCubit>().load(),
              child: const Text('إعادة المحاولة'),
            ),
          ],
        ),
      );
    }
    final devices = (state as DevicesLoaded).devices;
    if (devices.isEmpty) {
      return const Center(
        child: Text('لا أجهزة مسجلة بعد',
            style: TextStyle(fontFamily: 'Cairo', fontSize: 15)),
      );
    }
    return ListView.builder(
      padding: const EdgeInsets.all(12),
      itemCount: devices.length,
      itemBuilder: (context, index) {
        final device = devices[index];
        return Card(
          margin: const EdgeInsets.symmetric(vertical: 4),
          child: ListTile(
            leading: Icon(
              device.isMobile
                  ? Icons.smartphone
                  : Icons.desktop_windows_outlined,
              color: AppColors.primary,
            ),
            title: Text(
              device.userName,
              style: const TextStyle(
                fontFamily: 'Cairo',
                fontWeight: FontWeight.w600,
              ),
            ),
            subtitle: Text(
              '${device.platform ?? 'غير معروف'}'
              '${device.appVersion != null ? ' · ${device.appVersion}' : ''}',
              style: const TextStyle(fontFamily: 'Cairo', fontSize: 12),
            ),
            trailing: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(
                  dateTime(device.lastSeenAt),
                  style: const TextStyle(fontFamily: 'Cairo', fontSize: 11),
                ),
                const SizedBox(height: 4),
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                  decoration: BoxDecoration(
                    color: device.isRecentlyActive
                        ? AppColors.success
                        : Colors.grey.shade400,
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Text(
                    device.isRecentlyActive ? 'نشِط' : 'خامل',
                    style: const TextStyle(
                      fontFamily: 'Cairo',
                      fontSize: 10,
                      color: Colors.white,
                    ),
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}
