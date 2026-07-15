# Thermo-Nuclear Code Quality Review — Phase 4 Execution Transition

**Date:** 2026-07-15  
**Scope:** Phase 4 item 1 — explicit `EXECUTED` behavior distinct from `ACCEPT`  
**Review framework:** `@/c:/aa/projects/rel-str/.devin/skills/thermo-nuclear-code-review.md`  
**Build:** Passes (`npm run build -- --configuration development --no-progress`)  
**Status:** **Changes requested** — two structural blockers, one boundary leak, one UI state inconsistency.

---

## Reviewed files

- `@/c:/aa/projects/rel-str/src/app/features/rh-agent/services/rh-agent.types.ts:110-141`
- `@/c:/aa/projects/rel-str/src/app/features/rh-agent/services/rh-agent-occurrence-decision.service.ts:227-254`
- `@/c:/aa/projects/rel-str/src/app/features/rh-agent/stores/rh-agent-occurrence-decision.store.ts:182-217`
- `@/c:/aa/projects/rel-str/src/app/features/rh-agent/stores/rh-agent-group.store.ts:383-409`
- `@/c:/aa/projects/rel-str/src/app/features/rh-agent/components/trade-row/trade-row.component.ts`
- `@/c:/aa/projects/rel-str/src/app/features/rh-agent/components/trade-row/trade-row.component.html`
- `@/c:/aa/projects/rel-str/src/app/features/rh-agent/components/trade-row/trade-row.component.scss`
- `@/c:/aa/projects/rel-str/src/app/features/rh-agent/pages/agent-order/rh-agent-order.component.ts:75-198`
- `@/c:/aa/projects/rel-str/src/app/features/rh-agent/pages/agent-order/rh-agent-order.component.html`
- `@/c:/aa/projects/rel-str/docs/implementations/RH-AGENT-LATEST-ACTION-WORKFLOW-2607-01.md:138-143`

---

## Structural concerns

### 1. `markExecutedBatch` adds a brand-new query that needs a composite index

**File / lines:** `@/c:/aa/projects/rel-str/src/app/features/rh-agent/services/rh-agent-occurrence-decision.service.ts:232-254`

```ts
markExecutedBatch(runId: string, symbols: string[]): Observable<void> {
  ...
  const q = query(
    this.decisionsCollection,
    where('userId', '==', userId),
    where('runId', '==', runId),
    where('decisionType', '==', RhAgentReviewDecision.ACCEPT),
    where('symbol', 'in', normalizedSymbols)
  );
  ...
}
```

This is a brand-new query shape with no matching index in `@/c:/aa/projects/rel-str/firestore.indexes.json`. The first user who clicks "Mark Executed" will hit a Firestore index-required error.

**Why this is structural, not cosmetic:**

The occurrence-decision store already owns an authoritative in-memory map of every decision. It knows the exact document IDs that need to be marked executed. Adding a server-side query re-derives information the client already has, and it forces a new index path that did not exist in the Phase 3 design.

**Code-judo move:**

Change the contract so the store passes the decision IDs to the service, not the symbols. The service then performs a direct batch update by doc ID, eliminating the query and the index entirely:

```ts
// service
markExecutedByIds(ids: string[]): Observable<void> { ... writeBatch update each docRef by id ... }

// store
markExecutedForSymbols(runId, symbols) {
  const ids = Object.values(state.occurrenceDecisions())
    .filter(d => d.runId === runId && d.decisionType === ACCEPT && symbols.includes(d.symbol) && d.isCurrentInLatestRun)
    .map(d => d.id);
  ... optimistic update + call markExecutedByIds(ids) ...
}
```

This is simpler, avoids the index, and removes the stale-decision risk noted in finding #3.

---

### 2. Executed rows stay fully interactive

**Files:**
- `@/c:/aa/projects/rel-str/src/app/features/rh-agent/components/trade-row/trade-row.component.html:1-53`
- `@/c:/aa/projects/rel-str/src/app/features/rh-agent/components/trade-row/trade-row.component.scss:74-85`

After a row is marked executed, the UI swaps the "Mark executed" button for a `done_all` badge, but the slide-toggle, position-size input, stop-loss input, copy button, and remove button all remain enabled. That is a classic state-leak: the visual status changed, but the control surface still behaves as if the row is an active, mutable order.

**Fix:**

Add a single read-only guard driven by `row().executed`:

```ts
readonly isMutable = computed(() => !this.row().executed && this.isActionableRun());
```

Use it consistently:
- disable slide-toggle when `!isMutable()`
- disable inputs when `!isMutable()`
- disable/remove copy and remove buttons for executed rows
- consider removing the row from the active table entirely (see finding #4)

---

## Boundary / model issues

### 3. `markExecutedBatch` can update stale, non-current decisions

**File / lines:** `@/c:/aa/projects/rel-str/src/app/features/rh-agent/services/rh-agent-occurrence-decision.service.ts:238-243`

The service query omits `isCurrentInLatestRun == true`. The store filters for current-run decisions in its optimistic path, but the service does not. If local state and Firestore drift (e.g. another client, a later run transition, a manual edit), the batch can stamp `executedAt` onto decisions that are no longer part of the active order.

This is a boundary leak: the store and the service have different ideas about which documents are eligible for execution. The code-judo move in finding #1 fixes this automatically, because the store derives IDs from its own authoritative map.

If keeping the query-based approach, at minimum add `where('isCurrentInLatestRun', '==', true)` and the corresponding index.

---

### 4. Order page subtitle undercounts after execution

**File / lines:** `@/c:/aa/projects/rel-str/src/app/features/rh-agent/pages/agent-order/rh-agent-order.component.html:13-15`

```html
<span class="order-subtitle">
  {{ triageStore.acceptedCount() }} accepted symbol{{ triageStore.acceptedCount() === 1 ? '' : 's' }}
</span>
```

`triageStore.acceptedCount()` counts only `ACCEPT` ephemeral statuses and excludes `EXECUTED`. After the user marks a trade executed, the row remains in the order table (because `occurrenceStore.acceptedSymbols()` still includes executed symbols) but the subtitle count drops.

This reveals a model tension: the design doc says executed setups should live *outside* the active order workflow, but the current implementation keeps executed rows in the active order table while excluding them from the accepted count.

**Two clean fixes:**

- **Option A (preferred):** Filter executed symbols out of the active order table. The occurrence store can expose an `activeOrderSymbols()` computed that returns accepted-but-not-executed symbols. Executed rows move to a separate read-only view or disappear until Phase 4 item 2 builds the trade-history view.
- **Option B:** Change the subtitle to count `tradeRows().length` / `enabledRows().length`, so it matches the visible table.

Option A better honors the phase intent and removes the model inconsistency.

---

## Legibility / polish

### 5. `executed-badge` icon may clip

**File / lines:** `@/c:/aa/projects/rel-str/src/app/features/rh-agent/components/trade-row/trade-row.component.scss:79-84`

```scss
.executed-badge {
  color: var(--mat-sys-primary);
  font-size: 20px;
  width: 20px;
  height: 20px;
}
```

A 20px container for a 20px Material icon can clip descenders/glyph edges. Bump to `24px` or remove explicit sizing.

---

## Verified / approved

- `executedAt` is correctly modeled as an optional string on `RhAgentOccurrenceDecision` and parsed from Firestore.
- `EXECUTED` wins over `ACCEPT` in the group-store status aggregation, so status chips update as expected.
- The optimistic update + rollback pattern in `markExecutedForSymbols` follows the same shape as accept/reject/reset.
- Per-row and batch "Mark Executed" actions are wired through the Order page.
- The design doc Phase 4 item 1 is accurately described.

No file crossed 1000 lines during this change.

---

## Fixes applied

1. **ID-based execution update** — replaced the `markExecutedBatch` query with `markExecutedByIds(ids: string[])`. The store computes the eligible decision IDs from its own cache and passes them to the service, eliminating the missing-index risk and the stale-decision leak.
2. **Read-only executed rows** — added `row().executed` guards to the slide-toggle, inputs, copy button, and remove button; added an `&.executed` background treatment.
3. **Current-run boundary enforced** — because the store derives IDs only from decisions that are `ACCEPT`, `isCurrentInLatestRun`, and not yet executed, the service can no longer touch stale documents.
4. **Executed symbols removed from active order table** — added `activeOrderSymbols` computed to the occurrence-decision store (accepted, current-run, not executed) and repointed the Order page sync to use it.
5. **Executed badge sizing** — bumped icon container to 24px.

Build: passes (`npm run build -- --configuration development --no-progress`).

## Approval bar

- [x] 1. Eliminate the `markExecutedBatch` query by passing decision IDs from the store to the service, or add the required Firestore composite index.
- [x] 2. Make executed trade rows read-only (disable/remove controls).
- [x] 3. Ensure the service-side update can only touch current-run decisions (prefer the ID-based code-judo move).
- [x] 4. Resolve the order subtitle / executed-row mismatch, preferably by filtering executed symbols out of the active order table.
- [x] 5. Fix executed-badge icon sizing.

**Status:** Approved.
