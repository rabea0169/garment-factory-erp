# Handoff P0 Financial Reconciliation

## Status
- Branch: `fix/p0-financial-reconciliation`
- Commit: `b73961f`
- Base: `origin/main@fbdcca6`
- Phase: P0 financial reconciliation
- Task: Close cash-sale Treasury gap, preserve operational metadata for reversal, remove duplicate supplier-return posting, harden production idempotency, and fix production entrypoint.

## Completed
- Cash sale confirmation requires a validated `treasuryId`, passes server-computed `order.totalAmount` as `treasuryUpdates`, and stores the same side effect in journal metadata.
- Voucher creation persists treasury/customer/supplier updates in `JournalEntry.metadata`; reversal can invert them atomically.
- Supplier return now creates exactly one AP/Inventory reversal posting using actual `StockLedgerEntry.totalValue`, updates supplier balance, and returns the journal code.
- Concurrent identical production transitions and stage outputs now replay the committed result instead of returning a state error to the losing request.
- Prisma interactive transaction timeout is configurable through `DB_TX_TIMEOUT_MS` with a 10-second default; the test environment used 30 seconds for remote Prisma latency.
- `start:prod` now runs `dist/src/main.js`.

## Files Changed
- `backend/src/modules/sales/dto/confirm-sales-order.dto.ts`
- `backend/src/modules/sales/sales.controller.ts`
- `backend/src/modules/sales/sales.service.ts`
- `backend/src/modules/accounting/accounting.service.ts`
- `backend/src/modules/purchasing/purchasing.service.ts`
- `backend/src/modules/production/production-workflow.service.ts`
- `backend/src/prisma/prisma.service.ts`
- Related unit and PostgreSQL integration tests.
- `backend/.env.example`, `backend/package.json`, `docs/API_CONTRACT.md`, `docs/DATA_AND_MIGRATIONS.md`, `docs/adr/ADR-0020-p0-financial-reconciliation.md`.

## Database/API Impact
- No schema migration.
- Cash confirmation API gains optional body `{ treasuryId: "uuid" }`, required for CASH and forbidden for CREDIT.
- Existing journal entries without operational metadata are not guessed or modified; they require an approved reconciliation task.
- Supplier return remains backward-compatible at the route level but now returns `journalEntryCode`.

## Checks
| Check | Result | Notes |
|---|---|---|
| Format | PASS | `npm run format:check` |
| Typecheck | PASS | `npm run typecheck` |
| Lint | PASS | `npm run lint` |
| Build | PASS | `npm run build` |
| Backend tests | PASS | 32 suites / 198 tests |
| E2E tests | PASS | 3 suites / 64 tests |
| PostgreSQL integration | PASS | 9 suites / 35 tests on Prisma Postgres; `DB_TX_TIMEOUT_MS=30000` for remote latency |
| Secret scan | Pending CI | No secret or connection file tracked locally |
| start:prod smoke | Pending | Must run after build in CI/PR |

## Known Issues
- Remote Prisma PostgreSQL emits an SSL mode warning because `sslmode=require` is currently treated as `verify-full`; this is a driver warning, not a test failure. The deployment connection policy should be reviewed separately.
- `Jest did not exit one second after the test run` remains after remote integration suites; tests disconnect Prisma, but open-handle diagnostics should be addressed in a separate performance/fixture task.
- Historical journal entries with missing metadata remain unreconciled by design.

## Not Done
- No production database was modified.
- No migration was added.
- No automatic repair of historical balances was attempted.
- No PR was merged yet for this branch.

## Next Exact Task
- Push this branch and open a dedicated PR. Wait for CI including migration deploy, full PostgreSQL integration, Flutter, Secret Scan, and `start:prod` smoke. Merge only after all checks pass, then run post-merge reconciliation on main.

## Rollback
- Revert commit `b73961f` before deployment if CI or review rejects the contract.
- Do not delete operational or financial records. For already-created production transactions, use approved reversal/adjustment entries only.
