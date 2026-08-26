sealed class ProductionFailure implements Exception {
  const ProductionFailure(this.message);

  final String message;

  @override
  String toString() => message;
}

class ProductionNetworkFailure extends ProductionFailure {
  const ProductionNetworkFailure([super.message = 'تعذر الاتصال بالخادم']);
}

class ProductionUnauthorizedFailure extends ProductionFailure {
  const ProductionUnauthorizedFailure([super.message = 'انتهت الجلسة']);
}

class ProductionForbiddenFailure extends ProductionFailure {
  const ProductionForbiddenFailure([super.message = 'ليس لديك صلاحية لتنفيذ هذا الإجراء']);
}

class ProductionValidationFailure extends ProductionFailure {
  const ProductionValidationFailure([super.message = 'بيانات أمر التشغيل غير صالحة']);
}

class ProductionServerFailure extends ProductionFailure {
  const ProductionServerFailure([super.message = 'حدث خطأ في الخادم']);
}

class ProductionMappingFailure extends ProductionFailure {
  const ProductionMappingFailure([super.message = 'استجابة الإنتاج غير متوافقة']);
}
