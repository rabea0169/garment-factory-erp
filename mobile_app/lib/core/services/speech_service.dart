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

  Future<void> startListening(Function(String) onResult) async {
    if (await init()) {
      await _speechToText.listen(
        onResult: (result) {
          onResult(result.recognizedWords);
        },
        listenOptions: SpeechListenOptions(localeId: 'ar_SA'),
      );
    }
  }

  Future<void> stopListening() async {
    await _speechToText.stop();
  }
}
