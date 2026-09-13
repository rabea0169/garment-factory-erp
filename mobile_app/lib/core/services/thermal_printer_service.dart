import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_thermal_printer/flutter_thermal_printer.dart';
// Printer/ConnectionType تُصدَّر من utils صراحةً (الملف الرئيسي لا يُصدّرها).
import 'package:flutter_thermal_printer/utils/printer.dart' show Printer, ConnectionType;
import 'package:hive/hive.dart';

/// SELIM-ERP W2 — خدمة الطباعة الحرارية ESC/POS (BLE/USB/شبكة).
///
/// غلاف موحد فوق `flutter_thermal_printer`:
/// - **المسح**: أجهزة قريبة (BLE) + مثبتة (USB على ويندوز) + طابعات الشبكة
///   عبر أزرار تخصيص أنواع الاتصال.
/// - **الاتصال**: connect/disconnect مع تحديث الحالة في قائمة الأجهزة.
/// - **الطباعة العربية**: عبر `printWidget` — إيصار يُبنى كـ Widget عربي
///   RTL كامل فيُصيَّر صورة نقطية ثم يُرسل ESC/POS — بلا مشاكل codepage
///   العربية في الطابعات الرخيصة (نفس نهج معالج الطباعة في Selim).
/// - **الطابعة الافتراضية**: تُخزن في Hive (صندوق `gf_settings` — نفس
///   صندوق إعدادات النسخ الاحتياطي) فتبقى بعد إعادة التشغيل.
///
/// حدود معروفة: الاتصال الكلاسيكي SPP غير مدعوم من الحزمة (AGP 9) —
/// الطابعات القديمة الكلاسيكية فقط تعمل عبر الشبكة (IP).
class ThermalPrinterService extends ChangeNotifier {
  ThermalPrinterService({HiveInterface? hive, FlutterThermalPrinter? printer})
      : _hive = hive ?? Hive,
        _printerClient = printer ?? FlutterThermalPrinter.instance;

  /// الخدمة المشتركة للتطبيق.
  static final ThermalPrinterService instance = ThermalPrinterService();

  static const String boxName = 'gf_settings';
  static const String defaultPrinterKey = 'default_thermal_printer';

  final HiveInterface _hive;
  final FlutterThermalPrinter _printerClient;

  List<Printer> _devices = const [];
  bool _scanning = false;
  bool _initialized = false;
  StreamSubscription<List<Printer>>? _devicesSubscription;
  Printer? _defaultPrinter;

  /// الأجهزة المكتشفة في آخر مسح.
  List<Printer> get devices => List.unmodifiable(_devices);

  /// هل المسح جارٍ؟
  bool get scanning => _scanning;

  /// الطابعة الافتراضية المحفوظة (إن وُجدت).
  Printer? get defaultPrinter => _defaultPrinter;

  /// تهيئة كسولة: فتح الصندوق + قراءة الطابعة الافتراضية.
  Future<bool> init() async {
    if (_initialized) return true;
    Box? opened;
    await runZonedGuarded(() async {
      try {
        opened = await _hive.openBox(boxName);
      } catch (_) {
        // الكاش أفضل-جهد — الطباعة تشتغل بلا طابعة محفوظة.
      }
    }, (_, __) {});
    if (opened != null) {
      final raw = opened!.get(defaultPrinterKey);
      if (raw is Map) {
        try {
          _defaultPrinter = Printer.fromJson(
            Map<String, dynamic>.from(raw),
          );
        } catch (_) {
          // بيانات طابعة قديمة/تالفة — تُهمل.
        }
      }
    }
    _initialized = true;
    notifyListeners();
    return true;
  }

  /// أنواع الاتصال المتاحة على المنصة الحالية.
  ///
  /// USB مدعوم على ويندوز فقط؛ BLE على الجوال/الديسكتوب؛ الشبكة دائمًا.
  List<ConnectionType> get platformConnectionTypes {
    if (defaultTargetPlatform == TargetPlatform.windows) {
      return const [ConnectionType.USB, ConnectionType.BLE, ConnectionType.NETWORK];
    }
    return const [ConnectionType.BLE, ConnectionType.NETWORK];
  }

  /// يبدأ مسح الأجهزة — النتائج تتدفق إلى [devices].
  Future<void> scan({
    List<ConnectionType>? connectionTypes,
  }) async {
    await init();
    final types = connectionTypes ?? platformConnectionTypes;
    if (_scanning) return;
    _scanning = true;
    notifyListeners();
    try {
      _devicesSubscription?.cancel();
      _devicesSubscription = _printerClient.devicesStream.listen(
        (found) {
          _devices = found;
          notifyListeners();
        },
      );
      await _printerClient.getPrinters(
        connectionTypes: types,
        androidUsesFineLocation: true,
      );
    } catch (error) {
      debugPrint('ThermalPrinterService: فشل المسح: $error');
    } finally {
      _scanning = false;
      notifyListeners();
    }
  }

  /// يوقف المسح الجاري.
  Future<void> stopScan() async {
    try {
      await _printerClient.stopScan();
    } catch (_) {}
    await _devicesSubscription?.cancel();
    _devicesSubscription = null;
    _scanning = false;
    notifyListeners();
  }

  /// يتصل بطابعة — يرجع true عند النجاح.
  Future<bool> connect(Printer device) async {
    try {
      final ok = await _printerClient.connect(device);
      if (ok) {
        _devices = _devices
            .map((d) => d.address == device.address
                ? d.copyWith(isConnected: true)
                : d)
            .toList();
        notifyListeners();
      }
      return ok;
    } catch (error) {
      debugPrint('ThermalPrinterService: فشل الاتصال: $error');
      return false;
    }
  }

  /// يقطع اتصال طابعة.
  Future<void> disconnect(Printer device) async {
    try {
      await _printerClient.disconnect(device);
      _devices = _devices
          .map((d) => d.address == device.address
              ? d.copyWith(isConnected: false)
              : d)
          .toList();
      notifyListeners();
    } catch (_) {}
  }

  /// يعيّن الطابعة الافتراضية ويحفظها.
  Future<void> setDefaultPrinter(Printer? device) async {
    _defaultPrinter = device;
    notifyListeners();
    final box = _hive.isBoxOpen(boxName)
        ? await _hive.openBox(boxName)
        : null;
    if (box == null) return;
    try {
      if (device == null) {
        await box.delete(defaultPrinterKey);
      } else {
        await box.put(defaultPrinterKey, _printerToJson(device));
      }
    } catch (error) {
      debugPrint('ThermalPrinterService: فشل حفظ الطابعة: $error');
    }
  }

  /// طباعة Widget (عربي كامل) على الطابعة — الإيصار يُصيَّر نقطيًا.
  ///
  /// [paperSize] حسب عرض الورق (58mm/80mm) — افتراضي 80mm.
  Future<bool> printWidgetReceipt(
    BuildContext context, {
    required Widget widget,
    Printer? printer,
    PaperSize paperSize = PaperSize.mm58,
  }) async {
    final target = printer ?? _defaultPrinter;
    if (target == null) return false;
    try {
      await _printerClient.printWidget(
        context,
        printer: target,
        widget: widget,
        paperSize: paperSize,
        cutAfterPrinted: true,
      );
      return true;
    } catch (error) {
      debugPrint('ThermalPrinterService: فشل الطباعة: $error');
      return false;
    }
  }

  Map<String, dynamic> _printerToJson(Printer printer) {
    // toJson يرجع خريطة جاهزة (fromJson قرأناها في init) — احتياط يدوي
    // عند أي خلل مستقبلي في التسلسل.
    try {
      return Map<String, dynamic>.from(printer.toJson());
    } catch (_) {
      return <String, dynamic>{
        'name': printer.name,
        'address': printer.address,
        'connectionType': printer.connectionType?.name,
        'vendorId': printer.vendorId,
        'productId': printer.productId,
        'deviceUri': printer.deviceUri,
        'queueName': printer.queueName,
      };
    }
  }

  @override
  void dispose() {
    _devicesSubscription?.cancel();
    super.dispose();
  }
}
