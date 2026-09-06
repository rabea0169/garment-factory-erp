import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PaginatedResult } from '../../common/dto/paginated-result.dto';
import { PrismaService } from '../../prisma/prisma.service';
import {
  computeRequestHash,
  createIdempotencyKey,
  isIdempotencyUniqueViolation,
  storeIdempotencyResponse,
  tryReplayIdempotencyKey,
} from '../../core/common/idempotency.util';
import { CreateUserDto } from './dto/create-user.dto';
import { UserQueryDto } from './dto/user-query.dto';

/**
 * CC-9 (P1 — GF-IMP-W2): موديول إدارة المستخدمين — بديل SQL اليدوي.
 *
 * قبل هذا الموديول لم يكن هناك أي مسار API لإنشاء مستخدم أو تغيير دوره
 * أو تعطيله — كل إدارة الهويات كانت يدوية بلا تدقيق. كل عمليات الكتابة
 * هنا (إنشاء/تغيير دور/تعطيل/تنشيط) SUPER_ADMIN فقط (RolesGuard) وتنفّذ:
 * - تحديثات CAS عبر updateMany مشروط بالحالة السابقة (دور/نشاط) —
 *   صفر صفوف = تغيّر متزامن → 409.
 * - ActivityLog داخل نفس المعاملة (module: USERS) بالقيم قبل/بعد.
 * - Idempotency-Key كامل النمط القياسي (نفس مفتاح + نفس محتوى =
 *   نفس الاستجابة؛ محتوى مختلف = 409؛ سباق = replay).
 *
 * ملاحظة أمنية: كلمة المرور تُقبل في الإنشاء فقط وتُخزَّن bcrypt (نفس
 * المكتبة وعدد rounds الخاص بـ seed.ts) ولا تُعاد أبدًا — كل قراءة
 * تستخدم USER_PUBLIC_SELECT الصريح بلا عمود كلمة المرور.
 */

/** نفس عدد rounds في prisma/seed.ts — توحيد كلفة bcrypt بين مسارات الإنشاء. */
const BCRYPT_ROUNDS = 10;

/**
 * الأعمدة الآمنة للقراءة — لا كلمة مرور ولا jwtVersion ولا هاتف
 * (الحد الأدنى اللازم لإدارة الهويات في واجهة SUPER_ADMIN).
 */
const USER_PUBLIC_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  isActive: true,
  createdAt: true,
} as const;

/** قيم UserRole الفعلية من المخطط — فحص دفاعي في الخدمة فوق IsEnum في DTO. */
const VALID_ROLES = new Set<string>(Object.values(UserRole));

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * قائمة المستخدمين المرقّمة (صفحة/حد بحد أقصى 100 — من PaginationDto)
   * مع فلترين اختياريين role/isActive وselect آمن بلا أي هاش.
   */
  async listUsers(query: UserQueryDto = new UserQueryDto()) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.UserWhereInput = {};
    if (query.role !== undefined) where.role = query.role;
    if (query.isActive !== undefined) where.isActive = query.isActive;

    const [data, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: USER_PUBLIC_SELECT,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.user.count({ where }),
    ]);

    return new PaginatedResult(data, total, page, limit);
  }

  /**
   * إنشاء مستخدم (SUPER_ADMIN فقط عبر المتحكم):
   * - فرادة البريد داخل المعاملة برسالة عربية 409 (+ التقاط P2002 على
   *   فهرس البريد لسباق لم يلتقطه الفحص — نفس الرسالة).
   * - bcrypt بنفس cost prisma/seed.ts.
   * - ActivityLog (USER_CREATED) داخل المعاملة.
   * - Idempotency-Key كامل النمط (scope: users-create).
   */
  async createUser(
    dto: CreateUserDto,
    actorId: string,
    idempotencyKey?: string,
  ) {
    const email = dto.email.trim().toLowerCase();
    const name = dto.name.trim();

    if (!VALID_ROLES.has(dto.role)) {
      throw new ConflictException(
        'الدور غير صالح — يجب أن يكون إحدى قيم UserRole المعرفة في المخطط',
      );
    }

    const scope = 'users-create';
    const requestHash = computeRequestHash({
      operation: scope,
      actorId,
      name,
      email,
      role: dto.role,
    });
    const replay = await tryReplayIdempotencyKey(
      this.prisma,
      idempotencyKey,
      scope,
      requestHash,
    );
    if (replay) return replay;

    // الهاش خارج المعاملة — عمل CPU خالص لا يحتاج قفلًا على القاعدة،
    // فلا نُطيل عمر المعاملة (~100ms لكل 10 rounds).
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    try {
      return await this.prisma.$transaction(async (tx) => {
        await createIdempotencyKey(tx, idempotencyKey, scope, requestHash);

        // فرادة البريد داخل المعاملة — مصدر الحقيقة ضد INSERT متزامن.
        const existing = await tx.user.findUnique({
          where: { email },
          select: { id: true },
        });
        if (existing) {
          throw new ConflictException(
            'البريد الإلكتروني مستخدم بالفعل — اختر بريدًا آخر',
          );
        }

        const created = await tx.user.create({
          data: {
            name,
            email,
            password: passwordHash,
            role: dto.role,
          },
          select: USER_PUBLIC_SELECT,
        });

        await tx.activityLog.create({
          data: {
            userId: actorId,
            action: 'USER_CREATED',
            module: 'USERS',
            details: {
              createdUserId: created.id,
              name: created.name,
              email: created.email,
              role: created.role,
            },
          },
        });

        await storeIdempotencyResponse(tx, idempotencyKey, created);
        return created;
      });
    } catch (error) {
      if (idempotencyKey && isIdempotencyUniqueViolation(error)) {
        const replayed = await tryReplayIdempotencyKey(
          this.prisma,
          idempotencyKey,
          scope,
          requestHash,
        );
        if (replayed) return replayed;
      }
      // P2002 على فهرس البريد الفريد (سباق بين الفحص والإنشاء) → نفس 409
      // العربية. ميّزناه عن تعارض idempotency أعلاه قبل الوصول هنا.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'البريد الإلكتروني مستخدم بالفعل — اختر بريدًا آخر',
        );
      }
      throw error;
    }
  }

  /**
   * تغيير دور مستخدم (SUPER_ADMIN فقط):
   * - لا يمكن تغيير دور نفسك — 409 برسالة عربية.
   * - CAS عبر updateMany مشروط بالدور السابق — صفر صفوف = تغيّر متزامن → 409.
   * - ActivityLog (USER_ROLE_CHANGED) بالدور قبل/بعد داخل المعاملة.
   * - Idempotency-Key (scope: users-role).
   */
  async changeUserRole(
    targetUserId: string,
    newRole: UserRole,
    actorId: string,
    idempotencyKey?: string,
  ) {
    if (!VALID_ROLES.has(newRole)) {
      throw new ConflictException(
        'الدور غير صالح — يجب أن يكون إحدى قيم UserRole المعرفة في المخطط',
      );
    }
    if (targetUserId === actorId) {
      throw new ConflictException(
        'لا يمكنك تغيير دورك الخاص — اطلب ذلك من مدير أعلى',
      );
    }

    const scope = 'users-role';
    const requestHash = computeRequestHash({
      operation: scope,
      targetUserId,
      newRole,
      actorId,
    });
    const replay = await tryReplayIdempotencyKey(
      this.prisma,
      idempotencyKey,
      scope,
      requestHash,
    );
    if (replay) return replay;

    try {
      return await this.prisma.$transaction(async (tx) => {
        await createIdempotencyKey(tx, idempotencyKey, scope, requestHash);

        const target = await tx.user.findUnique({
          where: { id: targetUserId },
          select: { ...USER_PUBLIC_SELECT },
        });
        if (!target) {
          throw new NotFoundException('المستخدم غير موجود');
        }
        if (target.role === newRole) {
          throw new ConflictException(
            `الدور الجديد (${newRole}) هو دور المستخدم الحالي بالفعل`,
          );
        }

        // CAS: مشروط بالدور السابق المقروء — أي تغيير متزامن يُصفَّر صفوفه.
        const transition = await tx.user.updateMany({
          where: { id: targetUserId, role: target.role },
          data: { role: newRole },
        });
        if (transition.count !== 1) {
          throw new ConflictException(
            'تم تغيير دور المستخدم بالتزامن — أعد المحاولة',
          );
        }

        const updated = await tx.user.findUnique({
          where: { id: targetUserId },
          select: USER_PUBLIC_SELECT,
        });

        await tx.activityLog.create({
          data: {
            userId: actorId,
            action: 'USER_ROLE_CHANGED',
            module: 'USERS',
            details: {
              targetUserId,
              targetEmail: target.email,
              previousRole: target.role,
              newRole,
            },
          },
        });

        await storeIdempotencyResponse(tx, idempotencyKey, updated);
        return updated;
      });
    } catch (error) {
      if (idempotencyKey && isIdempotencyUniqueViolation(error)) {
        const replayed = await tryReplayIdempotencyKey(
          this.prisma,
          idempotencyKey,
          scope,
          requestHash,
        );
        if (replayed) return replayed;
      }
      throw error;
    }
  }

  /**
   * تعطيل مستخدم (SUPER_ADMIN فقط): isActive=false.
   * - لا يمكن تعطيل نفسك — 409.
   * - CAS مشروط بـ isActive=true — صفر صفوف = معطّل مسبقًا/تغيّر متزامن → 409.
   * - لا حاجة لرفع jwtVersion: JwtStrategy.validate يرفض كل طلب لمستخدم
   *   غير نشط (وlogin/refresh يرفضانه) فتبطل الجلسات فورًا عند التعطيل.
   * - ActivityLog (USER_DEACTIVATED) داخل المعاملة + idempotency.
   */
  async deactivateUser(
    targetUserId: string,
    actorId: string,
    idempotencyKey?: string,
  ) {
    return this.setUserActive(targetUserId, actorId, false, idempotencyKey);
  }

  /**
   * تنشيط مستخدم (SUPER_ADMIN فقط): isActive=true.
   * CAS مشروط بـ isActive=false — صفر صفوف = نشط مسبقًا/تغيّر متزامن → 409.
   * ActivityLog (USER_ACTIVATED) داخل المعاملة + idempotency.
   */
  async activateUser(
    targetUserId: string,
    actorId: string,
    idempotencyKey?: string,
  ) {
    return this.setUserActive(targetUserId, actorId, true, idempotencyKey);
  }

  /**
   * تنفيذ مشترك لتنشيط/تعطيل — نفس البنية: تحقق ذاتي + CAS + تدقيق +
   * idempotency داخل معاملة واحدة. حماية الذات تُطبَّق على التعطيل فقط:
   * المستخدم النشط لا يحتاج حماية من تنشيط نفسه (لا يمكنه استدعاؤه وهو
   * معطّل أصلًا لأن الجلسات تُرفض).
   */
  private async setUserActive(
    targetUserId: string,
    actorId: string,
    targetActive: boolean,
    idempotencyKey?: string,
  ) {
    const scope = targetActive ? 'users-activate' : 'users-deactivate';
    const requestHash = computeRequestHash({
      operation: scope,
      targetUserId,
      actorId,
    });
    const replay = await tryReplayIdempotencyKey(
      this.prisma,
      idempotencyKey,
      scope,
      requestHash,
    );
    if (replay) return replay;

    try {
      return await this.prisma.$transaction(async (tx) => {
        await createIdempotencyKey(tx, idempotencyKey, scope, requestHash);

        const target = await tx.user.findUnique({
          where: { id: targetUserId },
          select: USER_PUBLIC_SELECT,
        });
        if (!target) {
          throw new NotFoundException('المستخدم غير موجود');
        }
        if (!targetActive && target.id === actorId) {
          throw new ConflictException(
            'لا يمكنك تعطيل حسابك الخاص — اطلب ذلك من مدير أعلى',
          );
        }

        const transition = await tx.user.updateMany({
          where: { id: targetUserId, isActive: !targetActive },
          data: { isActive: targetActive },
        });
        if (transition.count !== 1) {
          throw new ConflictException(
            `تعذر ${targetActive ? 'تنشيط' : 'تعطيل'} المستخدم — ${
              targetActive ? 'قد يكون نشطًا' : 'قد يكون معطّلًا'
            } بالفعل أو تغيّر بالتزامن`,
          );
        }

        const updated = await tx.user.findUnique({
          where: { id: targetUserId },
          select: USER_PUBLIC_SELECT,
        });

        await tx.activityLog.create({
          data: {
            userId: actorId,
            action: targetActive ? 'USER_ACTIVATED' : 'USER_DEACTIVATED',
            module: 'USERS',
            details: {
              targetUserId,
              targetEmail: target.email,
              isActive: targetActive,
            },
          },
        });

        await storeIdempotencyResponse(tx, idempotencyKey, updated);
        return updated;
      });
    } catch (error) {
      if (idempotencyKey && isIdempotencyUniqueViolation(error)) {
        const replayed = await tryReplayIdempotencyKey(
          this.prisma,
          idempotencyKey,
          scope,
          requestHash,
        );
        if (replayed) return replayed;
      }
      throw error;
    }
  }
}
