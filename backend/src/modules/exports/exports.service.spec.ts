import 'reflect-metadata';
import * as ExcelJS from 'exceljs';
import type { Response } from 'express';
import { BadRequestException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { ExportsService } from './exports.service';
import { ExportsController } from './exports.controller';
import { PrismaService } from '../../prisma/prisma.service';
import { createPrismaMock } from '../../../test/helpers/prisma-mock';
import { FactorySettingsService } from '../system/factory-settings.service';

/**
 * SELIM-ERP W3 — اختبارات وحدة التصدير:
 * - Excel: XLSX صالح (بصمة PK) بورقة معلومات المصنع + ورقة الكيان RTL.
 * - Word: MHTML بنفس بنية المرجع (مسميات Office) + تهريب HTML.
 * - كيان غير معروف → BadRequest.
 * - أدوار الكيانات:_rolesFor + فحص المعالج (Forbidden).
 */

const SETTINGS = {
  id: 'factory',
  factoryName: 'مصنع سليم',
  factoryNameEn: null,
  slogan: null,
  phone: '01000000000',
  whatsapp: null,
  email: null,
  address: 'القاهرة',
  taxNumber: '123-456',
  commercialRegister: null,
  logo: null,
  currency: 'ج.م',
  invoicePrefix: 'INV-',
  invoiceFooter: null,
  defaultPaperSize: 'A4',
  enableInvoiceQr: true,
  taxRate: { toString: () => '0' },
  lastBackupAt: null,
  updatedAt: new Date(),
};

describe('ExportsService — التصدير (SELIM W3)', () => {
  let service: ExportsService;
  let prisma: ReturnType<typeof createPrismaMock>;

  beforeEach(() => {
    prisma = createPrismaMock();
    const factorySettings = {
      getSettings: jest.fn().mockResolvedValue(SETTINGS),
    } as unknown as FactorySettingsService;
    service = new ExportsService(
      prisma as unknown as PrismaService,
      factorySettings,
    );

    // بيانات افتراضية فارغة لكل الكيانات.
    prisma.customer.findMany.mockResolvedValue([]);
    prisma.supplier.findMany.mockResolvedValue([]);
    prisma.product.findMany.mockResolvedValue([]);
    prisma.worker.findMany.mockResolvedValue([]);
    prisma.expense.findMany.mockResolvedValue([]);
    prisma.rawMaterial.findMany.mockResolvedValue([]);
    prisma.salesOrder.findMany.mockResolvedValue([]);
    prisma.purchaseOrder.findMany.mockResolvedValue([]);
  });

  it('كيان غير معروف → BadRequest بقائمة المتاح', async () => {
    await expect(service.exportExcel('nope')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.exportWord('nope')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('exportExcel: ملف XLSX صالح (PK) بورقتين — معلومات المصنع ثم العملاء RTL', async () => {
    prisma.customer.findMany.mockResolvedValue([
      {
        code: 'CUST-1',
        name: 'عميل <اختبار> "تهريب"',
        phone: '01000000000',
        address: null,
        balance: '150.5',
        creditLimit: null,
        isActive: true,
      },
    ]);

    const { buffer, filename } = await service.exportExcel('customers');

    expect(buffer.subarray(0, 2).toString('latin1')).toBe('PK');
    expect(filename).toMatch(/^customers_\d{4}-\d{2}-\d{2}\.xlsx$/);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(
      buffer as unknown as Parameters<ExcelJS.Workbook['xlsx']['load']>[0],
    );
    expect(workbook.worksheets.map((ws) => ws.name)).toEqual([
      'معلومات المصنع',
      'العملاء',
    ]);
    // ترويسة معلومات المصنع تحمل اسم المصنع من الإعدادات.
    const info = workbook.getWorksheet('معلومات المصنع');
    expect(info?.getRow(1).getCell(2).text).toBe('مصنع سليم');
    // صف البيانات كامل داخل ورقة العملاء.
    const sheet = workbook.getWorksheet('العملاء');
    expect(sheet?.actualRowCount).toBe(2); // رؤوس + صف واحد
    expect(sheet?.getRow(2).getCell(2).value).toBe('عميل <اختبار> "تهريب"');
    expect(sheet?.views?.[0]?.rightToLeft).toBe(true);
  });

  it('exportWord: MHTML بمسميات Office + ترويسة المصنع + تهريب HTML', async () => {
    prisma.worker.findMany.mockResolvedValue([
      {
        code: 'WKR-1',
        name: 'أحمد <b>خياط</b>',
        specialty: 'SEWING',
        isActive: true,
      },
    ]);

    const { content, filename } = await service.exportWord('workers');

    expect(filename).toMatch(/^workers_\d{4}-\d{2}-\d{2}\.doc$/);
    // نفس بنية المرجع: مسميات Office + View Print + dir rtl.
    expect(content).toContain(
      'xmlns:w="urn:schemas-microsoft-com:office:word"',
    );
    expect(content).toContain('<w:View>Print</w:View>');
    expect(content).toContain('dir="rtl"');
    // ترويسة المصنع من الإعدادات + السجل الضريبي.
    expect(content).toContain('مصنع سليم');
    expect(content).toContain('123-456');
    // تهريب قيم البيانات (نفس قاعدة أمان المرجع).
    expect(content).not.toContain('<b>خياط</b>');
    expect(content).toContain('&lt;b&gt;خياط&lt;/b&gt;');
  });

  it('الكيانات الثمانية كلها مُعرَّفة بأدوارها', () => {
    expect(ExportsService.entityKeys()).toEqual([
      'customers',
      'suppliers',
      'products',
      'workers',
      'expenses',
      'inventory',
      'sales',
      'purchases',
    ]);
    expect(ExportsService.entityTitle('inventory')).toContain('المخزون');
  });
});

describe('ExportsController — أدوار التصدير (SELIM W3)', () => {
  it('rolesFor: كل كيان له أدوار، والكيان المجهول null', () => {
    expect(ExportsController.rolesFor('workers')).toContain(
      UserRole.HR_MANAGER,
    );
    expect(ExportsController.rolesFor('unknown')).toBeNull();
  });

  it('assertAllowed: كاشير يصدّر العملاء؛ الكاشير لا يصدّر العمال؛ SUPER_ADMIN يتجاوز', async () => {
    const exportExcelMock = jest
      .fn()
      .mockResolvedValue({ buffer: Buffer.from('x'), filename: 'workers.doc' });
    const service = {
      exportExcel: exportExcelMock,
    } as unknown as ExportsService;
    const controller = new ExportsController(service);
    const fakeRes = { set: jest.fn() } as unknown as Response;

    // كاشير + عمال → مرفوض (دور HR فقط).
    await expect(
      controller.exportExcel(
        'workers',
        {
          id: 'u-1',
          role: UserRole.CASHIER,
        },
        fakeRes,
      ),
    ).rejects.toThrow('صلاحية');

    // SUPER_ADMIN + أي كيان → يمر.
    await controller.exportExcel(
      'workers',
      { id: 'u-1', role: UserRole.SUPER_ADMIN },
      fakeRes,
    );
    expect(exportExcelMock).toHaveBeenCalledWith('workers');

    // كاشير + العملاء → مسموح (أدوار المبيعات).
    await controller.exportExcel(
      'customers',
      { id: 'u-1', role: UserRole.CASHIER },
      fakeRes,
    );
    expect(exportExcelMock).toHaveBeenCalledWith('customers');
  });
});
