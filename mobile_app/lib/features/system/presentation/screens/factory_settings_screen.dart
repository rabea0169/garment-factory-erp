import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:image_picker/image_picker.dart';

import '../../../../core/constants/app_colors.dart';
import '../../../../core/storage/auth_storage.dart';
import '../../../../core/widgets/selim/selim_shell.dart';
import '../cubit/settings_cubit.dart';

/// حد الشعار data-URL — نفس حد الخادم (512KB).
const int kMaxLogoBytes = 512 * 1024;

/// هل الصورة المختارة ضمن حد الحجم المسموح؟
bool isLogoSizeAllowed(int bytes) => bytes > 0 && bytes <= kMaxLogoBytes;

/// يحوّل بايتات صورة إلى data-URL (PNG/JPG من image_picker).
String? logoDataUrlFromBytes(List<int> bytes, String? mimeType) {
  if (bytes.isEmpty) return null;
  final type = (mimeType ?? 'image/png').toLowerCase();
  final normalized = type == 'image/jpg' ? 'image/jpeg' : type;
  // نفس قائمة الخادم (assertValidLogo): png/jpeg/webp فقط — يمنع
  // svg وكل نوع آخر يبدأ بـ image/ لكنه ليس صورة نقطية آمنة.
  if (normalized != 'image/png' &&
      normalized != 'image/jpeg' &&
      normalized != 'image/webp') {
    return null;
  }
  return 'data:$normalized;base64,${base64Encode(bytes)}';
}

/// SELIM-ERP W3 — شاشة إعدادات المصنع (نقل FactorySettings UI من Selim):
/// هوية المصنع (الاسم/الهاتف/العنوان/السجل الضريبي) + إعدادات الفاتورة
/// (العملة/البادئة/التذييل/QR/نسبة الضريبة) + الشعار (data-URL).
///
/// SUPER_ADMIN فقط (الحماية خادمية على POST؛ القراءة لكل موثّق).
class FactorySettingsScreen extends StatefulWidget {
  const FactorySettingsScreen({this.cubit, super.key});

  final SettingsCubit? cubit;

  @override
  State<FactorySettingsScreen> createState() => _FactorySettingsScreenState();
}

class _FactorySettingsScreenState extends State<FactorySettingsScreen> {
  SettingsCubit? _ownCubit;

  /// هل يستطيع المستخدم الحالي الحفظ؟ (POST خادميًا SUPER_ADMIN فقط —
  /// هذا تعطيل مبكر للنموذج بدل ملء الحقول ثم صد 403 عند الحفظ).
  /// null = لم يُعرف الدور بعد (يُعرض مؤشر انتظار).
  bool? _canEdit;

  final _formKey = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _nameEn = TextEditingController();
  final _slogan = TextEditingController();
  final _phone = TextEditingController();
  final _whatsapp = TextEditingController();
  final _email = TextEditingController();
  final _address = TextEditingController();
  final _taxNumber = TextEditingController();
  final _commercialRegister = TextEditingController();
  final _currency = TextEditingController();
  final _invoicePrefix = TextEditingController();
  final _invoiceFooter = TextEditingController();
  bool _enableInvoiceQr = true;
  double _taxRate = 0;
  String? _logoDataUrl;
  bool _logoRemoved = false;

  bool _initialized = false;

  @override
  void initState() {
    super.initState();
    _resolveRole();
  }

  Future<void> _resolveRole() async {
    final user = await AuthStorage().readUser();
    final role = user?['role']?.toString() ?? '';
    if (mounted) {
      setState(() => _canEdit = role == 'SUPER_ADMIN');
    }
  }

  /// للعرض فقط (غير SUPER_ADMIN).
  bool get _readOnly => _canEdit != true;

  @override
  void dispose() {
    _ownCubit?.close();
    for (final controller in [
      _name,
      _nameEn,
      _slogan,
      _phone,
      _whatsapp,
      _email,
      _address,
      _taxNumber,
      _commercialRegister,
      _currency,
      _invoicePrefix,
      _invoiceFooter,
    ]) {
      controller.dispose();
    }
    super.dispose();
  }

  void _fill(FactorySettingsModel settings) {
    _name.text = settings.factoryName;
    _nameEn.text = settings.factoryNameEn;
    _slogan.text = settings.slogan;
    _phone.text = settings.phone;
    _whatsapp.text = settings.whatsapp;
    _email.text = settings.email;
    _address.text = settings.address;
    _taxNumber.text = settings.taxNumber;
    _commercialRegister.text = settings.commercialRegister;
    _currency.text = settings.currency;
    _invoicePrefix.text = settings.invoicePrefix;
    _invoiceFooter.text = settings.invoiceFooter;
    _enableInvoiceQr = settings.enableInvoiceQr;
    _taxRate = settings.taxRate;
    _logoDataUrl = settings.logo;
    _logoRemoved = false;
  }

  Future<void> _pickLogo() async {
    final picked = await ImagePicker().pickImage(
      source: ImageSource.gallery,
      maxWidth: 600,
      imageQuality: 80,
    );
    if (picked == null) return;
    final bytes = await File(picked.path).readAsBytes();
    if (!isLogoSizeAllowed(bytes.length)) {
      if (mounted) {
        _notify(context, 'حجم الشعار يتجاوز 512KB — اختر صورة أصغر', false);
      }
      return;
    }
    setState(() {
      _logoDataUrl = logoDataUrlFromBytes(bytes, picked.mimeType);
      _logoRemoved = false;
    });
  }

  Future<void> _save(SettingsCubit cubit, FactorySettingsModel settings) async {
    if (!_formKey.currentState!.validate()) return;
    await cubit.save(
      settings.toUpdateJson(
        factoryName: _name.text.trim(),
        factoryNameEn: _nameEn.text.trim(),
        slogan: _slogan.text.trim(),
        phone: _phone.text.trim(),
        whatsapp: _whatsapp.text.trim(),
        email: _email.text.trim(),
        address: _address.text.trim(),
        taxNumber: _taxNumber.text.trim(),
        commercialRegister: _commercialRegister.text.trim(),
        currency: _currency.text.trim(),
        invoicePrefix: _invoicePrefix.text.trim(),
        invoiceFooter: _invoiceFooter.text.trim(),
        enableInvoiceQr: _enableInvoiceQr,
        taxRate: _taxRate,
        logo: _logoRemoved ? null : _logoDataUrl,
        clearLogo: _logoRemoved,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final cubit = widget.cubit ?? (_ownCubit ??= SettingsCubit()..load());
    return BlocProvider(
      create: (context) => cubit,
      child: BlocConsumer<SettingsCubit, SettingsState>(
        listener: (context, state) {
          if (state is SettingsSaved) {
            _notify(context, 'حُفظت إعدادات المصنع', true);
          } else if (state is SettingsError) {
            _notify(context, state.message, false);
          }
        },
        builder: (context, state) => SelimShellScaffold(
          title: 'إعدادات المصنع',
          body: _body(context, state),
        ),
      ),
    );
  }

  Widget _body(BuildContext context, SettingsState state) {
    if (state is SettingsLoading || state is SettingsInitial) {
      return const Center(child: CircularProgressIndicator());
    }
    // الدور لم يُحسم بعد — ننتظاره قبل عرض النموذج (لحظات).
    if (_canEdit == null) {
      return const Center(child: CircularProgressIndicator());
    }
    if (state is SettingsError) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(state.message, style: const TextStyle(fontFamily: 'Cairo')),
            const SizedBox(height: 12),
            FilledButton(
              onPressed: () => context.read<SettingsCubit>().load(),
              child: const Text('إعادة المحاولة'),
            ),
          ],
        ),
      );
    }
    final settings = (state as dynamic).settings as FactorySettingsModel;
    if (!_initialized) {
      _initialized = true;
      _fill(settings);
    }

    final saving = state is SettingsSaving;
    if (_readOnly) {
      return ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Card(
            color: AppColors.primary.withValues(alpha: 0.08),
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Row(
                children: [
                  Icon(Icons.lock_outline, color: AppColors.primary),
                  const SizedBox(width: 8),
                  const Expanded(
                    child: Text(
                      'وضع العرض فقط — الحفظ متاح لمدير النظام (SUPER_ADMIN)',
                      style: TextStyle(fontFamily: 'Cairo'),
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),
          ..._formFields(context),
          const SizedBox(height: 32),
        ],
      );
    }
    return Form(
      // ارتفاع المفتاح إلى النموذج فعليًا — بدونه currentState = null
      // وكان .validate() يرمي استثناء فارغًا عند كل حفظ.
      key: _formKey,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          ..._formFields(context),
          const SizedBox(height: 24),
          FilledButton.icon(
            onPressed: saving
                ? null
                : () => _save(context.read<SettingsCubit>(), settings),
            icon: saving
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.save),
            label: Text(saving ? 'جارٍ الحفظ…' : 'حفظ الإعدادات'),
          ),
          const SizedBox(height: 32),
        ],
      ),
    );
  }

  /// حقول النموذج (هوية + فاتورة) — مشتركة بين وضعَي العرض/التحرير.
  List<Widget> _formFields(BuildContext context) => [
        _sectionCard(
          context,
          title: 'هوية المصنع',
          icon: Icons.storefront,
          children: [
            _logoField(context),
            _field(_name, 'اسم المصنع *', validator: _required),
            _field(_nameEn, 'الاسم بالإنجليزية'),
            _field(_slogan, 'الشعار النصي'),
            _field(_phone, 'الهاتف', keyboard: TextInputType.phone),
            _field(_whatsapp, 'واتساب (للعرض على الإيصارات)',
                keyboard: TextInputType.phone),
            _field(_email, 'البريد الإلكتروني',
                keyboard: TextInputType.emailAddress),
            _field(_address, 'العنوان'),
            _field(_taxNumber, 'رقم التسجيل الضريبي (يغذي QR الفاتورة)'),
            _field(_commercialRegister, 'السجل التجاري'),
          ],
        ),
        const SizedBox(height: 16),
        _sectionCard(
          context,
          title: 'إعدادات الفاتورة',
          icon: Icons.receipt_long,
          children: [
            _field(_currency, 'العملة *', validator: _required),
            _field(_invoicePrefix, 'بادئة رقم الفاتورة'),
            _field(_invoiceFooter, 'تذييل الفاتورة (شكر/سياسات)'),
            SwitchListTile(
              title: const Text('تفعيل QR الفاتورة على الإيصارات',
                  style: TextStyle(fontFamily: 'Cairo')),
              subtitle: const Text(
                'TLV محلي ببيانات السجل الضريبي — بلا أي اتصال خارجي',
                style: TextStyle(fontFamily: 'Cairo', fontSize: 12),
              ),
              value: _enableInvoiceQr,
              activeThumbColor: AppColors.primary,
              onChanged: _readOnly
                  ? null
                  : (value) => setState(() => _enableInvoiceQr = value),
            ),
            ListTile(
              title: const Text('نسبة الضريبة (%)',
                  style: TextStyle(fontFamily: 'Cairo')),
              subtitle: SliderTheme(
                // SliderTheme مستقر عبر الإصدارات (activeColor أُهملت
                // وبديلها المباشر غير متاح في كل الإصدارات).
                data: const SliderThemeData(
                  activeTrackColor: AppColors.primary,
                ),
                child: Slider(
                  value: _taxRate,
                  max: 100,
                  divisions: 100,
                  label: '${_taxRate.round()}%',
                  onChanged: _readOnly
                      ? null
                      : (value) => setState(() => _taxRate = value),
                ),
              ),
              trailing: Text(
                '${_taxRate.round()}%',
                style: const TextStyle(fontFamily: 'Cairo', fontSize: 18),
              ),
            ),
          ],
        ),
      ];

  String? _required(String? value) =>
      (value?.trim().isEmpty ?? true) ? 'هذا الحقل مطلوب' : null;

  void _notify(BuildContext context, String message, bool success) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(
            message,
            style: const TextStyle(fontFamily: 'Cairo'),
          ),
          backgroundColor: success ? AppColors.success : AppColors.error,
        ),
      );
  }

  Widget _sectionCard(
    BuildContext context, {
    required String title,
    required IconData icon,
    required List<Widget> children,
  }) =>
      Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Icon(icon, color: AppColors.primary),
                  const SizedBox(width: 8),
                  Text(
                    title,
                    style: const TextStyle(
                      fontFamily: 'Cairo',
                      fontSize: 16,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              ...children,
            ],
          ),
        ),
      );

  Widget _logoField(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text('شعار المصنع',
            style: TextStyle(fontFamily: 'Cairo', fontWeight: FontWeight.w600)),
        const SizedBox(height: 8),
        Row(
          children: [
            Container(
              width: 84,
              height: 84,
              decoration: BoxDecoration(
                border: Border.all(color: Colors.grey.shade300),
                borderRadius: BorderRadius.circular(12),
              ),
              child: _logoDataUrl != null
                  ? Image.memory(
                      base64Decode(_logoDataUrl!.split(',').last),
                      fit: BoxFit.contain,
                      errorBuilder: (_, __, ___) => const Icon(Icons.broken_image),
                    )
                  : Icon(Icons.image_outlined,
                      size: 40, color: Colors.grey.shade400),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (!_readOnly)
                    OutlinedButton.icon(
                      onPressed: _pickLogo,
                      icon: const Icon(Icons.photo_library, size: 18),
                      label: const Text('اختيار صورة (≤ 512KB)'),
                    ),
                  if (_logoDataUrl != null && !_readOnly)
                    TextButton(
                      onPressed: () => setState(() {
                        _logoDataUrl = null;
                        _logoRemoved = true;
                      }),
                      child: const Text('إزالة الشعار'),
                    ),
                ],
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
      ],
    );
  }

  Widget _field(
    TextEditingController controller,
    String label, {
    TextInputType keyboard = TextInputType.text,
    String? Function(String?)? validator,
  }) =>
      Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: TextFormField(
          controller: controller,
          keyboardType: keyboard,
          validator: _readOnly ? null : validator,
          readOnly: _readOnly,
          decoration: InputDecoration(
            labelText: label,
            border: const OutlineInputBorder(),
          ),
        ),
      );
}
