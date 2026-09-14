import 'dart:io';

import 'package:dio/dio.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';

import '../network/api_client.dart';

/// SELIM-ERP W3 — تنزيل ملف من مسار API وحفظه محليًا ثم مشاركته.
///
/// المرجع يولّد Excel/Word داخل المتصفح؛ تطبيقنا يحمل من الخادم (المصدر
/// الوحيد للتوليد) عبر Dio بـ responseType.bytes ثم:
/// - الحفظ في مجلد مستندات التطبيق (اسم بلا تصادم بطابع زمني).
/// - مشاركة الملف عبر مشاركة النظام (share_plus) — كما يفعل
///   ExcelExportButton في Selim من المتصفح.
class FileDownloadService {
  FileDownloadService({Dio? dio}) : _injectedDio = dio;

  static final FileDownloadService instance = FileDownloadService();

  final Dio? _injectedDio;

  /// يُحل عند أول نداء — بيئات الاختبار قد لا تهيئ ApiClient
  /// (نمط الموجة الثانية في OutboxService/BackupCubit).
  Dio get _dio => _injectedDio ?? ApiClient.instance.dio;

  /// ينزّل [path] (مثل /export/excel/customers) ويعيد الملف المحفوظ.
  ///
  /// [fallbackName] امتداد/اسم احتياطي عند غياب Content-Disposition.
  Future<File> download(
    String path, {
    required String fallbackName,
    void Function(int received, int total)? onProgress,
  }) async {
    final response = await _dio.get<List<int>>(
      path,
      options: Options(responseType: ResponseType.bytes),
      onReceiveProgress: onProgress,
    );

    final dir = await getApplicationDocumentsDirectory();
    final stamp = DateTime.now().millisecondsSinceEpoch;
    final fileName = _fileNameFrom(response, fallbackName);
    final file = File('${dir.path}/$stamp-$fileName');
    await file.writeAsBytes(response.data ?? <int>[]);
    return file;
  }

  /// ينزّل ويفتح ورقة المشاركة مباشرة (زر التصدير في الشاشات).
  Future<void> downloadAndShare(
    String path, {
    required String fallbackName,
  }) async {
    final file = await download(path, fallbackName: fallbackName);
    await SharePlus.instance.share(
      ShareParams(files: [XFile(file.path)]),
    );
  }

  /// اسم الملف من Content-Disposition أو الاحتياطي.
  String _fileNameFrom(Response<List<int>> response, String fallbackName) {
    try {
      final disposition = response.headers.value('content-disposition');
      if (disposition != null) {
        final match =
            RegExp('filename="?([^";]+)"?').firstMatch(disposition);
        if (match != null && match.group(1)!.isNotEmpty) {
          return match.group(1)!.trim();
        }
      }
    } catch (_) {
      // تجاهل — الاسم الاحتياطي كافٍ.
    }
    return fallbackName;
  }
}
