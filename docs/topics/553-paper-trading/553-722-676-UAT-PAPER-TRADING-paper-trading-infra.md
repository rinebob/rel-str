**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Trade Exits  
**Blueprint:** #663 (BE)  
**Task:** #676  
**QA Issue:** #722  
**Topic Parent:** #553  
**Domain:** PAPER-TRADING  
**Type:** UAT  
**Status:** PASS  
**Created:** 2026-09-30  
**Last Updated:** 2026-09-30  

# UAT — #676 BE signal-trade mark coverage

## Scope

Signal-source OPEN paper trades previously received marks only at fill
time — the engine mark pass iterates strategy-instance trades, so signal
trades' governing `trailing-8` runs could never fire. #676 adds
`runSignalMarkPass` (option legs via RH option quotes, share legs via
`get_equity_quotes`), `markSignalTrade` (repository write seam), wiring
into `optionsMarkPass` / `optionsMarkPassManual`, and a prod verify
script.

## Scenarios

| # | Scenario | How verified | Result |
|---|---|---|---|
| 1 | OPEN signal trades marked under the PT market-date key with live quotes | prod script `paper-trading-signal-marks-676.ts` — `marked === population`, every trade `marks[ptDate].mark` finite | ✅ 15/15 marked |
| 2 | Single-leg `lastMark` updated to the fresh mark | same script — `lastMark === marks[ptDate].mark` per single-leg trade | ✅ |
| 3 | Marked signal trades are eval-eligible (mark + ACTIVE governing run) | script eval-eligibility check + `exit-eval-pass` unit test (trailing-8 closes SIGNAL trade at the mark) | ✅ 15 eligible |
| 4 | Quote-miss / legless / expired / mid-pass-close handled honestly | unit tests: skip counted w/ `skippedTradeIds`, legless skip (no fabricated mark=0), expired option leg → errors[], txn OPEN re-check | ✅ 8/8 pass tests |
| 5 | Errors isolated per trade; stages isolated in orchestrator | unit test (throw → errors[], pass continues); scheduled + manual fns wrap each stage in its own try/catch | ✅ |
| 6 | Audit trail — raw-quote doc carries real per-leg quotes | `netExitBreakdown` returns leg marks → persisted in `rawResponse.legs` | ✅ |
| 7 | Registered in both run-alls + both verify READMEs; guide present | grep registration; functions run-all sweep | ✅ |

## Test evidence

- `signal-mark-pass.test.ts` — 8/8 (mark write, quote-miss skip, equity
  leg, PT-date normalization, errors[] on throw, legless guard, expired
  leg → error).
- `exit-eval-pass.test.ts` — +1: governing `trailing-8` on a SIGNAL trade
  exits at the mark.
- `npm run test:paper-trading` — 130/130; `tsc --noEmit` clean on this
  change set; `npm run build` clean.
- Prod verify `paper-trading-signal-marks-676.ts` — **6/6 checks**,
  marked all 15 OPEN signal trades with real RH quotes.

## Follow-ups filed

- **#720** — signal-source option trades have no settlement path at
  expiration (pre-existing gap surfaced by review; pass classifies
  expired legs as errors so zombies are visible).

## Residual notes

- Root `scripts/verify/run-all.ts` sweep has 2 pre-existing failures
  unrelated to paper trading (`swing-605`, `portfolio-586` —
  `firebase-admin` resolution from repo root).
