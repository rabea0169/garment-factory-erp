import * as ExcelJS from 'exceljs';

/**
 * SELIM-ERP W2 — محلل جداول البيانات لمعالج الاستيراد (ImportWizard.tsx
 * في Selim ERP): يقرأ CSV أو XLSX ويحوله إلى { headers, rows } نصية.
 *
 * تصميم:
 * - CSV: محلل مخصص يتعامل مع علامات الاقتباس ("") والفواصل داخل
 *   الاقتباس وCRLF وBOM — ويتعرف تلقائيًا على الفاصل (`,` أو `;`).
 * - XLSX: exceljs — يقرأ أول ورقة فقط؛ قيم الخلايا تُحوَّل لنص (null → '').
 * - السطر الأول = رؤوس الأعمدة (تُنظّف من الفراغات)؛ الأسطر الفارغة
 *   تُتخطى؛ حد أقصى 2000 صف بيانات (حد المعالج — يناسب دفعات UAT).
 */

/** حد صفوف البيانات لكل ملف استيراد. */
export const MAX_IMPORT_ROWS = 2000;

export interface ParsedSheet {
  headers: string[];
  rows: string[][];
}

/** هل الامتداد xlsx؟ (يُعتمد على الاسم لا mime — المتصفحات تتفاوت). */
export function isXlsx(filename: string | undefined): boolean {
  return (filename ?? '').toLowerCase().endsWith('.xlsx');
}

/**
 * تحليل ملف CSV/XLSX إلى رؤوس + صفوف نصية.
 * @param buffer محتوى الملف الخام.
 * @param filename اسم الملف (لتمييز xlsx).
 */
export async function parseSpreadsheet(
  buffer: Buffer,
  filename: string | undefined,
): Promise<ParsedSheet> {
  if (isXlsx(filename)) {
    return parseXlsx(buffer);
  }
  return { headers: parseCsvHeader(buffer), rows: parseCsvRows(buffer) };
}

/** إزالة BOM والفراغات الطرفية من قيمة رأس. */
function cleanHeader(value: string): string {
  return value.replace(/^\uFEFF/, '').trim();
}

/** استخراج رؤوس الأعمدة من أول سطر CSV (مع كشف الفاصل). */
function parseCsvHeader(buffer: Buffer): string[] {
  const text = buffer.toString('utf8').replace(/^\uFEFF/, '');
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = detectDelimiter(firstLine);
  return splitCsvLine(firstLine, delimiter).map(cleanHeader);
}

/** صفوف بيانات CSV (بدون سطر الرؤوس) — الأسطر الفارغة تُتخطى. */
function parseCsvRows(buffer: Buffer): string[][] {
  const text = buffer.toString('utf8').replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/);
  if (lines.length < 2) return [];
  const delimiter = detectDelimiter(lines[0] ?? '');
  const rows: string[][] = [];
  let count = 0;
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i] || !lines[i].trim()) continue;
    if (++count > MAX_IMPORT_ROWS) break;
    rows.push(splitCsvLine(lines[i], delimiter).map((cell) => cell.trim()));
  }
  return rows;
}

/** كشف الفاصل: `,` الافتراضي؛ `;` إذا تفوق عددًا في سطر الرؤوس. */
function detectDelimiter(line: string): string {
  const commas = countOutsideQuotes(line, ',');
  const semicolons = countOutsideQuotes(line, ';');
  return semicolons > commas ? ';' : ',';
}

/** عدّ ظهور حرف خارج علامات الاقتباس. */
function countOutsideQuotes(line: string, char: string): number {
  let count = 0;
  let inQuotes = false;
  for (const c of line) {
    if (c === '"') inQuotes = !inQuotes;
    else if (c === char && !inQuotes) count++;
  }
  return count;
}

/** تقسيم سطر CSV مع دعم الاقتباس المزدوج داخل الحقول. */
function splitCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        // "" داخل الاقتباس = علامة اقتباس حرفية.
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delimiter) {
      cells.push(current);
      current = '';
    } else {
      current += c;
    }
  }
  cells.push(current);
  return cells;
}

/** تحليل XLSX عبر exceljs — أول ورقة فقط. */
async function parseXlsx(buffer: Buffer): Promise<ParsedSheet> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return { headers: [], rows: [] };

  const headers: string[] = [];
  const headerRow = sheet.getRow(1);
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    headers[colNumber - 1] = cleanHeader(cellToString(cell.value));
  });
  // ملء الفجوات إن تخللت أعمدة فارغة.
  for (let i = 0; i < headers.length; i++) {
    if (headers[i] === undefined) headers[i] = '';
  }

  const rows: string[][] = [];
  let count = 0;
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    if (count >= MAX_IMPORT_ROWS) return;
    count++;
    const values: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      values[colNumber - 1] = cellToString(cell.value);
    });
    for (let i = 0; i < headers.length; i++) {
      if (values[i] === undefined) values[i] = '';
    }
    // تخطي الصفوف الفارغة تمامًا.
    if (values.some((v) => v.trim() !== '')) rows.push(values);
  });
  return { headers, rows };
}

/** قيمة غير معروفة إلى نص بأمان (النص/الرقم/التاريخ فقط). */
function safeStringify(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return '';
}

/** قيمة خلية exceljs إلى نص (الصيغ تُقيَّم بالنتيجة المخزنة). */
function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  const asUnknown = value as unknown;
  if (asUnknown instanceof Date) return asUnknown.toISOString().slice(0, 10);
  if (typeof asUnknown === 'object') {
    const obj = asUnknown as Record<string, unknown>;
    if ('result' in obj) return safeStringify(obj.result);
    if ('richText' in obj && Array.isArray(obj.richText)) {
      return (obj.richText as { text?: string }[])
        .map((t) => t.text ?? '')
        .join('');
    }
    return safeStringify(obj.text);
  }
  return safeStringify(asUnknown);
}
