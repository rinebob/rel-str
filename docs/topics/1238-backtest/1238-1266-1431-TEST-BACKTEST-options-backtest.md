**Topic:** Options Backtest  
**Topic Slug:** backtest  
**Thread:** Backtest Analytics  
**Thread Slug:** backtest-analytics  
**Issue:** #1431  
**Thread Parent:** #1266  
**Topic Parent:** #1238  
**Task:** #1431  
**Domain:** BACKTEST  
**Type:** TEST  
**Status:** Complete  
**Created:** 2026-11-10  
**Last Updated:** 2026-11-12  

# TEST — #1431: Analysis results UAT follow-ups

Coverage plan + results for the twelve items. Layered: pure units (contracts/aggregate/emit util) → worker seams (deps-injected) → store → component → service → live probe.

## Bug 1 — `open` outcome

| Case | Where | Result |
|------|-------|--------|
| No-fire + series ends before FUTURE expiry → `open` | `worker.test.ts` — "no-fire + series ends before a FUTURE expiry → open record" | `outcome:'open'`, `lastBarDate`, `daysHeld` = pick→last-bar, real mae/mfe |
| Same but PAST expiry → stays `error` | `worker.test.ts` — existing truncation cases with pinned `today` | `error: "series ends …"` preserved |
| Per-rule open records (every rule, own excursion) | `worker.test.ts` — "open records carry each rule's own scan excursion" | fired rule → exit; non-fired → open w/ full-window excursion |
| `openCount` in aggregate | `aggregate.test.ts`, `worker.test.ts` | counted separately, excluded from hit-rate denominator (all-open doc → `hitRatePct` undefined) |
| FE render | `backtest-analysis-results.component.spec.ts` — "still open" cell text, real days/excursions, `outcome-open` class, Δ '—' | PASS |

## Bug 2 — expiry-rule hit rate

| Case | Where | Result |
|------|-------|--------|
| `expiry`-kind numerator = `expiredCount` | `aggregate.test.ts` | e.g. 8 expired + 1 open → 8/(9−0err−1open) = 100% (was structurally 0) |
| Other kinds keep `exitedCount` | `aggregate.test.ts` | unchanged |
| Open excluded from all denominators | `aggregate.test.ts` | `contractCount − errorCount − openCount` |

## Bug 3 — all-OTM verification

Live probe `functions/scripts/verify/options-analysis-all-otm-1431.ts` (registered as order 46):

- **Leg A** — `expiredItm === (intrinsicAtExpiry > 0)` per record → 1588 records, **0 violations**
- **Leg B** — census → **511 ITM / 1077 OTM**; early-exit docs (price-100/50, target-90) show ITM-only expired sets — expected matrix semantics, not a bug
- **Leg C** — nearest-the-money spot check `GOOG260220P00315000`: strike 315, underlying close 314.90 at 2026-02-20 expiry, distance 0.03% — stored `expiredItm=true`, intrinsic 0.10 — **recompute exact**

## Items 4–11 — page enhancements

| Item | Where |
|------|-------|
| 4 positions count | component spec — headline "10 positions" |
| 5 run params | component spec — "45DTE 20Δ put (CSP) · from 2026-01-05"; store spec — `templateName`/`startDate` |
| 6 Δ mark | component spec — exit row "-2.25 / -90%", open row '—' |
| 7 MAE % | component spec — "50%" subtext |
| 8 W/L | store spec — `winLossOf` SHORT win/loss/breakeven/open/error matrix + LONG inversion + undefined-side null + partial-ITM (intrinsic < premium → win); component spec — `wl-w`/`wl-l` cells. Semantics refinement (review R1): the spec's "expired-ITM = loss" is interpreted as *terminal* mark — `intrinsicAtExpiry` vs `entryMark` — so partial-ITM expiries (assignment cost below premium collected) count as wins; OTM/full-ITM examples unchanged |
| 9 outcome chips | store spec — filter AND + rebind reset; component spec — Open chip narrows to open rows |
| 10 capital/ROC | component spec — SPY500P → "$50,000" / "0.5% ROC" |
| 11 back nav | component spec — href `/options/strategy/backtest` |

## Item 12 — chart send

| Case | Where |
|------|-------|
| `resultDocToPlottedEntries` marker union | `analysis-results-emit.util.spec.ts` — exit→exitDate, expired→OCC expiry, open→lastBarDate, error→pick-only, same-contract dedupe, sort order, empty |
| `emitEntriesToChart` skips parse | `option-chart-load.service.ts` — shared confirm tail; >50 cancel loads nothing (existing spec still pins) |
| `onResultsDocId` | `option-chart-services.spec.ts` — success emit, missing doc, failed doc, fetch error, empty records — each names its error, no silent emit |
| `?results=` deep link | `option-chart-list.spec.ts` — plots with markerDates, no picker, consumed once + replaceUrl cleared |

## Verification results (2026-11-10)

- `tsx --test tests/functions/options-analysis/` — **68/68**
- jest (touched files) — component 23/23; store + emit + chart specs green
- `tsc --noEmit` app + spec configs — clean
- `npm run build:functions` — clean
- Live probe — **PASS** on 24 prod result docs
- `typecheck:tests` — pre-existing failures in foreign-session files only (paper-trading, rh-agent-mcp, position-groups); none in options-analysis/options-replay
