# Implementation Plan — FE: Today's Option Pricing View

**Topic:** Current option pricing  
**Topic Slug:** current-option-pricing  
**Thread:** Today's option pricing view  
**Thread Slug:** today-option-pricing-view  
**Issue:** #490  
**Thread Parent:** #487  
**Topic Parent:** #486  
**Domain:** OPTIONS  
**Type:** IMPL  
**Status:** Complete  
**Created:** 2026-09-22  
**Last Updated:** 2026-09-22  

Single-area plan: **FE only**. The callable, contracts, and bar service
already exist; no BE or SHARED work.

## Boundary

The page is self-contained under
`src/app/features/savant-trader/pages/option-chain/`. It imports:

- `OptionsContractService.getHistoricalOptionsChain$(symbol, date)` —
  feature-shared service (verified at `services/options-contract.service.ts:152`)
- `LocalBarReadService.getDailyBarsForRange$(symbol, from, to)` — core
  service (verified at `core/services/local-bar-read.service.ts:171`)
- `HistoricalOptionContract`, `GetHistoricalOptionsChainResponse` from
  `@options-contract/contracts` (carries mark/last/bid/ask/sizes/volume/
  open_interest/IV/Δ/Γ/Θ/V/ρ — all optional strings)
- `MatDatepicker` (in use: spread-builder-dialog, option-chart)

It does **not** import anything from `pages/option-chain-pct-change/`.
Identical patterns (delegated cell handlers, precomputed row view-models,
chain-response unwrap) are re-implemented in page-local utils — smaller and
simpler here because there is no start→target comparison, no saved configs,
no swing-compare.

## Files

```
pages/option-chain/
  option-chain.component.ts        — page shell: header, filter panel, grids
  option-chain.component.spec.ts
  option-chain.store.ts            — NgRx signalStore
  option-chain.store.spec.ts
  components/
    chain-grid.component.ts        — one side's strikes×expirations grid
    chain-grid.component.spec.ts
    chain-cell-popup.component.ts  — hover popup, full contract payload
    chain-cell-popup.component.spec.ts
  utils/
    chain.utils.ts                 — snapshot → cell/row models, chg calc
    chain.utils.spec.ts
    session-resolution.utils.ts    — PT-boundary resolve + walk-back
    session-resolution.utils.spec.ts
```

Route: add `OPTION_CHAIN = 'savant-trader/option-chain'` to `AppRoutes`
(full-path enum value, same pattern as `SWING_ANALYSIS`)
(`core/common/interfaces.ts`), lazy route in `core-routes.ts` mirroring the
`OPTION_CHAIN_PCT_CHANGE` entry, nav entry in `constants.ts` sidenav list
(label: "Option Chain").

## State

```text
symbol, dateInput, resolvedDate, source ('gcs' | upstream)
sessionSnapshot, priorSnapshot   — HistoricalOptionContract[] keyed by contractID
loading, error, resolvedNoData
filter { type: CALL|PUT|BOTH, strikeGte/Lte, expGte/Lte,
         deltaGte: -0.6, deltaLte: 0.6 }
orientation { calls: 'desc', puts: 'desc' }   // 'desc' = high strike at top
underlying: { sessionClose, priorClose }
```

`grids` is a computed: filter snapshot → build `ChainCell`s → group into
`GridRow`s (strike → cells per expiration) per side.

## Session resolution

`resolveSessionDate(now: Date): string` — if `now` (America/Los_Angeles) is
before 1:00 PM PT, start candidate = prior trading day; otherwise today.
`fetchResolvedChain$(symbol)` walks back from the candidate skipping
Sat/Sun, calling `getHistoricalOptionsChain$` until a snapshot with
contracts returns; cap 7 calendar days → `resolvedNoData`. The prior-session
snapshot is the same walk starting one trading day before the resolved
date. Manual date entry bypasses resolution — the picked date is fetched
directly (no walk-forward, but its prior session still walks back); a
"Today" button re-runs resolution.

## Change computation

Match session vs prior contracts by `contractID`. `chgAbs = mark −
priorMark`, `chgPct = chgAbs / priorMark`. Missing `mark` → cell price
"n/a" (no fallback). Missing prior contract/mark → chg "n/a".

## Layouts

- **CALLS / PUTS** — one `chain-grid` for that type.
- **BOTH** — shared strike column (union of both sides' strikes, filtered),
  calls grid left, puts grid right. Each side applies its own
  `orientation` toggle; sides may differ.

## Cell / popup

Cell shows mark (or "n/a"), chg $, chg %, delta, IV — precomputed
`ViewCell` strings per grid change; delegated `mouseover`/`mouseout` on the
grid body (same perf contract as pct-change grid: no per-cell components,
OnPush). Hover opens one overlay per grid anchored to the cell element,
rendering `chain-cell-popup` with the full payload: contractID, mark, last,
bid/ask + sizes, volume, OI, IV, delta, gamma, theta, vega, rho, chg $/%,
prior mark.

## Header

Symbol + company name (tracked-symbol profile when available), underlying
session close and prior-session close (last two daily bars at/before
resolvedDate via `getDailyBarsForRange$`), displayed session date, and
snapshot source label.

## Errors / empty states

Fetch failure → error banner with the failed date. Resolution exhausted →
"no chain data found in the last 7 days" state. Filtered-empty → existing
"No contracts matched the current filters." message.

## Phases → tasks

- **P1 Scaffold + data spine:** route/page skeleton; session-resolution
  utils; store fetch pipeline (session + prior + bars).
- **P2 Grid:** chain-grid component with cells; chg vs prior; BOTH layout +
  per-side orientation.
- **P3 Interactions + polish:** hover popup; filters panel; header;
  datepicker + Today button; empty/error states.
