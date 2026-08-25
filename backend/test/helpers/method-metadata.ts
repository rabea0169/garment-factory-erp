import 'reflect-metadata';

/**
 * GF-0003: قراءة metadata مخزنة على method decorator (مثل @Roles/@Public).
 * NestJS SetMetadata يخزن القيمة على دالة الـ method نفسها (descriptor.value)
 * لا على prototype باسم الخاصية — وهذا هو المسار الموثوق لقراءتها في الاختبارات.
 * يغلف الـ casts اللازمة في مكان واحد بدل تكرارها في كل spec.
 */
export function getMethodMetadata<T>(
  metadataKey: string,
  target: object,
  methodName: string,
): T | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(target, methodName);
  const handler = descriptor?.value as object | undefined;
  return Reflect.getMetadata(metadataKey, handler) as T | undefined;
}
