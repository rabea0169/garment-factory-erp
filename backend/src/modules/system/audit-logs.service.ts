import { Injectable, ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsQueryDto } from './dto/audit-logs-query.dto';

/**
 * SELIM-ERP W3 — سجل التدقيق (يقلد GET /api/audit-logs في Selim —
 * SPRING 71: نفس المعاملات، نفس قاعدة الرؤية).
 *
 * قاعدة الرؤية (مقتبسة من المرجع): SUPER_ADMIN وGENERAL_MANAGER يريان السجل كاملًا،
 * وبقية الأدوار ترى مدخلاتها الخاصة فقط (فرض userId=المستخدم).
 *
 * تكييف أسماء الحقول لـ ActivityLog عندنا: module بدل entityType،
 * والتاريخ createdAt (ActionLog عندنا بلا updatedAt).
 */
@Injectable()
export class AuditLogsService {
  constructor(private readonly prisma: PrismaService) {}

  async query(
    dto: AuditLogsQueryDto,
    user: { id: string; role: UserRole },
  ): Promise<{
    logs: Array<{
      id: string;
      userId: string;
      userName: string;
      action: string;
      module: string;
      details: unknown;
      createdAt: Date;
    }>;
    total: number;
    page: number;
    pageSize: number;
  }> {
    const page = dto.page ?? 1;
    const pageSize = dto.pageSize ?? 50;

    const where: {
      module?: string;
      action?: string;
      userId?: string;
      createdAt?: { gte?: Date; lte?: Date };
    } = {};

    // الرؤية: غير الإداريين يرون مدخلاتهم فقط — شرط واحد لا يُتجاوز.
    const isAdmin =
      user.role === UserRole.SUPER_ADMIN ||
      user.role === UserRole.GENERAL_MANAGER;
    if (isAdmin && dto.userId) {
      where.userId = dto.userId;
    } else if (!isAdmin) {
      if (dto.userId && dto.userId !== user.id) {
        throw new ForbiddenException(
          'يمكنك عرض مدخلاتك الخاصة فقط من سجل التدقيق',
        );
      }
      where.userId = user.id;
    }

    if (dto.module) where.module = dto.module;
    if (dto.action) where.action = dto.action;
    if (dto.startDate || dto.endDate) {
      where.createdAt = {
        ...(dto.startDate ? { gte: new Date(dto.startDate) } : {}),
        ...(dto.endDate
          ? { lte: new Date(`${dto.endDate.slice(0, 10)}T23:59:59.999Z`) }
          : {}),
      };
    }

    const [rows, total] = await Promise.all([
      this.prisma.activityLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          userId: true,
          action: true,
          module: true,
          details: true,
          createdAt: true,
          user: { select: { name: true } },
        },
      }),
      this.prisma.activityLog.count({ where }),
    ]);

    return {
      logs: rows.map((r) => ({
        id: r.id,
        userId: r.userId,
        userName: r.user?.name ?? '—',
        action: r.action,
        module: r.module,
        details: r.details,
        createdAt: r.createdAt,
      })),
      total,
      page,
      pageSize,
    };
  }
}
