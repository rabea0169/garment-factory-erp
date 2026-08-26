-- Wave2 / New accounts: Add new chart-of-accounts codes needed by GL postings
-- for subagents B (Inventory/Production) and C (HR/Payroll/Shipping).
--
-- This migration seeds Account rows directly in the DB (using the same
-- fixed-UUID pattern as the existing chart-of-accounts.ts) so that
-- GL-posting services can rely on the rows existing on any database
-- where migrations are applied — even if `prisma db seed` was not run
-- (e.g. CI/test environments, fresh prod DBs).
--
-- The TypeScript constants in `src/core/financial/chart-of-accounts.ts`
-- are the authoritative source of the UUIDs. This migration MUST stay
-- in sync with that file. `prisma/seed.ts` also upserts these rows
-- so local dev DBs (created via `prisma migrate dev` + `prisma db seed`)
-- have them too.
--
-- Pattern (from `20260828060000_audit_v2_cluster5_e5_multi_currency`):
--   * All id columns are TEXT (matching Prisma's @default(uuid()) convention).
--   * `INSERT ... ON CONFLICT ("id") DO NOTHING` for idempotency.
--   * `ON CONFLICT ("code") DO NOTHING` would be tempting but is unsafe
--     if a row with the same code but a different id was previously
--     inserted — we want this migration to be a no-op if the id is
--     already present, NOT to fail on a code collision. (Code collisions
--     are detected by the unique constraint at INSERT time anyway.)
--
-- Rollback:
--   DELETE FROM "accounts" WHERE "id" IN (
--     '10000000-0000-0000-0000-000000000033',  -- WIP
--     '10000000-0000-0000-0000-000000000032',  -- FINISHED_GOOD_STOCK
--     '10000000-0000-0000-0000-000000000051',  -- WORKER_ADVANCES
--     '20000000-0000-0000-0000-000000000041',  -- SALARIES_PAYABLE
--     '40000000-0000-0000-0000-000000000021',  -- INVENTORY_ADJUSTMENT_INCOME
--     '50000000-0000-0000-0000-000000000031',  -- WASTE_EXPENSE
--     '50000000-0000-0000-0000-000000000041',  -- INVENTORY_ADJUSTMENT_EXPENSE
--     '50000000-0000-0000-0000-000000000051',  -- SALARIES_EXPENSE
--     '50000000-0000-0000-0000-000000000061'   -- SHIPPING_EXPENSE
--   );

-- 1300 sub-accounts — المخزون المُفصّل (assets)
INSERT INTO "accounts" ("id", "code", "name", "type", "isGroup", "balance", "isActive", "createdAt")
VALUES (
  '10000000-0000-0000-0000-000000000033',
  '1320',
  'إنتاج تحت التشغيل (Work in Progress)',
  'ASSET',
  false,
  0,
  true,
  CURRENT_TIMESTAMP
) ON CONFLICT ("id") DO NOTHING;

INSERT INTO "accounts" ("id", "code", "name", "type", "isGroup", "balance", "isActive", "createdAt")
VALUES (
  '10000000-0000-0000-0000-000000000032',
  '1310',
  'مخزون البضاعة التامة (Finished Goods)',
  'ASSET',
  false,
  0,
  true,
  CURRENT_TIMESTAMP
) ON CONFLICT ("id") DO NOTHING;

INSERT INTO "accounts" ("id", "code", "name", "type", "isGroup", "balance", "isActive", "createdAt")
VALUES (
  '10000000-0000-0000-0000-000000000051',
  '1330',
  'سلف العمال (Worker Advances)',
  'ASSET',
  false,
  0,
  true,
  CURRENT_TIMESTAMP
) ON CONFLICT ("id") DO NOTHING;

-- 2400 — الأجور المستحقة (liability)
INSERT INTO "accounts" ("id", "code", "name", "type", "isGroup", "balance", "isActive", "createdAt")
VALUES (
  '20000000-0000-0000-0000-000000000041',
  '2400',
  'الأجور المستحقة (Salaries Payable)',
  'LIABILITY',
  false,
  0,
  true,
  CURRENT_TIMESTAMP
) ON CONFLICT ("id") DO NOTHING;

-- 4200 — إيراد تسوية المخزون الموجبة (revenue)
INSERT INTO "accounts" ("id", "code", "name", "type", "isGroup", "balance", "isActive", "createdAt")
VALUES (
  '40000000-0000-0000-0000-000000000021',
  '4200',
  'إيراد تسوية المخزون (Inventory Adjustment Income)',
  'REVENUE',
  false,
  0,
  true,
  CURRENT_TIMESTAMP
) ON CONFLICT ("id") DO NOTHING;

-- 5000 sub — مصروفات تشغيلية تفصيلية (expenses)
INSERT INTO "accounts" ("id", "code", "name", "type", "isGroup", "balance", "isActive", "createdAt")
VALUES (
  '50000000-0000-0000-0000-000000000031',
  '5300',
  'مصروف الهدر (Waste Expense)',
  'EXPENSE',
  false,
  0,
  true,
  CURRENT_TIMESTAMP
) ON CONFLICT ("id") DO NOTHING;

INSERT INTO "accounts" ("id", "code", "name", "type", "isGroup", "balance", "isActive", "createdAt")
VALUES (
  '50000000-0000-0000-0000-000000000041',
  '5400',
  'مصروف تسوية المخزون (Inventory Adjustment Expense)',
  'EXPENSE',
  false,
  0,
  true,
  CURRENT_TIMESTAMP
) ON CONFLICT ("id") DO NOTHING;

INSERT INTO "accounts" ("id", "code", "name", "type", "isGroup", "balance", "isActive", "createdAt")
VALUES (
  '50000000-0000-0000-0000-000000000051',
  '5500',
  'مصروف الأجور (Salaries Expense)',
  'EXPENSE',
  false,
  0,
  true,
  CURRENT_TIMESTAMP
) ON CONFLICT ("id") DO NOTHING;

INSERT INTO "accounts" ("id", "code", "name", "type", "isGroup", "balance", "isActive", "createdAt")
VALUES (
  '50000000-0000-0000-0000-000000000061',
  '5600',
  'مصروف الشحن (Shipping Expense)',
  'EXPENSE',
  false,
  0,
  true,
  CURRENT_TIMESTAMP
) ON CONFLICT ("id") DO NOTHING;
