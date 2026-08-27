import 'dart:io' show Platform;

import 'package:flutter_contacts/flutter_contacts.dart';

class ContactImportException implements Exception {
  const ContactImportException(this.message, {this.canOpenSettings = false});

  final String message;
  final bool canOpenSettings;

  @override
  String toString() => message;
}

class ImportedContactData {
  const ImportedContactData({
    required this.name,
    required this.phone,
    required this.email,
    this.address,
  });

  final String name;
  final String phone;
  final String email;
  final String? address;

  bool get hasAnyData =>
      name.isNotEmpty || phone.isNotEmpty || email.isNotEmpty;
}

class ContactImportService {
  const ContactImportService();

  Future<ImportedContactData?> pickContact() async {
    if (!Platform.isAndroid && !Platform.isIOS) {
      throw const ContactImportException(
        'اختيار جهات الاتصال متاح على Android وiOS فقط.',
      );
    }

    final permission = await FlutterContacts.permissions.request(
      PermissionType.read,
    );
    if (permission != PermissionStatus.granted &&
        permission != PermissionStatus.limited) {
      throw ContactImportException(
        permission == PermissionStatus.permanentlyDenied ||
                permission == PermissionStatus.restricted
            ? 'تم رفض إذن جهات الاتصال نهائيًا. فعّل الإذن من إعدادات الهاتف.'
            : 'يلزم السماح بقراءة جهة اتصال واحدة لاستيراد بياناتها.',
        canOpenSettings: permission == PermissionStatus.permanentlyDenied ||
            permission == PermissionStatus.restricted,
      );
    }

    final contact = await FlutterContacts.native.showPicker(
      properties: {
        ContactProperty.name,
        ContactProperty.phone,
        ContactProperty.email,
        ContactProperty.address,
      },
    );
    if (contact == null) return null;

    final result = mapContact(contact);
    if (!result.hasAnyData) {
      throw const ContactImportException(
        'جهة الاتصال المختارة لا تحتوي على اسم أو هاتف أو بريد صالح.',
      );
    }
    return result;
  }

  ImportedContactData mapContact(Contact contact) {
    final name = _firstNonEmpty([
      contact.displayName,
      _composeStructuredName(contact.name),
    ]);
    final phone = _normalizePhone(
      _firstNonEmpty(contact.phones.map((item) => item.number)),
    );
    final email = _firstNonEmpty(contact.emails.map((item) => item.address));
    final address = _firstNonEmpty(
      contact.addresses.map((item) => item.formatted),
    );

    return ImportedContactData(
      name: name,
      phone: phone,
      email: email,
      address: address.isEmpty ? null : address,
    );
  }

  String _composeStructuredName(Name? name) {
    if (name == null) return '';
    return [name.prefix, name.first, name.middle, name.last, name.suffix]
        .where((part) => part?.trim().isNotEmpty ?? false)
        .map((part) => part!.trim())
        .join(' ');
  }

  String _firstNonEmpty(Iterable<String?> values) {
    for (final value in values) {
      final normalized = value?.trim() ?? '';
      if (normalized.isNotEmpty) return normalized;
    }
    return '';
  }

  String _normalizePhone(String value) {
    final compact = value.replaceAll(RegExp(r'[\s().-]+'), '');
    if (compact.startsWith('00')) return '+${compact.substring(2)}';
    return compact;
  }
}
