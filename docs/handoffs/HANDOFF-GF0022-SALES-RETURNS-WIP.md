# Handoff GF-0022 — Sales Returns WIP

## Status
- Branch: `feat/gf-0022-sales-returns`
- Base: `d815831` / current main lineage after PR #39 and subsequent merges
- Status: schema and additive migration prepared; service/API not yet implemented

## Completed
- Added `SalesReturn` and `SalesReturnItem` to Prisma schema.
- Preserved original sale price, VAT amount, COGS unit cost, and total COGS per returned line.
- Added additive migration `20260826050000_gf0022_sales_returns` with foreign keys, unique idempotency relation, and indexes.
- `prisma validate`, `prisma format --check`, and `git diff --check` pass.

## Not Done
- DTO and controller endpoint.
- Atomic service transaction.
- WH-FG ledger receive and financial reversal.
- Idempotency replay and concurrency tests.
- CI, PR, and merge.

## Next Exact Task
Implement `CreateSalesReturnDto` and `SalesService.createReturn` or a dedicated `SalesReturnService` using the existing InventoryService and FinancialPostingService contracts. Reject quantities above sold minus prior returns, calculate VAT and COGS on the server, receive through the finished-goods ledger, post the reverse journal, and commit all effects in one transaction.

## Rollback
The migration is additive and contains no destructive operation. Before applying it to production, run backup/restore rehearsal and migration deploy on a disposable database.
