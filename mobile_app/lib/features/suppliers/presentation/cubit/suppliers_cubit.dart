import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_parsing.dart';

abstract class SuppliersState {}

class SuppliersInitial extends SuppliersState {}

class SuppliersLoading extends SuppliersState {}

class SuppliersLoaded extends SuppliersState {
  SuppliersLoaded(this.suppliers);

  final List<Map<String, dynamic>> suppliers;
}

class SuppliersError extends SuppliersState {
  SuppliersError(this.message);

  final String message;
}

class SuppliersCubit extends Cubit<SuppliersState> {
  SuppliersCubit() : super(SuppliersInitial());

  Future<void> fetchSuppliers() async {
    emit(SuppliersLoading());
    try {
      final response = await ApiClient.instance.dio.get('/suppliers');
      emit(
        SuppliersLoaded(
          ApiParsing.paginatedMaps(
            response.data,
            context: 'الموردين',
          ),
        ),
      );
    } catch (error) {
      emit(SuppliersError(ApiClient.instance.messageFor(error)));
    }
  }

  Future<void> createSupplier({
    required String name,
    String? phone,
    String? email,
    String? address,
    String? notes,
  }) async {
    await ApiClient.instance.dio.post('/suppliers', data: {
      'name': name,
      if (phone != null && phone.isNotEmpty) 'phone': phone,
      if (email != null && email.isNotEmpty) 'email': email,
      if (address != null && address.isNotEmpty) 'address': address,
      if (notes != null && notes.isNotEmpty) 'notes': notes,
    });
    await fetchSuppliers();
  }
}
