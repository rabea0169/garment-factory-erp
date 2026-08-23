import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import '../../../../core/constants/app_colors.dart';
import '../cubit/products_cubit.dart';
import '../cubit/products_state.dart';

class ProductsScreen extends StatelessWidget {
  const ProductsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (context) => ProductsCubit()..fetchProducts(),
      child: Scaffold(
        appBar: AppBar(
          title: const Text('دليل المنتجات (الكتالوج)'),
          actions: [
            Builder(
              builder: (ctx) => IconButton(
                icon: const Icon(Icons.refresh),
                onPressed: () => ctx.read<ProductsCubit>().fetchProducts(),
              ),
            ),
          ],
        ),
        body: BlocBuilder<ProductsCubit, ProductsState>(
          builder: (context, state) {
            if (state is ProductsLoading) {
              return const Center(child: CircularProgressIndicator());
            } else if (state is ProductsError) {
              return Center(
                  child: Text(state.message,
                      style: const TextStyle(
                          color: AppColors.error, fontFamily: 'Cairo')));
            } else if (state is ProductsLoaded) {
              final products = state.products;
              if (products.isEmpty) {
                return const Center(
                    child: Text('لا توجد منتجات حالياً',
                        style: TextStyle(fontFamily: 'Cairo')));
              }
              return ListView.builder(
                padding: const EdgeInsets.all(16),
                itemCount: products.length,
                itemBuilder: (context, index) {
                  final product = products[index];
                  final variants = product['variants'] as List;

                  return Card(
                    margin: const EdgeInsets.only(bottom: 12),
                    child: ExpansionTile(
                      leading:
                          const Icon(Icons.checkroom, color: AppColors.primary),
                      title: Text(product['name'],
                          style: const TextStyle(
                              fontWeight: FontWeight.bold,
                              fontFamily: 'Cairo')),
                      subtitle: Text(
                          'كود: ${product['code']} | السعر: ${product['retailPrice']} جنيه'),
                      children: [
                        Padding(
                          padding: const EdgeInsets.all(16.0),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Text('المقاسات والألوان المتاحة:',
                                  style: TextStyle(
                                      fontWeight: FontWeight.bold,
                                      fontFamily: 'Cairo')),
                              const SizedBox(height: 8),
                              Wrap(
                                spacing: 8,
                                runSpacing: 8,
                                children: variants.map((variant) {
                                  return Chip(
                                    label: Text(
                                        '${variant['size']} - ${variant['color']}'),
                                    backgroundColor:
                                        AppColors.primary.withAlpha(25),
                                  );
                                }).toList(),
                              ),
                            ],
                          ),
                        )
                      ],
                    ),
                  );
                },
              );
            }
            return const SizedBox();
          },
        ),
        floatingActionButton: FloatingActionButton(
          onPressed: () {},
          child: const Icon(Icons.add),
        ),
      ),
    );
  }
}
