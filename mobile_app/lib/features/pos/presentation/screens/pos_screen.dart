import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/constants/app_colors.dart';
import '../../../../core/services/barcode_scanner_launcher.dart';
import '../../../../core/services/thermal_printer_service.dart';
import '../../../../core/widgets/selim/selim_shell.dart';
import '../cubit/pos_cubit.dart';
import '../widgets/pos_receipt_widget.dart';

/// SELIM-ERP W2 — شاشة نقطة البيع (POS.tsx في Selim ERP).
///
/// تخطيط تكيفي: الجوال — سلة أسفل + شبكة منتجات أعلى (نفس لوحة Selim
/// POS)؛ الديسكتوب — شبكة يمين ولوحة سلة يسار. المسح بكاميرا الجهاز
/// عبر BarcodeScannerLauncher المشترك. الإيصار يُطبع حراريًا بعد البيع
/// مباشرة إن كانت هناك طابعة افتراضية محفوظة.
class PosScreen extends StatefulWidget {
  const PosScreen({super.key, this.cubit});

  /// يُحقن في الاختبارات؛ الافتراضي cubit جديد يبدأ بجلب الكتالوج.
  final PosCubit? cubit;

  @override
  State<PosScreen> createState() => _PosScreenState();
}

class _PosScreenState extends State<PosScreen> {
  final _searchController = TextEditingController();
  final _discountController = TextEditingController();

  @override
  void dispose() {
    _searchController.dispose();
    _discountController.dispose();
    super.dispose();
  }

  PosCubit _cubit() => widget.cubit ?? context.read<PosCubit>();

  Future<void> _onScanBarcode() async {
    final code = await const BarcodeScannerLauncher().scan(context);
    if (code == null || code.isEmpty) return;
    await _handleCode(code);
  }

  Future<void> _handleCode(String code) async {
    final item = await _cubit().resolveBarcode(code);
    if (!mounted) return;
    if (item == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('لم يُعرف الباركود: $code')),
      );
      return;
    }
    _cubit().addToCart(item);
  }

  Future<void> _checkout() async {
    final cubit = _cubit();
    final receipt = await cubit.checkout();
    if (!mounted || receipt == null) return;
    await showDialog<void>(
      context: context,
      builder: (dialogContext) => _ReceiptDialog(receipt: receipt),
    );
  }

  @override
  Widget build(BuildContext context) {
    final injected = widget.cubit;
    final body = BlocBuilder<PosCubit, PosState>(
      bloc: injected ?? context.watch<PosCubit>(),
      builder: (context, state) {
        if (state is PosLoading || state is PosInitial) {
          return const Center(child: CircularProgressIndicator());
        }
        if (state is PosError) {
          return Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.wifi_off_rounded,
                    size: 48, color: AppColors.error),
                const SizedBox(height: 12),
                Text(state.message, textAlign: TextAlign.center),
                const SizedBox(height: 12),
                FilledButton.icon(
                  onPressed: () => _cubit().loadCatalog(),
                  icon: const Icon(Icons.refresh_rounded),
                  label: const Text('إعادة المحاولة'),
                ),
              ],
            ),
          );
        }
        final ready = state as PosReady;
        if (ready.catalog.isEmpty) {
          return const Center(
            child: Text('لا يوجد كتالوج منتجات نشطة بعد'),
          );
        }
        return _buildBody(ready);
      },
    );

    return SelimShellScaffold(
      title: 'نقطة البيع',
      actions: [
        IconButton(
          tooltip: 'إعدادات الطابعة',
          icon: const Icon(Icons.print_rounded),
          onPressed: () => Navigator.of(context).push(
            MaterialPageRoute<void>(
              builder: (_) => const _PrinterSettingsRoute(),
            ),
          ),
        ),
      ],
      body: BlocProvider.value(
        value: injected ?? context.read<PosCubit>(),
        child: body,
      ),
      fab: null,
    );
  }

  Widget _buildBody(PosReady ready) {
    final query = _searchController.text;
    final items = query.isEmpty
        ? ready.catalog
        : _cubit().searchCatalog(query);
    final isWide = MediaQuery.sizeOf(context).width >= 900;

    if (isWide) {
      return Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(child: _catalogPane(ready, items)),
          SizedBox(
            width: 380,
            child: _cartPane(ready),
          ),
        ],
      );
    }
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 8, 12, 4),
          child: _searchBar(),
        ),
        Expanded(child: _catalogGrid(ready, items)),
        SafeArea(top: false, child: _cartSummaryBar(ready)),
      ],
    );
  }

  Widget _catalogPane(PosReady ready, List<PosCartItem> items) {
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 8, 12, 4),
          child: _searchBar(),
        ),
        Expanded(child: _catalogGrid(ready, items)),
      ],
    );
  }

  Widget _searchBar() {
    return Row(
      children: [
        Expanded(
          child: TextField(
            controller: _searchController,
            onChanged: (_) => setState(() {}),
            decoration: InputDecoration(
              hintText: 'بحث بالاسم أو الكود…',
              prefixIcon: const Icon(Icons.search_rounded),
              isDense: true,
              contentPadding:
                  const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
              ),
            ),
          ),
        ),
        const SizedBox(width: 8),
        FilledButton.icon(
          onPressed: _onScanBarcode,
          icon: const Icon(Icons.qr_code_scanner_rounded),
          label: const Text('مسح'),
        ),
      ],
    );
  }

  Widget _catalogGrid(PosReady ready, List<PosCartItem> items) {
    return GridView.builder(
      padding: const EdgeInsets.all(12),
      gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
        maxCrossAxisExtent: 200,
        childAspectRatio: 1.05,
        crossAxisSpacing: 10,
        mainAxisSpacing: 10,
      ),
      itemCount: items.length,
      itemBuilder: (context, index) {
        final item = items[index];
        final inCart = ready.cart
            .where((line) => line.variantId == item.variantId)
            .fold(0, (sum, line) => sum + line.quantity);
        return _ProductTile(
          item: item,
          inCart: inCart,
          onTap: () => _cubit().addToCart(item),
        );
      },
    );
  }

  Widget _cartPane(PosReady ready) {
    return Card(
      margin: const EdgeInsets.all(12),
      elevation: 2,
      child: Column(
        children: [
          _cartHeader(ready),
          Expanded(child: _cartList(ready)),
          _totalsSection(ready),
        ],
      ),
    );
  }

  Widget _cartSummaryBar(PosReady ready) {
    return Container(
      margin: const EdgeInsets.fromLTRB(12, 0, 12, 8),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: AppColors.primary,
        borderRadius: BorderRadius.circular(14),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  '${ready.itemCount} قطعة في السلة',
                  style: const TextStyle(
                      color: Colors.white, fontWeight: FontWeight.w700),
                ),
                Text(
                  'الإجمالي: ${ready.total.toStringAsFixed(2)} ج.م',
                  style: const TextStyle(color: Colors.white70, fontSize: 12),
                ),
              ],
            ),
          ),
          FilledButton.tonalIcon(
            style: FilledButton.styleFrom(
              backgroundColor: Colors.white,
              foregroundColor: AppColors.primary,
            ),
            onPressed: ready.cart.isEmpty ? null : _checkout,
            icon: const Icon(Icons.point_of_sale_rounded),
            label: const Text('إتمام البيع'),
          ),
        ],
      ),
    );
  }

  Widget _cartHeader(PosReady ready) {
    return Padding(
      padding: const EdgeInsets.all(12),
      child: Row(
        children: [
          Expanded(
            child: Text(
              'السلة (${ready.itemCount})',
              style: const TextStyle(
                fontFamily: 'Cairo',
                fontWeight: FontWeight.w800,
                fontSize: 16,
              ),
            ),
          ),
          IconButton(
            tooltip: 'تفريغ السلة',
            icon: const Icon(Icons.delete_sweep_rounded),
            onPressed: ready.cart.isEmpty ? null : () => _cubit().clearCart(),
          ),
          TextButton(
            onPressed: () => _cubit().togglePriceLevel(),
            child: Text(
              ready.priceLevel == PosPriceLevel.retail
                  ? 'قطاعي → جملة'
                  : 'جملة → قطاعي',
            ),
          ),
        ],
      ),
    );
  }

  Widget _cartList(PosReady ready) {
    if (ready.cart.isEmpty) {
      return const Center(child: Text('اسحب صنفًا أو امسح باركود'));
    }
    return ListView.builder(
      itemCount: ready.cart.length,
      itemBuilder: (context, index) {
        final line = ready.cart[index];
        return ListTile(
          dense: true,
          title: Text(
            '${line.name} (${line.size}/${line.color})',
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
          subtitle: Text(
              '${line.quantity} × ${line.unitPrice.toStringAsFixed(2)}'),
          trailing: _QtyStepper(
            quantity: line.quantity,
            onChanged: (q) => _cubit().setQuantity(line.variantId, q),
            onRemove: () => _cubit().removeLine(line.variantId),
          ),
        );
      },
    );
  }

  Widget _totalsSection(PosReady ready) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: const BoxDecoration(
        border: Border(top: BorderSide(color: Colors.black12)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              const Text('خصم (ج.م):'),
              const SizedBox(width: 8),
              Expanded(
                child: TextField(
                  controller: _discountController,
                  keyboardType:
                      const TextInputType.numberWithOptions(decimal: true),
                  decoration: const InputDecoration(
                      isDense: true, hintText: '0.00'),
                  onChanged: (value) =>
                      _cubit().setDiscount(double.tryParse(value) ?? 0),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          _totalRow('الإجمالي', ready.subtotal),
          if (ready.discount > 0)
            _totalRow('الخصم', -ready.discount),
          _totalRow('الضريبة (14%)', ready.vat),
          const Divider(height: 12),
          _totalRow('المستحق', ready.total, bold: true),
          const SizedBox(height: 8),
          SizedBox(
            width: double.infinity,
            child: FilledButton.icon(
              onPressed: ready.cart.isEmpty ? null : _checkout,
              icon: const Icon(Icons.point_of_sale_rounded),
              label: const Text('إتمام البيع النقدي'),
            ),
          ),
        ],
      ),
    );
  }

  Widget _totalRow(String label, double value, {bool bold = false}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 1),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: TextStyle(fontWeight: bold ? FontWeight.w800 : null)),
          Text(
            '${value.toStringAsFixed(2)} ج.م',
            style: TextStyle(
                fontWeight: bold ? FontWeight.w800 : FontWeight.w600),
          ),
        ],
      ),
    );
  }
}

/// بلاطة منتج في شبكة الكتالوج.
class _ProductTile extends StatelessWidget {
  const _ProductTile({required this.item, required this.inCart, this.onTap});

  final PosCartItem item;
  final int inCart;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Container(
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(
          color: inCart > 0 ? AppColors.primary.withValues(alpha: 0.08) : Colors.white,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: inCart > 0 ? AppColors.primary : Colors.black12,
            width: inCart > 0 ? 1.6 : 1,
          ),
        ),
        child: Stack(
          children: [
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Center(
                    child: Icon(
                      Icons.checkroom_rounded,
                      size: 40,
                      color: AppColors.primaryLight,
                    ),
                  ),
                ),
                Text(
                  item.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                      fontWeight: FontWeight.w700, fontSize: 13),
                ),
                Text(
                  '${item.size} · ${item.color}',
                  style: TextStyle(
                      fontSize: 11, color: Colors.grey.shade700),
                ),
                const SizedBox(height: 4),
                Text(
                  '${item.unitPrice.toStringAsFixed(2)} ج.م',
                  style: const TextStyle(
                      fontWeight: FontWeight.w800,
                      color: AppColors.primary,
                      fontSize: 13),
                ),
              ],
            ),
            if (inCart > 0)
              Positioned(
                top: 0,
                left: 0,
                child: CircleAvatar(
                  radius: 12,
                  backgroundColor: AppColors.primary,
                  child: Text(
                    '$inCart',
                    style: const TextStyle(
                        fontSize: 11,
                        color: Colors.white,
                        fontWeight: FontWeight.w800),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// متخطي الكمية (+/-/حذف).
class _QtyStepper extends StatelessWidget {
  const _QtyStepper({
    required this.quantity,
    required this.onChanged,
    required this.onRemove,
  });

  final int quantity;
  final ValueChanged<int> onChanged;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        IconButton(
          visualDensity: VisualDensity.compact,
          icon: const Icon(Icons.remove_rounded),
          onPressed: () => onChanged(quantity - 1),
        ),
        Text('$quantity',
            style: const TextStyle(fontWeight: FontWeight.w800)),
        IconButton(
          visualDensity: VisualDensity.compact,
          icon: const Icon(Icons.add_rounded),
          onPressed: () => onChanged(quantity + 1),
        ),
        IconButton(
          visualDensity: VisualDensity.compact,
          icon: const Icon(Icons.close_rounded, size: 18),
          onPressed: onRemove,
        ),
      ],
    );
  }
}

/// حوار الإيصار بعد البيع — معاينة + طباعة حرارية.
class _ReceiptDialog extends StatelessWidget {
  const _ReceiptDialog({required this.receipt});

  final PosReceipt receipt;

  Future<void> _print(BuildContext context) async {
    final printed = await ThermalPrinterService.instance.printWidgetReceipt(
      context,
      widget: PosReceiptWidget(receipt: receipt),
    );
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(printed
            ? 'أُرسل الإيصار للطابعة'
            : 'لا طباعة — تحقق من الطابعة في الإعدادات'),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Row(
        children: [
          const Icon(Icons.receipt_long_rounded, color: AppColors.success),
          const SizedBox(width: 8),
          Text(receipt.pendingOffline ? 'بيع معلق (offline)' : 'تم البيع'),
        ],
      ),
      content: SingleChildScrollView(
        child: PosReceiptWidget(receipt: receipt),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('إغلاق'),
        ),
        FilledButton.icon(
          onPressed: () => _print(context),
          icon: const Icon(Icons.print_rounded),
          label: const Text('طباعة'),
        ),
      ],
    );
  }
}

/// غلاف مسار إعدادات الطابعة (Navigator.push — شاشة مستقلة).
class _PrinterSettingsRoute extends StatelessWidget {
  const _PrinterSettingsRoute();

  @override
  Widget build(BuildContext context) {
    return const PrinterSettingsScreen();
  }
}

/// SELIM-ERP W2 — شاشة إعدادات الطابعة الحرارية: مسح/اتصال/افتراضية.
class PrinterSettingsScreen extends StatefulWidget {
  const PrinterSettingsScreen({super.key});

  @override
  State<PrinterSettingsScreen> createState() => _PrinterSettingsScreenState();
}

class _PrinterSettingsScreenState extends State<PrinterSettingsScreen> {
  @override
  void initState() {
    super.initState();
    ThermalPrinterService.instance.init().then((_) {
      if (mounted) {
        ThermalPrinterService.instance.scan();
      }
    });
  }

  @override
  void dispose() {
    ThermalPrinterService.instance.stopScan();
    super.dispose();
  }

  Future<void> _testPrint(BuildContext context) async {
    final receipt = PosReceipt(
      code: 'POS-TEST',
      items: [
        {'name': 'اختبار طباعة', 'quantity': 1, 'unitPrice': 10, 'total': 10},
      ],
      subtotal: 10,
      discount: 0,
      vatAmount: 1.4,
      total: 11.4,
      qrPayload: 'اختبار طابعة نقطة البيع',
      pendingOffline: false,
    );
    final ok = await ThermalPrinterService.instance.printWidgetReceipt(
      context,
      widget: PosReceiptWidget(receipt: receipt),
    );
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(ok ? 'وصل الاختبار للطابعة' : 'فشل الاختبار — تحقق من الاتصال')),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('إعدادات الطابعة الحرارية'),
        centerTitle: true,
      ),
      body: AnimatedBuilder(
        animation: ThermalPrinterService.instance,
        builder: (context, _) {
          final service = ThermalPrinterService.instance;
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Card(
                child: ListTile(
                  leading: const Icon(Icons.star_rounded,
                      color: AppColors.warning),
                  title: const Text('الطابعة الافتراضية'),
                  subtitle: Text(
                    service.defaultPrinter?.name ??
                        'غير محددة — اختر طابعة من الأسفل',
                  ),
                  trailing: service.defaultPrinter == null
                      ? null
                      : IconButton(
                          icon: const Icon(Icons.link_off_rounded),
                          tooltip: 'إلغاء الافتراضية',
                          onPressed: () => service.setDefaultPrinter(null),
                        ),
                ),
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  Expanded(
                    child: FilledButton.icon(
                      onPressed: service.scanning
                          ? null
                          : () => service.scan(),
                      icon: service.scanning
                          ? const SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(
                                  strokeWidth: 2),
                            )
                          : const Icon(Icons.bluetooth),
                      label: Text(service.scanning ? 'جاري المسح…' : 'مسح الطابعات'),
                    ),
                  ),
                  const SizedBox(width: 8),
                  OutlinedButton.icon(
                    onPressed: () => _testPrint(context),
                    icon: const Icon(Icons.receipt_long_rounded),
                    label: const Text('طباعة اختبار'),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              if (service.devices.isEmpty)
                const Padding(
                  padding: EdgeInsets.all(24),
                  child: Center(
                    child: Text(
                      'لا طابعات قريبة.\nأكّد تشغيل البلوتوث أو الصقي طابعة الشبكة.',
                      textAlign: TextAlign.center,
                    ),
                  ),
                ),
              for (final device in service.devices)
                Card(
                  child: ListTile(
                    leading: Icon(
                      device.connectionType?.name == 'NETWORK'
                          ? Icons.lan_rounded
                          : Icons.print_rounded,
                    ),
                    title: Text(device.name ?? device.address ?? 'طابعة'),
                    subtitle: Text(
                      '${device.connectionType?.name ?? '—'} · ${device.address ?? ''}',
                      style: const TextStyle(fontSize: 12),
                    ),
                    trailing: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        if (device.isConnected == true)
                          OutlinedButton(
                            onPressed: () =>
                                service.disconnect(device),
                            child: const Text('قطع'),
                          )
                        else
                          OutlinedButton(
                            onPressed: () => service.connect(device),
                            child: const Text('اتصال'),
                          ),
                        const SizedBox(width: 8),
                        TextButton(
                          onPressed: () => service.setDefaultPrinter(device),
                          child: const Text('افتراضية'),
                        ),
                      ],
                    ),
                  ),
                ),
              const SizedBox(height: 16),
              Text(
                'الطابعات المدعومة: ESC/POS عبر بلوتوث BLE أو الشبكة (IP) '
                'أو USB على ويندوز. الطباعة الكلاسيكية SPP غير مدعومة في '
                'هذه الحزمة — الطابعات الكلاسيكية تعمل عبر الشبكة.',
                style: TextStyle(
                    fontSize: 12, color: Colors.grey.shade700),
              ),
            ],
          );
        },
      ),
    );
  }
}
