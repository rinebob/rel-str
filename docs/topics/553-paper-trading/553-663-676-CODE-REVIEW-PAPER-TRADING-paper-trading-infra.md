**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Trade Exits  
**Blueprint:** #663 (BE)  
**Task:** #676  
**Topic Parent:** #553  
**Domain:** PAPER-TRADING  
**Type:** CODE-REVIEW  
**Status:** PASS (2 rounds — round 2 converged, no new findings)  
**Created:** 2026-09-30  
**Last Updated:** 2026-09-30  

# Code Review — #676 BE mark coverage for signal-source trades

## Scope

| File | Change |
|---|---|
| `functions/src/paper-trading/passes/signal-mark-pass.ts` | NEW — `runSignalMarkPass` + `defaultSignalMarkDeps` (OPEN SIGNAL trades → `netExitPrice` mark → atomic write) |
| `functions/src/paper-trading/engine/position-repository.ts` | `markSignalTrade` — marks + legs.lastMark + unrealizedPnl + raw-quote txn (mark taken directly, no ÷100) |
| `functions/src/paper-trading/engine/options-strategy-passes.ts` | wired into `optionsMarkPass` (every-30min market-hours schedule) + `optionsMarkPassManual` |
| `tests/functions/paper-trading/signal-mark-pass.test.ts` | NEW — 5 tests |
| `tests/functions/paper-trading/exit-eval-pass.test.ts` | +1 — governing trailing-8 on a SIGNAL trade closes at the mark |
| `functions/package.json` | test registered in `test:paper-trading` |
| `functions/scripts/verify/paper-trading-signal-marks-676.ts` + `scripts/verify/paper-trading-signal-marks-676.md` | prod verify + guide |
| `functions/scripts/verify/run-all.ts`, `scripts/verify/run-all.ts`, both READMEs | registration |

## Test results

- `signal-mark-pass.test.ts`: 5/5; eval-pass suite: 12/12; full
  `test:paper-trading`: 127/127; `tsc --noEmit` + `npm run build` clean.
- Prod verify: `paper-trading-signal-marks-676.ts` — **5/5 checks;
  marked all 11 real OPEN signal trades** with live RH quotes.

## Round 1 — 3 axes (standards / spec / thermo)

| # | Finding | Fix |
|---|---|---|
| S1 | Verify script never injected `d.id` → per-trade mark check keyed on `undefined` (vacuous) | `({id: d.id, ...data})`; strengthened all checks |
| F1 | Leg-less trade → `netExitPrice` returns finite `0` → fabricated `mark=0` could fire stops | pass skips `!trade.legs.length` (mirrors close-callable guard) |
| F2 | Order-level net mark stamped on every leg's `lastMark` — multi-leg would corrupt `positionValue`/stats | `markSignalTrade` stamps `lastMark` only when `legs.length === 1` (same guard as `applyExitFill`) |
| F4 | No status re-check in the txn — marks/nonzero `unrealizedPnl` could land on a CLOSED doc | txn returns `false` on non-OPEN → pass counts as skipped |
| F5/S3/S5 | `skipped` was a bare count; errors unlogged; errors path untested | `skippedTradeIds[]`; `logger.warn` per skip/error; 3 new tests (throw → errors[], legless, expired-option) |
| S7 | Signal pass shared the try with instance marking — one stage's failure killed both | isolated try/catch per stage in scheduled + manual fns |
| S4 | `markSignalTrade` in position-repository (module-level db, wrong home) | moved to `repository.ts`, `db`-first param like siblings |
| F6 | Synthetic `rawResponse` discarded real quotes | `netExitBreakdown` returns per-leg quotes → raw-quote doc carries them; `netExitPrice` kept as scalar wrapper |
| — | `unrealizedPnl: 0` on missing entry fill | `?? trade.unrealizedPnl` fallback; cast dropped |

**Deferred:** signal-option expiry has no settlement path → follow-up  
issue **#720** filed; the pass classifies expired legs as errors so
zombies are visible. Batched quote fetch (F8) deferred — ~15 trades.

## Post-fix verification

- `signal-mark-pass.test.ts`: 8/8; full `test:paper-trading`: 130/130;
  `tsc --noEmit` + build clean.
- Prod verify (honest re-run): **6/6 checks, 15 OPEN signal trades all
  marked**, per-trade assertions real (ids, fresh-mark equality,
  lastMark==mark, eval-eligible set non-empty).
