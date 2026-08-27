import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/network/api_client.dart';

abstract class SuppliersState {}

class SuppliersInitial extends SuppliersState {}

class SuppliersLoading extends SuppliersState {}

class SuppliersLoaded extends SuppliersState {
  SuppliersLoaded(this.suppliers);

  final List<dynamic> suppliers;
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
      emit(SuppliersLoaded(ApiClient.extractPaginatedData(response.data)));
    } catch (error) {
      emit(SuppliersError('حدث خطأ أثناء تحميل الموردين: $error'));
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
