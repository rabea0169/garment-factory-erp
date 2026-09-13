import 'package:garment_factory_erp/core/services/outbox_service.dart';

/// طابور صادر وهمي — يسجل الإدراجات في الذاكرة بلا Hive/شبكة.
class FakeOutbox extends OutboxService {
  final List<OutboxEntry> _entries = [];

  List<OutboxEntry> get entries => List.unmodifiable(_entries);

  @override
  Future<OutboxEntry?> enqueue({
    required String method,
    required String path,
    required Map<String, dynamic> body,
    String? idempotencyKey,
  }) async {
    final entry = OutboxEntry(
      id: 'fake-${_entries.length + 1}',
      method: method,
      path: path,
      body: body,
      idempotencyKey: idempotencyKey ?? 'fake-key',
      createdAt: DateTime.now(),
    );
    _entries.add(entry);
    notifyListeners();
    return entry;
  }
}
