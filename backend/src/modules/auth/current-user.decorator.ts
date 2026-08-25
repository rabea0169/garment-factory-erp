import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * يستخرج المستخدم (أو حقلًا منه) من الجلسة بعد تحقق JwtStrategy.
 * الاستخدام: @CurrentUser() user أو @CurrentUser('id') userId
 * قاعدة P0-04: الهوية من الجلسة فقط — لا تُقبل من body أبدًا.
 */
export const CurrentUser = createParamDecorator(
  (data: string | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<{
      user?: Record<string, unknown>;
    }>();
    const user = request?.user;
    return data ? user?.[data] : user;
  },
);
