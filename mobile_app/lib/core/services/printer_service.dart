import 'package:blue_thermal_printer/blue_thermal_printer.dart';

class PrinterService {
  final BlueThermalPrinter bluetooth = BlueThermalPrinter.instance;

  Future<List<BluetoothDevice>> getDevices() async {
    return await bluetooth.getBondedDevices();
  }

  Future<bool> connect(BluetoothDevice device) async {
    final isConnected = await bluetooth.isConnected;
    if (isConnected == true) return true;
    
    try {
      await bluetooth.connect(device);
      return true;
    } catch (e) {
      return false;
    }
  }

  Future<void> printReceipt(String text) async {
    final isConnected = await bluetooth.isConnected;
    if (isConnected == true) {
      bluetooth.printNewLine();
      // يتم دعم بعض الطابعات لطباعة نصوص عربية إذا كانت الطابعة تدعم ذلك (مهم: Encoding)
      bluetooth.printCustom(text, 1, 1);
      bluetooth.printNewLine();
      bluetooth.printNewLine();
      bluetooth.paperCut();
    }
  }

  Future<void> disconnect() async {
    await bluetooth.disconnect();
  }
}
