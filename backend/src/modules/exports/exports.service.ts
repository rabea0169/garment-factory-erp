import { BadRequestException, Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../../prisma/prisma.service';
import { FactorySettingsService } from '../system/factory-settings.service';

/**
 * SELIM-ERP W3 — خدمة التصدير Excel/Word (نقل من lib/excel-export.ts
 * وlib/word-export.ts في Selim ERP).
 *
 * - **Excel**: exceljs (نفس مكتبة المرجع) — ورقة «معلومات المصنع» أولًا
 *   من FactorySettings (نفس includeFactoryInfo=true هناك) ثم ورقة
 *   البيانات برؤوس مُنسّقة وRTL.
 * - **Word**: نفس أسلوب المرجع حرفيًا — HTML بمسميات Office (MHTML)
 *   داخل ملف .doc (المرجع وثّقه: يعمل في MS Word؛ LibreOffice/Google
 *   Docs قد يعرضه بشكل مختلف — قيد معروف نقلناه كما هو).
 * - الكيانات: العملاء/الموردون/المنتجات/العمال/المصاريف/المخزون/
 *   المبيعات/المشتريات — كل كيان بأدوار قراءة وحدته الأصل (INV-2
 *   للمالية).
 */

/** صف واحد = مصفوفة قيم (نفس نمط sheets في المرجع). */
type Row = (string | number | null)[];

/** تعريف كيان قابل للتصدير. */
interface ExportEntityDef {
  /** الاسم في المسار (export/excel/:entity). */
  key: string;
  /** اسم الورقة/التقرير. */
  title: string;
  headers: string[];
  /** يجلب الصفوف (بترتيب زمني تنازلي عمومًا). */
  load: (prisma: PrismaService) => Promise<Row[]>;
}

const num = (v: unknown): number => Number(v ?? 0);
const isoDate = (v: Date): string => v.toISOString().slice(0, 10);

const ENTITIES: ExportEntityDef[] = [
  {
    key: 'customers',
    title: 'العملاء',
    headers: [
      'الكود',
      'الاسم',
      'الهاتف',
      'العنوان',
      'الرصيد',
      'الحد الائتماني',
      'فعال',
    ],
    load: (p) =>
      p.customer
        .findMany({
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          select: {
            code: true,
            name: true,
            phone: true,
            address: true,
            balance: true,
            creditLimit: true,
            isActive: true,
          },
        })
        .then((rows) =>
          rows.map((r): Row => [
            r.code,
            r.name,
            r.phone ?? '',
            r.address ?? '',
            num(r.balance),
            r.creditLimit === null ? 'بلا حد' : num(r.creditLimit),
            r.isActive ? 'نعم' : 'لا',
          ]),
        ),
  },
  {
    key: 'suppliers',
    title: 'الموردون',
    headers: ['الكود', 'الاسم', 'الهاتف', 'الرصيد', 'فعال'],
    load: (p) =>
      p.supplier
        .findMany({
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          select: {
            code: true,
            name: true,
            phone: true,
            balance: true,
            isActive: true,
          },
        })
        .then((rows) =>
          rows.map((r): Row => [
            r.code,
            r.name,
            r.phone ?? '',
            num(r.balance),
            r.isActive ? 'نعم' : 'لا',
          ]),
        ),
  },
  {
    key: 'products',
    title: 'المنتجات',
    headers: [
      'الكود',
      'الاسم',
      'الباركود',
      'سعر التجزئة',
      'سعر الجملة',
      'فعال',
    ],
    load: (p) =>
      p.product
        .findMany({
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          select: {
            code: true,
            name: true,
            barcode: true,
            retailPrice: true,
            wholesalePrice: true,
            isActive: true,
          },
        })
        .then((rows) =>
          rows.map((r): Row => [
            r.code,
            r.name,
            r.barcode ?? '',
            num(r.retailPrice),
            r.wholesalePrice === null ? '' : num(r.wholesalePrice),
            r.isActive ? 'نعم' : 'لا',
          ]),
        ),
  },
  {
    key: 'workers',
    title: 'العمال',
    headers: ['الكود', 'الاسم', 'التخصص', 'فعال'],
    load: (p) =>
      p.worker
        .findMany({
          orderBy: { createdAt: 'desc' },
          select: { code: true, name: true, specialty: true, isActive: true },
        })
        .then((rows) =>
          rows.map((r): Row => [
            r.code,
            r.name,
            r.specialty,
            r.isActive ? 'نعم' : 'لا',
          ]),
        ),
  },
  {
    key: 'expenses',
    title: 'المصاريف',
    headers: ['التاريخ', 'البند', 'المبلغ', 'ملاحظات'],
    load: (p) =>
      p.expense
        .findMany({
          orderBy: { date: 'desc' },
          select: { date: true, categoryName: true, amount: true, notes: true },
          take: 5000,
        })
        .then((rows) =>
          rows.map((r): Row => [
            isoDate(r.date),
            r.categoryName,
            num(r.amount),
            r.notes ?? '',
          ]),
        ),
  },
  {
    key: 'inventory',
    title: 'المخزون (الخامات)',
    headers: ['الكود', 'الاسم', 'الوحدة', 'الرصيد', 'حد الطلب', 'تكلفة الوحدة'],
    load: (p) =>
      p.rawMaterial
        .findMany({
          where: { isActive: true },
          orderBy: { code: 'asc' },
          select: {
            code: true,
            name: true,
            unit: true,
            currentStock: true,
            minStockLevel: true,
            costPerUnit: true,
          },
        })
        .then((rows) =>
          rows.map((r): Row => [
            r.code,
            r.name,
            r.unit,
            num(r.currentStock),
            num(r.minStockLevel),
            num(r.costPerUnit),
          ]),
        ),
  },
  {
    key: 'sales',
    title: 'المبيعات',
    headers: ['الكود', 'التاريخ', 'العميل', 'الإجمالي', 'الحالة'],
    load: (p) =>
      p.salesOrder
        .findMany({
          orderBy: { createdAt: 'desc' },
          select: {
            code: true,
            createdAt: true,
            customer: { select: { name: true } },
            totalAmount: true,
            status: true,
          },
          take: 5000,
        })
        .then((rows) =>
          rows.map((r): Row => [
            r.code,
            isoDate(r.createdAt),
            r.customer?.name ?? '—',
            num(r.totalAmount),
            r.status,
          ]),
        ),
  },
  {
    key: 'purchases',
    title: 'المشتريات',
    headers: ['الكود', 'التاريخ', 'المورد', 'الإجمالي', 'الحالة'],
    load: (p) =>
      p.purchaseOrder
        .findMany({
          orderBy: { createdAt: 'desc' },
          select: {
            code: true,
            createdAt: true,
            supplier: { select: { name: true } },
            totalAmount: true,
            status: true,
          },
          take: 5000,
        })
        .then((rows) =>
          rows.map((r): Row => [
            r.code,
            isoDate(r.createdAt),
            r.supplier?.name ?? '—',
            num(r.totalAmount),
            r.status,
          ]),
        ),
  },
];

function entityOf(key: string): ExportEntityDef {
  const def = ENTITIES.find((e) => e.key === key);
  if (!def) {
    throw new BadRequestException(
      `كيان تصدير غير معروف: ${key} (المتاح: ${ENTITIES.map((e) => e.key).join('/')})`,
    );
  }
  return def;
}

/** تهريب HTML (نفس escapeHtml في المرجع — مطلوب لسلامة جدول Word). */
function escapeHtml(value: string | number | null | undefined): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

@Injectable()
export class ExportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly factorySettings: FactorySettingsService,
  ) {}

  /** كل الكيانات المدعومة (لعرض الأزرار المتاحة حسب الدور). */
  static entityKeys(): string[] {
    return ENTITIES.map((e) => e.key);
  }

  /** عنوان الكيان للواجهة. */
  static entityTitle(key: string): string {
    return entityOf(key).title;
  }

  /** يولّد ملف XLSX: ورقة معلومات المصنع + ورقة البيانات (نمط المرجع). */
  async exportExcel(
    entity: string,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const def = entityOf(entity);
    const [rows, settings] = await Promise.all([
      def.load(this.prisma),
      this.factorySettings.getSettings(),
    ]);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Garment Factory ERP';
    workbook.created = new Date();

    // ورقة معلومات المصنع أولًا — نفس ترويسة المرجع (includeFactoryInfo).
    const info = workbook.addWorksheet('معلومات المصنع', {
      views: [{ rightToLeft: true }],
    });
    info.addRows([
      ['اسم المصنع', settings.factoryName],
      ['الاسم الإنجليزي', settings.factoryNameEn ?? ''],
      ['الهاتف', settings.phone ?? ''],
      ['العنوان', settings.address ?? ''],
      ['السجل الضريبي', settings.taxNumber ?? ''],
      ['العملة', settings.currency],
      ['التقرير', def.title],
      ['تاريخ التقرير', new Date().toISOString()],
    ]);
    info.getColumn(1).width = 24;
    info.getColumn(2).width = 48;
    info.getColumn(1).eachCell((cell) => {
      cell.font = { bold: true };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'E2E8F0' },
      };
    });

    const sheet = workbook.addWorksheet(def.title, {
      views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }],
    });
    sheet.addRow(def.headers);
    for (const row of rows) sheet.addRow(row);
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: '059669' },
    };
    headerRow.alignment = { vertical: 'middle', horizontal: 'right' };
    sheet.columns = def.headers.map((header) => ({
      width: Math.min(Math.max(header.length + 6, 14), 45),
    }));

    const buffer = await workbook.xlsx.writeBuffer();
    return {
      buffer: Buffer.from(buffer),
      filename: `${def.key}_${new Date().toISOString().slice(0, 10)}.xlsx`,
    };
  }

  /**
   * يولّد ملف Word (.doc بمحتوى MHTML) — نقل حرفي لأسلوب المرجع
   * (exportToWord): ترويسة المصنع + جدول البيانات. بلا مكتبات.
   */
  async exportWord(
    entity: string,
  ): Promise<{ content: string; filename: string }> {
    const def = entityOf(entity);
    const [rows, settings] = await Promise.all([
      def.load(this.prisma),
      this.factorySettings.getSettings(),
    ]);

    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const headerCells = def.headers
      .map((h) => `<th>${escapeHtml(h)}</th>`)
      .join('');
    const bodyRows = rows
      .map(
        (row) =>
          `<tr>${row.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`,
      )
      .join('\n');

    const factoryHeader = settings.factoryName
      ? `<div style="text-align:center; margin-bottom:20px; border-bottom:2px solid #0f172a; padding-bottom:10px;">
        <h1 style="margin:0; color:#0f172a; font-size:22px;">${escapeHtml(settings.factoryName)}</h1>
        <div style="margin-top:6px; font-size:11px; color:#475569;">
          ${settings.phone ? `&#9742; ${escapeHtml(settings.phone)}` : ''}
          ${settings.address ? ` &bull; ${escapeHtml(settings.address)}` : ''}
          ${settings.taxNumber ? ` &bull; سجل ضريبي: ${escapeHtml(settings.taxNumber)}` : ''}
        </div>
      </div>`
      : '';

    const html = `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word"
      xmlns="http://www.w3.org/TR/REC-html40">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(def.title)}</title>
  <!--[if gte mso 9]>
  <xml>
    <w:WordDocument>
      <w:View>Print</w:View>
      <w:Zoom>90</w:Zoom>
      <w:DoNotOptimizeForBrowser/>
    </w:WordDocument>
  </xml>
  <![endif]-->
  <style>
    @page { size: A4; margin: 1.5cm; }
    body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; direction: rtl; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #94a3b8; padding: 6px 8px; font-size: 12px; text-align: right; }
    th { background: #059669; color: #ffffff; }
    tr:nth-child(even) td { background: #f1f5f9; }
    .meta { text-align: center; color: #64748b; font-size: 11px; margin: 8px 0 16px; }
  </style>
</head>
<body dir="rtl">
  ${factoryHeader}
  <h2 style="text-align:center; margin:0 0 4px;">${escapeHtml(def.title)}</h2>
  <div class="meta">عدد السجلات: ${rows.length} — تاريخ التصدير: ${escapeHtml(now)}</div>
  <table>
    <thead><tr>${headerCells}</tr></thead>
    <tbody>
${bodyRows}
    </tbody>
  </table>
</body>
</html>`;

    return {
      content: html,
      filename: `${def.key}_${new Date().toISOString().slice(0, 10)}.doc`,
    };
  }
}
