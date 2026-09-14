import {
  Injectable,
  CanActivate,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PATH_METADATA } from '@nestjs/common/constants';
import { UserRole } from '@prisma/client';
import { IS_PUBLIC_KEY } from './public.decorator';
import {
  actionFromHttpMethod,
  hasExplicitPermission,
  resourceFromRoutePath,
} from '../../core/permissions/permissions.domain';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

/**
 * حارس الأدوار (GF-0002):
 * - المسارات العامة تتخطى الفحص.
 * - المسارات بلا @Roles() متاحة لأي مستخدم موثّق.
 * - المسارات بـ @Roles() تتطلب دورًا مطابقًا (SUPER_ADMIN يتجاوز دائمًا).
 *
 * SELIM-ERP W4 — الطبقة الثانية (نفس checkPermission في المرجع SPRINT 81):
 * عند فشل فحص الدور نستأنف بصلاحية صريحة على المستخدم
 * (users.permissions): مورد الصلاحية يُستنتج من مسار المتحكم
 * (resourceFromRoutePath) وإجراؤه من HTTP method (actionFromHttpMethod).
 * الصلاحيات الصريحة **تضيف** وصولًا فوق الدور فقط — لا تلغيه أبدًا،
 * ولا تُمنح إلا عبر PUT /users/:id/permissions (SUPER_ADMIN حصريًا).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{
      method?: string;
      user?: { role?: UserRole; permissions?: unknown };
    }>();
    const { user } = request;

    if (user?.role === UserRole.SUPER_ADMIN) {
      return true;
    }

    if (requiredRoles.some((role) => user?.role === role)) {
      return true;
    }

    // SELIM-ERP W4: فشل فحص الدور → منح صريح يفتح المسار (لا شيء آخر يفعل).
    const controllerPath = this.reflector.get<string>(
      PATH_METADATA,
      context.getClass(),
    );
    const handlerPath = this.reflector.get<string>(
      PATH_METADATA,
      context.getHandler(),
    );
    const resource = resourceFromRoutePath(
      `${controllerPath ?? ''}/${handlerPath ?? ''}`,
    );
    const action = actionFromHttpMethod(request.method ?? 'GET');
    if (
      resource &&
      hasExplicitPermission(user?.permissions, resource, action)
    ) {
      return true;
    }

    return false;
  }
}
