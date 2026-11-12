**Topic:** Options Backtest  
**Topic Slug:** backtest  
**Thread:** Backtest Analytics  
**Thread Slug:** backtest-analytics  
**Issue:** #1431  
**Thread Parent:** #1266  
**Topic Parent:** #1238  
**Task:** #1431  
**Domain:** BE + FE + SHARED  
**Type:** IMPL  
**Status:** Complete  
**Created:** 2026-11-10  
**Last Updated:** 2026-11-12  

# IMPL — #1431: Analysis results UAT follow-ups

Twelve follow-ups from the #1425/#1435 UATs — three worker/contract bugs and nine results-page enhancements, plus the chart send from the original analysis-results vision.

## Bugs

### 1. `open` outcome for future-expiry contracts

`noFireOutcome` in `records.ts` wrote `error: "series ends X before expiry Y"` for any series not reaching the expiry bar — but a contract expiring in the **future** can't reach it, so every live position reported as an error under every rule.

- New `AnalysisOpenTrade` union member: `outcome: 'open'` with `lastBarDate`, real days-held-so-far (`pickDate → lastBarDate`), and the rule's own scan excursion.
- `noFireOutcome` gains a `today` param (PT date): `!reachedExpiry && expiration > today` → `open`; truncated past-expiry series stays `error`.
- Non-fired rules still share one `sharedNoFire` record — correct because a non-fired scan always spans the same expiry-clipped window (see `evaluateExit`), so per-rule excursions coincide by construction.
- `AnalysisWorkerDeps.getToday` seam added (defaults `getMarketDatePT`) so tests pin "today" deterministically.
- `ExitTypeAggregate.openCount` added; open records excluded from the hit-rate denominator alongside errors.
- `EXIT_REGISTRY_VERSION` 1 → 2 — pre-#1431 docs carry wrong outcome/hit-rate semantics and must render stale.

### 2. Hold-to-expiry hit rate

`hitRatePct` was `exitedCount / (contractCount − errorCount)` — structurally 0 for the `expiry` rule (it can never fire). Hit rate is now kind-aware: `expiry`-kind rules use `expiredCount / (contractCount − errorCount − openCount)` — "hit" = reached expiration. All other kinds keep `exitedCount` numerator; open records excluded from every denominator.

### 3. All-OTM verification

Suspicion that every expired record reported OTM. Probe `options-analysis-all-otm-1431.ts` (three legs): intrinsic↔ITM invariant per record, per-doc ITM/OTM census, nearest-the-money recompute against `getCachedBarsFromSymbolData`. **Result:** 1588 expired records — 511 ITM / 1077 OTM, zero invariant violations; spot check `GOOG260220P00315000` (strike 315, close 314.90) recomputes exactly. The early-exit docs show ITM-only expired sets — correct matrix semantics (an OTM put decays into the profit target → 'exit'; only adverse paths survive to expiry). No bug.

## Results-page items

| # | Item | Implementation |
|---|------|----------------|
| 4 | Position count | `store.positionCount` — `contractCount` from the first success doc; headline `N positions` |
| 5 | Run params | Headline `symbol · templateName · N positions · from startDate`; template name via `getReplayTemplate`, `startDate` from the run doc (`watchRunDoc` — runId IS the listDocId under #1430) |
| 6 | Row Δ mark | `priceChange()`: exit → `exitPrice − entryMark`; expired → `intrinsicAtExpiry − entryMark`; open/error → '—'; both delta and % rendered |
| 7 | MAE % | `maePct()` subtext in the MAE cell — `mae/entryMark × 100` |
| 8 | W / L | `winLossOf()` — template-side-aware: SHORT (CSP) — exit below entry or expired-OTM = win, exit above or expired-ITM = loss; LONG inverts; open/error/breakeven neither. New `W / L` aggregate column |
| 9 | Outcome chips | `outcomeFilter` (All/Exit/Expired/Open/Error) AND'd with the existing exit-type chips; both reset on `watchList` rebind |
| 10 | Capital / ROC | `capitalRoc()` — strike from `parseOccContractId`; capital = `strike × 100`, ROC = `entryMark / strike` |
| 11 | Back nav | `← Backtest` link → `/options/strategy/backtest` |
| 12 | Chart send | Per-rule `chart` link in the aggregate table → `/options/chart?results={listDocId}_{exitId}` |

### Item 12 plumbing

- `resultDocToPlottedEntries` (`analysis-results-emit.util.ts`) — one `PlottedEntry` per unique contract; `markerDates` = pick days ∪ each record's terminal marker (`exitDate` / OCC expiration / `lastBarDate` for open / pick-only for error). The exit price rides implicitly — the dot lands on the plotted series at that date.
- `OptionChartLoadService.emitEntriesToChart` — pre-built `PlottedEntry[]` skip parsing into the shared >50-confirm + `loadPlotted` tail. `confirmAndLoad` now returns whether it loaded so the textarea write stays behind the confirm (cancel can't leave the field disagreeing).
- `OptionChartListService.bindResultsDeepLink` + `onResultsDocId` — `?results=` is consumed once (replaceUrl, same as `?list=`); missing/failed/empty docs name their error via `listErrorText`; cross-symbol docs switch the page first.

## Files

**SHARED:** `options-analysis-contracts.ts` (+`AnalysisOpenTrade`, `openCount`), `options-analysis-registry.ts` (v2).

**BE:** `records.ts` (open/error split on `today`), `aggregate.ts` (`openCount`, kind-aware hit rate, open-excluded denominator), `worker.ts` (`getToday` seam, outcome comment), `scripts/verify/options-analysis-all-otm-1431.ts` (new probe), README/run-all registration.

**FE:** `analysis-results.store.ts` (runDoc stream, outcomeFilter, winsLosses, header computeds), `options-replay-runs.service.ts` (`watchRunDoc`), `options-analysis-runs.service.ts` (`getResultDoc$`), converter `openCount` default, results page (TS/HTML/SCSS), `analysis-results-emit.util.ts` (new), `option-chart-load.service.ts`, `option-chart-list.service.ts`, `option-chart.component.ts` (`bindResultsDeepLink` line only — the chips-column hover/pin work in the same file is a different session's #1423).

## Tests

- `tests/functions/options-analysis/worker.test.ts` — open outcome (future-expiry truncated → open, real excursion/lastBarDate/daysHeld, openCount, zero-denominator hitRate), per-rule open records, past-expiry truncation stays error
- `tests/functions/options-analysis/aggregate.test.ts` — `openCount`, open excluded from denominator, expiry-kind `expiredCount` numerator
- `analysis-results.store.spec.ts` — outcome filter semantics, `winLossOf` both sides, header computeds
- `backtest-analysis-results.component.spec.ts` — all nine page items rendered
- `analysis-results-emit.util.spec.ts` — marker unions per outcome
- `option-chart-services.spec.ts` / `option-chart-list.spec.ts` — `onResultsDocId` outcomes, `?results=` deep-link consume + plot

**Verified:** BE `tsx --test` 68/68, jest specs green, `tsc` app + spec configs clean, functions build clean, probe PASS on live docs.
