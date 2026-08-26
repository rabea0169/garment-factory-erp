-- Wave 2 v2 — Seed new Chart of Accounts entries at the DB level.
--
-- Background:
--   The financial modules (HR, Production, Inventory, Shipping) need new
--   system accounts that did not exist in the original chart-of-accounts.ts
--   (which only had 10 accounts). The new accounts (added by Wave 2 across
--   multiple subagents) are:
--     * FINISHED_GOOD_STOCK — Asset
--     * WIP                  — Asset
--     * WORKER_ADVANCES      — Asset (worker salary advances / receivable)
--     * SALARIES_PAYABLE     — Liability
--     * INVENTORY_ADJUSTMENT_INCOME  — Revenue (positive inventory adjustments)
--     * SALARIES_EXPENSE     — Expense
--     * WASTE_EXPENSE        — Expense
--     * INVENTORY_ADJUSTMENT_EXPENSE — Expense (negative inventory adjustments)
--     * SHIPPING_EXPENSE     — Expense
--
--   These accounts are referenced from src/core/financial/chart-of-accounts.ts
--   and inserted here with the SAME fixed UUIDs so migrations and seed.ts
--   stay in sync. Note: the previous subagent's UUID choices for some keys
--   differ from the audit's recommended UUIDs (WIP at ...051 not ...041,
--   FINISHED_GOOD_STOCK at ...041 not ...032, etc.) — we keep the existing
--   UUIDs to avoid duplicate keys and let `prisma generate` resolve the
--   references from the constant map.
--
-- This migration:
--   * INSERT ... ON CONFLICT (id) DO NOTHING so it's safe to re-run on
--     databases where seed.ts already created the rows. The migration runs
--     as part of `prisma migrate deploy`, while seed.ts runs separately —
--     both must produce the same rows for any database state.
--
-- Account code convention (matches chart-of-accounts.ts):
--   1100 — Cash & Banks (CASH, BANK)
--   1200 — Accounts Receivable (ACCOUNTS_RECEIVABLE)
--   1300 — Inventory (INVENTORY)
--   1310 — Finished Goods Stock (FINISHED_GOOD_STOCK)
--   1320 — Work in Process (WIP)
--   1330 — Worker Advances (WORKER_ADVANCES)
--   2200 — Accounts Payable (ACCOUNTS_PAYABLE)
--   2300 — VAT Payable
--   2400 — Salaries Payable
--   3000 — Owners Equity
--   4100 — Sales Revenue
--   4200 — Inventory Adjustment Income
--   5000 — General Expense
--   5100 — COGS
--   5200 — Salaries Expense
--   5300 — Waste Expense
--   5400 — Inventory Adjustment Expense
--   5600 — Shipping Expense

INSERT INTO "accounts" ("id", "code", "name", "type", "isActive", "createdAt") VALUES
  (
    '10000000-0000-0000-0000-000000000041',
    '1310',
    'مخزون المنتج التام',
    'ASSET',
    true,
    NOW()
  ),
  (
    '10000000-0000-0000-0000-000000000051',
    '1320',
    'مخزون تحت التشغيل',
    'ASSET',
    true,
    NOW()
  ),
  (
    '10000000-0000-0000-0000-000000000061',
    '1330',
    'سلف العمال',
    'ASSET',
    true,
    NOW()
  ),
  (
    '20000000-0000-0000-0000-000000000041',
    '2400',
    'رواتب مستحقة',
    'LIABILITY',
    true,
    NOW()
  ),
  (
    '40000000-0000-0000-0000-000000000021',
    '4200',
    'إيرادات تسوية المخزون',
    'REVENUE',
    true,
    NOW()
  ),
  (
    '50000000-0000-0000-0000-000000000031',
    '5200',
    'مصروف الرواتب',
    'EXPENSE',
    true,
    NOW()
  ),
  (
    '50000000-0000-0000-0000-000000000041',
    '5300',
    'مصروف الهدر',
    'EXPENSE',
    true,
    NOW()
  ),
  (
    '50000000-0000-0000-0000-000000000051',
    '5400',
    'مصروف تسوية المخزون',
    'EXPENSE',
    true,
    NOW()
  ),
  (
    '50000000-0000-0000-0000-000000000061',
    '5600',
    'مصروف الشحن',
    'EXPENSE',
    true,
    NOW()
  )
ON CONFLICT ("id") DO NOTHING;
