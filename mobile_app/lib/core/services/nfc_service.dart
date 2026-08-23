class NfcService {
  static Future<bool> isAvailable() async {
    return false;
  }

  static void startReading(Function(String) onRead, Function(String) onError) {
    // mock nfc implementation
  }

  static void stopReading() {
    // mock nfc stop
  }
}
