# Thermo-Nuclear Code Review — Phase 1 Latest-Only Action Workflow

**Date:** 2026-07-15
**Scope:** RH Agent Latest-Only Action Workflow, Phase 1 implementation
**Status:** Approved — all findings addressed

## Findings

### 1. `RhAgentGroupStore.activeRunMarketDate()` does a duplicate run lookup

The computed re-scans `agentStore.runs()` to find the active run, but `viewedRun()` already computed the same lookup.

**File:** `src/app/features/rh-agent/stores/rh-agent-group.store.ts`
**Fix:** Derive `activeRunMarketDate` from `viewedRun()`.

```ts
activeRunMarketDate: computed((): string | null =>
  state.viewedRun()?.marketDate ?? state._activeRunMarketDate()
),
```

---

### 2. `SignalReviewFacade` mutation guards are repetitive

Every mutation method repeats `if (!this.canMutate()) return;`. This is mechanical duplication and easy to forget.

**File:** `src/app/features/rh-agent/stores/signal-review.facade.ts`
**Fix:** Replace the per-method guard with a small wrapper helper that bails early when the run is not actionable.

```ts
private runIfActionable<T>(fn: () => T): T | undefined {
  if (!this.canMutate()) return;
  return fn();
}
```

Apply it to each guarded mutation method.

---

### 3. New-run transition effect mutates state inside a facade effect

The facade tracks `previousLatestRunId` as a mutable class field updated inside an `effect()`. This is a side-effect inside an effect and puts transition logic in the wrong layer.

**File:** `src/app/features/rh-agent/stores/signal-review.facade.ts`
**Fix:** Move the transition into `RhAgentGroupStore`, which already owns `activeRunId`. Use a store hook or a dedicated reaction so the facade only reads the predicate.

---

### 4. `ChartReviewComponent` re-derives `isActionableRun`

The component wraps `groupStore.isActionableRun()` in its own computed, adding indirection without value.

**File:** `src/app/features/rh-agent/pages/chart-review/chart-review.component.ts`
**Fix:** Remove the local computed and bind `groupStore.isActionableRun()` directly in the template, or expose it through the chart-review facade if one is introduced later.

---

### 5. Order page can fall back to a historical run date

`RhAgentOrderComponent.currentMarketDate()` falls back to `groupStore.activeRunMarketDate()` and then `todayDate()`. If the user arrived from a historical run and `latestCompletedRun` is still loading, the page can silently target the wrong date.

**File:** `src/app/features/rh-agent/pages/agent-order/rh-agent-order.component.ts`
**Fix:** Order should always target the latest completed run and treat an unknown date as non-actionable. Replace the fallback chain with a single computed that returns `null` until the latest completed run is known, and disable actionable controls when it is `null`.

```ts
readonly orderMarketDate = computed(() =>
  this.agentStore.latestCompletedRun()?.marketDate ?? null
);
```

---

### 6. Run header placement lacks layout hooks

`<app-run-metrics-strip>` is inserted directly into `signal-review.component.html` and `chart-review.component.html` without a wrapper class. It may render correctly, but there is no obvious hook for margins or responsive treatment.

**Files:**
- `src/app/features/rh-agent/pages/signal-review/signal-review.component.html`
- `src/app/features/rh-agent/pages/chart-review/chart-review.component.html`
**Fix:** Wrap the strip in a dedicated container element (e.g. `.active-run-context`) so layout and future read-only styling can be controlled from the page stylesheet.

---

## Approval Bar

Address findings 1, 3, and 5 before merging. Findings 2, 4, and 6 are recommended but optional if time is short.

- [x] 1. Remove duplicated run lookup in `activeRunMarketDate`
- [x] 2. (Optional) Centralize mutation guard in facade
- [x] 3. Move new-run transition out of facade effect into group store
- [x] 4. (Optional) Remove redundant `isActionableRun` computed in Chart Review
- [x] 5. Harden Order page date resolution
- [x] 6. (Optional) Add wrapper class around run-metrics-strip
