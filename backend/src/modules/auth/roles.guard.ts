import {
  Injectable,
  CanActivate,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { IS_PUBLIC_KEY } from './public.decorator';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

/**
 * حارس الأدوار (GF-0002):
 * - المسارات العامة تتخطى الفحص.
 * - المسارات بلا @Roles() متاحة لأي مستخدم موثّق.
 * - المسارات بـ @Roles() تتطلب دورًا مطابقًا (SUPER_ADMIN يتجاوز دائمًا).
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
      user?: { role?: UserRole };
    }>();
    const { user } = request;

    if (user?.role === UserRole.SUPER_ADMIN) {
      return true;
    }

    return requiredRoles.some((role) => user?.role === role);
  }
}
