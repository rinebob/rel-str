# Verify — #1074 deterministic CSV codec

**Topic:** #553 Paper Trading Infra · **Thread:** #1059 Trade Analysis & Forensics · **Task:** #1074

## Scripts

### `paper-trading-analysis-1074-csv-codec.ts`

Proves the shared CSV codec (`shared/analysis-csv.ts` — `serializeDataset` +
`COLUMN_TYPES`) against real production paper-trade documents.

**What it does**

1. Lists live `source: 'signal'` trades from `paper-trading/trades/items` (real prod, read-only).
2. Prefers docs with stamped `signalIndicators` and projects up to 25 trades into `TradeAnalysisRow` (codec-scope projection — full row derivation is #1076's job).
3. Serializes and checks:
   - header equals the `ANALYSIS_COLUMNS` manifest order
   - rows are sorted by `tradeId` and `serialize(shuffled)` is byte-identical
   - no `undefined` / `null` / `NaN` literal cells
   - a spec-local RFC-4180 parse + `COLUMN_TYPES` coercion deep-equals the projected rows

**Usage** (from `functions/`):

```
npx tsx scripts/verify/paper-trading-analysis-1074-csv-codec.ts
```

Requires ADC (`gcloud auth application-default login` or `GOOGLE_APPLICATION_CREDENTIALS`) + the IPv4 preload (`NODE_OPTIONS`). No arguments, no writes.

**Pass**: all checks print ✔ and the run ends with `=== ALL CHECKS PASSED ===`, exit 0.
**Fail**: ✖ lines name the broken invariant; exit 1.

## Number-format note

The codec emits shortest-round-trip numbers (`String(v)`), not the prototype CSV's cosmetic `toFixed(2)` — production fills carry 3–4 decimal prices and sub-cent P&L, so the dataset stays lossless. View layers own padding.
