# Verification Guide — task #1073: trade-analysis contracts

## `paper-trading-analysis-1073-contracts.ts`

Proves the #1059 analysis contracts work against real Firestore:

- **Path helpers** — `analysisDatasetsPath()` →
  `paper-trading/analysis-datasets/items`, `analysisSlicesPath()` →
  `paper-trading/analysis-slices/items`, `analysisDatasetGcsPath(id)` →
  `analysis-datasets/{id}.csv`.
- **Manifest ⇄ schema bijection** — every `ANALYSIS_COLUMNS` key is a
  `TradeAnalysisRow` key and vice versa (46 columns; runtime echo of the
  jest pin in `shared/analysis-dataset-contracts.spec.ts`).
- **Dataset-index round-trip** — writes a probe `AnalysisDatasetDoc`
  (`status: 'generating'`, `barRange`, `tags`, `gcsPath`) to the real
  `paper-trading/analysis-datasets/items` collection, reads it back
  field-by-field.
- **Slice round-trip** — writes a probe `AnalysisSlice` with all three
  `SliceFilter` ops (`in`, `range`, `dateRange`) and confirms they
  serialize/deserialize as plain JSON.
- **Cleanup** — both probe docs (`verify-1073-*`) are deleted in a
  `finally`, and the delete is re-checked.

### Usage

```powershell
cd functions
npx tsx scripts/verify/paper-trading-analysis-1073-contracts.ts
```

### Prerequisites

- ADC credentials: `gcloud auth application-default login` or
  `GOOGLE_APPLICATION_CREDENTIALS`. Project: rel-str.
- IPv4 preload for Node (AGENTS.md): `NODE_OPTIONS=--require
  C:\Users\bob\.config\node\ipv4-only.cjs`.

### Pass criteria

`=== ALL CHECKS PASSED ===`, exit 0 — 16 checks.

### Side effects

Writes two docs under `paper-trading/analysis-{datasets,slices}/items`
named `verify-1073-*` and deletes them before exit. Safe to re-run —
`set` overwrites, and cleanup is idempotent.

### What it does NOT check

- Firestore client-side rules for `analysis-slices` writes — admin SDK
  bypasses rules. The rule change (authed CRUD on `analysis-slices`,
  server-only writes on `analysis-datasets`) is exercised when the FE
  slice store lands in #1081.
- CSV serialization — that's the codec task (#1074).
