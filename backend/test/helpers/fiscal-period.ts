import { PrismaService } from '../../src/prisma/prisma.service';

/**
 * GF-IMP-W2 / ACC-3: مساعد مواصفات التكامل — يزرع فترة مالية مفتوحة واسعة
 * (2020-2030) ل cover تواريخ أي سيناريو اختبار.
 *
 * بعد ACC-3 يرفض محرك الترحيل كل قيد بلا فترة مفتوحة شاملة تاريخه؛ ومواصفات
 * التكامل تفرغ جدول users بـ TRUNCATE CASCADE فيجرف معه fiscal_periods
 * (علاقة FK) — لذا يجب إعادة زرعها بعد إنشاء المستخدم في كل سيناريو.
 */
export async function seedOpenFiscalPeriod(
  prisma: PrismaService,
  createdById: string,
): Promise<string> {
  const startDate = new Date(Date.UTC(2020, 0, 1));
  const endDate = new Date(Date.UTC(2030, 11, 31));
  const period = await prisma.fiscalPeriod.upsert({
    where: { startDate_endDate: { startDate, endDate } },
    update: {},
    create: {
      name: 'Integration Test Period (2020-2030)',
      startDate,
      endDate,
      status: 'OPEN',
      createdById,
    },
  });
  return period.id;
}
