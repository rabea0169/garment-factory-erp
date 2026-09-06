import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ListResponseDto } from '../../common/dto/list-response.dto';
import {
  computeRequestHash,
  createIdempotencyKey,
  isIdempotencyUniqueViolation,
  storeIdempotencyResponse,
  tryReplayIdempotencyKey,
} from '../../core/common/idempotency.util';
import {
  DocumentCodePrefix,
  generateDocumentCode,
} from '../../core/common/codes.util';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { SupplierQueryDto } from './dto/supplier-query.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';

/**
 * PUR-7 (P2 — GF-IMP-W3): استكمال موديول الموردين — تكافؤ مع العملاء.
 *
 * كان الموديول مبتورًا (قائمة نشطين + إنشاء فقط): لا تحديث لبيانات
 * المورد ولا تعطيل/تنشيط — كل تصحيح بيانات كان يدويًا في القاعدة بلا
 * تدقيق. المسارات الجديدة (نفس نمط users module من W2 — CC-9):
 * - `updateSupplier`: PATCH دلالي للحقول المرسلة فقط + ActivityLog
 *   بالقيم قبل/بعد داخل المعاملة + idempotency (scope: supplier-update).
 * - `deactivateSupplier`/`activateSupplier`: CAS عبر updateMany مشروط
 *   بـ isActive المعاكس (صفر صفوف → 409) + ActivityLog + idempotency
 *   بنطاقين منفصلين. لا حماية «نفسك» هنا (المورد ليس مستخدمًا —
 *   حماية الذات في users تخص الهويات لا بيانات الأطراف).
 * - القائمة: includeInactive اختياري (الافتراضي النشطون فقط لشاشات
 *   الاختيار) + q/from/to من قالب CC-6.
 *
 * الأدوار (المتحكم): INVENTORY_MANAGER أو GENERAL_MANAGER لكل
 * عمليات الكتابة — نفس أدوار إنشاء مورد القائمة.
 */
@Injectable()
export class SuppliersService {
  constructor(private readonly prisma: PrismaService) {}

  async getSuppliers(query: SupplierQueryDto = new SupplierQueryDto()) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    // PUR-7 (ج) + CC-6: فلاتر موحدة — التواريخ ISO صالحة وfrom ≤ to
    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;
    if (
      (from && Number.isNaN(from.getTime())) ||
      (to && Number.isNaN(to.getTime()))
    ) {
      throw new BadRequestException('فلاتر الموردين تتطلب تواريخ ISO صالحة');
    }
    if (from && to && from > to) {
      throw new BadRequestException(
        'تاريخ بداية فلاتر الموردين لا يمكن أن يكون بعد تاريخ النهاية',
      );
    }

    // المحذوفون ناعمًا مستثنون دائمًا؛ النشط فقط هو الافتراضي (شاشات
    // الاختيار) وincludeInactive يضم المعطّلين إداريًا.
    const where: Prisma.SupplierWhereInput = {
      deletedAt: null,
      ...(query.includeInactive ? {} : { isActive: true }),
      ...(from || to
        ? {
            createdAt: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          }
        : {}),
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' } },
              { code: { contains: query.q, mode: 'insensitive' } },
              { phone: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.supplier.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.supplier.count({ where }),
    ]);

    return new ListResponseDto(data, total, page, limit);
  }

  async createSupplier(input: CreateSupplierDto, idempotencyKey?: string) {
    // RES-F02: replay-safe retry via Idempotency-Key header.
    const requestHash = computeRequestHash({
      name: input.name,
      phone: input.phone ?? null,
      email: input.email ?? null,
      address: input.address ?? null,
      notes: input.notes ?? null,
    });
    const scope = 'supplier-create';
    try {
      return await this.prisma.$transaction(async (tx) => {
        const replay = await tryReplayIdempotencyKey(
          tx,
          idempotencyKey,
          scope,
          requestHash,
        );
        if (replay)
          return replay as Awaited<ReturnType<typeof tx.supplier.create>> & {
            replayed: true;
          };

        const created = await tx.supplier.create({
          data: {
            code: generateDocumentCode(DocumentCodePrefix.SUPPLIER),
            name: input.name.trim(),
            phone: input.phone?.trim() || undefined,
            email: input.email?.trim().toLowerCase() || undefined,
            address: input.address?.trim() || undefined,
            notes: input.notes?.trim() || undefined,
          },
        });
        await storeIdempotencyResponse(tx, idempotencyKey, created);
        return created;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        !isIdempotencyUniqueViolation(error)
      ) {
        throw new ConflictException('بيانات المورد مستخدمة بالفعل');
      }
      throw error;
    }
  }

  /**
   * PUR-7 (أ): تحديث بيانات مورد — PATCH دلالي للحقول المرسلة فقط
   * (name/phone/address/notes). الحقول غير المرسلة لا تُمس؛ طلب بلا أي
   * حقل → 400 (لا «تحديث» فارغًا يكتب سجل تدقيق بلا أثر). ActivityLog
   * بالقيم قبل/بعد للحقول المتغيرة فقط داخل نفس المعاملة + idempotency
   * كامل النمط (scope: supplier-update).
   */
  async updateSupplier(
    supplierId: string,
    dto: UpdateSupplierDto,
    actorId: string,
    idempotencyKey?: string,
  ) {
    // تحضير القيم الجديدة (trim) للحقول المرسلة فقط — undefined = غير مُرسل
    const updates: Record<string, string> = {};
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) {
        throw new BadRequestException(
          'اسم المورد لا يمكن أن يكون فارغًا أو مسافات فقط',
        );
      }
      updates.name = name;
    }
    if (dto.phone !== undefined) updates.phone = dto.phone.trim();
    if (dto.address !== undefined) updates.address = dto.address.trim();
    if (dto.notes !== undefined) updates.notes = dto.notes.trim();
    if (Object.keys(updates).length === 0) {
      throw new BadRequestException(
        'لا حقول للتحديث — أرسل واحدًا على الأقل من name/phone/address/notes',
      );
    }

    const scope = 'supplier-update';
    const requestHash = computeRequestHash({
      operation: scope,
      supplierId,
      actorId,
      updates,
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

        const existing = await tx.supplier.findUnique({
          where: { id: supplierId },
          select: {
            id: true,
            code: true,
            name: true,
            phone: true,
            address: true,
            notes: true,
            // المحذوف ناعمًا لا يُحدَّث (نفس قرار التعطيل/التنشيط أدناه)
            deletedAt: true,
          },
        });
        if (!existing || existing.deletedAt) {
          throw new NotFoundException('المورد غير موجود');
        }

        const updated = await tx.supplier.update({
          where: { id: supplierId },
          data: updates,
        });

        // سجل التدقيق: الحقول المتغيرة فقط بالقيم قبل/بعد (نصية آمنة)
        const changedFields: Record<string, { before: string; after: string }> =
          {};
        for (const [field, after] of Object.entries(updates)) {
          const rawBefore = (existing as Record<string, unknown>)[field];
          // قيم المورد القابلة للتحديث كلها string | null — أي قيمة أخرى
          // غير نصية تُسجَّل فارغة (لا String على كائن أبدًا)
          const before = typeof rawBefore === 'string' ? rawBefore : '';
          changedFields[field] = { before, after };
        }
        await tx.activityLog.create({
          data: {
            userId: actorId,
            action: 'SUPPLIER_UPDATED',
            module: 'PURCHASING',
            details: {
              supplierId,
              code: existing.code,
              changedFields,
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

  /** PUR-7 (ب): تعطيل مورد — isActive=false عبر CAS + تدقيق + idempotency. */
  async deactivateSupplier(
    supplierId: string,
    actorId: string,
    idempotencyKey?: string,
  ) {
    return this.setSupplierActive(supplierId, actorId, false, idempotencyKey);
  }

  /** PUR-7 (ب): تنشيط مورد — isActive=true عبر CAS + تدقيق + idempotency. */
  async activateSupplier(
    supplierId: string,
    actorId: string,
    idempotencyKey?: string,
  ) {
    return this.setSupplierActive(supplierId, actorId, true, idempotencyKey);
  }

  /**
   * تنفيذ مشترك لتنشيط/تعطيل المورد — نفس بنية users.setUserActive من
   * W2 (CC-9): CAS مشروط بـ isActive المعاكس (صفر صفوف = الحالة مطلوبة
   * أصلًا أو تغيّرت بالتزامن → 409) + ActivityLog داخل المعاملة +
   * idempotency بنطاقين منفصلين. المحذوف ناعمًا يُعامل كموجود منطقيًا
   * لكن لا يُفعّل (404) — الحذف الناعم أقوى من التعطيل.
   */
  private async setSupplierActive(
    supplierId: string,
    actorId: string,
    targetActive: boolean,
    idempotencyKey?: string,
  ) {
    const scope = targetActive ? 'supplier-activate' : 'supplier-deactivate';
    const requestHash = computeRequestHash({
      operation: scope,
      supplierId,
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

        const target = await tx.supplier.findUnique({
          where: { id: supplierId },
          select: { id: true, code: true, name: true, deletedAt: true },
        });
        if (!target || target.deletedAt) {
          throw new NotFoundException('المورد غير موجود');
        }

        // CAS: مشروط بـ isActive المعاكس — أي تغيير متزامن يُصفَّر صفوفه
        const transition = await tx.supplier.updateMany({
          where: { id: supplierId, isActive: !targetActive, deletedAt: null },
          data: { isActive: targetActive },
        });
        if (transition.count !== 1) {
          throw new ConflictException(
            `تعذر ${targetActive ? 'تنشيط' : 'تعطيل'} المورد — ${
              targetActive ? 'قد يكون نشطًا' : 'قد يكون معطّلًا'
            } بالفعل أو تغيّر بالتزامن`,
          );
        }

        const updated = await tx.supplier.findUnique({
          where: { id: supplierId },
        });

        await tx.activityLog.create({
          data: {
            userId: actorId,
            action: targetActive
              ? 'SUPPLIER_ACTIVATED'
              : 'SUPPLIER_DEACTIVATED',
            module: 'PURCHASING',
            details: {
              supplierId,
              code: target.code,
              name: target.name,
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
