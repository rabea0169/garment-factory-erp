import 'package:flutter_contacts/flutter_contacts.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:garment_factory_erp/core/contacts/contact_import_service.dart';

void main() {
  const service = ContactImportService();

  test('maps contact properties and normalizes phone number', () {
    final data = service.mapContact(
      const Contact(
        displayName: '  مصنع النور  ',
        phones: [Phone(number: '0020 (100) 123-4567')],
        emails: [Email(address: '  sales@example.com ')],
        addresses: [Address(formatted: 'القاهرة')],
      ),
    );

    expect(data.name, 'مصنع النور');
    expect(data.phone, '+201001234567');
    expect(data.email, 'sales@example.com');
    expect(data.address, 'القاهرة');
    expect(data.hasAnyData, isTrue);
  });

  test('uses the complete structured name when display name is absent', () {
    final data = service.mapContact(
      const Contact(
        name: Name(prefix: 'م.', first: 'أحمد', middle: 'علي', last: 'محمود'),
      ),
    );

    expect(data.name, 'م. أحمد علي محمود');
    expect(data.phone, isEmpty);
    expect(data.email, isEmpty);
    expect(data.address, isNull);
  });

  test('reports empty contact as having no usable data', () {
    final data = service.mapContact(const Contact());

    expect(data.hasAnyData, isFalse);
  });
}
