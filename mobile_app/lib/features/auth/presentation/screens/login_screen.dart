import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/constants/app_colors.dart';
import '../../../../core/router/app_router.dart';
import '../cubit/auth_cubit.dart';

/// شاشة تسجيل الدخول.
///
/// UI-REVAMP: (1) زر إظهار/إخفاء كلمة المرور — كان الإدخال أعمى تمامًا،
/// وهو أكبر مصدر أخطاء كتابة على أرض المصنع. (2) ترويسة علامة تجارية
/// بتدرج أزرق بعمق بدل أيقونة مسطحة مع اسم النظام ووصفه. (3) تذييل
/// يعرض إصدار التطبيق (اتساقًا مع pubspec) — أسهل ملاحظة عند الإبلاغ
/// عن مشكلة. (4) الزر يعرض مؤشر تحميل مضغوط عند AuthLoading.
class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  bool _obscurePassword = true;

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  void _submit() {
    if (_formKey.currentState!.validate()) {
      context.read<AuthCubit>().login(
        _emailController.text,
        _passwordController.text,
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Form(
            key: _formKey,
            child: BlocConsumer<AuthCubit, AuthState>(
              listener: (context, state) {
                if (state is AuthAuthenticated) {
                  context.go(AppRouter.dashboard);
                } else if (state is AuthError) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(
                      content: Text(
                        state.message,
                        style: const TextStyle(fontFamily: 'Cairo'),
                      ),
                      backgroundColor: AppColors.error,
                      behavior: SnackBarBehavior.floating,
                    ),
                  );
                }
              },
              builder: (context, state) {
                final isLoading = state is AuthLoading;
                return Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const _LoginBrandHeader(),
                    const SizedBox(height: 48),
                    TextFormField(
                      controller: _emailController,
                      enabled: !isLoading,
                      textInputAction: TextInputAction.next,
                      decoration: const InputDecoration(
                        labelText: 'البريد الإلكتروني',
                        prefixIcon: Icon(Icons.email_outlined),
                      ),
                      keyboardType: TextInputType.emailAddress,
                      validator: (value) {
                        if (value == null || value.trim().isEmpty) {
                          return 'يرجى إدخال البريد الإلكتروني';
                        }
                        return null;
                      },
                    ),
                    const SizedBox(height: 16),
                    TextFormField(
                      controller: _passwordController,
                      enabled: !isLoading,
                      obscureText: _obscurePassword,
                      onFieldSubmitted: (_) => isLoading ? null : _submit(),
                      decoration: InputDecoration(
                        labelText: 'كلمة المرور',
                        prefixIcon: const Icon(Icons.lock_outline),
                        suffixIcon: IconButton(
                          tooltip: _obscurePassword
                              ? 'إظهار كلمة المرور'
                              : 'إخفاء كلمة المرور',
                          icon: Icon(
                            _obscurePassword
                                ? Icons.visibility_outlined
                                : Icons.visibility_off_outlined,
                          ),
                          onPressed: () => setState(
                            () => _obscurePassword = !_obscurePassword,
                          ),
                        ),
                      ),
                      validator: (value) {
                        if (value == null || value.isEmpty) {
                          return 'يرجى إدخال كلمة المرور';
                        }
                        return null;
                      },
                    ),
                    const SizedBox(height: 24),
                    SizedBox(
                      width: double.infinity,
                      height: 50,
                      child: ElevatedButton(
                        onPressed: isLoading ? null : _submit,
                        child: isLoading
                            ? const SizedBox(
                                width: 22,
                                height: 22,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2.5,
                                  color: Colors.white,
                                ),
                              )
                            : const Text(
                                'دخول',
                                style: TextStyle(fontSize: 18),
                              ),
                      ),
                    ),
                    const SizedBox(height: 32),
                    const _LoginVersionFooter(),
                  ],
                );
              },
            ),
          ),
        ),
      ),
    );
  }
}

/// ترويسة العلامة التجارية — أيقونة المصنع داخل حاوية متدرجة بعمق،
/// اسم النظام بخط عريض، وسطر وصف وظيفي يوضح هوية النظام.
class _LoginBrandHeader extends StatelessWidget {
  const _LoginBrandHeader();

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Container(
          width: 88,
          height: 88,
          decoration: BoxDecoration(
            gradient: const LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [AppColors.primaryDark, AppColors.primaryLight],
            ),
            borderRadius: BorderRadius.circular(24),
            boxShadow: [
              BoxShadow(
                color: AppColors.primary.withValues(alpha: 0.35),
                blurRadius: 18,
                offset: const Offset(0, 8),
              ),
            ],
          ),
          child: const Icon(
            Icons.factory_rounded,
            size: 48,
            color: Colors.white,
          ),
        ),
        const SizedBox(height: 20),
        Text(
          'تسجيل الدخول',
          style: Theme.of(context).textTheme.headlineMedium
              ?.copyWith(fontWeight: FontWeight.bold, color: AppColors.primary),
        ),
        const SizedBox(height: 8),
        const Text(
          'مرحباً بك في نظام إدارة المصنع',
          style: TextStyle(color: AppColors.textSecondary, fontFamily: 'Cairo'),
        ),
      ],
    );
  }
}

/// تذييل الإصدار — رقم النسخة يُحدَّث من pubspec عبر fromEnvironment
/// غير متاح في الوضع الافتراضي، فيُعرض الثابت المتزامن يدويًا مع
/// pubspec.yaml (نفس رقم 1.6.0+9). يُقرأ أيضًا رقم البناء لتمييز
/// نسخ الاختبار عن نسخ الإنتاج عند الإبلاغ عن مشكلات.
class _LoginVersionFooter extends StatelessWidget {
  const _LoginVersionFooter();

  static const String _appVersion = '1.6.0+9';

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        const Icon(
          Icons.info_outline_rounded,
          size: 14,
          color: AppColors.textHint,
        ),
        const SizedBox(width: 4),
        Text(
          'إصدار $_appVersion',
          style: const TextStyle(
            color: AppColors.textHint,
            fontFamily: 'Cairo',
            fontSize: 12,
          ),
        ),
      ],
    );
  }
}
