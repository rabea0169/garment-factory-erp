import 'package:speech_to_text/speech_to_text.dart';

class SpeechService {
  final SpeechToText _speechToText = SpeechToText();
  bool _isInitialized = false;

  Future<bool> init() async {
    if (!_isInitialized) {
      _isInitialized = await _speechToText.initialize();
    }
    return _isInitialized;
  }

  void startListening(Function(String) onResult) async {
    if (await init()) {
      _speechToText.listen(
        onResult: (result) {
          onResult(result.recognizedWords);
        },
        localeId: 'ar_SA', // تحديد اللغة العربية
      );
    }
  }

  void stopListening() {
    _speechToText.stop();
  }
}
