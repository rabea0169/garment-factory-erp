import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { generateDocumentCode } from '../../core/common/codes.util';
import {
  computeRequestHash,
  createIdempotencyKey,
  isIdempotencyUniqueViolation,
  storeIdempotencyResponse,
  tryReplayIdempotencyKey,
} from '../../core/common/idempotency.util';
import {
  ImportEntityDef,
  getImportEntities,
  getImportEntity,
  matchColumn,
  resolveEnumValue,
} from './import-entities';
import { parseSpreadsheet } from './parse/spreadsheet-parser.util';

/**
 * SELIM-ERP W2 — خدمة الاستيراد (تقلد ImportWizard في Selim ERP).
 *
 * التدفق ثنائي الخطوات (نفس معالج Selim):
 * 1. **معاينة** (POST /import/preview): رفع الملف (CSV/XLSX) → تحليل +
 *    تحقق صف-بصف (حقول مطلوبة/أنواع/تكرارات داخل الملف وخارجًا) بلا أي
 *    كتابة — الجوال يعرض جدول المعاينة بالصفوف الحمراء/الخضراء.
 * 2. **تنفيذ** (POST /import/commit): الصفوف الصالحة فقط تُنشأ داخل
 *    معاملة واحدة (تزامن مع التحقق الخادمي مجددًا — لا ثقة بالعميل)،
 *    مع idempotency لإعادة المحاولة الآمنة.
 *
 * الأدوار: اتحاد أدوار الإنشاء للكيانات الأربعة على مستوى الكنترولر،
 * ثم تحقق دقيق داخل الخدمة بأن دور المستخدم يملك إنشاء الكيان المحدد.
 */

const IDEMPOTENCY_SCOPE_IMPORT = 'data-import';

/** خطأ تحقق واحد في صف. */
export interface RowError {
  row: number;
  field: string;
  message: string;
}

/** صف معاينة واحد: بيانات مطابقة + حالة. */
export interface PreviewRow {
  row: number;
  data: Record<string, string>;
  valid: boolean;
  errors: RowError[];
}

/** نتيجة المعاينة. */
export interface PreviewResult {
  entityType: string;
  fileName?: string;
  headers: string[];
  /** رؤوس غير معروفة (تجاهلت) + أعمدة مطلوبة مفقودة. */
  unmappedHeaders: string[];
  missingRequiredColumns: string[];
  rows: PreviewRow[];
  validCount: number;
  invalidCount: number;
}

@Injectable()
export class DataImportService {
  constructor(private readonly prisma: PrismaService) {}

  /** وصف الكيانات المدعومة (لشاشة الاختيار في الجوال) — قراءة صرفة. */
  describeEntities() {
    return getImportEntities().map((def) => ({
      type: def.type,
      title: def.title,
      roles: def.roles,
      uniqueKeys: def.uniqueKeys,
      columns: def.columns.map((c) => ({
        key: c.key,
        header: c.header,
        required: c.required,
        type: c.type,
        hint: c.hint,
      })),
    }));
  }

  /**
   * SELIM-ERP W3 — قالب الاستيراد XLSX (نقل من GET /api/import/template
   * في Selim): مصنف بورقة RTL لكل كيان مدعوم، صف رؤوس مُنسّق بأعمدة
   * الكيان نفسها (نفس عناوين المعالج حرفيًا) + قوائم منسدلة لأعمدة
   * enum (تخصصات العمال) + تعليق تلميح على الأعمدة المطلوبة.
   * الأعمدة الإضافية بلا رأس — يرشد المستخدم لأخذها من هنا.
   */
  async generateTemplate(): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Garment Factory ERP';

    for (const def of getImportEntities()) {
      const worksheet = workbook.addWorksheet(def.title, {
        views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }],
      });
      const headers = def.columns.map((c) =>
        c.required ? `${c.header} *` : c.header,
      );
      worksheet.addRow(headers);
      const headerRow = worksheet.getRow(1);
      headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      headerRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: '059669' },
      };
      headerRow.alignment = { vertical: 'middle', horizontal: 'right' };
      worksheet.columns = def.columns.map((c) => ({
        width: Math.min(Math.max(c.header.length + 6, 14), 45),
      }));

      // أعمدة enum: قائمة منسدلة بالقيم العربية المقبولة (exceljs: تعيين
      // dataValidation على كل خلية في نطاق 2..1001 — لا API لنطاق كامل).
      def.columns.forEach((column, index) => {
        if (column.type === 'enum' && column.enumValues) {
          const values = Object.values(column.enumValues).map(
            (synonyms) => synonyms[0],
          );
          const letter = worksheet.getColumn(index + 1).letter;
          for (let row = 2; row <= 201; row++) {
            worksheet.getCell(`${letter}${row}`).dataValidation = {
              type: 'list',
              allowBlank: true,
              formulae: [`"${values.join(',')}"`],
              showErrorMessage: true,
              error: 'اختر قيمة من القائمة المنسدلة',
            };
          }
        }
      });
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  /** الخطوة 1: معاينة بلا كتابة — تحليل + تحقق كامل. */
  async preview(
    buffer: Buffer,
    filename: string | undefined,
    entityType: string,
    role: UserRole,
  ): Promise<PreviewResult> {
    const def = this.authorize(entityType, role);
    const sheet = await parseSpreadsheet(buffer, filename);
    const { mappedHeaders, unmappedHeaders, missingRequiredColumns } =
      this.mapHeaders(def, sheet.headers);

    const rows: PreviewRow[] = [];
    for (let i = 0; i < sheet.rows.length; i++) {
      const raw = sheet.rows[i];
      const data: Record<string, string> = {};
      for (let c = 0; c < sheet.headers.length; c++) {
        const key = mappedHeaders[c];
        if (key) data[key] = (raw[c] ?? '').trim();
      }
      const errors = this.validateRow(def, data, i + 2, []);
      // أرقام الصفوف تبدأ من 2 (سطر الرؤوس هو 1) — توافق عرض الملف.
      rows.push({ row: i + 2, data, valid: errors.length === 0, errors });
    }

    // تكرارات داخل الملف على المفاتيح الفريدة.
    this.flagInFileDuplicates(def, rows);

    // تكرارات مع القاعدة الحالية (bulk query واحدة لكل حقل فريد).
    await this.flagDbDuplicates(def, rows);

    const validCount = rows.filter((r) => r.valid).length;
    return {
      entityType: def.type,
      fileName: filename,
      headers: sheet.headers,
      unmappedHeaders,
      missingRequiredColumns,
      rows,
      validCount,
      invalidCount: rows.length - validCount,
    };
  }

  /** الخطوة 2: تنفيذ الصفوف الصالحة — تحقق خادمي مجدد داخل معاملة. */
  async commit(
    entityType: string,
    rowsData: Record<string, string>[],
    userId: string,
    role: UserRole,
    idempotencyKey?: string,
  ) {
    const def = this.authorize(entityType, role);

    const requestHash = computeRequestHash({
      operation: IDEMPOTENCY_SCOPE_IMPORT,
      userId,
      entityType,
      rows: rowsData,
    });
    const replay = await tryReplayIdempotencyKey(
      this.prisma,
      idempotencyKey,
      IDEMPOTENCY_SCOPE_IMPORT,
      requestHash,
    );
    if (replay) return replay;

    try {
      return await this.prisma.$transaction(async (tx) => {
        await createIdempotencyKey(
          tx,
          idempotencyKey,
          IDEMPOTENCY_SCOPE_IMPORT,
          requestHash,
        );

        const results: {
          row: number;
          status: 'created' | 'skipped';
          code?: string;
          errors?: RowError[];
        }[] = [];
        const created: string[] = [];

        // أرقام الصفوف تُحفظ من الترتيب المرسل (الجوال يرسل ترتيب الملف).
        for (let i = 0; i < rowsData.length; i++) {
          const data = rowsData[i];
          // تحقق مجدد داخل المعاملة — بلا ثقة بالعميل.
          const dbErrors = await this.checkDbDuplicatesForRow(def, data);
          const errors = this.validateRow(def, data, i + 2, dbErrors);
          if (errors.length > 0) {
            results.push({ row: i + 2, status: 'skipped', errors });
            continue;
          }
          const create = this.buildCreateData(def, data);
          const record = await this.createRecord(def, create, tx);
          results.push({ row: i + 2, status: 'created', code: record.code });
          created.push(record.id);
        }

        await tx.activityLog.create({
          data: {
            userId,
            action: 'DATA_IMPORT_COMPLETED',
            module: 'IMPORT',
            details: {
              entityType: def.type,
              totalRows: rowsData.length,
              createdCount: created.length,
              skippedCount: results.length - created.length,
            },
          },
        });

        const response = {
          entityType: def.type,
          total: rowsData.length,
          created: created.length,
          skipped: results.length - created.length,
          results,
        };
        await storeIdempotencyResponse(tx, idempotencyKey, response);
        return response;
      });
    } catch (error) {
      if (idempotencyKey && isIdempotencyUniqueViolation(error)) {
        const replayed = await tryReplayIdempotencyKey(
          this.prisma,
          idempotencyKey,
          IDEMPOTENCY_SCOPE_IMPORT,
          requestHash,
        );
        if (replayed) return replayed;
      }
      throw error;
    }
  }

  /** تحقق الدور مقابل أدوار الكيان — لا ترقية صلاحيات عبر الاستيراد. */
  private authorize(entityType: string, role: UserRole): ImportEntityDef {
    let def: ImportEntityDef;
    try {
      def = getImportEntity(entityType);
    } catch {
      throw new NotFoundException(`نوع استيراد غير مدعوم: ${entityType}`);
    }
    if (role !== UserRole.SUPER_ADMIN && !def.roles.includes(role)) {
      throw new ForbiddenException(`دورك لا يملك صلاحية استيراد ${def.title}`);
    }
    return def;
  }

  /** ربط الرؤوس بمفاتيح الحقول — يرجع الخريطة والتقارير. */
  private mapHeaders(def: ImportEntityDef, headers: string[]) {
    const mappedHeaders: (string | null)[] = [];
    const unmappedHeaders: string[] = [];
    const mappedKeys = new Set<string>();
    for (const header of headers) {
      const key = matchColumn(def, header);
      mappedHeaders.push(key);
      if (!key && header.trim() !== '') unmappedHeaders.push(header);
      if (key) mappedKeys.add(key);
    }
    const missingRequiredColumns = def.columns
      .filter((c) => c.required && !mappedKeys.has(c.key))
      .map((c) => c.header);
    return { mappedHeaders, unmappedHeaders, missingRequiredColumns };
  }

  /** تحقق صف واحد: الحقول + الأنواع + أخطاء قاعدة جاهزة (dbErrors). */
  private validateRow(
    def: ImportEntityDef,
    data: Record<string, string>,
    rowNumber: number,
    dbErrors: RowError[],
  ): RowError[] {
    const errors: RowError[] = [];
    for (const col of def.columns) {
      const value = (data[col.key] ?? '').trim();
      if (col.required && value === '') {
        errors.push({
          row: rowNumber,
          field: col.key,
          message: `${col.header} مطلوب`,
        });
        continue;
      }
      if (value === '') continue;
      if (col.type === 'number') {
        const num = Number(value);
        if (!Number.isFinite(num) || num < 0) {
          errors.push({
            row: rowNumber,
            field: col.key,
            message: `${col.header} يجب أن يكون رقمًا غير سالب`,
          });
        }
      } else if (col.type === 'phone') {
        // هاتف مصري متساهل: 8-15 رقمًا مع + اختياري.
        if (!/^\+?\d{8,15}$/.test(value.replace(/[\s-]/g, ''))) {
          errors.push({
            row: rowNumber,
            field: col.key,
            message: `${col.header} غير صالح`,
          });
        }
      } else if (col.type === 'enum') {
        const resolved = resolveEnumValue(col, value);
        if (!resolved) {
          errors.push({
            row: rowNumber,
            field: col.key,
            message: `${col.header} غير معروف`,
          });
        }
      } else if (col.type === 'date') {
        if (Number.isNaN(Date.parse(value))) {
          errors.push({
            row: rowNumber,
            field: col.key,
            message: `${col.header} تاريخ غير صالح`,
          });
        }
      }
    }
    return [...errors, ...dbErrors];
  }

  /** تعليم تكرارات المفاتيح الفريدة داخل الملف نفسه. */
  private flagInFileDuplicates(def: ImportEntityDef, rows: PreviewRow[]) {
    for (const key of def.uniqueKeys) {
      const seen = new Map<string, number>();
      for (const row of rows) {
        const value = (row.data[key] ?? '').trim();
        if (value === '') continue;
        const previous = seen.get(value);
        if (previous !== undefined) {
          row.valid = false;
          row.errors.push({
            row: row.row,
            field: key,
            message: `مكرر داخل الملف (سبق في الصف ${previous})`,
          });
        } else {
          seen.set(value, row.row);
        }
      }
    }
  }

  /** فحص التكرار مع القاعدة الحالية (bulk) — يعلّم الصفوف المطابقة. */
  private async flagDbDuplicates(def: ImportEntityDef, rows: PreviewRow[]) {
    for (const key of def.uniqueKeys) {
      const values = rows
        .map((r) => (r.data[key] ?? '').trim())
        .filter((v) => v !== '');
      if (values.length === 0) continue;
      const existing = await this.findExistingValues(def, key, values);
      if (existing.size === 0) continue;
      for (const row of rows) {
        const value = (row.data[key] ?? '').trim();
        if (value !== '' && existing.has(value)) {
          row.valid = false;
          row.errors.push({
            row: row.row,
            field: key,
            message: 'موجود مسبقًا في النظام',
          });
        }
      }
    }
  }

  /** أخطاء القاعدة لصف واحد أثناء التنفيذ (داخل المعاملة). */
  private async checkDbDuplicatesForRow(
    def: ImportEntityDef,
    data: Record<string, string>,
  ): Promise<RowError[]> {
    const errors: RowError[] = [];
    for (const key of def.uniqueKeys) {
      const value = (data[key] ?? '').trim();
      if (value === '') continue;
      const existing = await this.findExistingValues(def, key, [value]);
      if (existing.has(value)) {
        errors.push({ row: 0, field: key, message: 'موجود مسبقًا في النظام' });
      }
    }
    return errors;
  }

  /** قيم موجودة في القاعدة لمفاتيح فريدة (حسب الكيان). */
  private async findExistingValues(
    def: ImportEntityDef,
    key: string,
    values: string[],
  ): Promise<Set<string>> {
    const set = new Set<string>();
    if (def.type === 'products') {
      if (key === 'code') {
        const found = await this.prisma.product.findMany({
          where: { code: { in: values } },
          select: { code: true },
        });
        found.forEach((f) => set.add(f.code));
      } else if (key === 'barcode') {
        const found = await this.prisma.product.findMany({
          where: { barcode: { in: values } },
          select: { barcode: true },
        });
        found.forEach((f) => f.barcode && set.add(f.barcode));
      }
    } else if (def.type === 'customers') {
      const where =
        key === 'code' ? { code: { in: values } } : { phone: { in: values } };
      const found = await this.prisma.customer.findMany({
        where,
        select: { code: true, phone: true },
      });
      found.forEach((f) => {
        set.add(f.code);
        if (f.phone) set.add(f.phone);
      });
    } else if (def.type === 'suppliers') {
      const where =
        key === 'code' ? { code: { in: values } } : { phone: { in: values } };
      const found = await this.prisma.supplier.findMany({
        where,
        select: { code: true, phone: true },
      });
      found.forEach((f) => {
        set.add(f.code);
        if (f.phone) set.add(f.phone);
      });
    } else if (def.type === 'workers') {
      const where =
        key === 'code'
          ? { code: { in: values } }
          : { nationalId: { in: values } };
      const found = await this.prisma.worker.findMany({
        where,
        select: { code: true, nationalId: true },
      });
      found.forEach((f) => {
        set.add(f.code);
        if (f.nationalId) set.add(f.nationalId);
      });
    }
    return set;
  }

  /** تحويل بيانات الصف إلى بيانات إنشاء (بعد اجتياز التحقق). */
  private buildCreateData(def: ImportEntityDef, data: Record<string, string>) {
    const create: Record<string, unknown> = {};
    for (const col of def.columns) {
      const value = (data[col.key] ?? '').trim();
      if (value === '') continue;
      if (col.type === 'number') {
        create[col.key] = Number(value);
      } else if (col.type === 'enum') {
        create[col.key] = resolveEnumValue(col, value);
      } else {
        create[col.key] = value;
      }
    }
    // قيم افتراضية مطابقة لمسارات الإنشاء الأصلية.
    if (def.type === 'products' && create.wholesalePrice === undefined) {
      create.wholesalePrice = create.retailPrice;
    }
    if (def.type === 'workers' && create.pieceRate === undefined) {
      create.pieceRate = 0;
    }
    return create;
  }

  /** إنشاء السجل بالكيان المناسب — توليد الكود عند غيابه. */
  private async createRecord(
    def: ImportEntityDef,
    create: Record<string, unknown>,
    tx: Prisma.TransactionClient,
  ): Promise<{ id: string; code: string }> {
    if (!create.code) {
      create.code = generateDocumentCode(def.codePrefix);
    }
    // تحويل موقّع: بيانات الصف تحقّقت أعلاه (buildCreateData + validateRow)
    // — النقل عبر UncheckedCreateInput لا يمر بعلاقات.
    if (def.type === 'products') {
      return tx.product.create({
        data: create as Prisma.ProductUncheckedCreateInput,
      });
    }
    if (def.type === 'customers') {
      return tx.customer.create({
        data: create as Prisma.CustomerUncheckedCreateInput,
      });
    }
    if (def.type === 'suppliers') {
      return tx.supplier.create({
        data: create as Prisma.SupplierUncheckedCreateInput,
      });
    }
    return tx.worker.create({
      data: create as Prisma.WorkerUncheckedCreateInput,
    });
  }
}
