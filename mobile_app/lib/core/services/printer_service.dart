import 'package:blue_thermal_printer/blue_thermal_printer.dart';
import 'package:flutter/foundation.dart';

class PrinterService {
  BlueThermalPrinter? bluetooth;

  PrinterService() {
    if (!kIsWeb) {
      bluetooth = BlueThermalPrinter.instance;
    }
  }

  Future<List<BluetoothDevice>> getDevices() async {
    if (kIsWeb) return [];
    return await bluetooth?.getBondedDevices() ?? [];
  }

  Future<bool> connect(BluetoothDevice device) async {
    if (kIsWeb) return true;
    final isConnected = await bluetooth?.isConnected;
    if (isConnected == true) return true;
    
    try {
      await bluetooth?.connect(device);
      return true;
    } catch (e) {
      return false;
    }
  }

  Future<void> printReceipt(String text) async {
    if (kIsWeb) return;
    final isConnected = await bluetooth?.isConnected;
    if (isConnected == true) {
      bluetooth?.printNewLine();
      bluetooth?.printCustom(text, 1, 1);
      bluetooth?.printNewLine();
      bluetooth?.printNewLine();
      bluetooth?.paperCut();
    }
  }

  Future<void> disconnect() async {
    if (kIsWeb) return;
    await bluetooth?.disconnect();
  }
}
