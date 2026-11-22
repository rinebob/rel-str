# Verify — #1503 legacy simulator deprecation note

| | |
|---|---|
| **Script** | `functions/scripts/verify/options-simulator-deprecation-1503.ts` |
| **Run** | `cd functions && npx tsx scripts/verify/options-simulator-deprecation-1503.ts` |
| **Scope** | `runBacktestSimulation` (backtest-simulator.ts) + its task-queue callable entry `stBacktestPermutation` (backtest-worker.ts) — the legacy daily-bars simulator superseded by Selection Replay + Backtest Analytics (Threads #1240/#1266/#1270). Comment-only change: marker present on both surfaces, no callers removed or changed |
| **Stages** | DRY only: static source assertions — no credentials, no env, no Firestore. Instant, run-all safe |

## What it verifies — 14 checks

### Superseded marker on `runBacktestSimulation`

- A JSDoc block sits directly above the export (trailing whitespace only — an unrelated earlier comment can't satisfy the check).
- The marker names the superseding surface ("superseded by Selection Replay + Backtest Analytics"), the superseding Threads `#1240`/`#1266`/`#1270`, and the policy ("retained for reference", "do not extend"), and carries the `@deprecated` tag.
- Comment continuation lines are normalized before matching, so phrases that wrap mid-sentence still match.

### Superseded marker on `stBacktestPermutation`

- Same assertions on the comment directly above the task-queue callable export.

### No callers removed or changed

- `backtest-worker.ts` still imports `runBacktestSimulation` and still `await`s it.
- The simulator's export signature head is unchanged (`symbol, strategy, config, dailyBars, …`).
- The callable is still re-exported from `functions/src/index.ts`.

## Result history

| Date | Stage | Result |
|---|---|---|
| 2026-11-22 | DRY | 14/14 pass |
