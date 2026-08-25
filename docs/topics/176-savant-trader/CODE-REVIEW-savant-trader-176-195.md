**Topic:** Savant Trader — FE-A2: Collapse ephemeral decision status into durable store
**Issue:** #195
**Topic Parent:** #176
**Domain:** SAVANT-TRADER
**Type:** Code Review
**Status:** Complete
**Created:** 2026-08-25
**Last Updated:** 2026-08-25

---

## Summary

Three-axis review of FE-A2 (#195): removing the ephemeral `statuses` map from TriageStore and deriving ACCEPT/REJECT status from the durable OccurrenceDecisionStore instead. CONSIDER/WATCH moved to a separate `screeningStatuses` map. 8 files modified, 1 new test file.

### Tasks covered

| Task | Issue # | Description | Stage |
|---|---|---|---|
| FE-A2 | #195 | Collapse ephemeral decision status into durable store | 6_REVIEW |

**Verdict: PASS** — all critical and major findings discovered during review were fixed before writing this doc.

---

## Standards

### Findings discovered and fixed

**1. Status merge conflict — ephemeral overrides durable (CRITICAL → fixed)**
- **File:** `src/app/features/savant-trader/stores/group.store.ts:250`
- The merge `{ ...occurrenceStore.statusBySymbol(), ...triageStore.screeningStatuses() }` let ephemeral CONSIDER/WATCH override durable ACCEPT/REJECT for the same symbol.
- **Fix:** Reversed spread order to `{ ...triageStore.screeningStatuses(), ...occurrenceStore.statusBySymbol() }` so durable decisions always win.

**2. Missing `watchSymbol` facade method (MAJOR → fixed)**
- **File:** `src/app/features/savant-trader/stores/signal-review.facade.ts`
- The facade had `considerSymbol` but no `watchSymbol`, even though ChartReviewComponent uses WATCH status.
- **Fix:** Added `watchSymbol(symbol)` method to SignalReviewFacade.

**3. Duplicated ranking logic (NIT → fixed)**
- **File:** `src/app/features/savant-trader/stores/occurrence-decision.store.ts`
- `statusBySymbol` computed and `statusForSymbol()` method both implemented the same ACCEPT-over-REJECT ranking logic.
- **Fix:** Extracted `rankDurable()` helper function.

### Findings accepted (no fix needed)

**4. `durableStatusCounts` naming vs spec `statusCounts` (MAJOR → accepted)**
- **File:** `src/app/features/savant-trader/stores/occurrence-decision.store.ts:135`
- Spec said "statusCounts computed" but implementation is named `durableStatusCounts`. The name is more descriptive and avoids confusion with the facade-level combined `statusCounts`. Accepted as-is.

**5. ChartReviewComponent calls `triageStore.setScreeningStatus` directly (MINOR → accepted)**
- **File:** `src/app/features/savant-trader/pages/chart-review/chart-review.component.ts:207`
- ChartReviewComponent doesn't use the SignalReviewFacade — it injects stores directly (consistent with how it calls `occurrenceStore.acceptSignals`). Accepted as consistent with the component's existing pattern.

### Findings deferred

**6. utils.ts exceeds 400 lines (MINOR → deferred)**
- **File:** `src/app/features/savant-trader/utils/utils.ts` (607 lines)
- Pre-existing — not introduced by this task.

---

## Spec

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 1 | TriageStore.statuses map removed | MET | No `statuses` field in TriageState |
| 2 | setStatus/setStatuses/setGroupStatus/acceptSymbol/rejectSymbol/considerSymbol/watchSymbol removed | MET | No references found in codebase |
| 3 | acceptedSymbols/acceptedCount/statusCounts computed removed | MET | No references found in codebase |
| 4 | CONSIDER/WATCH moved to screeningStatuses map | MET | `screeningStatuses` in TriageState, `setScreeningStatus` method |
| 5 | OccurrenceDecisionStore.statusForSymbol() added | MET | Lines 157-170 in occurrence-decision.store.ts |
| 6 | OccurrenceDecisionStore.statusCounts computed added | MET | Named `durableStatusCounts` (more descriptive) |
| 7 | SignalReviewFacade updated (no triageStore.setStatus calls) | MET | No setStatus calls found |
| 8 | ChartReviewComponent updated (derives from occurrenceStore) | MET | Line 118 uses `occurrenceStore.statusForSymbol(symbol)` |
| 9 | GroupStore updated (derives from occurrenceStore) | MET | Line 250 merges `occurrenceStore.statusBySymbol()` + `triageStore.screeningStatuses()` |
| 10 | Decisions survive page refresh | MET | OccurrenceDecisionStore loads from Firestore via `loadDecisionsForRun` |
| 11 | Tests: status derived from durable store | MET | 13 new tests in occurrence-decision.store.spec.ts |

---

## Thermo-Nuclear

### Architecture quality

The separation is clean: durable ACCEPT/REJECT lives in OccurrenceDecisionStore (backed by Firestore), ephemeral CONSIDER/WATCH lives in TriageStore.screeningStatuses (in-memory only). The facade combines both for the UI's `statusCounts`.

### Merge priority

After the fix, durable decisions correctly win over ephemeral screening statuses in the GroupStore merge. A symbol with both ACCEPT and CONSIDER will show ACCEPT.

### Consistency between statusBySymbol and statusForSymbol

Both filter by `isCurrentInLatestRun` and both use the shared `rankDurable()` helper. Consistent.

### Double-counting risks

No double-counting in the facade's `statusCounts`: durable counts come from `durableStatusCounts` (ACCEPT/REJECT), screening counts are computed separately (CONSIDER/WATCH), and REVIEW comes from `reviewCount`. Each status bucket is independent.

### Removed effect safety

The removed effect in GroupStore that called `triageStore.setStatuses(statusMap)` was only syncing durable decisions into the ephemeral map. With the new architecture, durable status is read directly from `occurrenceStore.statusBySymbol()`, so the effect is no longer needed. Safe to remove.

### Consumer audit

No consumers still expect the old `statuses` map to contain ACCEPT/REJECT. All references verified clean via grep.

---

## Verification

- **Build:** PASS (`ng build`)
- **Tests:** 27/27 PASS (14 triage.store.spec.ts + 13 occurrence-decision.store.spec.ts)

---

## Files changed

| File | Change |
|---|---|
| `stores/occurrence-decision.store.ts` | Added `statusBySymbol` computed, `durableStatusCounts` computed, `statusForSymbol()` method, `rankDurable()` helper |
| `stores/triage.store.ts` | Removed `statuses` map + all status methods; added `screeningStatuses` map + `setScreeningStatus`/`clearScreeningStatuses` |
| `stores/signal-review.facade.ts` | `statusCounts` combines durable + screening; removed `triageStore.setStatus` calls; added `watchSymbol()` |
| `stores/group.store.ts` | Merges `occurrenceStore.statusBySymbol()` + `triageStore.screeningStatuses()`; removed `setStatuses` effect |
| `pages/chart-review/chart-review.component.ts` | `selectedSymbolStatus` derives from `occurrenceStore.statusForSymbol`; removed `triageStore.setStatus` calls |
| `pages/agent-order/order.component.html` | `triageStore.acceptedCount()` → `occurrenceStore.acceptedCount()` |
| `stores/triage.store.spec.ts` | 5 new tests for `screeningStatuses` |
| `stores/occurrence-decision.store.spec.ts` | New file — 13 tests for `statusForSymbol`, `statusBySymbol`, `durableStatusCounts` |
