# #1247 — Engine open pass ladder cadence (one position per cadence period)

Verifies `runOpenPass` (paper-trading engine) no longer treats an instance
as serial. Pre-#1247 any existing OPEN position skipped the pass with
`existing_position` — one position at a time, held to expiration, so a
ladder cadence was unreachable. The fix opens one new position per cadence
period while prior positions stay open, with same-day idempotency and an
optional `maxOpenPositions` cap.

## What it checks

- Seeds two scratch strategy instances + `daily-analysis/latest` sims:
  - `verify-1247-inst` (daily, symbol `VTSY`) with a **yesterday-open**
    strategy trade — the old `existing_position` gate would skip here.
  - `verify-1247-inst-cap` (`maxOpenPositions: 1`, symbol `VTSZ`) with a
    yesterday-open trade.
- Runs the real `runOpenPass` with all-default deps (real Firestore
  readers/writers; brokerage order placer is the built-in STUB — no real
  order is placed).
- **AC1** — instance A opens a NEW position (`skipped=false`,
  `positionId = buildPositionId(config, date)`); the trade doc + raw quote
  persist; the instance now holds **two concurrent** open positions.
- **AC2** — same-day re-run skips `already_opened_today`; no third
  position.
- **AC3** — capped instance skips `max_open_positions` (distinct reason).
- **AC4** — `cap=1` preserves the old single-position behavior.
- Stats honesty: instance-A stats scope gets +1/+premium and the global
  `stats/ALL` doc increments — then `ALL` is restored to its pre-run
  snapshot (the scratch open must not leak into prod aggregates).

**Coverage note:** the script exercises the **daily** cadence end-to-end.
Weekly cadence (`already_opened_in_period`, closed-leg mid-period blocking)
is covered by unit specs only — `open-pass.test.ts`
(`weekly instance skips …`, `weekly instance skips when the in-period leg
already closed`).
- All scratch docs deleted and verified gone: instances, `daily-analysis`
  docs, trades, raw quotes, accounts, per-instance stats.

## Run

```bash
cd functions
npx tsx scripts/verify/paper-trading-engine-open-1247.ts
```

Needs ADC (Firestore). No RH MCP — the order placer is a stub. Expect one
harmless `[ScreenshotLifecycle]` bucket warning when run locally: entry
fills fire a screenshot capture that needs a storage bucket only prod
configures.

Pass = `15 passed, 0 failed`. A FAIL line names the assertion; `FATAL`
means the pass threw (e.g., missing sim doc → `null` result, or
`createPosition: instance … not found` — the seeded doc must satisfy the
`getInstance` shape validator: symbol, optionType, side, phases).

Script: `functions/scripts/verify/paper-trading-engine-open-1247.ts`
