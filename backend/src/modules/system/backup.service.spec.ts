import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BackupService,
  BACKUP_ORDER,
  RESTORE_CONFIRM_PHRASE,
} from './backup.service';
import { PrismaService } from '../../prisma/prisma.service';
import { createPrismaMock } from '../../../test/helpers/prisma-mock';
import { FactorySettingsService } from './factory-settings.service';

/**
 * SELIM-ERP W2 — اختبارات النسخ الاحتياطي/الاستعادة:
 * - **بوابة التغطية**: كل موديل في schema.prisma موجود في BACKUP_ORDER
 *   مرة واحدة بالضبط — إضافة موديل جديد دون تسجيله هنا تفشل فورًا.
 * - لا تكرارات في الترتيب نفسه.
 * - الاستعادة: عبارة التأكيد + رفض ملف بلا مستخدمين + إصدار صيغة خاطئ.
 */

/** استخراج أسماء الموديلات من schema.prisma (نفس ملف المصدر الحي). */
function schemaModels(): string[] {
  const schemaPath = join(__dirname, '../../../prisma/schema.prisma');
  const content = readFileSync(schemaPath, 'utf8');
  return Array.from(content.matchAll(/^model (\w+) \{/gm)).map((m) => m[1]);
}

describe('BackupService — النسخ الاحتياطي (SELIM W2)', () => {
  let service: BackupService;
  let prisma: ReturnType<typeof createPrismaMock>;
  const tx = {} as unknown as ReturnType<typeof createPrismaMock>;

  /** موك موسّع: يضيف/يوحّد مندوبي كل الجداول الـ 75 مع قيم افتراضية. */
  function createBackupMock(): ReturnType<typeof createPrismaMock> {
    const base = createPrismaMock() as unknown as Record<string, unknown>;
    for (const spec of BACKUP_ORDER) {
      const delegate = spec.model.charAt(0).toLowerCase() + spec.model.slice(1);
      const existing = (base[delegate] ?? {}) as Record<
        string,
        jest.Mock | undefined
      >;
      base[delegate] = {
        ...existing,
        findMany: (existing.findMany ?? jest.fn()).mockResolvedValue([]),
        count: (existing.count ?? jest.fn()).mockResolvedValue(0),
        createMany:
          existing.createMany ?? jest.fn().mockResolvedValue({ count: 0 }),
      };
    }
    // $executeRawUnsafe غير موجود في الموك الموحد (restore يحتاجه).
    base.$executeRawUnsafe = jest.fn().mockResolvedValue(0);
    return base as unknown as ReturnType<typeof createPrismaMock>;
  }

  beforeEach(() => {
    prisma = createBackupMock();
    prisma.$transaction.mockImplementation(
      (arg: (client: typeof prisma) => Promise<unknown>): Promise<unknown> =>
        arg(tx),
    );
    Object.assign(tx, prisma);
    // W3: موك خفيف لإعدادات المصنع — markBackupDone تُستدعى بعد التصدير
    // (لا ننقل سلوك فشلها إلى فشل النسخة — تجاهل مقصود).
    const factorySettings = {
      markBackupDone: jest.fn().mockResolvedValue(undefined),
    } as unknown as FactorySettingsService;
    service = new BackupService(
      prisma as unknown as PrismaService,
      factorySettings,
    );
  });

  it('بوابة التغطية: BACKUP_ORDER يغطي كل موديلات schema مرة واحدة', () => {
    const models = schemaModels();
    const ordered = BACKUP_ORDER.map((s) => s.model);
    // لا تكرار داخلي.
    expect(new Set(ordered).size).toBe(ordered.length);
    // كل موديل schema موجود (لا نسيان — فشل يعني موديلًا لن يُنسخ/يُستعاد).
    const missing = models.filter((m) => !ordered.includes(m));
    expect(missing).toEqual([]);
    // ولا موديل وهمي (حُذف من schema وبقي هنا).
    const stale = ordered.filter((m) => !models.includes(m));
    expect(stale).toEqual([]);
  });

  /**
   * حارس ترتيب FK (انحدار بروفة 2026-09-14): كل حقل @relation يشير إلى
   * نموذج آخر يجب أن يأتي هدفه قبل صاحبه في BACKUP_ORDER — وإلا فشل
   * الاستعادة بـ P2003 على أي قاعدة فيها تلك البيانات (حدث فعلًا مع
   * FiscalPeriod.createdById → User قبل الإصلاح). المراجع الذاتية
   * (Account/RefreshToken/JournalEntry) تُحرس بفرز insertSortBy إلزامي.
   */
  it('حارس الترتيب: كل FK بين-نماذج يُدرج هدفه قبله + المراجع الذاتية مفروزة', () => {
    const schemaPath = join(__dirname, '../../../prisma/schema.prisma');
    const content = readFileSync(schemaPath, 'utf8');
    const fkMap = new Map<string, string[]>(); // model → [target, ...]
    const selfRef = new Set<string>();
    for (const block of content.matchAll(/model (\w+) \{([\s\S]*?)\n\}/g)) {
      const [, model, body] = block;
      const targets: string[] = [];
      for (const line of body.split('\n')) {
        const rel = line.match(
          /^\s*(\w+)\??\s+(\w+)\??\s+@relation\((?:"\w+",\s*)?fields:\s*\[(\w+)\]/,
        );
        if (rel) {
          const [, , target, field] = rel;
          void field;
          targets.push(target);
          if (target === model) selfRef.add(model);
        }
      }
      if (targets.length > 0) fkMap.set(model, targets);
    }
    const position = new Map(BACKUP_ORDER.map((s, i) => [s.model, i]));
    const violations: string[] = [];
    for (const spec of BACKUP_ORDER) {
      for (const target of fkMap.get(spec.model) ?? []) {
        if (target === spec.model) continue; // ذاتي — يُحرس بالفرز أدناه
        const tp = position.get(target);
        if (tp !== undefined && tp > (position.get(spec.model) ?? -1)) {
          violations.push(`${spec.model} قبل ${target}`);
        }
      }
    }
    expect(violations).toEqual([]);
    // المراجع الذاتية الثلاثة المعروفة تتطلب فرزًا يضمن الأب/الأقدم أولًا.
    for (const model of selfRef) {
      const spec = BACKUP_ORDER.find((s) => s.model === model);
      expect(spec?.insertSortBy).toBeDefined();
    }
  });

  it('createBackup: يمر على كل الجداول ويسجل التدقيق ويحسب الإجماليات', async () => {
    // جلسة افتراضية: جدول واحد بصف واحد عبر delegate موسع محليًا.
    const backup = await service.createBackup('user-1');
    expect(backup.meta.formatVersion).toBe(1);
    expect(backup.meta.exportedById).toBe('user-1');
    expect(Object.keys(backup.data)).toContain('User');
    expect(backup.meta.totalRows).toBeGreaterThanOrEqual(0);
    expect(prisma.activityLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'SYSTEM_BACKUP_CREATED',
        }) as Record<string, unknown>,
      }) as Record<string, unknown>,
    );
  });

  it('createBackup (W3): يسجّل آخر نسخة ناجحة لإعدادات المصنع (تذكير التنبيهات)', async () => {
    await service.createBackup('user-1');
    // markBackupDone استُدعيت مرة — يغذي تنبيه «مر أسبوع بلا نسخة».
    const factorySettingsMock = (
      service as unknown as {
        factorySettings: { markBackupDone: jest.Mock };
      }
    ).factorySettings;
    expect(factorySettingsMock.markBackupDone).toHaveBeenCalledTimes(1);
    // وفشلها لا يفشل التصدير (التقاط مقصود في الخدمة).
    factorySettingsMock.markBackupDone.mockRejectedValueOnce(new Error('x'));
    const backup = await service.createBackup('user-1');
    expect(backup.meta.formatVersion).toBe(1);
  });

  it('يرفض الاستعادة بلا عبارة التأكيد المكتوبة', async () => {
    const file = Buffer.from(
      JSON.stringify({
        meta: { formatVersion: 1, exportedAt: '2026-09-13' },
        data: { User: [{ id: 'u1' }] },
      }),
    );
    await expect(service.restore(file, 'تأكيد', 'user-1')).rejects.toThrow(
      RESTORE_CONFIRM_PHRASE,
    );
  });

  it('يرفض ملف بلا مستخدمين (قفل خارج) أو صيغة غير مدعومة', async () => {
    const noUsers = Buffer.from(
      JSON.stringify({
        meta: { formatVersion: 1, exportedAt: '2026-09-13' },
        data: { Product: [] },
      }),
    );
    await expect(
      service.restore(noUsers, RESTORE_CONFIRM_PHRASE, 'user-1'),
    ).rejects.toThrow('مستخدمين');

    const badVersion = Buffer.from(
      JSON.stringify({
        meta: { formatVersion: 99, exportedAt: '2026-09-13' },
        data: { User: [{ id: 'u1' }] },
      }),
    );
    await expect(
      service.restore(badVersion, RESTORE_CONFIRM_PHRASE, 'user-1'),
    ).rejects.toThrow('إصدار صيغة');

    const notJson = Buffer.from('ليس JSON');
    await expect(
      service.restore(notJson, RESTORE_CONFIRM_PHRASE, 'user-1'),
    ).rejects.toThrow('JSON');
  });

  it('restore: TRUNCATE للجداول ثم إدراج بترتيب FK داخل معاملة واحدة', async () => {
    prisma.$queryRaw.mockResolvedValue([
      { tablename: 'users' },
      { tablename: 'customers' },
    ]);
    (
      prisma as unknown as { $executeRawUnsafe: jest.Mock }
    ).$executeRawUnsafe.mockResolvedValue(0);
    // ملف يحوي مستخدمًا واحدًا فقط (delegates الأخرى بلا صفوف).
    const file = Buffer.from(
      JSON.stringify({
        meta: { formatVersion: 1, exportedAt: '2026-09-13T00:00:00Z' },
        data: {
          User: [
            { id: 'u1', createdAt: '2026-09-01T00:00:00Z' },
            { id: 'u2', createdAt: '2026-09-05T00:00:00Z' },
          ],
        },
      }),
    );
    const result = (await service.restore(
      file,
      RESTORE_CONFIRM_PHRASE,
      'u1',
    )) as { restored: boolean };
    expect(result.restored).toBe(true);
    // TRUNCATE بكل الجداول المكتشفة (عدا هجرات prisma) بـ CASCADE.
    expect(
      (prisma as unknown as { $executeRawUnsafe: jest.Mock }).$executeRawUnsafe,
    ).toHaveBeenCalledWith(
      'TRUNCATE TABLE "users", "customers" RESTART IDENTITY CASCADE',
    );
    // إدراج المستخدمين مرتبين زمنيًا (الأقدم أولًا — مرجع ذاتي محتمل).
    const usersCreate = (tx.user as unknown as { createMany: jest.Mock })
      .createMany;
    expect(usersCreate).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ id: 'u1' }),
        expect.objectContaining({ id: 'u2' }),
      ],
    });
    // سجل تدقيق الاستعادة.
    expect(prisma.activityLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'SYSTEM_RESTORED',
        }) as Record<string, unknown>,
      }) as Record<string, unknown>,
    );
  });

  /**
   * سيناريو التعافي الكارثي (بروفة 2026-09-14): مستخدم محلي جديد ينفذ
   * الاستعادة على نظام فارغ — معرفه محيته TRUNCATE مع الجداول، فلا يجوز
   * أن ينكسر سجل التدقيق بمفتاح أجنبي لمستخدم غير موجود بعد الاستعادة.
   * المتوقع: تنسب الحركة لمُصدِّر النسخة (موجود في بياناتها) ويوثق المنفذ
   * الفعلي نصًّا في التفاصيل، وتنجح الاستعادة كاملة.
   */
  it('restore على نظام جديد: سجل التدقيق يُنسب لمستخدم النسخة لا المنفذ المحلي المحذوف', async () => {
    prisma.$queryRaw.mockResolvedValue([{ tablename: 'users' }]);
    (
      prisma as unknown as { $executeRawUnsafe: jest.Mock }
    ).$executeRawUnsafe.mockResolvedValue(0);
    const file = Buffer.from(
      JSON.stringify({
        meta: {
          formatVersion: 1,
          exportedAt: '2026-09-13T00:00:00Z',
          exportedById: 'exporter-1',
        },
        data: {
          User: [
            { id: 'exporter-1', createdAt: '2026-09-01T00:00:00Z' },
            { id: 'worker-user', createdAt: '2026-09-05T00:00:00Z' },
          ],
        },
      }),
    );
    // الموك يعيد count صفرية افتراضيًا — نحاكي إدراج المستخدمين فعليًا.
    (
      prisma.user as unknown as { createMany: jest.Mock }
    ).createMany.mockResolvedValue({ count: 2 });
    const result = (await service.restore(
      file,
      RESTORE_CONFIRM_PHRASE,
      'local-admin-999', // غير موجود في النسخة إطلاقًا
    )) as { restored: boolean; totalRows: number };
    expect(result.restored).toBe(true);
    expect(result.totalRows).toBe(2);
    // الحركة منسوبة لمُصدِّر النسخة (FK سليم) والمنفذ الفعلي موثق نصًّا.
    expect(prisma.activityLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'exporter-1',
          action: 'SYSTEM_RESTORED',
          details: expect.objectContaining({
            performedBy: 'local-admin-999',
          }) as Record<string, unknown>,
        }) as Record<string, unknown>,
      }) as Record<string, unknown>,
    );
  });

  /**
   * مطابقة عدادات الفحوصات: نفس ملف DR أعلاه لكن بلا exportedById في
   * meta — تنسب الحركة لأول مستخدم في النسخة بدل الفشل.
   */
  it('restore بلا exportedById: أول مستخدم في النسخة هو منصة التدقيق', async () => {
    prisma.$queryRaw.mockResolvedValue([]);
    (
      prisma as unknown as { $executeRawUnsafe: jest.Mock }
    ).$executeRawUnsafe.mockResolvedValue(0);
    const file = Buffer.from(
      JSON.stringify({
        meta: { formatVersion: 1, exportedAt: '2026-09-13T00:00:00Z' },
        data: {
          User: [{ id: 'first-user', createdAt: '2026-09-01T00:00:00Z' }],
        },
      }),
    );
    await service.restore(file, RESTORE_CONFIRM_PHRASE, 'outsider-x');
    expect(prisma.activityLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'first-user',
        }) as Record<string, unknown>,
      }) as Record<string, unknown>,
    );
  });
});
