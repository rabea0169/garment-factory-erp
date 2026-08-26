# ADR-0014: Quality and Waste Model

## Status
Accepted for GF-0014 implementation.

## Context

The legacy `QualityCheck` model records checked, passed, and rejected quantities but is not tied to the authoritative production stage run. It does not distinguish rejection from irreversible waste, does not persist the actor, and does not enforce quantity conservation.

## Decision

GF-0014 extends `QualityCheck` additively. A quality check is linked to `WorkOrder` and, for every new write, to the authoritative `ProductionStageRun`. The request uses `ProductionStage` for the selected stage while the legacy `stage` column remains mapped for backward compatibility until a separately approved cleanup.

The GF-0014 quality check is a final inspection for a completed stage run. `PENDING`, `IN_PROGRESS`, and `CANCELLED` stage runs are rejected. PostgreSQL and the service enforce at most one quality check for each non-null `stageRunId`; this MVP policy prevents independent checks from double-counting the same stage output. Multiple inspections and aggregate reconciliation are deferred to a separately approved model.

The service and database enforce non-negative integer quantities and the invariant:

```text
checkedQty = passedQty + rejectedQty + wasteQty
```

Rejected units and waste units are separate outcomes. Waste requires a classified `QualityWasteReason`; its cost is calculated by the server from the work-order cost source and is never trusted from the client. For GF-0014, inspected input includes all three outcomes, so `checkedQty = passedQty + rejectedQty + wasteQty`. A check stores the actor, completion status, timestamps, and an optional idempotency key. Completed checks are not edited in place; any correction requires a separately audited reversal or adjustment endpoint/model, which is explicitly outside GF-0014.

## Migration and rollback

The migration is additive: new enums, nullable/backfilled fields, indexes, and non-destructive constraints are introduced without deleting operational records. Existing rows receive `wasteQty = 0`, a safe completed status, and remain readable through the legacy stage field. If deployment must be rolled back, application writes using the new fields are stopped and the migration is reverted only through an approved backup/restore procedure; operational records are not hard-deleted.

## Consequences

Quality writes become auditable and deterministic, and downstream quality KPIs can distinguish passed, rejected, and wasted quantities. The service must validate stage-run ownership, completion status, and uniqueness before creating a check, and integration tests must run against PostgreSQL to prove the constraints and indexes. The stage-run output remains the authoritative production quantity record; GF-0014 records the quality classification and does not post inventory or accounting entries.

## Acceptance evidence

- Unit tests cover conservation, non-negative quantities, waste reason, actor, cost calculation, and idempotent replay.
- HTTP tests cover authentication, role authorization, DTO validation, and actor extraction.
- PostgreSQL integration tests cover the database constraints, stage-run relation, one-check-per-stage-run policy, duplicate requests, and transaction rollback.
