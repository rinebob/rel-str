# Thermo-Nuclear Code Quality Review — Phase 4.2 Trade Data Model

**Date:** 2026-07-15  
**Scope:** Phase 4 item 2 — execution details live in a related trade record, persisted on "Mark Executed"  
**Review framework:** `@/c:/aa/projects/rel-str/.devin/skills/thermo-nuclear-code-review.md`  
**Build:** Passes (`npm run build -- --configuration development --no-progress`)  
**Status:** **Approved** after fixes — all blockers addressed.

---

## Reviewed files

- `@/c:/aa/projects/rel-str/src/app/core/common/constants.ts`
- `@/c:/aa/projects/rel-str/src/app/features/rh-agent/services/rh-agent.types.ts`
- `@/c:/aa/projects/rel-str/src/app/features/rh-agent/services/rh-agent-trade.service.ts`
- `@/c:/aa/projects/rel-str/src/app/features/rh-agent/services/rh-agent-signal.service.ts`
- `@/c:/aa/projects/rel-str/src/app/features/rh-agent/stores/rh-agent-trade.store.ts`
- `@/c:/aa/projects/rel-str/src/app/features/rh-agent/components/trade-row/trade-row.component.ts`
- `@/c:/aa/projects/rel-str/src/app/features/rh-agent/pages/agent-order/rh-agent-order.component.ts`
- `@/c:/aa/projects/rel-str/firestore.rules`
- `@/c:/aa/projects/rel-str/firestore.indexes.json`
- `@/c:/aa/projects/rel-str/docs/implementations/RH-AGENT-LATEST-ACTION-WORKFLOW-2607-01.md`

---

## Structural concerns

### 1. Non-atomic, component-level orchestration of two related writes

**File / lines:** `@/c:/aa/projects/rel-str/src/app/features/rh-agent/pages/agent-order/rh-agent-order.component.ts:196-201`

```ts
private markRowsExecuted(runId: string, marketDate: string, rows: TradeRow[]): void {
  const decisionsBySymbol = this.buildDecisionsBySymbol(runId);
  this.tradeStore.openTradesForRows(runId, marketDate, rows, decisionsBySymbol);
  this.occurrenceStore.markExecutedForSymbols(runId, rows.map((r) => r.symbol));
}
```

The Order component fires two independent async mutations — create trade records, then mark occurrence decisions executed. There is no shared transaction, no sequential error handling, and no rollback. If the trade write fails, the occurrence decision is still marked executed; if the mark-executed write fails, a trade record exists for a non-executed decision. The component now owns orchestration that belongs in a dedicated execution layer.

**Why this is structural:**

- It scatters the "execute a trade" invariant across a UI component.
- It introduces a half-applied state window with no recovery path.
- It duplicates the "which decisions are eligible" logic (`buildDecisionsBySymbol`) in the page component instead of keeping it in the store/service that already owns the concept.

**Code-judo move:**

Introduce a single execution orchestrator — either a new `RhAgentExecutionService` or a store method in `RhAgentTradeStore` that owns the whole "execute" action. The orchestrator should:

1. Compute the set of eligible occurrence decisions once.
2. Create the trade records.
3. On success, mark the corresponding decision IDs executed.
4. Surface a single success/error snackbar and keep the component free of transaction choreography.

A minimal version keeps the two writes sequential inside the service/store and returns one `Observable<void>` to the component. A stronger version wraps both Firestore writes in a single client-side transaction, which is possible because both collections are user-scoped and the doc IDs are known.

---

## Boundary / model issues

### 2. `decisionsBySymbol` can link a trade to the wrong occurrence

**File / lines:** `@/c:/aa/projects/rel-str/src/app/features/rh-agent/pages/agent-order/rh-agent-order.component.ts:203-216`

```ts
private buildDecisionsBySymbol(runId: string): Record<string, RhAgentOccurrenceDecision> {
  const map: Record<string, RhAgentOccurrenceDecision> = {};
  for (const d of Object.values(this.occurrenceStore.occurrenceDecisions())) {
    if (
      d.runId === runId &&
      d.decisionType === RhAgentReviewDecision.ACCEPT &&
      d.isCurrentInLatestRun
    ) {
      map[d.symbol] = d;
    }
  }
  return map;
}
```

Occurrence-decision identity is `runId + symbol + timeframe + signalType`. A single symbol can have multiple accepted decisions (e.g., daily vs. weekly, or different signal types). The lookup above collapses them by symbol alone, so the trade's `occurrenceDecisionId` may point to a different occurrence than the row that was actually executed.

**Fix:**

Key the lookup by the same composite identity that the row already carries (`symbol + timeframe + signalType`), or pass the exact occurrence decision ID into the row when it is synced. The latter is cleaner and removes all ambiguity.

---

### 3. `marketDate` is passed but never persisted

**File / lines:** `@/c:/aa/projects/rel-str/src/app/features/rh-agent/services/rh-agent-trade.service.ts:31-33` and `openTrades` body

`OpenTradeInput` carries `marketDate`, but `RhAgentTrade` has no `marketDate` field and the service ignores it. Either persist it on the trade record or drop it from the input interface. Carrying dead parameters obscures the real contract and will confuse future readers.

---

## Type-contract / legibility issues

### 4. Misleading comment in `openTradesForRows`

**File / lines:** `@/c:/aa/projects/rel-str/src/app/features/rh-agent/stores/rh-agent-trade.store.ts:92-95`

```ts
/**
 * Open trades for the given rows, linking each to its occurrence decision
 * when the decision map is provided. Optimistically adds the trades and
 * rolls back on service failure.
 */
```

The implementation is not optimistic; it only patches state after the service succeeds. The comment should be corrected or removed to avoid future confusion.

---

### 5. Inline dynamic import used as a type annotation

**File / lines:** `@/c:/aa/projects/rel-str/src/app/features/rh-agent/pages/agent-order/rh-agent-order.component.ts:204`

```ts
private buildDecisionsBySymbol(runId: string): Record<string, import('../../services/rh-agent.types').RhAgentOccurrenceDecision> {
```

`RhAgentOccurrenceDecision` is already exported from `rh-agent.types.ts`. There is no reason to use a dynamic import expression as a type annotation. Add a normal top-level import and use it directly.

---

### 6. `TradeInputRow` duplicates `SignalDirection`

**File / lines:** `@/c:/aa/projects/rel-str/src/app/features/rh-agent/services/rh-agent.types.ts:111-120`

```ts
export interface TradeInputRow {
  ...
  direction: 'LONG' | 'SHORT';
  ...
}
```

The codebase already defines `SignalDirection = 'LONG' | 'SHORT'`. Repeating the literal weakens the contract and makes future direction changes harder. Use `SignalDirection` directly.

---

## Positive notes

- The choice to keep execution details in a separate `rh-agent-trades` collection is sound: it avoids turning the occurrence-decision record into a kitchen sink and supports multiple trades per occurrence later.
- Firestore rules and the `userId + runId` index are present, so the new collection follows the existing security/access pattern.
- The service/store structure mirrors the well-established occurrence-decision pattern, so the new code is consistent with the codebase.
- `closePrice` was added to `RhAgentSignalItem`, giving the Order page a real entry price instead of a magic zero default.

---

## Applied fixes

1. **Centralized execution orchestration** — added `RhAgentExecutionService` and `RhAgentExecutionStore`. The service performs the trade creation and occurrence-decision `executedAt` update inside a single Firestore transaction, so the two writes are atomic. The store exposes one `executeTradeRows` method and updates both local caches.
2. **Exact trade-to-occurrence link** — the Order component now pairs each row with its occurrence decision using the composite identity `symbol:timeframe:signalType`, eliminating the symbol-only collision risk.
3. **Dead parameter removed** — `marketDate` is now persisted on `RhAgentTrade` and parsed back from Firestore.
4. **Misleading comment fixed** — `openTradesForRows` now accurately describes that state updates happen only after service success.
5. **Dynamic import type annotation removed** — `RhAgentOccurrenceDecision` is imported normally in the Order component.
6. **Literal union replaced with enum** — `TradeInputRow.direction` and the `SignalDirection` type alias are gone; all LONG/SHORT references now use the existing `SignalDirection` enum.
7. **Occurrence store simplified** — removed the symbol-based `markExecutedForSymbols` in favor of the exact-ID `markExecutedByIds` method. The new execution store is the only caller.
8. **Literal timeframe unions replaced with `SignalTimeframe`** — `TradeRow`, `TradeInputRow`, `RhAgentTrade`, `RhAgentSignalItem`, and `RhAgentOccurrenceDecision` now use the existing `SignalTimeframe` enum instead of `'D' | 'W'` literals.
9. **Trade storage path and ID changed** — trades are persisted under `rh-agent-trades/{symbol}/trades/{tradeId}` with a deterministic, human-readable `tradeId` of `{symbol}_{marketDate}_{timeframe}_{signalType}`.

Build remains green.

## Approval bar

- [x] No clear structural regression.
- [x] No obvious missed code-judo opportunity — execution is now one canonical transaction.
- [x] No file-size explosion.
- [x] No new spaghetti branching in shared paths.
- [x] No hacky/magical abstractions.
- [x] Type and boundary issues cleaned up.

**Status: Approved.**
