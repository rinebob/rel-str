# ADR-010: Options Backtest — Selection Replay over SA Pick Documents

## Status

Accepted

## Context

Topic #1238 (Options Backtest), Thread #1240 (Selection Replay) adds template-driven options backtests: pick a named template ("sell one 45DTE 20Δ put daily, hold to expiration"), apply a symbol + start date, run it, review the list of contracts the strategy would have opened, and inspect each contract's price series.

The existing backtest simulator (`runBacktestSimulation`) replays daily bars, fetches the full option chain for each day a position is open, and mark-to-markets a portfolio — entry/exit marks are decided inside the loop and each trade's daily history is discarded. Two forces pushed against reusing it:

1. **The user's model is hold-to-expiration for education.** Every contract is held to its expiration so the full lifecycle series is visible; hypothetical exits ("close at 50% of premium") are applied at analysis time on the stored series, not during data collection. A mark-to-market simulation loop simulates nothing the series doesn't already contain.
2. **SA owns contract data.** SA ingests daily corpus files and produces derived data products; rel-str deliberately persists no contract data in Firestore.

During planning, SA committed to producing **Pick Documents** — JSON files per `{symbol, option type, target delta, expiration rule}` keyed by trading date, each day carrying the picked `contractId` plus its actual delta, IV, mark, bid/ask, volume, OI, and underlying close, with `pickCount`/`missCount` coverage stats and a `gridVersion`. This made contract selection a solved upstream problem: the per-day cross-sectional question ("which contract is the 20Δ 45DTE put on this date") is answered by SA with real market data.

## Decision

**Selection is consumed, not computed.** A Selection Replay run = template + symbol + start date:

1. Resolve the template to its pick-doc coordinate (`type`, `targetDelta`, `expiry.mode`/`dte`).
2. Fetch the SA Pick Document for `{symbol, coordinate}` covering the entry window (startDate → latest data day).
3. Map each `days` entry to a **Contract List** row: `{ entryDate, contractId, strike, expiration, dte, delta, iv, mark, bid, ask, volume, openInterest, underlyingClose }`. Days absent from the doc (SA `missCount` gaps) persist as `no-selection` marker rows so ladder holes stay visible.
4. Persist the contract list in dedicated collections — `st-options-replay-runs/{runId}` headers plus `st-options-contract-lists/{runId}_{symbol}` payloads — each day's pick a distinct position entry even when consecutive days share a contractId.

Exits, expiration settlement, and P&L are **not computed during the run**. The **Backtest Analytics** thread (#1266) applies named exit rules to the contract list over each contract's SA Contract Series and emits `TradeAnalysisRow`s into the existing analysis-dataset pipeline (Topic #553, Thread #1059: `analysisDatasetTask` → `writeDataset` → CSV + index doc → FE workbench) — a **Result Set** is an analysis dataset. Multi-leg positions (matched pick docs per leg) are deferred to Thread #1270.

Phase 1 UI: run dialog gains template + start date (no `initialCash`/`reportTier`); the contract list renders as a table; a row action opens a simple mark-series line chart (backtest-dashboard style), lazy-fetching that contract's series via `getHistoricalOptionsContract$`. A carousel/filmstrip viewer is explicitly deferred.

## Considered Options

- **Local modeled selection (Black-Scholes inversion + strike walk)** — decided mid-planning, then abandoned before implementation when SA offered pick docs. Would have consumed a Symbol IV Series (also new SA surface), an anchor/candidate Contract Series validation loop, and carried inherent modeled-vs-actual delta error that had to be measured and bounded in every row. Pick docs deliver actual picks with real delta for ~1 fetch per run instead of 1–4 per day — strictly better on data fidelity and fetch cost. Recorded here because a future reader may wonder why a "backtest selector" contains no selection math.
- **Reuse the daily-chain path (`partnerHistoricalOptionsV2` + `OptionsChainCache`)** — rejected earlier for corpus-coverage risk and because it discards all but the pick anyway; further obsoleted by pick docs.
- **Cross-sectional SA query (contracts filtered by date + Greeks)** — rejected; superseded entirely by pick docs.
- **Persist daily mark series onto each row** — abandoned: rel-str owns no contract-data persistence; series are fetched from SA at view/analysis time.
- **Reuse `st-backtest-*` collections** — rejected at blueprint. The equity-curve simulator's permutation payload (trades + metrics + equity curve) is a different document shape than a contract list; a `kind`-discriminated union inside one collection was judged a schema lie that worsens once Result Sets arrive. The signal-sim and selection-replay pipelines share nothing below the launch-dialog concept.
- **Reuse the pick-doc corpus storage** — not applicable: pick docs are SA-owned and fetched per run (SA callable endpoint); rel-str persists only its own artifacts (run headers, contract lists, later analysis datasets).
- **Cross-site GCS read for pick docs** — rejected in favor of an SA callable: uniform auth/error semantics via the existing partner-proxy pattern; GCS would leak SA's storage layout into our contract and add cross-project IAM.

## Consequences

- **Templates live in a dedicated `templateRegistry`** (blueprint decision): `templateId` maps to a pick-doc coordinate + `side` + display metadata, separate from `strategyRegistry` — signal strategies and time-based selection are fundamentally different entry shapes, and the registry is the natural home for multi-leg `legs[]` coordinates later (Thread #1270). If SA's pick-doc grid turns out enumerable, the registry may enumerate available coordinates rather than hard-registering each variant — open pending SA grid semantics.
- **Rel-str contains no option-selection math** — no BS, no Greeks modeling. Selection quality is SA's; our audit surface is the pick doc itself (`delta` field per day, `missCount`, `gridVersion`). Golden tests assert pipeline correctness against fixture pick docs, not selection accuracy.
- **The run produces a contract list, not trades**: no equity curve, no P&L, no settlement logic in Phase 1. Rows are flat single-leg fields (multi-leg row shape deferred to Thread #1270).
- **The terminal analyzer already exists**: excursion fields (`mfePct`/`maePct`/`mfeDate`/`maeDate`/`givebackRatio`), an exit-registry grammar, the dataset writer, and the FE workbench ship under Topic #553 — Phase 2 feeds contract-list rows through exit evaluation into `TradeAnalysisRow`s rather than building a new analyzer. Thread #1119 (Options Expression Replay) scoped this bridge pre-pick-docs; its premise (modeled premium) is superseded but its row-pipeline intent is confirmed by this ADR.
- **Fetch cost collapses** to ~1 pick doc + N lazy series fetches at view time; there is no per-day upstream fetch at all.
- **Out of scope**: the live-engine ITM settlement dead-end (#728) is a separate fix under paper-trading.

## Future Work

- **Backtest Analytics (Thread #1266)**: exit-rule engine over contract lists, `TradeAnalysisRow` emission into the analysis-dataset pipeline, result-set comparison views.
- **Multi-leg Templates (Thread #1270)**: matching pick docs across legs (e.g., short-put leg + long-put leg for a put credit spread) once single-leg review proves out.
- **Carousel/filmstrip contract-series viewer** for browsing many contracts quickly.
- If a pick-doc gap proves problematic (e.g., missing delta/DTE coordinates needed for a template), revisit whether SA can generate on-demand coordinates.

## Amendment — 2026-10-26 (spike #1278)

Wire contract confirmed against SA's shipped `CellYearDoc`
(`av-proxy-api/shared/options/options-delta-picks.types.ts`; SPEC 213-215
declares it the storage + wire contract). Two mechanics refinements vs the
text above:

- **Fetch unit is a year shard**, not a window: the partner endpoint serves
  `options-delta-picks/{SYM}-{type}-{deltaPct}-{dte}/years/{YYYY}` — one call
  per `(symbol, type, delta, dte, year)`. `startDate` filters `days`
  client-side; a year-spanning run fetches per year and merges.
- **Misses are explicit entries, not absent keys**: `days` values are
  `DayPick | DayMiss` (`status: 'no_chain' | 'no_match'`). Consumers narrow
  with `isPickDocPick`; misses map to `no-selection` rows with reasons
  `no_match→'miss'`, `no_chain→'gap'`.
- The endpoint itself is pending SA task av-proxy-api#225 (blocked by #223
  materialization); auth = existing partner ID-token convention.
