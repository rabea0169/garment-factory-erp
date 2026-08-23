import 'package:nfc_manager/nfc_manager.dart';

class NfcService {
  static Future<bool> isAvailable() async {
    return await NfcManager.instance.isAvailable();
  }

  static void startReading(Function(String) onRead, Function(String) onError) {
    NfcManager.instance.startSession(onDiscovered: (NfcTag tag) async {
      try {
        final ndef = Ndef.from(tag);
        if (ndef == null) {
          onError('العلامة لا تدعم NDEF');
          return;
        }

        final record = ndef.cachedMessage?.records.first;
        if (record != null) {
          final text = String.fromCharCodes(record.payload);
          onRead(text);
        } else {
          onError('العلامة فارغة');
        }
      } catch (e) {
        onError(e.toString());
      } finally {
        NfcManager.instance.stopSession();
      }
    });
  }

  static void stopReading() {
    NfcManager.instance.stopSession();
  }
}
