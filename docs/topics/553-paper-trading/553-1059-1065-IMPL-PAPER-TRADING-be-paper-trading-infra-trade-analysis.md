# BE IMPL — Trade Analysis & Forensics

**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Trade Analysis & Forensics  
**Thread Slug:** trade-analysis  
**Issue:** #1065  
**Thread Parent:** #1059  
**Topic Parent:** #553  
**Domain:** PAPER-TRADING  
**Type:** Implementation Plan  
**Status:** Draft  
**Created:** 2026-10-17  
**Last Updated:** 2026-10-20  

## Scope

Generation side of the pipeline (PRD US1/US2). One write path — **all** generation (live snapshot AND replay) enqueues a Cloud Task; the index doc appears immediately as `generating` and transitions to `ready`/`failed` on completion. No callable writes a dataset synchronously — replay already needs the task timeout budget, and one write path means one writer to test.

## 1. Dataset writer — `functions/src/paper-trading/analysis/dataset-writer.ts`

- `writeDataset(rows, meta, deps)` → serializes via the SHARED codec, uploads to `getStorage().bucket()` at `analysis-datasets/{datasetId}.csv` (precedent: `screenshot-capture/storage-writer.ts`), then updates the index doc at `analysisDatasetsPath()/items/{datasetId}` with `status: 'ready'`, `rowCount`, `gcsPath`.
- Failure flips the doc to `status: 'failed'` + `error` — never leaves `generating` stuck.
- Dataset id: `ds-{yyyymmdd}-{origin}-{shortHash(params)}` — versioned, never overwritten (PRD: snapshots accumulate). **As-built (#1076):** the hash input is `canonicalParams|isoTimestamp|nonce` — pure params-hash would collide on same-day same-config reruns; the nonce keeps "never overwritten" while honoring "two same-day runs → distinct ids".

## 2. Entry callable — `generateTradeDataset` (new `CallableName`)

- Validates params (`origin`, symbolScope, signalTypes, exitRule grammar, barRange, entryConvention, entryFilters), creates the index doc `generating`, enqueues `analysisDatasetTask` (pattern: `auto-paper-ingest-task.ts` — `onTaskDispatched`, dedupe on active dataset id is unnecessary since ids are unique), returns `{ datasetId }`.
- **As-built (#1076):** request/response/`AnalysisRunParams`/`AnalysisDatasetTaskPayload`/`ENTRY_CONVENTIONS` live in `shared/analysis-dataset-contracts.ts`; `entryFilters` added to `AnalysisDatasetDoc` (provenance-only). Validation whitelists `entryConvention` + `signalTypes`, checks exit-rule grammar via `parseVariantKey` gated to the three firing PRD families (`initial-stop`/`trailing-stop`/`time-stop` — `limit-stddev` parses but is stubbed never to fire, so it's rejected here), requires real calendar dates in `barRange` (regex + `Date.parse` — '2026-13-45' rejected), and uppercases `symbolScope` (the ledger keys symbols uppercase — a lowercase scope would silently produce an empty dataset).
- **As-built (#1076):** `analysisDatasetTask` ships as a stub `onTaskDispatched` that flips the index doc to `failed` ('not implemented — #1077/#1078') — an undeployed enqueue target would wedge docs at `generating`; a fail-loud stub keeps the deployable surface honest. Real passes land in #1077 (live) / #1078 (replay).
- **As-built (#1076):** verify scripts must name the bucket (`rel-str.appspot.com`) — parameterless admin init resolves the default bucket only in the function runtime, not under local ADC.

## 3. Task handler — `functions/src/paper-trading/analysis/analysis-dataset-task.ts`

- **live path**: enumerate `paper-trading/trades/items` (repo read), map each trade → `TradeAnalysisRow`: ledger-observed lifecycle fields, stamped `ind.*` from signal context, `strength.*` computed from SDS bars at entry date (reuse SDS reader used by eval-pass), `excursionSource: 'marks'`.
- **As-built (#1077):** `strength.*` anchors at the **signal bar** (`signalBarDate`), not the entry fill — under `signal-bar-close` they're the same bar. Bars load once per symbol (`asOf '9999-12-31'`) and slice to each anchor in memory; a symbol with many signal dates would otherwise re-read its full history per anchor.
- **As-built (#1077):** cohort rule = `expression==='EQ'` **and** signal-linked (`signalType`/`signalId`/`ticket.signalId`) → `signal-equity`; everything else (manual, option-expression) → `excluded`, kept in the file.
- **As-built (#1077):** excursion walks `marks` on `mark ?? underlyingClose`, direction-aware, bounds `[entryDate, exitDate]`; `givebackRatio` only on terminal rows. Open trades carry a provisional `tradeRetPct` vs the latest mark (views compute on CLOSED anyway). `exitReason` = `governingVariant` on terminal rows.
- **As-built (#1077):** task handler wraps both branches — `live` runs the pass; `replay` still fails loud ('lands in #1078'); `retryConfig.maxAttempts: 3`, `memory: 1GiB`. Any pre-writer throw flips the index doc `failed` too.
- **As-built (#1077):** `entryFilters` is provenance-only — validated/carried but not applied (no entry gating exists to apply it to on a snapshot).
- **As-built (#1077):** `barRange` bounds `signalBarDate ?? entryDate` — a manual trade with no signal bar is bounded by its entry fill date (a 2019 manual can't leak into a 2026 snapshot); only fully-undated trades bypass the range. Multi-fill entries map earliest entry fill / latest exit fill.
- **As-built (#1077):** the task handler guards a missing/blank `datasetId` before any doc write — `doc()` would mint a random id and stamp `failed` onto a junk doc.
- **replay path**: for each symbol in scope, read SDS daily bars (`symbol-data/{sym}/daily/{yr}`), run `detectAllStTrendRiderSignals` (`st-cloud-function/strategies/signal-detection.ts`), filter to selected signalTypes, walk each signal forward under the exit-registry grammar (`paper-trading/exits/` — `trailing-N`, `time-Nd`, `initial-stop-N`) on daily closes; entry at signal-day close per `entryConvention`; outcomes/excursion modeled, `excursionSource: 'replay'`.
- **As-built (#1078):** `barRange` is asymmetric on purpose — `to` slices bars before indicator compute AND bounds the walk ("the data considered"); `from` filters signals **after** detection. Zones are causal (verified: dropping 10 recent bars changes zero earlier values), so full prior history must feed warmup or early signals shift — slicing `from` pre-compute reintroduces the prototype's warmup artifact.
- **As-built (#1078):** AMAT parity — replaying the prototype's 2023+ bar window reproduces it exactly (99/98/32.7%/1.30, zero signal-set diff). Full SDS history (8 shards, 1831 bars, 2019+) yields 194/193/35.8%/1.30 — strictly more signals, production-faithful (SDS computes indicators on full history).
- **As-built (#1078):** the detector+evaluator are injected deps (`detectSignals`/`evaluateExit`) so specs spy the seams; prod wiring passes the real `detectAllStTrendRiderSignals` + `evaluateVariant` (pinned by a wiring spec). V1+V2 detection both run; windowV2 = own zone array (same-timeframe context, matching `generateZoneSignals`).
- **As-built (#1078):** excursion uses intraday extremes (mfe off highs, mae off lows — richer than live's marks) bounded to the walk window; `daysToMfe`/`daysHeld` are calendar days for schema consistency (prototype used bar count); `givebackRatio` uses the live formula `(mfe−ret)/mfe` (prototype emitted the complementary kept-ratio `ret/mfe`).
- **As-built (#1078):** synthetic `tradeId = replay-{symbol}-{yyyymmdd}-{V1L|V1S|V2L|V2S}`; modeled rows carry null ledger provenance (signalId/signalStatus/cohortId/positionGroupId/captureList/sector/industry/capTier/qty/realizedPnl/capitalRequired) and `analysisCohort: 'signal-equity'`, `source: 'replay'`.
- **As-built (#1078):** empty `symbolScope` enumerates `symbol-data` root doc ids — a full-universe replay may exceed the 540s task budget (sequential per-symbol full-history loads); chunked batching is a known limitation, not handled here. Symbols with no bars warn + skip (AC).
- **As-built (#1078):** no max-hold cap — the prototype's 120d cap never fired on AMAT; trades that never trigger stay OPEN (consistent with live semantics). `entryFilters` provenance-only, same as live.
- Row batching: accumulate rows per symbol, write once at end; progress logged per symbol for multi-symbol runs.

## 4. Verify script — `functions/scripts/verify/paper-trading-analysis-dataset.ts`

- Dry-run live snapshot (counts rows, samples columns) without writing.
- Replay AMAT with defaults → row count + stats (98 closed, ~32.7% profitable, payoff ~1.30) compared to the validated prototype tolerances.
- Registered in `scripts/verify/run-all.ts` under the paper-trading group.
- **As-built (#1079):** both legs run the REAL passes (`runLiveSnapshot`/`runReplay`) with only `writeDataset` swapped for an in-memory collector — the relay exercises the production mapping end-to-end and structurally cannot touch GCS or the index.
- **As-built (#1079):** the parity leg replays the prototype's exact bar window — `loadDailyBars` slices `d >= 2023-01-01` (the prototype computed indicators on that slice, so warmup must match) and `barRange.to` is frozen at 2026-10-16 (the fixture's max referenced date) so appended SDS bars can't drift the check. Expected stats derive from the checked-in CSV `paper-trading-analysis-dataset-amat-prototype.csv` at run time; asserts are exact on rows/closed/signal-set, ±0.5pp winrate, ±0.02 payoff.
- **As-built (#1079):** a full-history AMAT leg (no warmup slice, same frozen `to`) prints as informational only — the production-faithful baseline (194/193/35.8%/1.30) legitimately drifts if SDS backfills older shards.
- **As-built (#1079):** #1007 transitional fallback — working-tree `collections.ts` routes `trades` to `st-paper-trading/trades/items`, empty until the rename migration runs (deploy → `--apply` per its runbook). When canonical enumerates zero, the `listTrades` dep reads the legacy path with a ⚠ (same `{id, ...data}` + `isPaperTrade` construction as `listTrades`). Self-healing once canonical has docs; the warn does not fail the run.

## Risks

- **Detection parity**: regenerated signals must match what production detected — `detectAllStTrendRiderSignals` needs the same zone inputs (ltfZone/windowV2) production feeds it; verify script pins the AMAT prototype numbers.
- **Exit grammar fidelity**: replay walk must use the registry, not a reimplementation — import from `exits/`.
- **Index-orphan**: task crash between enqueue and finalize leaves `generating` — writer fail-soft flips to `failed`; a sweep is out of scope.
