import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/constants/app_colors.dart';
import '../../../../core/widgets/app_feedback.dart';
import '../../../system/presentation/widgets/export_buttons.dart';
import '../cubit/products_cubit.dart';
import '../cubit/products_state.dart';
import 'add_product_screen.dart';
import '../../../inventory/presentation/cubit/inventory_cubit.dart';
import '../../../../core/widgets/selim/selim_shell.dart';

class ProductsScreen extends StatelessWidget {
  const ProductsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (context) => ProductsCubit()..fetchProducts(),
      child: SelimShellScaffold(
        title: 'دليل المنتجات (الكتالوج)',
        actions: [
          // SELIM-ERP W3: تصدير Excel/Word (يُخفى ذاتيًا لغير المصرّحين).
          const EntityExportButtons(entities: ['products']),
          Builder(
            builder: (ctx) => IconButton(
              icon: const Icon(Icons.refresh),
              onPressed: () => ctx.read<ProductsCubit>().fetchProducts(),
            ),
          ),
        ],
        body: BlocBuilder<ProductsCubit, ProductsState>(
          builder: (context, state) {
            if (state is ProductsLoading || state is ProductsInitial) {
              return const AppLoadingView();
            } else if (state is ProductsError) {
              return AppErrorView(
                message: state.message,
                onRetry: () => context.read<ProductsCubit>().fetchProducts(),
              );
            } else if (state is ProductsLoaded) {
              final products = state.products;
              if (products.isEmpty) {
                return AppEmptyView(
                  title: 'لا توجد منتجات حاليًا',
                  actionLabel: 'إعادة التحميل',
                  onAction: () => context.read<ProductsCubit>().fetchProducts(),
                );
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
                      leading: const Icon(
                        Icons.checkroom,
                        color: AppColors.primary,
                      ),
                      title: Text(
                        product['name'],
                        style: const TextStyle(
                          fontWeight: FontWeight.bold,
                          fontFamily: 'Cairo',
                        ),
                      ),
                      subtitle: Text(
                        'كود: ${product['code']} | السعر: ${product['retailPrice']} جنيه',
                      ),
                      children: [
                        Padding(
                          padding: const EdgeInsets.all(16.0),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Text(
                                'المقاسات والألوان المتاحة:',
                                style: TextStyle(
                                  fontWeight: FontWeight.bold,
                                  fontFamily: 'Cairo',
                                ),
                              ),
                              const SizedBox(height: 8),
                              Wrap(
                                spacing: 8,
                                runSpacing: 8,
                                children: variants.map((variant) {
                                  return Chip(
                                    label: Text(
                                      '${variant['size']} - ${variant['color']}',
                                    ),
                                    backgroundColor: AppColors.primary
                                        .withAlpha(25),
                                  );
                                }).toList(),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  );
                },
              );
            }
            return const SizedBox();
          },
        ),
        fab: Builder(
          builder: (ctx) => FloatingActionButton(
            onPressed: () {
              Navigator.push(
                ctx,
                MaterialPageRoute(
                  builder: (_) => MultiBlocProvider(
                    providers: [
                      BlocProvider.value(value: ctx.read<ProductsCubit>()),
                      BlocProvider(
                        create: (_) => InventoryCubit()..fetchRawMaterials(),
                      ),
                    ],
                    child: const AddProductScreen(),
                  ),
                ),
              );
            },
            child: const Icon(Icons.add),
          ),
        ),
      ),
    );
  }
}
