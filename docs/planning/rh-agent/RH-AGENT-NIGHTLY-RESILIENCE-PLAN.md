# RH Agent — Nightly Run Resilience Plan

**Status:** TODO — implement only if nightly run failures are observed in production
**Created:** 2026-07-01
**Related docs:**
- `RH-AGENT-SIGNAL-PERSISTENCE-PLAN.md` (signal-history cutover, Steps 1–5 complete)

---

## Context

The nightly run is the canonical writer of `signal-history`. Every night:

1. `symbolDataSyncNightly` fires at 1:00 AM UTC (6 PM PT) via Cloud Scheduler
2. It enqueues one Cloud Task per symbol to sync price bars from SavantAPI
3. When all tasks complete, it calls `startRhAgentRun(marketDate, 'nightly')`
4. Each symbol's worker runs the strategy and writes to `run-ids/{runId}` and `signal-history/{barDate}`

`signal-history` is only written when `triggeredBy === 'nightly'`. PDR and manual runs skip it.

---

## Failure Modes

### F1 — `symbolDataSyncNightly` fires but `startRhAgentRun` is never called
**Cause:** symbol-data-sync worker throws before reaching the agent trigger, or Cloud Scheduler job is skipped/delayed.
**Impact:** No `rh-agent-runs` doc is created for the day. `signal-history` is never written.

### F2 — `startRhAgentRun` fires but individual symbol workers fail
**Cause:** Cloud Task exhausts retries, worker throws after writing `run-ids` but before writing `signal-history`.
**Impact:** `run-ids` doc exists for the symbol but no `signal-history` doc for that `barDate`. Partial history gap.

### F3 — `signal-history` doc is stale after strategy logic changes
**Cause:** The ST_ZONE_UPTICK strategy is updated but existing `signal-history` docs were written by the old version.
**Impact:** Historical chart dots reflect old logic. Backfill re-run skips existing docs by default.

---

## Mitigations

### 2B — Fallback Cloud Scheduler Trigger

**Addresses:** F1

Add a second `onSchedule` Cloud Function in `rh-agent-trigger.ts` that fires at **3:00 AM UTC** (after the nightly sync window). It:

1. Computes today's `marketDate` (same logic as `getMarketDate()`)
2. Queries `rh-agent-runs` for any doc with `marketDate === today` AND `triggeredBy === 'nightly'`
3. If none found → calls `startRhAgentRun(marketDate, 'nightly')` as a self-healing fallback
4. If already exists → logs and exits (no-op)

**Key detail:** Must skip weekends/holidays. Reuse `getMarketDate()` to get the last valid market date.

**Proposed function name:** `rhAgentNightlyFallback`

**Schedule:** `0 3 * * 2-6` (3 AM UTC Tue–Sat, same day-of-week window as symbolDataSyncNightly)

```typescript
// rh-agent-trigger.ts
export const rhAgentNightlyFallback = onSchedule(
  { schedule: '0 3 * * 2-6', timeZone: 'Etc/UTC', memory: '256MiB', timeoutSeconds: 60 },
  async () => {
    const marketDate = getMarketDate();
    const existing = await db.collection(RH_AGENT_RUNS_COLLECTION)
      .where('marketDate', '==', marketDate)
      .where('triggeredBy', '==', 'nightly')
      .limit(1)
      .get();
    if (!existing.empty) {
      logger.info('rh_agent_nightly_fallback_skip', { marketDate, reason: 'run already exists' });
      return;
    }
    logger.warn('rh_agent_nightly_fallback_triggered', { marketDate });
    await startRhAgentRun(marketDate, 'nightly');
  }
);
```

---

### 1A — Post-Run Gap Validator

**Addresses:** F2

Add a Cloud Scheduler function that fires at **4:30 AM UTC** (after the nightly run window is fully complete). It:

1. Finds the most recent `rh-agent-runs` doc with `triggeredBy === 'nightly'` for today's `marketDate`
2. Queries `run-ids` collection group for all symbols that wrote to this `runId`
3. For each symbol, checks if a `signal-history/{marketDate}` doc exists
4. For any symbol missing a `signal-history` doc: reads the `run-ids` doc and re-writes `signal-history`

This is fully idempotent — safe to run multiple times.

**Proposed function name:** `rhAgentSignalHistoryGapFill`

**Schedule:** `30 4 * * 2-6` (4:30 AM UTC Tue–Sat)

**Implementation location:** New file `rh-agent-gap-fill.ts`

```typescript
// High-level logic
async function fillGaps(runId: string, marketDate: string): Promise<number> {
  // 1. Get all run-ids docs for this runId
  const runIdSnap = await db.collectionGroup(RH_AGENT_RUN_IDS_SUBCOLLECTION)
    .where('runId', '==', runId).get();

  let filled = 0;
  for (const runIdDoc of runIdSnap.docs) {
    const symbol = runIdDoc.data().symbol;
    const historyRef = db.collection(RH_AGENT_SYMBOLS_COLLECTION)
      .doc(symbol).collection(RH_AGENT_SIGNAL_HISTORY_SUBCOLLECTION).doc(marketDate);

    const existing = await historyRef.get();
    if (existing.exists) continue; // already written, skip

    // Re-write from run-ids data
    const entries = Object.values(runIdDoc.data().signals ?? {}) as RhAgentSignalEntry[];
    if (entries.length > 0) {
      const writer = new SignalDateWriter(symbol);
      await writer.writeSignalHistoryDocPublic(runId, entries); // needs public wrapper
      filled++;
    }
  }
  return filled;
}
```

**Note:** `writeSignalHistoryDoc` is currently `private` on `SignalDateWriter`. It needs a `public` or `internal` wrapper method exposed for the gap-filler, or the gap-filler can inline the Firestore write logic directly.

---

### 3A — Separate Canonicalization Step (Deferred)

**Addresses:** F2 (alternative approach)

The idea: decouple `writeSignalHistoryDoc` from the per-symbol worker entirely. Instead of each worker writing its own `signal-history` doc, a single post-run callable would walk all `run-ids` docs for the completed `runId` and write `signal-history` in bulk after all workers finish.

**Advantages:**
- Worker hot path becomes simpler — just writes `run-ids`, no conditionals on `triggeredBy`
- `signal-history` write is independently retryable without re-running the strategy
- Gap-fill (1A) becomes trivial — just re-run the canonicalization step for the runId

**Why it was deferred:**
- Requires a reliable "all workers done" signal. Currently the run completion is detected inside `symbolDataSyncSymbol` after the last task writes back, but there is no durable fan-in event that a separate function can subscribe to without polling
- Cloud Tasks has no native "all tasks in queue finished" callback — would require a counter approach (increment `processedCount` on each worker, trigger canonicalization when `processedCount === totalSymbols`)
- That counter-based fan-in is non-trivial to make reliable under partial retries and would change how the run lifecycle works — the user explicitly wanted to avoid changing run behavior at this stage
- The current approach (worker writes `signal-history` directly when `triggeredBy === 'nightly'`) is simple and already working well. The gap validator (1A) and fallback trigger (2B) cover the failure modes without this architectural change

**Revisit when:** The run lifecycle needs to support post-run hooks for other purposes (e.g. sending a summary notification, kicking off a next-day pre-market scan). At that point, a proper fan-in pattern is worth building.

---

### 4A — Strategy Version Field

**Addresses:** F3

Add a `strategyVersion` string field to `RhAgentSignalHistoryDoc`. Written by the worker at signal-history write time.

**Step 1 — Config:**
```typescript
// rh-agent-config.ts
export const STRATEGY_VERSION = 'st-zone-uptick-v1';
```

**Step 2 — Writer:**
```typescript
// writeSignalHistoryDoc — add to each doc written:
strategyVersion: STRATEGY_VERSION,
```

**Step 3 — Interface:**
```typescript
// RhAgentSignalHistoryDoc
strategyVersion?: string;
```

**Step 4 — Backfill script flag:**
Add `--strategy-version <v>` to `generate-historical-signal-history.ts`. When provided, the script overwrites any `signal-history` doc whose `strategyVersion` field does not match `<v>` (instead of skipping all existing docs).

```typescript
// In the script's skip logic:
if (!OVERWRITE && existing.exists) {
  const existingVersion = existing.data()?.strategyVersion;
  if (!STRATEGY_VERSION_ARG || existingVersion === STRATEGY_VERSION_ARG) continue;
  // version mismatch — fall through to overwrite
}
```

---

## Implementation Order

| Priority | Item | Effort | Risk |
|----------|------|--------|------|
| 1 | **2B** Fallback scheduler trigger | Low — ~30 lines | Low |
| 2 | **1A** Gap fill validator | Medium — ~80 lines | Low (read-heavy, idempotent) |
| 3 | **4A** Strategy version field | Low — field + backfill flag | Low |
| — | **3A** Separate canonicalization step | High — fan-in architecture | Medium — changes run lifecycle; **deferred** |

---

## Files Affected

| File | Change |
|------|--------|
| `functions/src/rh-agent-cloud-function/rh-agent-trigger.ts` | Add `rhAgentNightlyFallback` scheduler |
| `functions/src/rh-agent-cloud-function/rh-agent-gap-fill.ts` | New file: gap validator scheduler |
| `functions/src/rh-agent-cloud-function/rh-agent-signal-date-writer.ts` | Expose `writeSignalHistoryDoc` for gap filler |
| `functions/src/rh-agent-cloud-function/rh-agent-config.ts` | Add `STRATEGY_VERSION` constant + `strategyVersion` field to interface |
| `functions/scripts/generate-historical-signal-history.ts` | Add `--strategy-version` flag |
| `functions/src/index.ts` | Export `rhAgentNightlyFallback`, `rhAgentSignalHistoryGapFill` |
