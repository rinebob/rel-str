# SHARED IMPL — Trade Analysis & Forensics

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
**Last Updated:** 2026-10-17  

## Scope

Shared contracts for the CSV-native analysis pipeline (PRD: `553-1059-1060-PRD-PAPER-TRADING-paper-trading-infra-trade-analysis.md`). Everything both the BE generator and the FE workbench must agree on lives here: the row schema, dataset/slice metadata, storage paths, and the deterministic CSV codec.

## 1. Row schema + column manifest — `shared/analysis-dataset-contracts.ts`

- `TradeAnalysisRow` — the flat ~45-column interface, grouped:
  - **identity/provenance**: `datasetId`, `tradeId`, `signalId`, `signalType` (stamped verbatim: `D_ST_TREND_RIDER_V{n}_{LONG|SHORT}`, or null on non-signal trades), `cohortId`, `symbol`, `direction`, `expression`, `captureList`, `sector`, `industry`, `capTier`, `source` (`live|replay`), `status`
  - **lifecycle**: `signalBarDate`, `entryDate`, `exitDate`, `entryPrice`, `exitPrice`, `qty`, `daysHeld`, `exitReason`
  - **outcomes**: `tradeRetPct` (direction-aware), `symbolMovePct` (direction-neutral), `realizedPnl` — percent-units, not fractions
  - **excursion**: `mfePct`, `maePct`, `mfeDate`, `maeDate`, `daysToMfe`, `givebackRatio`, `excursionSource` (`marks|replay`)
  - **signal context**: `ind.*` stamped snapshot fields — the detector's own key names (as-built: `ind.delta`, `ind.windowV2`, `ind.zoneV1`, `ind.zoneV1Prev`, `ind.zoneV2`, `ind.zoneV2Prev`); `null` when the signal type doesn't stamp that key
  - **computed context**: `strength.diPlus`, `strength.diMinus`, `strength.diHist`, `strength.adx` — computed at generation from bars, never stamped
- `ANALYSIS_COLUMNS: AnalysisColumnDef[]` — ordered manifest: `{ key, label, kind: 'string'|'number'|'date'|'enum', enumValues?, filterable, defaultVisible }`. The manifest is the single source of truth for CSV header order, FE table columns, and filter-type dispatch.
- `AnalysisCohort = 'signal-equity'` contract — manual trades and option-expression rows are flagged (`analysisCohort: 'excluded'`) rather than dropped; analysis views filter on it.

## 2. Dataset index + slice contracts — `shared/analysis-dataset-contracts.ts` (cont.)

- `AnalysisDatasetDoc`: `{ id, origin: 'live'|'replay', status: 'generating'|'ready'|'failed', rowCount, symbolScope, signalTypes, exitRule, barRange, entryConvention, generatedAt, gcsPath, tags[], notes, error? }`
- Path helpers in `@paper-trading/ids`: `analysisDatasetsPath()` → `paper-trading/analysis-datasets/items`, `analysisSlicesPath()` → `paper-trading/analysis-slices/items` (anchor pattern per AGENTS.md).
- `AnalysisSlice`: `{ id, name, note?, createdAt, filters: SliceFilter[] }` where `SliceFilter = { column, op: 'in'|'range'|'dateRange', value }`. Slices serialize to JSON; missing-column predicates are skipped client-side with a notice.

## 3. CSV codec — `shared/analysis-csv.ts`

- `serializeDataset(rows: TradeAnalysisRow[], columns?): string` — header row from manifest order, RFC-4180 quoting, dates ISO `YYYY-MM-DD`, empty cells for absent sparse fields. Numbers emit shortest-round-trip `String(v)` (as-built, #1074: real fills carry 3–4-decimal prices, so 2-decimal padding was rejected as lossy; percent fields remain percent-units).
- Column-type map (`COLUMN_TYPES`) consumed by the FE to coerce papaparse output (papaparse stays FE-only — no dep in shared).
- Deterministic output is required: same input rows → byte-identical CSV (stable sort on tradeId before serialize), so dataset diffs are meaningful.

## Test seams

- Round-trip: serialize → papaparse-equivalent parse → deep-equal rows.
- Manifest/schema drift guard: every `TradeAnalysisRow` key appears in `ANALYSIS_COLUMNS` exactly once.
- Snapshot of a golden fixture CSV to catch accidental column-order/format drift.
