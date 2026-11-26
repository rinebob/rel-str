**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading  
**Thread:** Signal Selection  
**Thread Slug:** signal-selection  
**Issue:** #1655  
**Thread Parent:** #1117  
**Topic Parent:** #553  
**Blueprint:** #1648  
**Domain:** FE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-25  
**Last Updated:** 2026-11-25  

# Code Review — #1655: FE-IMPL chart + signal markers on /signals/symbol-review

**Verdict: PASS** — one pass, three axes run in parallel; 2 majors +
several minors fixed in-gate; no blockers remain. AC1–AC6 verified
against the diff (AC5 acceptably deferred — spec says "if cheap", click
plumbing through flex-chart is not cheap).

## Axes

| Axis | Result | Findings |
|------|--------|----------|
| Standards (repo conventions + Fowler baseline + contract baseline) | PASS after fix | 1 major-ish dead import, 2 minors, judgment calls |
| Spec (ACs + IMPL/TEST Phase-2 sections) | MET ×5 + 1 deferred | 1 nit (stale-bars concern, shared with Thermo major #2); no test gaps |
| Thermo-nuclear (races, state leaks, structural) | PASS after fix | 2 majors, 2 minors, 2 nits |

## Majors fixed in-gate

1. **Markers keyed to the bundle but not to the bars** (Thermo major #2,
   Spec nit — same concern). `loadCharts` blanks `symbolDataVersion`
   but not `dailyData`, so on an AAPL→MSFT switch the new MSFT bundle
   could briefly plot against the *previous* symbol's bars — any date
   that exists in both datasets produces a dot at a wrong-symbol close.
   The `reviewMarkers` computed now guards both reads by symbol:
   `bars?.symbol !== b.symbol → []` (`symbol-review.component.ts`).
   Regression pin: "does not plot against the previous symbol's bars
   while the new fetch is in flight".
2. **Duck-typed bar lookup + `as any` casts copied from dead prior art**
   (Thermo major #1). `uptickDotsFromHistory` — the pattern my converter
   was cloned from — has zero live callers and keyed on `date`/`d`
   fields its own signature doesn't declare. Both converters now share
   a `barIndexByDate(bars: PriceBar[])` helper keyed on the real
   required `date` field; all four casts deleted; `bar?.close` +
   early-continue replaces the falsy-close dance
   (`signal-marker-converters.ts`).

## Minors fixed in-gate

- **Dead `ST_SIGNAL_DOTS_INDICATOR` import** removed
  (`signal-marker-converters.ts:8`).
- **`_V1_`/`_V2_` substring family detection** → anchored `/_V(\d+)_/`
  version extraction (same family-detection shape as `signalTradeDesc`,
  `shared/paper-trading-ids.ts:96`); non-V-family types still fall back
  to `ST_SIGNAL_DOT_COLORS`.
- **`base + '59'` hex concat** → `ST_SUPPRESSED_DOT_COLORS[base]` lookup
  (the map covers all four uptick hues; the signal palette aliases V1).
  The `+ '59'` concat remains as a defensive fallback for a future base
  color outside the map.
- **Spec fixtures** — `dailyBars` stubs gained `symbol` to match
  `ChartDataset`; one new spec pins the stale-bars regression.
- **Comment added** documenting that checked-ness is color-only — the
  scatter renderer has no hollow/outline channel (#1679 established
  the alpha-ghost convention instead).

## Judgment calls / non-blocking

- `uptickDotsFromHistory` retained — zero live callers but exported
  barrel API; it now shares `barIndexByDate` so it stays honest if
  resurrected. Deletion is a bigger decision than this gate.
- Inert `ibsLongColor`/`ibsShortColor` params on the reused uptick-dots
  indicator config — harmless passthrough, same as `addSuppressedDots`.
- AC5 (row↔marker hover/click affordance) deferred — requires marker-
  click plumbing through flex-chart; spec's "if cheap" clause allows it.
  Candidate for a follow-up task if desired.
- `'59'` alpha literal kept as named const `REVIEW_UNCHECKED_ALPHA`
  (fallback path only).

## Spec coverage added during review

- "does not plot against the previous symbol's bars while the new fetch
  is in flight" — the major-#2 regression pin.

## Verification

- `npx jest --coverage=false` — **342/342 suites, 6,770 tests** green.
- `tsc --noEmit` — 0 errors on all touched files (2 pre-existing
  foreign errors in `scripts/bulk-swing-sweep.ts` +
  `portfolio-dashboard.store.spec.ts` — other sessions' uncommitted
  work, untouched).
- Focused: **88/88** across converter / base-indicators / signal-detail /
  symbol-review specs.

## Files

- `src/app/features/savant-trader/utils/chart-indicators/signal-marker-converters.ts` + `.spec.ts` (new)
- `src/app/features/savant-trader/utils/chart-indicators/base-indicators.ts` + `.spec.ts`
- `src/app/features/savant-trader/utils/chart-indicators.ts` (barrel)
- `src/app/features/savant-trader/components/signal-detail/signal-detail.component.{ts,spec.ts}`
- `src/app/features/savant-trader/pages/symbol-review/symbol-review.component.{ts,html,scss,spec.ts}`
