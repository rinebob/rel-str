**Topic:** Watchlist management  
**Topic Slug:** watchlist-mgmt  
**Thread:** Unified list infrastructure  
**Thread Slug:** unified-list-infra  
**Issue:** #521  
**Thread Parent:** #492  
**Topic Parent:** #465  
**Task:** #524  
**Domain:** WATCHLIST  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-09-22  
**Last Updated:** 2026-09-22  

# Code Review: #524 — Registry read path (defs, composite ids, watchLists$, lazy migration)

Three axes run in parallel (Standards, Spec, Thermo-nuclear), all findings
fixed and regression-tested in-tree before verdict.

## Summary

| Axis | Verdict | Notable findings |
|---|---|---|
| Standards | PASS after fixes | M1 same-id delete, M2 userId-less legacy docs, M3 constants duplication — all fixed |
| Spec | PASS after fixes | F1 backend bare-name writer, F2 moveToList overwrite, F3 legacy→legacy merge — all fixed |
| Thermo-nuclear | PASS after fixes | C1 moveToList no-merge (same as F2), M1 out-vs-registry merge, M2 unsorted emission — all fixed |

## Findings by severity

### Critical — fixed

- **`moveToList` wiped registry metadata** (`batch.set` without
  `{ merge: true }`) — every triage move would have erased
  `label/order/role/hidden`, degrading docs to `nonexclusive` on next
  snapshot. Fixed; spec asserts merge flag + metadata preservation.

### Major — fixed

- **Dual-legacy same-key merge dropped symbols** — `resolveSnapshot` read
  `registry.get(key)` not `out.get(key)`; coexisting `PAST_SIGNALS` +
  `MONITOR` bare docs would lose the first doc's symbols. Fixed (`out.get`);
  spec covers the union.
- **Same-id delete** — a composite-id doc missing `key` was classified
  legacy and batch-deleted after being set (same ref). Guard added; spec
  covers stamp-in-place.
- **userId-less legacy docs invisible** — the `where('userId'==)` query
  can't see docs written without the field (backend
  `symbol-data-symbol-added.ts` writes bare `PRIMARY` with no userId).
  Fixed via `probeLegacyDocs`: first emission `getDoc`s the seven known
  legacy bare ids and folds unowned/mine docs into the migration batch.
  **Follow-up flagged:** the BE writer itself still emits bare-name docs —
  it needs a `{userId}_PRIMARY` write path (BE follow-up task; FE
  self-heals each load until then).
- **Unsorted emission** — defs now sort by `order` on every emit path;
  spec covers.

### Minor — fixed

- Constants duplication: `SYMBOL_LIST_FILTER_OPTIONS` now derives from
  `SYSTEM_LIST_DEFS` (labels/order single-sourced).
- `toDef` coerces `key`/`role`/`order`/`symbols` defensively.
- Deterministic `order` for unknown legacy lists (sorted by id, order
  starts at `USER_LIST_ORDER_START = 100`).
- Fallback path key derivation for prefixed-but-unstamped ids.
- Unused `of` import removed; `createList` comment corrected; collection
  path wording fixed in defs header; CONTEXT.md Untriaged entry synced to
  the exclusive-only semantic.
- Spec hygiene: shared `setupService()` helper, `getDoc` impl reset,
  weak `removeFromList` assertion strengthened.

### Deferred / nits (accepted)

- Service is ~390 lines (over the 300 target) — cohesive single
  responsibility; extraction into a migration helper file is optional.
- Duplicate emission after migration (local emit + listener echo) —
  harmless; consumer-side `distinctUntilChanged` is a Phase-2 option.
- `watchLists$` binds the first auth uid for the subscription's life —
  documented in code; account switch requires resubscribe.

## Test results

- Focused: `symbol-list.service.spec.ts` — 14/14 green.
- Full suite: 123 suites / 1706 tests — all green.
- tsc: no errors in changed files (pre-existing errors in unrelated
  in-flight work: option-chain-pct-change store, indicator-config-dialog,
  bulk-swing-sweep — not this task's scope).

## Verdict

**PASS** — all critical/major findings fixed and regression-tested; task
acceptance criteria met (registry defs + composite ids + watchLists$ live
read + lazy migration + compat adapter).
