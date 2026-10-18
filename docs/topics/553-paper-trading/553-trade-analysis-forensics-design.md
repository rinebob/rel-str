**Topic:** Paper Trading Infra  
**Type:** DESIGN NOTE (unticketed — feeds #906 planning + a future Thread)  
**Status:** Draft  
**Created:** 2026-10-17  

# Trade Analysis & Signal Forensics — Design Note

Capture of the analytical-layer direction discussed after the #904 pipeline
went live. Goal: paper trading as the platform for answering "how would this
signal have done" — a page for scatter-plot exploration across entry
dimensions plus TradeStation-style performance reports.

## Layered architecture

```
Layer 0 — extraction  : flat row per trade (entry→exit lifecycle + computed
                        metrics). Exists today as CSV export scripts.
Layer 1 — storage     : materialized per-trade analysis docs so the FE reads
                        rows, never computes walks.
Layer 2 — page        : scatter / heatmap / distributions / TS-style report /
                        per-trade drawer. Thin client over Layer 1.
```

Two data sources feed the same row schema:

- **Live trades** — `paper-trading/trades/items` (source='signal'). Lifecycle
  facts are recorded by the ledger (fills, marks, exitEvents); the exporter
  enriches with excursion stats from SDS bars.
- **Synthetic trades** — #906 replay. Signals are regenerated over historical
  SDS bars via the same pure functions the live strategy uses
  (`computeStTrendBands` → `computeStZone`/`V2` →
  `detectAllStTrendRiderSignals`), then each occurrence walks the trailing-stop
  rule forward. Verified on AMAT: 99 trades over ~4y, replayed 2026-10-15
  V2_SHORT matches the real live trade.

## Row schema (the contract everything shares)

Identity: `tradeId, signalId, symbol, signalType, signalTimeframe, direction,
captureList, signalBarDate, sector, industry, capTier, cohortId, governingVariant,
signalStatus, signalRunId`

Lifecycle: `createdAt, entryDate, entryPrice, quantity, exitDate, exitPrice, exitReason,
symbolMovePct (direction-neutral), tradeRetPct (direction-aware), realizedPnl,
unrealizedPnl, daysHeld, lastMark, lastMarkDate`

Excursion: `mfePct, maePct, mfeDate, maeDate, daysToMfe, givebackRatio, excursionSource`

Counterfactuals: `shadowOutcomes` (non-governing variant results)

Entry features: `ind.*` — sparse union of signal indicator keys (today:
`zoneV1, zoneV1Prev, zoneV2, zoneV2Prev, delta, windowV2`)

Computed context: `strength.diPlus, strength.diMinus, strength.diHist,
strength.adx` — ST Trend Strength (DI+/−, ADX) sampled at the entry bar.
Computed at export time from `computeStTrendStrength` over SDS bars, so it's
retroactive — no signal-writer stamp needed and old trades get real values.
`strength.diHist` is the first continuous entry-feature column (proper
scatter axis, not a strip chart).

Conventions:
- Entry-day excursion excluded (live fills ~2:20pm PT; entry-day high/low
  predates entry). Excursion starts on the next bar.
- OPEN trades are right-censored: `exitReason='OPEN'`, marked to latest.
- Direction-aware math throughout (shorts gain on negative symbolMovePct).
- Weekly signals fire on the weekly bar but the lifecycle still walks
  DAILY closes — same as live (nightly eval reads daily marks for every
  trade regardless of signal timeframe).
- Option-leg excursion uses the daily marks map (`excursionSource='marks'`) —
  coarser grain than share `bars`; never silently blended.
- Option returns are premium-basis %, not capital-basis. Add
  `pnlPctOnCapital` (P&L ÷ capitalRequired) before mixing option and equity
  outcomes in the same column.

## Page views

### Dataset strip
Filters that define the cohort under analysis: source (live / synthetic /
both), signalType, direction, sector/industry/capTier, date range, zone state
at entry, capture list. `n=` always visible.

### Scatter explorer (the primary ask)
- x: any entry feature (`ind.*`, sector, capTier, daysToMfe, ...) — discrete
  values get jitter or strip-chart rendering
- y: `tradeRetPct` (or `symbolMovePct`, `mfePct`, `givebackRatio`, `daysHeld`)
- color: exitReason or outcome sign; facet by signalType × direction
- click a point → trade drawer
- Sweet spots/danger zones read as clusters; the analysis page should let
  the user lasso a region and see the cohort stats for just those points.

### Slice heatmap
Pivot table, signalType × zone-state (or sector, month, capTier), cell =
avgRet with color intensity, tooltip shows n + hit rate. The slice table is
the takeaway view — this is where "V2 longs at zone 4 bleed" becomes visible.

### Distribution tabs
Histograms (not averages — hit rate lies): `tradeRetPct`, `mfePct`, `maePct`,
`givebackRatio`, `daysHeld`. Overlay by signalType for shape comparison.

### TradeStation-style performance report
Standard metrics catalog, all derivable from the row set:

- **Profitability**: net profit, gross P/L, profit factor, payoff ratio,
  expectancy (per-trade avg), CAGR, buy&hold comparison
- **Trade stats**: n, win/loss/flat, % profitable, avg win/loss, largest
  win/loss, max consecutive wins/losses, avg days in trade (all / winners /
  losers), long-vs-short side split
- **Drawdown**: max/avg DD, longest recovery, recovery factor, Calmar —
  REQUIRES the equity-curve series (see data gaps)
- **Risk ratios**: Sharpe, Sortino (need periodic mark-to-market), K-ratio,
  RINA, SQN; std dev / skew / kurtosis of trade returns
- **Excursion**: avg/max MFE & MAE, givebackRatio distribution,
  MAE-vs-outcome scatter (stop-placement sanity)
- **Period returns**: year×month heatmap (needs mark series)

### Trade drawer
Per-trade chart: daily candlesticks (SDS bars) + entry marker + trailing-stop
line (recomputable: running max/min of closes × trail pct) + exit marker +
MFE/MAE shaded band + variant outcomes table (governing vs shadows —
counterfactual "what if trailing-5" on the same trade).

`gallery-card-chart` already renders bar series; this is a page-level
composition, not new chart infra.

## Second data grain (chart support)

The one-row summary can't draw paths. Companion long-format series:

`tradeId, date, mark, underlyingClose` (live: from `marks`; replay: from the
walk). Stored on the analysis doc as a compact array (~60 numbers/trade) or
joined to SDS bars at render time.

## Known data gaps

- **Thin indicator snapshot**: signal writer stamps only 6 fields
  (zone/delta/window). Real sweet-spot analysis needs richer entry context —
  a small ST-writer task stamps more indicators at capture; old docs stay
  sparse.
- **Equity-curve / mark series**: drawdown, Sharpe, time-in-market, period
  returns all need mark-to-market series — the long-format artifact.
- **Sizing & friction**: no notional, no commission/slippage. Even flat
  per-trade cost materially changes short-hold results.
- **Live/synthetic provenance**: rows carry `origin` (live vs replay); the
  page must default to separated or clearly-flagged mixing.
- **Replay conventions are provisional**: entry = signal-day close, exit =
  trailing-8 on closes, 120d cap. These are knobs — the analysis layer should
  let the user re-run under different conventions eventually.

## Sequencing

1. Prove the columns answer questions — CSVs today
   (`.devin/tmp/signal-trades-*.csv`, `.devin/tmp/signal-replay-AMAT.csv`)
2. Full-symbol replay run → dataset depth (~5-8k trades)
3. Ticket: materialized `paper-trading/analysis/items/{id}` writer
   (nightly pass for live; replay writer for synthetic)
4. Ticket: the forensics page in the new UI

## Reference scripts (untracked, uncommitted)

- `functions/scripts/analysis/signal-trades-export.ts` — live trades → CSV
- `.devin/tmp/replay-one-symbol.ts` — single-symbol replay prototype
