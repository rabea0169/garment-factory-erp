import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { EVENTS } from '../../events/event-types';

/**
 * حمولة حدث انخفاض المخزون كما تبثها InventoryService (buildStockEvents)
 * بعد نجاح معاملة الحركة (INV-1: بث بعد commit فقط).
 */
export interface StockLowPayload {
  materialId: string;
  warehouseId: string;
  currentStock: number;
  minStockLevel: number;
  /** CC-8: منفذ الحركة الذي هبط بالرصيد — فاعل سجل التنبيه. */
  actorId?: string;
}

/**
 * CC-8 (W2-4): أول مستمع حقيقي لأحداث المخزون في النظام.
 *
 * يسمع STOCK_LOW (inventory.stock.low) — الحدث الذي تبثه InventoryService
 * بعد commit معاملة الحركة — ويسجّل ActivityLog (module: INVENTORY،
 * action: STOCK_LOW_ALERT) بتفاصيل المادة والرصيد وعتبة إعادة الطلب،
 * فيصبح النقص مرئيًا في سجل النشاط للمديرين دون الاستعلام عن الـ dashboard.
 *
 * قيود التصميم:
 * - ActivityLog.userId إلزامي (String في المخطط — ليس String?) فلا يمكن
 *   تمرير null. «نظام الفاعل المتاح» هنا = منفذ الحركة نفسه (actorId
 *   يرافق الحدث من executeMovement). بدونه (حركة نظامية بلا مستخدم)
 *   نكتفي بسجل Logger تحذيري ولا نكتب ActivityLog — لا قيمة وهمية.
 * - المستمع لا يرمي أبدًا: try/catch داخلي كامل — فشل التسجيل (قاعدة
 *   مشغولة/خطأ شبكة) لا يكسر عمليات المخزون ولا يلوّث emitAsync للمستدعي.
 * - lookup اسم المادة best-effort: فشله لا يمنع كتابة السجل (يرجع null).
 */
@Injectable()
export class StockAlertListener {
  private readonly logger = new Logger(StockAlertListener.name);

  constructor(private readonly prisma: PrismaService) {}

  @OnEvent(EVENTS.STOCK_LOW, { async: true })
  async handleStockLow(payload: StockLowPayload): Promise<void> {
    try {
      await this.recordLowStockAlert(payload);
    } catch (error) {
      // CC-8: فشل التسجيل لا يرمي أبدًا — عمليات المخزون لا تتأثر
      this.logger.error(
        `فشل تسجيل تنبيه انخفاض المخزون للمادة ${payload.materialId} ` +
          `(الرصيد ${payload.currentStock} / العتبة ${payload.minStockLevel})`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private async recordLowStockAlert(payload: StockLowPayload): Promise<void> {
    if (!payload.actorId) {
      // ActivityLog يتطلب userId (String إلزامي) ولا فاعل معروف في الحدث —
      // نسجّل تحذيرًا عبر Logger كحد أدنى بدل كتابة سجل بفاعل وهمي.
      this.logger.warn(
        `انخفاض مخزون بلا فاعل معروف — لا يُكتب ActivityLog: المادة ` +
          `${payload.materialId} بالمخزن ${payload.warehouseId} رصيد ` +
          `${payload.currentStock} ≤ عتبة ${payload.minStockLevel}`,
      );
      return;
    }

    const material = await this.lookupMaterial(payload.materialId);

    await this.prisma.activityLog.create({
      data: {
        userId: payload.actorId,
        action: 'STOCK_LOW_ALERT',
        module: 'INVENTORY',
        details: {
          materialId: payload.materialId,
          materialCode: material?.code ?? null,
          materialName: material?.name ?? null,
          warehouseId: payload.warehouseId,
          currentStock: payload.currentStock,
          minStockLevel: payload.minStockLevel,
        },
      },
    });
    this.logger.log(
      `تنبيه نقص مخزون: ${material?.name ?? payload.materialId} — الرصيد ` +
        `${payload.currentStock} ≤ عتبة إعادة الطلب ${payload.minStockLevel}`,
    );
  }

  /** best-effort: فشل الجلب يعيد null ويستمر التسجيل بلا اسم المادة. */
  private async lookupMaterial(
    materialId: string,
  ): Promise<{ code: string; name: string } | null> {
    try {
      return await this.prisma.rawMaterial.findUnique({
        where: { id: materialId },
        select: { code: true, name: true },
      });
    } catch {
      return null;
    }
  }
}
