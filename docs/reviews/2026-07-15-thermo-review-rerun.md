# Thermo-Nuclear Code Review — Rerun: Phase 3 Occurrence Decisions

**Date:** 2026-07-15  
**Scope:** Verify the fixes from the Phase 3 / full-session review and hunt for missed structural simplifications.  
**Build:** Passes (`npm run build -- --configuration development --no-progress`).  
**Status:** **Changes requested** — one structural mismatch, one lingering UI omission, and one missing Firestore index.

---

## Verified fixes from prior reviews

| # | Fix | Status | Evidence |
|---|-----|--------|----------|
| 1 | `RhAgentOccurrenceDecision.decisionType` narrowed to `DurableDecisionType` (`ACCEPT \| REJECT`) | ✅ | `@/c:/aa/projects/rel-str/src/app/features/rh-agent/services/rh-agent.types.ts:105-108` |
| 2 | `whipsawLinkedToOccurrenceId` removed from type and service | ✅ | `@/c:/aa/projects/rel-str/src/app/features/rh-agent/services/rh-agent-occurrence-decision.service.ts:60-90` and `@/c:/aa/projects/rel-str/src/app/features/rh-agent/services/rh-agent.types.ts:110-139` |
| 3 | `isDurableDecision` matches `DurableDecisionType` only | ✅ | `@/c:/aa/projects/rel-str/src/app/features/rh-agent/stores/rh-agent-triage.store.ts:230-235` |
| 4 | Group-store sync ranks `ACCEPT` over `REJECT` | ✅ | `@/c:/aa/projects/rel-str/src/app/features/rh-agent/stores/rh-agent-group.store.ts:388-393` |
| 5 | Order page reacts to `acceptedSymbols()` in an effect and preserves edits with `untracked()` | ✅ | `@/c:/aa/projects/rel-str/src/app/features/rh-agent/pages/agent-order/rh-agent-order.component.ts:99-133` |
| 6 | Triage report reads durable occurrence decisions | ✅ | `@/c:/aa/projects/rel-str/src/app/features/rh-agent/pages/agent-triage-report/rh-agent-triage-report.component.ts:75-120` |
| 7 | `getCurrentRunSignalsForSymbol` extracted to signal service and reused | ✅ | `@/c:/aa/projects/rel-str/src/app/features/rh-agent/services/rh-agent-signal.service.ts:127-137` |
| 8 | Legacy `persistedStatuses` removed from triage store | ✅ | `@/c:/aa/projects/rel-str/src/app/features/rh-agent/stores/rh-agent-triage.store.ts:34-55` |
| 9 | `markRunNotCurrent` rolls back local state on failure | ✅ | `@/c:/aa/projects/rel-str/src/app/features/rh-agent/stores/rh-agent-occurrence-decision.store.ts:183-200` |
| 10 | `deleteDecisionsForSymbol` removed | ✅ | not present in `@/c:/aa/projects/rel-str/src/app/features/rh-agent/services/rh-agent-occurrence-decision.service.ts` |
| 11 | Occurrence-decision store no longer has empty `withHooks` | ✅ | `@/c:/aa/projects/rel-str/src/app/features/rh-agent/stores/rh-agent-occurrence-decision.store.ts:233-235` |
| 12 | `acceptedCount` derived from `acceptedSymbols` | ✅ | `@/c:/aa/projects/rel-str/src/app/features/rh-agent/stores/rh-agent-occurrence-decision.store.ts:89-96` |
| 13 | `resetSignals`/`resetSignalDecisions` collapsed | ✅ | `@/c:/aa/projects/rel-str/src/app/features/rh-agent/stores/rh-agent-occurrence-decision.store.ts:115-136` |
| 14 | Firestore occurrence-decision indexes aligned with actual queries | ✅ mostly | Indexes exist for `userId+runId`, `userId+runId+isCurrentInLatestRun`, `userId+symbol+isCurrentInLatestRun`, and `userId+marketDate` at `@/c:/aa/projects/rel-str/firestore.indexes.json:95-128` |

---

## New findings

### 1. Triage Report still models its UI around the full review-status enum

**File:** `@/c:/aa/projects/rel-str/src/app/features/rh-agent/pages/agent-triage-report/rh-agent-triage-report.component.ts:61-94`

The report only loads durable occurrence decisions, whose `decisionType` is `DurableDecisionType` (`ACCEPT \| REJECT`). Yet the component uses `ALL_REVIEW_STATUSES` for filter chips and derives a full `StatusCounts`. The result:

- Chips for `PENDING`, `REVIEW`, `CONSIDER`, `EXCLUDE`, `LOW_TRADABILITY`, `WATCH`, and `EXECUTED` are permanently zero and clickable-but-meaningless.
- The count loop needs a cast to compile: `const status = d.decisionType as keyof StatusCounts;`.

This is the exact kind of type-boundary leak the skill flags: the durable-decision model is being forced through the broader ephemeral-status enum.

**Code-judo move:**

```ts
const DURABLE_DECISION_STATUSES: DurableDecisionType[] = [
  RhAgentReviewDecision.ACCEPT,
  RhAgentReviewDecision.REJECT,
];

type DecisionCounts = {
  [K in DurableDecisionType]: number;
};
```

Use `DURABLE_DECISION_STATUSES` for `allStatuses` and `DecisionCounts` for `statusCounts`. The cast disappears and the UI matches the data shape.

---

### 2. Symbol-row status class bindings still have no styles

**File:** `@/c:/aa/projects/rel-str/src/app/features/rh-agent/components/symbol-row/symbol-row.component.html:9-16`

The panel binds `[class.status-review]`, `[class.status-accept]`, `[class.status-reject]`, etc., but `@/c:/aa/projects/rel-str/src/app/features/rh-agent/components/symbol-row/symbol-row.component.scss` contains no rules for those classes. This was flagged in the full-session review (#8) but was only partially addressed by removing the whipsaw binding.

**Fix:** Either add the panel-level status styles or remove the bindings. If status color lives elsewhere (e.g. the ACR action buttons), the dead bindings are just noise and should be deleted.

---

### 3. Missing Firestore index for `loadCurrentDecisions()` without a symbol

**File:** `@/c:/aa/projects/rel-str/src/app/features/rh-agent/services/rh-agent-occurrence-decision.service.ts:189-205`

`loadCurrentDecisions()` runs:

```ts
where('userId', '==', userId)
where('isCurrentInLatestRun', '==', true)
```

There is no composite index with exactly those two fields. The existing `userId+symbol+isCurrentInLatestRun` and `userId+runId+isCurrentInLatestRun` indexes may or may not satisfy this query depending on Firestore's planner. To avoid a runtime index error, add:

```json
{
  "collectionGroup": "rh-agent-occurrence-decisions",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "userId", "order": "ASCENDING" },
    { "fieldPath": "isCurrentInLatestRun", "order": "ASCENDING" }
  ]
}
```

---

### 4. `rh-agent-order.component.ts` imports a constant through a service re-export

**File:** `@/c:/aa/projects/rel-str/src/app/features/rh-agent/pages/agent-order/rh-agent-order.component.ts:34`

```ts
import { RH_AGENT_MAX_TRADE_AMOUNT } from '../../services/rh-agent.service';
```

The constant is defined in `@/c:/aa/projects/rel-str/src/app/features/rh-agent/services/rh-agent.types.ts:19` and merely re-exported by the service. Import it from its canonical home (`rh-agent.types`) to remove the indirection.

---

### 5. `RhAgentOccurrenceDecisionService` wraps the shared ID helper for no benefit

**File:** `@/c:/aa/projects/rel-str/src/app/features/rh-agent/services/rh-agent-occurrence-decision.service.ts:54-57`

```ts
private decisionId(runId: string, symbol: string, timeframe: string, signalType: string): string {
  return buildRhAgentOccurrenceDecisionId(runId, symbol, timeframe, signalType);
}
```

This is a pure pass-through. Use `buildRhAgentOccurrenceDecisionId` directly; delete the wrapper and its repeated private signature.

---

### 6. Triage service header still advertises "legacy triage helpers"

**File:** `@/c:/aa/projects/rel-str/src/app/features/rh-agent/services/rh-agent-triage.service.ts:1-7`

The service now contains only review-flag helpers. The header should say so, or the word "legacy" will confuse the next reader.

---

## Fixes applied

1. **Triage report UI model** — replaced `ALL_REVIEW_STATUSES`/`StatusCounts` with a local `DURABLE_DECISION_STATUSES` array and `DecisionCounts` type; removed the `as keyof StatusCounts` cast.
2. **Symbol-row status bindings** — removed the dead `[class.status-*]` bindings from the panel.
3. **Firestore index** — added `userId + isCurrentInLatestRun` composite index for `loadCurrentDecisions()`.
4. **Order component import** — `RH_AGENT_MAX_TRADE_AMOUNT` now imported from `rh-agent.types`.
5. **Occurrence-decision service** — removed the pass-through `decisionId()` wrapper; calls use `buildRhAgentOccurrenceDecisionId` directly.
6. **`toDecisions` data boundary** — skips docs with an invalid/missing `decisionType` and logs a warning instead of silently defaulting to `REJECT`.
7. **Triage service header** — updated to describe review-flag ownership only.
8. **Feature index** — re-exported `RhAgentOccurrenceDecision` and `DurableDecisionType`.

Build: passes (`npm run build -- --configuration development --no-progress`).

## Approval bar

- [x] 1. Triage report UI model matches durable decision shape.
- [x] 2. Symbol-row status class bindings have matching styles or are removed.
- [x] 3. Firestore index added for `userId + isCurrentInLatestRun`.
- [x] 4. Order component imports `RH_AGENT_MAX_TRADE_AMOUNT` from canonical types file.
- [x] 5. Occurrence-decision service uses shared ID helper directly.
- [x] 6. Triage service header comment is accurate.

**Status:** Approved.
