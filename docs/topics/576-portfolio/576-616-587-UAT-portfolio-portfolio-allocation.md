# UAT — #587 FE AllocationStore + selectors

- **Topic Parent:** #576
- **Task:** #587
- **Issue:** #616 (QA)
- **Blueprint:** #582
- **Type:** UAT
- **Status:** Complete
- **Last Updated:** 2026-09-26

## Scope

The Allocation Manager's state layer — `allocation.store.ts` (SignalStore)
+ `allocation.types.ts`. No UI surface yet; acceptance is verified through
the committed spec suite (`allocation.store.spec.ts`, 18 specs) which
fixtures the exact data shapes the page will render.

## Prerequisites

- Repo checkout on `prod`; `npm install` done.
- No credentials — store specs stub all three services (data/bucket/attribution).
- Command: `npx jest src/app/features/portfolio-dashboard/allocation.store.spec.ts --coverage=false`

## Scenarios (each maps to a spec)

| # | Scenario | Spec |
|---|---|---|
| 1 | All accounts surface, non-agentic included | `loadAccounts surfaces ALL accounts` |
| 2 | Per-account snapshot/positions/fills + asOf stamp | `loads snapshot + positions + fills` |
| 3 | Zero cross-account leakage (foreign doc injected) | `zero cross-account leakage` |
| 4 | bucketRows: config+stats merge, Cash pinned last, Unassigned row | `bucketRows merges config + stats` |
| 5 | accountHeader: value / allocated / cash / diverged | `accountHeader reports` |
| 6 | positionsRows: bucket-name join + linkKey + Unassigned label | `positionsRows resolves bucket names` |
| 7 | bucketDetail(id): bucket + stats + owned positions; null for unknown | `bucketDetail(id)` |
| 8 | Post-write selector refresh via attribution stream | `post-write selector refresh` |
| 9 | Account switch attaches that account's streams + lazy-loads | `switching accounts` |
| 10 | Write methods delegate to services | `assign/move/unassign delegate`, `bucket mutations delegate`, `renameBucket delegates` |
| 11 | Per-account error isolation | `per-account error surfaces` |
| 12 | refresh() reloads after a prior load | `refresh() reloads` |
| 13 | loadAccounts failure → loadError, empty state | `loadAccounts failure` |
| 14 | Errored stream re-attaches on reselect | `an errored stream re-attaches` |
| 15 | Dangling bucketId folds into Unassigned (no vanished numbers) | `dangling bucketId` |
| 16 | Unassigned counts flat-but-traded realized P&L + closedCount | `flat-but-traded instruments` |

## Traceability

| Task AC | Scenarios |
|---|---|
| Selectors scoped to selected account — zero cross-account leakage | 3, 9 |
| Cash row = account value − Σ bucket exposures; never stored | 4 (PRD-authoritative semantics: broker actual + derived residual) |
| Unassigned derived from positions lacking attribution | 4, 6, 15, 16 |
| Store spec covers selector outputs on fixtures | 4–8 |
| Post-write selector refresh verified in spec | 8 |

Regression: full suite run (`npx jest`) — the `isWellFormedPosition` export
and `buildEquityCurve` extraction touch shared utils used by #584 specs.

## Results

- Store spec: **18/18 PASS**
- `shared/portfolio-allocation-utils.spec.ts`: **36/36 PASS** (buildEquityCurve
  extraction regression-checked by existing suite)
- Full suite: **2016/2016 PASS**, 147 suites

## Refinement pass

**Not applicable — no user-facing surface.** The store has no template;
the page arrives in #588.
