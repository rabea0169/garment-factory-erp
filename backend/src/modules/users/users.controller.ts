import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.guard';
import { CreateUserDto } from './dto/create-user.dto';
import { ChangeUserRoleDto } from './dto/change-user-role.dto';
import { UserQueryDto } from './dto/user-query.dto';
import { UpdatePermissionsDto } from './dto/update-permissions.dto';
import { ForbiddenException, Put } from '@nestjs/common';
import { UsersService } from './users.service';

/**
 * CC-9 (P1 — GF-IMP-W2): متحكم إدارة المستخدمين — SUPER_ADMIN فقط.
 *
 * الحراس عامة (JwtAuthGuard + RolesGuard عبر APP_GUARD في app.module)
 * فلا نكرر @UseGuards — نفس نمط suppliers/shipping. كل مسار موسوم
 * @Roles(UserRole.SUPER_ADMIN) صراحةً (حتى القائمة: إدارة الهويات
 * عملية إدارية مقصورة على أعلى دور).
 */
@ApiTags('Users (إدارة المستخدمين)')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'CC-9: قائمة المستخدمين (SUPER_ADMIN فقط)' })
  async listUsers(@Query() query: UserQueryDto) {
    return this.usersService.listUsers(query);
  }

  @Post()
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'CC-9: إنشاء مستخدم جديد (SUPER_ADMIN فقط)' })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description:
      'CC-9: مفتاح ثابت لإعادة إرسال نفس طلب الإنشاء بأمان — نفس المفتاح + نفس المحتوى = نفس الاستجابة، ومحتوى مختلف = 409',
  })
  async createUser(
    @Body() dto: CreateUserDto,
    @CurrentUser('id') actorId: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.usersService.createUser(dto, actorId, idempotencyKey);
  }

  @Patch(':id/role')
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'CC-9: تغيير دور مستخدم (SUPER_ADMIN فقط — لا يمكن لنفسك)',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description: 'CC-9: مفتاح إعادة محاولة آمنة لتغيير الدور',
  })
  async changeRole(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ChangeUserRoleDto,
    @CurrentUser('id') actorId: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.usersService.changeUserRole(
      id,
      dto.role,
      actorId,
      idempotencyKey,
    );
  }

  @Patch(':id/deactivate')
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'CC-9: تعطيل مستخدم (SUPER_ADMIN فقط — لا يمكن لنفسك)',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description: 'CC-9: مفتاح إعادة محاولة آمنة للتعطيل',
  })
  async deactivate(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser('id') actorId: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.usersService.deactivateUser(id, actorId, idempotencyKey);
  }

  @Patch(':id/activate')
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'CC-9: تنشيط مستخدم (SUPER_ADMIN فقط)' })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description: 'CC-9: مفتاح إعادة محاولة آمنة للتنشيط',
  })
  async activate(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser('id') actorId: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.usersService.activateUser(id, actorId, idempotencyKey);
  }

  // ----------------------------------------------------------------
  // SELIM-ERP W4 — الصلاحيات التفصيلية للمستخدم
  // (نقل GET/PUT /api/users/[id]/permissions من المرجع SPRINT 81)
  // ----------------------------------------------------------------

  @Get(':id/permissions')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.GENERAL_MANAGER,
    UserRole.ACCOUNTANT,
    UserRole.CASHIER,
    UserRole.PRODUCTION_MANAGER,
    UserRole.INVENTORY_MANAGER,
    UserRole.HR_MANAGER,
    UserRole.VIEWER,
  )
  @ApiOperation({
    summary:
      'W4: صلاحيات مستخدم (المخزّنة + افتراضيات الدور + الفعالة) — SUPER_ADMIN أو صاحب الحساب',
  })
  async getPermissions(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: { id: string; role: UserRole },
  ) {
    if (actor.id !== id && actor.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException(
        'غير مصرح — يمكنك الاطلاع على صلاحياتك الخاصة فقط',
      );
    }
    return this.usersService.getUserPermissions(id);
  }

  @Put(':id/permissions')
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary:
      'W4: تحديث صلاحيات مستخدم (SUPER_ADMIN فقط — لا يمكن لنفسه: حماية من حبس النفس)',
  })
  async updatePermissions(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdatePermissionsDto,
    @CurrentUser('id') actorId: string,
  ) {
    return this.usersService.updateUserPermissions(id, dto, actorId);
  }
}
