import 'package:flutter_test/flutter_test.dart';
import 'package:garment_factory_erp/core/network/api_parsing.dart';

void main() {
  group('ApiParsing', () {
    test('extracts typed maps from a paginated response', () {
      final result = ApiParsing.paginatedMaps(
        <String, dynamic>{
          'data': <Map<String, dynamic>>[
            <String, dynamic>{'id': 'one', 'amount': '12.5'},
          ],
          'meta': <String, dynamic>{'page': 1},
        },
        context: 'sales',
      );

      expect(result, hasLength(1));
      expect(result.single['id'], 'one');
    });

    test('rejects non-map items rather than returning unsafe dynamic data', () {
      expect(
        () => ApiParsing.paginatedMaps(
          <String, dynamic>{
            'data': <Object?>['invalid']
          },
          context: 'sales',
        ),
        throwsA(isA<FormatException>()),
      );
    });

    test('parses numeric strings and rejects fractional integers', () {
      final json = <String, dynamic>{'amount': '12.50', 'quantity': 3};

      expect(
        ApiParsing.number(json, 'amount', context: 'sales'),
        12.5,
      );
      expect(
        ApiParsing.integer(json, 'quantity', context: 'sales'),
        3,
      );
      expect(
        () => ApiParsing.integer(
          <String, dynamic>{'quantity': 1.5},
          'quantity',
          context: 'sales',
        ),
        throwsA(isA<FormatException>()),
      );
    });
  });
}
