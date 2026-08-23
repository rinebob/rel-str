# ADR-005: SDS Completion Detection — Symbol Set Reconciliation

## Status

Accepted

## Context

The SDS pipeline processes stock symbol data across three intervals (DAILY, WEEKLY, MONTHLY) per POST sequence (A, B, C). Each interval run dispatches one Cloud Task per symbol to the `symbolDataSyncWorker` queue. The pipeline must detect when an interval run is "complete" so it can fire sequence fan-in and dispatch downstream consumers.

### The problem with count-based completion

The initial implementation (Task #167) uses `processedCount >= totalSymbols` as the completion trigger. The worker's `finally` block increments `processedCount` on every invocation via `FieldValue.increment(1)`.

This has two holes:

1. **Retry inflation.** Cloud Tasks retries failed tasks (`maxAttempts: 3`). If a worker throws after the `finally` block runs, the retry increments the counter again for the same symbol. `processedCount` can exceed `totalSymbols` and fire completion early while symbols have no data.

2. **Silent drops.** If a task is never dispatched, `processedCount` never reaches `totalSymbols`. The watchdog force-completes, but there is no record of which symbols were never attempted.

## Decision

Replace the count-based trigger with **symbol set reconciliation**.

### Run document schema

```
symbols: string[]              // expected symbols (set at creation, never modified)
processedSymbols: string[]     // attempted symbols (arrayUnion in finally block)
```

### Worker write

```
processedSymbols: FieldValue.arrayUnion(payload.symbol)
```

`arrayUnion` is idempotent — retries don't inflate the set.

### Completion trigger

```
processedSymbols.length >= symbols.length
```

Every expected symbol has been attempted. Failed symbols just don't have data — downstream consumers already handle missing data gracefully.

### Watchdog

Force-completes runs with no activity for **5 minutes** (changed from 15). The full run processes ~100 symbols at 50 concurrent / 20 per second — total runtime is 1-2 minutes. 5 minutes is a generous backstop. Sequences get 8 minutes (3 intervals × ~2 min + buffer).

## Consequences

- **+ Retry-proof**: duplicate task executions do not inflate the completion signal.
- **+ Simple schema**: two arrays on the run doc, ~6KB for 500 symbols.
- **+ No failed/success bookkeeping**: if a fetch fails, the symbol just doesn't have data. Downstream consumers handle gaps.
- **− Larger run docs**: ~6KB vs ~0.5KB for counters. Negligible.
- **− Migration**: existing run docs use count-based schema. Compatibility check needed for in-flight runs during deployment.
