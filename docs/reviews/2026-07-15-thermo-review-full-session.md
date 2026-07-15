# Thermo-Nuclear Code Review — Full Session (Phase 3 + enum refactor)

**Date:** 2026-07-15  
**Scope:** All working-tree changes: Phase 3 occurrence-level durable ACR decisions, `RhAgentDecisionType`/`RhReviewStatus` enum consolidation, and the rename to `RhAgentReviewDecision`.  
**Build:** Passes (`npm run build -- --configuration development --no-progress`).  
**Status:** **Approved** — all blockers fixed; build passes.

---

## 1. Order page resets user edits whenever accepted symbols change

**File:** `@/src/app/features/rh-agent/pages/agent-order/rh-agent-order.component.ts:98-125`

```ts
constructor() {
  effect(() => this.initializeTradeRows());
}

private initializeTradeRows(): void {
  const symbols = this.occurrenceStore.acceptedSymbols();
  this.tradeRows.set(
    symbols.map((symbol) => ({
      symbol,
      direction: 'LONG' as const,
      signalType: '',
      barDate: '',
      positionSize: RH_AGENT_MAX_TRADE_AMOUNT,
      stopLossPercent: 8,
      enabled: true,
    }))
  );
}
```

The `effect` rebuilds the entire `tradeRows` array from defaults every time `acceptedSymbols()` changes. Any position size, stop-loss, or enabled toggles the user has made are destroyed. This is not an edge case — it is the normal flow once a second accepted occurrence arrives or the latest run transitions.

**Action:** Merge instead of replace. Keep existing rows for symbols still in `acceptedSymbols`, add defaults only for new symbols, and remove rows for symbols that left. This also removes the need to treat the Order page as a simple reactive rebuild.

---

## 2. Triage Report still reads the deprecated collection

**Files:**
- `@/src/app/features/rh-agent/pages/agent-triage-report/rh-agent-triage-report.component.ts:110-127`
- `@/src/app/features/rh-agent/services/rh-agent-triage.service.ts:68-222`

The report loads `rh-agent-triage-decisions`, which the new occurrence-decision flow no longer writes. The page will show stale or empty data. It also still depends on the full old persistence layer (`loadDecisionsForDateRange`, `setDecision`, etc.) that Phase 3 removed from the active path.

**Action:** Repoint the report to `RhAgentOccurrenceDecisionService` and filter by `marketDate` range, or delete the report page if it is no longer in scope.

---

## 3. Group store sync effect collapses multi-occurrence symbols unpredictably

**File:** `@/src/app/features/rh-agent/stores/rh-agent-group.store.ts:383-394`

```ts
const statusMap: Record<string, RhAgentReviewDecision> = {};
for (const decision of Object.values(decisions)) {
  if (decision.runId !== runId) continue;
  if (decision.decisionType === RhAgentReviewDecision.ACCEPT) statusMap[decision.symbol] = RhAgentReviewDecision.ACCEPT;
  else if (decision.decisionType === RhAgentReviewDecision.REJECT) statusMap[decision.symbol] = RhAgentReviewDecision.REJECT;
}
```

A symbol can have multiple occurrence decisions (different timeframes or signal types). This loop silently overwrites the per-symbol status with whichever decision happens to be iterated last. There is no documented rule for how to aggregate ACCEPT + REJECT on the same symbol.

**Action:** Define an explicit rule (e.g., REJECT wins, latest wins, or show the most conservative state) and implement it with a `reduce` or stable sort. Do not rely on object-iteration order.

---

## 4. `decisionType` is typed too broadly

**File:** `@/src/app/features/rh-agent/services/rh-agent.types.ts:124-125`

`RhAgentOccurrenceDecision.decisionType` is typed as the full `RhAgentReviewDecision` enum, which includes `PENDING`, `REVIEW`, `CONSIDER`, `EXCLUDE`, `LOW_TRADABILITY`, `WATCH`, and `EXECUTED`. Only `ACCEPT` and `REJECT` are meaningful for a durable occurrence record.

**Action:** Narrow it:

```ts
export type DurableDecisionType =
  | RhAgentReviewDecision.ACCEPT
  | RhAgentReviewDecision.REJECT;
```

Use that for `decisionType` and keep `RhAgentReviewDecision` for the broader ephemeral UI concept.

---

## 5. `isDurableDecision` matches the durable decision boundary

**File:** `@/src/app/features/rh-agent/stores/rh-agent-triage.store.ts:230-235`

```ts
function isDurableDecision(status: RhAgentReviewDecision): boolean {
  return status === ReviewStatus.ACCEPT || status === ReviewStatus.REJECT;
}
```

The helper now matches `DurableDecisionType`: only explicit `ACCEPT` and `REJECT` are durable. Whipsaw handling is deferred.

---

## 6. `UserDecisionType` and `decisionId()` are duplicated

**Files:**
- `@/src/app/features/rh-agent/services/rh-agent-occurrence-decision.service.ts:36-37,58-60`
- `@/src/app/features/rh-agent/stores/rh-agent-occurrence-decision.store.ts:28-29,46-48`

Both files define an identical `UserDecisionType` alias and an identical `decisionId()` helper. This is exactly the kind of duplicated boundary logic that will diverge.

**Action:** Move `UserDecisionType` (and the narrowed `DurableDecisionType`) to `rh-agent.types.ts`. Move `decisionId()` to a shared helper or expose it from the service.

---

## 7. Triage Store header and state fields are stale

**File:** `@/src/app/features/rh-agent/stores/rh-agent-triage.store.ts:1-53`

The header still says the store persists RACR decisions to `rh-agent-triage-decisions`. In reality it now only manages ephemeral statuses and review flags. It also keeps `decisionsLoading` and `decisionsError` fields that previously tracked durable decision loads but now only relate to review-flag loads.

**Action:** Rewrite the header to describe the actual responsibility (ephemeral ACR UI state + review flags). Rename `decisionsLoading`/`decisionsError` to `reviewFlagsLoading`/`reviewFlagsError` or drop them if unneeded.

---

## 8. UI status chips and badge classes are inconsistent

**Files:**
- `@/src/app/features/rh-agent/components/status-summary-chips/status-summary-chips.component.html`
- `@/src/app/features/rh-agent/components/status-summary-chips/status-summary-chips.component.scss`
- `@/src/app/features/rh-agent/pages/agent-triage-report/rh-agent-triage-report.component.html:94-95`
- `@/src/app/features/rh-agent/pages/agent-triage-report/rh-agent-triage-report.component.scss`
- `@/src/app/features/rh-agent/components/symbol-row/symbol-row.component.html:16`

- `REVIEW` and `EXECUTED` both use the `↑` icon.
- The triage-report table badge uses a manual `toLowerCase().replace('_', '-')`, which is fragile for multi-word statuses. The component already has a correct `cssClassForStatus()` helper — use it.
- `symbol-row.component.html` references `status-executed` but `symbol-row.component.scss` has no rule for it.

**Action:** Pick distinct icons, reuse `cssClassForStatus()` in the template, and either add styles or remove unused CSS classes.

---

## 9. `StatusCounts` zero object is hand-maintained

**File:** `@/src/app/features/rh-agent/pages/agent-triage-report/rh-agent-triage-report.component.ts:84-101`

The `statusCounts` computed manually initializes a zeroed object that mirrors `StatusCounts`. It is already out of sync with the enum in spirit, and the duplication is unnecessary.

**Action:** Derive it from `ALL_REVIEW_STATUSES`:

```ts
const counts = Object.fromEntries(
  ALL_REVIEW_STATUSES.map((s) => [s, 0])
) as StatusCounts;
```

---

## 10. `withHooks` import is unused

**File:** `@/src/app/features/rh-agent/stores/rh-agent-occurrence-decision.store.ts:17`

`withHooks` is imported but the store no longer uses it.

**Action:** Remove the import.

---

## 11. Occurrence-decision store header is stale

**File:** `@/src/app/features/rh-agent/stores/rh-agent-occurrence-decision.store.ts:1-10`

The header says "ACCEPTED / REJECTED" (past tense) while the code now uses `ACCEPT` / `REJECT`.

**Action:** Update the comment to match the enum values.

---

## 12. Design doc still uses past-tense decision names

**File:** `@/docs/implementations/RH-AGENT-LATEST-ACTION-WORKFLOW-2607-01.md:46,53,63,69`

The workflow doc talks about `ACCEPTED`/`REJECTED` durable decisions. Since the enum values are now `ACCEPT`/`REJECT`, the doc should either use the enum names or explicitly separate semantic concept from enum value.

---

## 13. Optimistic local decision still carries an empty `userId`

**File:** `@/src/app/features/rh-agent/stores/rh-agent-occurrence-decision.store.ts:220`

```ts
const d = buildDecision(runId, marketDate, signal, decisionType, '');
```

The service stamps the real `userId`, so the local object gets an empty string. This was flagged in the previous review as a fake fallback. It still works, but it means the local cache briefly holds a malformed `RhAgentOccurrenceDecision`.

**Action:** Make `userId` optional on the interface or use an explicit placeholder constant so the type boundary is honest.

---

## 14. `RhAgentTriageService` still exposes a full legacy decision API

**File:** `@/src/app/features/rh-agent/services/rh-agent-triage.service.ts:1-199`

Most of the service (`loadDecisionsForDate`, `loadDecisionsForDateRange`, `setDecision`, `setDecisionsBatch`, `deleteDecision`, etc.) targets `rh-agent-triage-decisions`. Only the review-flag methods are still part of the active flow. The rest is dead weight that confuses the boundary.

**Action:** Remove the deprecated decision methods, or move them behind a clearly-labeled legacy module if the report page still needs them temporarily.

---

## 15. `buildSymbolGroups` returns `reviewStatus: 'PENDING'` as a raw string

**File:** `@/src/app/features/rh-agent/utils/rh-agent.utils.ts:579`

```ts
reviewStatus: statuses[item.profile.symbol] ?? 'PENDING',
```

The field is typed as `RhAgentReviewDecision`. Using the string literal happens to compile because the enum value is the same, but it bypasses the enum and is brittle if the enum ever changes.

**Action:** Use `RhAgentReviewDecision.PENDING`.

---

## Refactor for #4 — narrowing `decisionType`

Introduce a `DurableDecisionType` union in `rh-agent.types.ts` that contains only the enum members that can actually be persisted as occurrence-level decisions:

```ts
export type DurableDecisionType =
  | RhAgentReviewDecision.ACCEPT
  | RhAgentReviewDecision.REJECT;
```

Then change the interface:

```ts
export interface RhAgentOccurrenceDecision {
  ...
  decisionType: DurableDecisionType;
  ...
}
```

This keeps `RhAgentReviewDecision` as the broad UI enum while making the durable boundary honest. All service/store signatures that accept/persist decisions should be typed with `DurableDecisionType`; only template-level status chips and ephemeral triage state use the full enum.

---

## Fixes applied

1. **Order page** — `syncTradeRowsWithAcceptedSymbols()` now merges existing rows for still-accepted symbols (read with `untracked()` to avoid self-triggering the effect) and only creates defaults for newly accepted symbols; removed symbols drop out without resetting edits.
2. **Triage Report** — repointed from `RhAgentTriageService.loadDecisionsForDateRange` to `RhAgentOccurrenceDecisionService.loadDecisionsForDateRange`; table/CSV now use `marketDate`, `decisionType`, and `runId`.
3. **Group store sync** — added explicit precedence (ACCEPT wins over REJECT) instead of relying on iteration order.
4. **`decisionType` narrowing** — added `DurableDecisionType` and applied it to `RhAgentOccurrenceDecision` and service/store signatures.
5. **`isDurableDecision`** — kept as `ACCEPT | REJECT` matching `DurableDecisionType`.
6. **Duplication** — moved `DurableDecisionType` to `rh-agent.types.ts` and `decisionId()` to `rh-agent-firestore-helpers.ts` as `buildRhAgentOccurrenceDecisionId`.
7. **Triage Store header/state** — header now describes ephemeral UI state + review flags; renamed `decisionsLoading`/`decisionsError` to `reviewFlagsLoading`/`reviewFlagsError` and wired them in `loadReviewFlags`.
8. **UI chips/classes** — `EXECUTED` gets a `$` icon and distinct success styling; removed `WHIPSAW_REVERSAL` chip and related badge/dot styles.
9. **`StatusCounts`** — derived from `ALL_REVIEW_STATUSES`.
10. **Unused import** — removed `withHooks` from occurrence-decision store; updated header comment.
11. **Design doc** — aligned decision names with enum values and deferred whipsaw linkage.
12. **`userId`** — made it optional on `RhAgentOccurrenceDecision` and removed the empty-string placeholder from the optimistic builder.
13. **Deprecated triage API** — removed `RhTriageDecision`, `RhTriageDecisionInput`, and all `rh-agent-triage-decisions` read/write/listen methods from `RhAgentTriageService`; removed their exports from `index.ts`.
14. **`buildSymbolGroups`** — uses `RhAgentReviewDecision.PENDING` instead of the raw string.
15. **Firestore index** — added `userId` + `marketDate` composite index for occurrence-decision date-range queries.

Build: passes (`npm run build -- --configuration development --no-progress`).

---

## Approval Bar

All blockers addressed.

- [x] 1. Order page preserves user edits when accepted symbols change.
- [x] 2. Triage Report reads occurrence decisions.
- [x] 3. Multi-occurrence symbol aggregation is explicit.
- [x] 4. `decisionType` narrowed with `DurableDecisionType`.
- [x] 5. `isDurableDecision` matches `DurableDecisionType` (`ACCEPT | REJECT`).
- [x] 6. `UserDecisionType` / `decisionId()` deduplicated.
- [x] 7. Triage Store header/state reflects ephemeral + review-flag responsibility.
- [x] 8. UI chips/badge classes handle `EXECUTED`; whipsaw styling removed.
- [x] 9. `StatusCounts` derived from enum.
- [x] 10. Unused `withHooks` removed; header fixed.
- [x] 11. Design doc updated.
- [x] 12. `userId` optional.
- [x] 13. Deprecated triage decision API removed.
- [x] 14. `buildSymbolGroups` uses enum value.
- [x] 15. Firestore index added for occurrence-decision date-range queries.

**Status: Approved.**
