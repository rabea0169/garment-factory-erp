# ADR-0015: HR and Payroll Scope and Calculation Policy

## Status

Accepted as the GF-0015 implementation baseline on 2026-08-26. Production deployment still requires UAT and owner sign-off.

## Context

PR #24 is merged in `main` and adds only `POST /hr/attendance`, using the existing unique `(workerId, date)` constraint. The repository already has `Worker`, `Attendance`, `DailyProduction`, `WorkerAdvance`, and a legacy `Payroll` model, but it has no payroll endpoints, approval state, audit actor, idempotency for HR writes, or server-side period calculation. The current `recordDailyProduction` and `recordAdvance` paths are not sufficient for an auditable payroll cycle.

The authoritative strategic plan requires worker data, attendance, piece-rate production, advances, deductions, payroll periods, server-side calculation, and a price snapshot. It does not authorize taking payroll totals from a phone or silently inferring an absence policy.

## Decision

GF-0015 is split into one implementation slice: **HR and payroll calculation and approval**, without reimplementing attendance. The existing attendance endpoint remains the source for daily attendance records and is reviewed for actor/idempotency hardening only when required by the slice.

The first payroll MVP uses the following explicit rules:

1. A payroll period has an inclusive `periodStart` and `periodEnd` and is unique per worker and period.
2. `grossAmount` is calculated on the server as the sum of `DailyProduction.totalAmount` in the period. The stored `DailyProduction.pieceRate` is the historical price snapshot; the client cannot provide or override it.
3. `advanceDeduct` is the sum of worker advances in the period, capped at `grossAmount`. An advance amount must be positive and is never accepted from a payroll request as a precomputed deduction.
4. `absenceDeduct` is zero in this MVP because `Worker` has no fixed salary or approved daily absence-rate policy. Attendance is recorded and reported, but no financial absence deduction is invented. A future absence policy requires a separate ADR and model fields.
5. `netAmount = grossAmount - advanceDeduct - absenceDeduct`. The result cannot be negative.
6. Payroll is created as `DRAFT`, may be approved by `HR_MANAGER` or `GENERAL_MANAGER`, and cannot be recalculated or edited after approval. Corrections require a reversal/recalculation workflow with audit trail.
7. Payment and the accounting journal are outside GF-0015 and belong to GF-0018. A payroll record must not be marked paid by the GF-0015 calculation endpoint.
8. All payroll writes occur in transactions, record the authenticated actor, and support idempotency for retryable create/approve operations. Duplicate worker-period payrolls are rejected.

## Alternatives rejected

A single daily rate derived from an undocumented salary, accepting a client-supplied gross/net amount, or automatically treating every absent attendance row as a paid or unpaid day would create financial rules not present in the current data model. Those alternatives are deferred until the product owner approves the policy and required schema.

## Database and rollback

The expected additive migration introduces explicit payroll status and audit/idempotency fields and a worker-period uniqueness constraint only after existing data is reconciled. No operational or financial row is deleted. Before deployment, CI must run migration deploy on a clean PostgreSQL database and the integration suite must cover duplicate periods, calculation, approval immutability, rollback on transaction failure, and idempotent replay. Rollback is through code revert plus an approved backup/restore or reverse migration; `db push` is prohibited on shared environments.

## Consequences

The MVP produces explainable piece-rate payroll without guessing a fixed salary or absence amount. It leaves payment posting and absence policy visibly incomplete rather than creating a false accounting result. HR and accounting users can audit the actor, source period, historical rates, deductions, and approval state.

## Next implementation task

`GF-0015-IMPL`: add the smallest typed DTO/service/controller slice for payroll draft calculation and approval, harden the existing attendance/production/advance writes only where needed for actor and idempotency, add the additive migration, and test the complete server-side calculation on PostgreSQL.
