import 'dart:convert';
import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:hive/hive.dart';
import 'package:intl/intl.dart';
import 'package:path_provider/path_provider.dart';

import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_parsing.dart';
import '../../../../core/widgets/selim/format.dart';

/// ملخص قاعدة البيانات من GET /system/backup/summary.
class BackupSummary {
  const BackupSummary({
    required this.tables,
    required this.totalRows,
    required this.counts,
    required this.formatVersion,
  });

  factory BackupSummary.fromJson(Map<String, dynamic> payload) => BackupSummary(
        tables: ApiParsing.integer(payload, 'tables',
            context: 'ملخص النسخ الاحتياطي'),
        totalRows: ApiParsing.integer(payload, 'totalRows',
            context: 'ملخص النسخ الاحتياطي'),
        counts: _parseCounts(payload['counts']),
        formatVersion: ApiParsing.integer(payload, 'formatVersion',
            context: 'ملخص النسخ الاحتياطي', fallback: 1),
      );

  final int tables;
  final int totalRows;

  /// عدد صفوف كل جدول {tableName: rows}.
  final Map<String, int> counts;
  final int formatVersion;

  static Map<String, int> _parseCounts(Object? raw) {
    if (raw is! Map) return const {};
    return raw.map((key, value) => MapEntry(key.toString(), asNum(value).toInt()));
  }
}

/// حالات شاشة النسخ الاحتياطي والاستعادة (SELIM-ERP W2).
abstract class BackupState {}

class BackupInitial extends BackupState {}

class BackupSummaryLoading extends BackupState {}

class BackupSummaryLoaded extends BackupState {
  BackupSummaryLoaded({required this.summary, required this.lastBackupAt});

  final BackupSummary summary;

  /// لحظة آخر نسخة احتياطية (من Hive) — null إن لم تُنشأ نسخة بعد.
  final DateTime? lastBackupAt;
}

class BackupCreating extends BackupState {
  BackupCreating(this.summary);

  final BackupSummary? summary;
}

class BackupCreated extends BackupState {
  BackupCreated({
    required this.filePath,
    required this.sizeBytes,
    required this.createdAt,
    this.summary,
  });

  /// مسار ملف النسخة على الجهاز (مجلد مستندات التطبيق).
  final String filePath;

  /// حجم الملف بالبايت.
  final int sizeBytes;

  /// لحظة إنشاء النسخة.
  final DateTime createdAt;

  final BackupSummary? summary;
}

class BackupRestoring extends BackupState {
  BackupRestoring(this.summary);

  final BackupSummary? summary;
}

class BackupRestored extends BackupState {
  BackupRestored({
    required this.restored,
    required this.tables,
    required this.totalRows,
    this.summary,
  });

  final bool restored;
  final int tables;
  final int totalRows;

  final BackupSummary? summary;
}

class BackupError extends BackupState {
  BackupError(this.message, {this.summary});

  final String message;

  final BackupSummary? summary;
}

/// Cubit النسخ الاحتياطي والاستعادة — وحدة /system الخادمية (SELIM-ERP W2).
///
/// عقد الخادم:
/// - GET /system/backup/summary → {tables, totalRows, counts, formatVersion}.
/// - GET /system/backup → {meta:{exportedAt,totalRows,counts}, data:{}} —
///   تُحفظ كما هي في ملف JSON داخل مستندات التطبيق.
/// - POST /system/restore بـ FormData {file, confirm} →
///   {restored, tables, totalRows}.
///
/// تاريخ آخر نسخة يُخزن في Hive بصندوق `gf_settings` مفتاح
/// `last_backup_at` (ISO 8601) ليظهر عند فتح الشاشة لاحقًا.
///
/// الحماية خادمية (SUPER_ADMIN فقط) — الشاشة لا تفحص الدور محليًا.
class BackupCubit extends Cubit<BackupState> {
  /// dio يُحقن في الاختبارات؛ documentsDirectory كذلك (مجلد مؤقت)
  /// والافتراضي مجلد مستندات التطبيق عبر path_provider.
  BackupCubit({
    Dio? dio,
    HiveInterface? hive,
    Future<Directory> Function()? documentsDirectory,
  })  : _injectedDio = dio,
        _hive = hive ?? Hive,
        _documentsDirectory =
            documentsDirectory ?? getApplicationDocumentsDirectory,
        super(BackupInitial());

  static const String settingsBoxName = 'gf_settings';
  static const String lastBackupAtKey = 'last_backup_at';

  final Dio? _injectedDio;
  final HiveInterface _hive;
  final Future<Directory> Function() _documentsDirectory;

  Box? _settingsBox;

  /// آخر ملخص حُمل — يُرفق بحالات العمليات كي لا تفقد الواجهة بطاقتها.
  BackupSummary? _lastSummary;
  DateTime? _lastBackupAt;

  Dio get _dio => _injectedDio ?? ApiClient.instance.dio;

  /// جلب ملخص البيانات عند فتح الشاشة.
  Future<void> loadSummary() async {
    emit(BackupSummaryLoading());
    try {
      final response = await _dio.get('/system/backup/summary');
      final payload =
          ApiParsing.map(response.data, context: 'ملخص النسخ الاحتياطي');
      _lastSummary = BackupSummary.fromJson(payload);
      _lastBackupAt = await _readLastBackupAt();
      emit(BackupSummaryLoaded(
          summary: _lastSummary!, lastBackupAt: _lastBackupAt));
    } catch (error) {
      emit(BackupError(ApiClient.instance.messageFor(error)));
    }
  }

  /// إنشاء نسخة احتياطية وتنزيلها: GET /system/backup ثم حفظ الاستجابة
  /// في `garment-erp-backup-<yyyyMMdd-HHmmss>.json` داخل مستندات التطبيق.
  Future<void> createBackup() async {
    emit(BackupCreating(_lastSummary));
    try {
      final response = await _dio.get('/system/backup');
      final payload =
          ApiParsing.map(response.data, context: 'النسخة الاحتياطية');
      final directory = await _documentsDirectory();
      final now = DateTime.now();
      final stamp = DateFormat('yyyyMMdd-HHmmss').format(now);
      final file = File(
        '${directory.path}${Platform.pathSeparator}'
        'garment-erp-backup-$stamp.json',
      );
      // تنسيق بمسافات بادئة للقراءة البشرية — الحجم يظل صغيرًا نسبيًا.
      const encoder = JsonEncoder.withIndent('  ');
      await file.writeAsString(encoder.convert(payload), flush: true);
      final sizeBytes = await file.length();
      _lastBackupAt = now;
      await _storeLastBackupAt(now);
      emit(BackupCreated(
        filePath: file.path,
        sizeBytes: sizeBytes,
        createdAt: now,
        summary: _lastSummary,
      ));
    } catch (error) {
      emit(BackupError(ApiClient.instance.messageFor(error),
          summary: _lastSummary));
    }
  }

  /// تنفيذ الاستعادة: رفع ملف النسخة مع عبارة التأكيد عبر FormData.
  /// التحقق الحرفي من عبارة «استعادة» يتم في الشاشة قبل تفعيل الزر —
  /// هنا تُرسل كما وردت (confirm) والخادم يرفض غير المطابقة.
  Future<bool> restore({
    required String filePath,
    required String fileName,
    required String phrase,
  }) async {
    emit(BackupRestoring(_lastSummary));
    try {
      final formData = FormData.fromMap({
        'file': await MultipartFile.fromFile(filePath, filename: fileName),
        'confirm': phrase,
      });
      final response = await _dio.post('/system/restore', data: formData);
      final payload = ApiParsing.map(response.data, context: 'نتيجة الاستعادة');
      emit(BackupRestored(
        restored: payload['restored'] != false,
        tables: ApiParsing.integer(payload, 'tables',
            context: 'نتيجة الاستعادة', fallback: 0),
        totalRows: ApiParsing.integer(payload, 'totalRows',
            context: 'نتيجة الاستعادة', fallback: 0),
        summary: _lastSummary,
      ));
      return true;
    } catch (error) {
      emit(BackupError(ApiClient.instance.messageFor(error),
          summary: _lastSummary));
      return false;
    }
  }

  // ------------------------------------------------------------- Hive

  /// فتح صندوق الإعدادات (أفضل-جهد — فشل Hive يُعاد بصمت null).
  Future<Box?> _openSettingsBox() async {
    if (_settingsBox != null && _settingsBox!.isOpen) return _settingsBox;
    try {
      _settingsBox = await _hive.openBox(settingsBoxName);
    } catch (_) {
      _settingsBox = null;
    }
    return _settingsBox;
  }

  Future<DateTime?> _readLastBackupAt() async {
    final box = await _openSettingsBox();
    if (box == null) return null;
    final value = box.get(lastBackupAtKey);
    if (value is String) return DateTime.tryParse(value);
    if (value is int) {
      return DateTime.fromMillisecondsSinceEpoch(value);
    }
    return null;
  }

  Future<void> _storeLastBackupAt(DateTime moment) async {
    final box = await _openSettingsBox();
    if (box == null) return;
    try {
      await box.put(lastBackupAtKey, moment.toIso8601String());
    } catch (_) {
      // أفضل-جهد: فشل الختم لا يفشل إنشاء النسخة.
    }
  }
}
