import 'package:dio/dio.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:uuid/uuid.dart';

import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_parsing.dart';

/// كيان قابل للاستيراد كما يصفه GET /import/entities:
/// {type, title, columns:[{key,header,required,type,hint}], uniqueKeys}.
class ImportEntity {
  const ImportEntity({
    required this.type,
    required this.title,
    required this.columns,
    required this.uniqueKeys,
  });

  factory ImportEntity.fromJson(Map<String, dynamic> json) => ImportEntity(
        type: ApiParsing.requiredString(json, 'type',
            context: 'كيان الاستيراد'),
        title: ApiParsing.requiredString(json, 'title',
            context: 'كيان الاستيراد'),
        columns: ApiParsing.mapList(json['columns'], context: 'أعمدة الاستيراد')
            .map(ImportColumn.fromJson)
            .toList(growable: false),
        uniqueKeys: ((json['uniqueKeys'] as List?) ?? const [])
            .map((key) => key.toString())
            .toList(growable: false),
      );

  /// معرف نوع الكيان (يُرسل للخادم في المعاينة والالتزام).
  final String type;

  /// العرض العربي للكيان (عنوان البطاقة).
  final String title;

  /// قالب الأعمدة المتوقعة في الملف.
  final List<ImportColumn> columns;

  /// المفاتيح الفريدة (تُستخدم لتخطي الصفوف المكررة خادميًا).
  final List<String> uniqueKeys;

  /// عدد الأعمدة الإلزامية — يظهر كبطاقة فرعية.
  int get requiredColumnsCount =>
      columns.where((column) => column.isRequired).length;
}

/// عمود واحد في قالب الكيان.
class ImportColumn {
  const ImportColumn({
    required this.key,
    required this.header,
    required this.type,
    this.isRequired = false,
    this.hint,
  });

  factory ImportColumn.fromJson(Map<String, dynamic> json) => ImportColumn(
        key: ApiParsing.requiredString(json, 'key', context: 'عمود الاستيراد'),
        header: ApiParsing.requiredString(json, 'header',
            context: 'عمود الاستيراد'),
        type: json['type']?.toString() ?? 'text',
        // "required" كلمة محجوزة في دارت — نقرأ المفتاح الخام مباشرة.
        isRequired: json['required'] == true,
        hint: ApiParsing.nullableString(json, 'hint'),
      );

  final String key;

  /// رأس العمود كما يتوقع وصف الكيان (مطابقة رأس الملف).
  final String header;

  /// نوع القيمة: text / number / date ...
  final String type;

  final bool isRequired;

  final String? hint;
}

/// خطأ صف واحد من المعاينة {row, field, message}.
class ImportRowError {
  const ImportRowError({
    required this.row,
    required this.field,
    required this.message,
  });

  factory ImportRowError.fromJson(Map<String, dynamic> json) => ImportRowError(
        row: ApiParsing.integer(json, 'row',
            context: 'خطأ صف الاستيراد', fallback: 0),
        field: json['field']?.toString() ?? '',
        message: json['message']?.toString() ?? '',
      );

  final int row;
  final String field;
  final String message;
}

/// صف معاينة واحد {row, data:{}, valid, errors:[...]}.
class ImportPreviewRow {
  const ImportPreviewRow({
    required this.row,
    required this.data,
    required this.valid,
    required this.errors,
  });

  factory ImportPreviewRow.fromJson(Map<String, dynamic> json) =>
      ImportPreviewRow(
        row: ApiParsing.integer(json, 'row',
            context: 'صف المعاينة', fallback: 0),
        data: ApiParsing.map(json['data'], context: 'بيانات صف المعاينة'),
        valid: json['valid'] == true,
        errors: ApiParsing.mapList(json['errors'] ?? const [],
                context: 'أخطاء صف المعاينة')
            .map(ImportRowError.fromJson)
            .toList(growable: false),
      );

  final int row;

  /// قيم الصف كما فُهمت من الملف (مفاتيح = مفاتيح الأعمدة).
  final Map<String, dynamic> data;

  final bool valid;

  final List<ImportRowError> errors;

  /// خريطة نصية للصف — الشكل الذي يرسله commit للخادم.
  Map<String, String> get asStringMap => data.map(
        (key, value) => MapEntry(key, value == null ? '' : value.toString()),
      );
}

/// ملخص نتيجة الالتزام {entityType, total, created, skipped, results}.
class ImportCommitSummary {
  const ImportCommitSummary({
    required this.entityType,
    required this.total,
    required this.created,
    required this.skipped,
    required this.results,
  });

  final String entityType;
  final int total;
  final int created;
  final int skipped;

  /// نتيجة كل صف: {row, status, code, errors}.
  final List<Map<String, dynamic>> results;
}

/// حالات معالج الاستيراد (SELIM-ERP W2).
abstract class ImportState {}

class ImportInitial extends ImportState {}

class ImportLoading extends ImportState {}

/// الكيانات المتاحة للاستيراد (الخطوة أ).
class ImportEntitiesLoaded extends ImportState {
  ImportEntitiesLoaded(this.entities);

  final List<ImportEntity> entities;
}

/// المعاينة جاهزة (الخطوة د) — الصفوف الصالحة/الفاسدة + أعمدة مفقودة.
class ImportPreviewReady extends ImportState {
  ImportPreviewReady({
    required this.entityType,
    required this.entityTitle,
    required this.fileName,
    required this.headers,
    required this.unmappedHeaders,
    required this.missingRequiredColumns,
    required this.rows,
    required this.validCount,
    required this.invalidCount,
  });

  final String entityType;
  final String entityTitle;
  final String fileName;

  /// رؤوس الأعمدة كما وردت في الملف.
  final List<String> headers;

  /// أعمدة في الملف لا تطابق قالب الكيان (تُهمل).
  final List<String> unmappedHeaders;

  /// أعمدة إلزامية مفقودة من الملف — تمنع الاستيراد كليًا.
  final List<String> missingRequiredColumns;

  final List<ImportPreviewRow> rows;
  final int validCount;
  final int invalidCount;

  /// الاستيراد ممكن فقط بلا أعمدة إلزامية مفقودة وبوجود صفوف صالحة.
  bool get canImport => missingRequiredColumns.isEmpty && validCount > 0;

  /// الصفوف الصالحة فقط كخرائط نصية — جسم commit.
  List<Map<String, String>> get validRows =>
      rows.where((row) => row.valid).map((row) => row.asStringMap).toList();
}

class ImportCommitting extends ImportState {}

/// اكتمل الاستيراد وظهر الملخص (الخطوة هـ).
class ImportDone extends ImportState {
  ImportDone(this.summary);

  final ImportCommitSummary summary;
}

class ImportError extends ImportState {
  ImportError(this.message);

  final String message;
}

/// Cubit معالج الاستيراد — يستدعي وحدة /import الخادمية (SELIM-ERP W2).
///
/// عقد الخادم:
/// - GET /import/entities → مصفوفة {type,title,columns,uniqueKeys}.
/// - POST /import/preview?entity=TYPE بـ FormData {file, entity} ←
///   {entityType, headers, unmappedHeaders, missingRequiredColumns,
///    rows:[{row,data,valid,errors:[{row,field,message}]}],
///    validCount, invalidCount}.
/// - POST /import/commit بجسم JSON {entityType, rows:[...]} وترويسة
///   Idempotency-Key (uuid v4) → {entityType, total, created, skipped,
///   results:[{row,status,code,errors}]}.
class ImportCubit extends Cubit<ImportState> {
  /// dio يُحقن في الاختبارات (نمط ExpensesCubit)؛ الافتراضي عميل التطبيق.
  ImportCubit({Dio? dio, Uuid? uuid})
      : _injectedDio = dio,
        _uuid = uuid ?? const Uuid(),
        super(ImportInitial());

  final Dio? _injectedDio;

  /// مولّد مفاتيح idempotency لطلب الالتزام (uuid v4).
  final Uuid _uuid;

  Dio get _dio => _injectedDio ?? ApiClient.instance.dio;

  /// الكيان المختار (الخطوة أ) — يُلزم به طلبا المعاينة والالتزام.
  ImportEntity? selectedEntity;

  /// جلب الكيانات القابلة للاستيراد (الخطوة أ).
  Future<void> loadEntities() async {
    emit(ImportLoading());
    try {
      final response = await _dio.get('/import/entities');
      // الخادم يرجع مصفوفة خامًا — paginatedMaps يتقبلها ويقبل {data:[...]}.
      final list = ApiParsing.paginatedMaps(response.data,
          context: 'كيانات الاستيراد');
      emit(ImportEntitiesLoaded(
          list.map(ImportEntity.fromJson).toList(growable: false)));
    } catch (error) {
      emit(ImportError(ApiClient.instance.messageFor(error)));
    }
  }

  /// تسجيل الكيان المختار من البطاقات (الخطوة أ → ب).
  void selectEntity(ImportEntity entity) {
    selectedEntity = entity;
  }

  /// رفع الملف للمعاينة (الخطوة ج) — FormData بالملف والكيان، والكيان
  /// يُرسل في الجسم وفي query معًا (الخادم يقرأ الاستعلام).
  Future<void> previewFile({
    required String filePath,
    required String fileName,
  }) async {
    final entity = selectedEntity;
    if (entity == null) return;
    emit(ImportLoading());
    try {
      final formData = FormData.fromMap({
        'file': await MultipartFile.fromFile(filePath, filename: fileName),
        'entity': entity.type,
      });
      final response = await _dio.post(
        '/import/preview',
        data: formData,
        queryParameters: {'entity': entity.type},
      );
      final payload =
          ApiParsing.map(response.data, context: 'معاينة الاستيراد');
      final rows = ApiParsing.mapList(payload['rows'], context: 'صفوف المعاينة')
          .map(ImportPreviewRow.fromJson)
          .toList(growable: false);
      final computedValid = rows.where((row) => row.valid).length;
      final validCount = ApiParsing.integer(payload, 'validCount',
          context: 'معاينة الاستيراد', fallback: computedValid);
      emit(ImportPreviewReady(
        entityType: entity.type,
        entityTitle: entity.title,
        fileName: fileName,
        headers: ((payload['headers'] as List?) ?? const [])
            .map((header) => header.toString())
            .toList(growable: false),
        unmappedHeaders: ((payload['unmappedHeaders'] as List?) ?? const [])
            .map((header) => header.toString())
            .toList(growable: false),
        missingRequiredColumns:
            ((payload['missingRequiredColumns'] as List?) ?? const [])
                .map((column) => column.toString())
                .toList(growable: false),
        rows: rows,
        validCount: validCount,
        invalidCount: ApiParsing.integer(payload, 'invalidCount',
            context: 'معاينة الاستيراد', fallback: rows.length - computedValid),
      ));
    } catch (error) {
      emit(ImportError(ApiClient.instance.messageFor(error)));
    }
  }

  /// الالتزام (الخطوة هـ): استيراد الصفوف الصالحة فقط كخرائط نصية مع
  /// ترويسة Idempotency-Key (uuid v4) — إعادة الإرسال بنفس المفتاح
  /// تعيد نفس النتيجة دون تكرار الإنشاء.
  Future<void> commitValidRows() async {
    final current = state;
    if (current is! ImportPreviewReady) return;
    emit(ImportCommitting());
    try {
      final idempotencyKey = _uuid.v4();
      final response = await _dio.post(
        '/import/commit',
        data: {
          'entityType': current.entityType,
          'rows': current.validRows,
        },
        options: Options(headers: {'Idempotency-Key': idempotencyKey}),
      );
      final payload =
          ApiParsing.map(response.data, context: 'نتيجة الاستيراد');
      emit(ImportDone(ImportCommitSummary(
        entityType: payload['entityType']?.toString() ?? current.entityType,
        total: ApiParsing.integer(payload, 'total',
            context: 'نتيجة الاستيراد', fallback: current.validRows.length),
        created: ApiParsing.integer(payload, 'created',
            context: 'نتيجة الاستيراد', fallback: 0),
        skipped: ApiParsing.integer(payload, 'skipped',
            context: 'نتيجة الاستيراد', fallback: 0),
        results: ApiParsing.mapList(payload['results'] ?? const [],
            context: 'نتائج الاستيراد'),
      )));
    } catch (error) {
      emit(ImportError(ApiClient.instance.messageFor(error)));
    }
  }

  /// إعادة تعيين المعالج لاستيراد جديد — تُتبعها loadEntities من الشاشة.
  void reset() {
    selectedEntity = null;
    emit(ImportInitial());
  }
}
