import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

import { CreateBranchDto, UpdateBranchDto } from './dto/branch.dto';

/**
 * SELIM-ERP W4: فروع الشركة — نقل /api/company/branches من Selim ERP
 * (SPRINT 89 + 93 + 94) بمعمارية أحادية المستأجر.
 *
 * قواعد المرجع المطبَّقة حرفيًا:
 * - القائمة مرتبة (isMain DESC, name ASC) وتشمل المعطَّل (إدارة) —
 *   المنتقي في الواجهة يفلتر isActive.
 * - تعيين isMain=true يلغي رئيسية باقي الفروع (transaction) — رئيسي واحد فقط.
 * - لا يمكن حذف الفرع الرئيسي (400) — عطِّله أو انقل الرئيسية أولًا.
 * - حذف فرع غير رئيسي مسموح: مستنداته تُفك بربطها (SetNull في القاعدة)
 *   فتبقى فواتير البيع/الشراء والأصناف بلا فرع — لا فقد بيانات.
 * - كل كتابة تدوَّن في ActivityLog (سجل التدقيق — نفس logAuditInTx في المرجع).
 */
@Injectable()
export class BranchesService {
  constructor(private readonly prisma: PrismaService) {}

  /** قائمة الفروع مع عدادات المستندات المرتبطة (لعرض الاستخدام في الشاشة). */
  async list() {
    const branches = await this.prisma.companyBranch.findMany({
      orderBy: [{ isMain: 'desc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        address: true,
        phone: true,
        manager: true,
        isMain: true,
        isActive: true,
        createdAt: true,
        _count: {
          select: { salesOrders: true, purchaseOrders: true, products: true },
        },
      },
    });
    return {
      branches: branches.map((b) => ({
        id: b.id,
        name: b.name,
        address: b.address,
        phone: b.phone,
        manager: b.manager,
        isMain: b.isMain,
        isActive: b.isActive,
        createdAt: b.createdAt,
        salesCount: b._count.salesOrders,
        purchaseCount: b._count.purchaseOrders,
        productsCount: b._count.products,
      })),
    };
  }

  /** إنشاء فرع — رئيسي واحد فقط: إن عُيّن رئيسيًا تُلغى رئيسية البقية. */
  async create(dto: CreateBranchDto, actorId: string) {
    const name = dto.name.trim();
    const isMain = dto.isMain ?? false;
    const branch = await this.prisma.$transaction(async (tx) => {
      if (isMain) {
        await tx.companyBranch.updateMany({
          where: { isMain: true },
          data: { isMain: false },
        });
      }
      return tx.companyBranch.create({
        data: {
          name,
          address: dto.address?.trim() || null,
          phone: dto.phone?.trim() || null,
          manager: dto.manager?.trim() || null,
          isMain,
          isActive: dto.isActive ?? true,
        },
      });
    });
    await this.prisma.activityLog.create({
      data: {
        userId: actorId,
        action: 'BRANCH_CREATED',
        module: 'COMPANY',
        details: { name, isMain },
      },
    });
    return branch;
  }

  /** تحديث فرع — نقل الرئيسية transactionally (رئيسي واحد فقط). */
  async update(id: string, dto: UpdateBranchDto, actorId: string) {
    const existing = await this.prisma.companyBranch.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException('الفرع غير موجود');
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.isMain === true) {
        await tx.companyBranch.updateMany({
          where: { isMain: true, id: { not: id } },
          data: { isMain: false },
        });
      }
      return tx.companyBranch.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.address !== undefined
            ? { address: dto.address?.trim() || null }
            : {}),
          ...(dto.phone !== undefined
            ? { phone: dto.phone?.trim() || null }
            : {}),
          ...(dto.manager !== undefined
            ? { manager: dto.manager?.trim() || null }
            : {}),
          ...(dto.isMain !== undefined ? { isMain: dto.isMain } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        },
      });
    });
    await this.prisma.activityLog.create({
      data: {
        userId: actorId,
        action: 'BRANCH_UPDATED',
        module: 'COMPANY',
        details: { id, name: updated.name, isMain: updated.isMain },
      },
    });
    return updated;
  }

  /**
   * حذف فرع — الرئيسي مرفوض (400 مثل المرجع: «لا يمكن حذف الفرع الرئيسي»).
   * غير الرئيسي: الحذف يُفك ربط مستنداته (SetNull) فلا تُفقد فاتورة ولا صنف.
   */
  async remove(id: string, actorId: string) {
    const existing = await this.prisma.companyBranch.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException('الفرع غير موجود');
    }
    if (existing.isMain) {
      return {
        success: false,
        error: 'لا يمكن حذف الفرع الرئيسي — عطّله أو انقل الرئيسية لفرع آخر',
      };
    }
    await this.prisma.companyBranch.delete({ where: { id } });
    await this.prisma.activityLog.create({
      data: {
        userId: actorId,
        action: 'BRANCH_DELETED',
        module: 'COMPANY',
        details: { id, name: existing.name },
      },
    });
    return { success: true };
  }
}
