# Verify #1076 — dataset writer + generateTradeDataset

`paper-trading-analysis-1076-dataset-writer.ts` — exercises every pipeline
stage added by #1076 against real prod resources.

## Usage

```powershell
cd functions
npx tsx scripts/verify/paper-trading-analysis-1076-dataset-writer.ts
```

Requires ADC (`gcloud auth application-default login`). The script writes
two `verify-1076-*` probe docs under `paper-trading/analysis-datasets/items`
plus one GCS object (`analysis-datasets/verify-1076-ok.csv`) and deletes
all of them in cleanup (`.finally` — probes are removed even on crash).

## Checks

| # | Check | Pass condition |
|---|-------|----------------|
| 1 | bad exit grammar | `invalid-argument` HttpsError |
| 2 | invalid run writes nothing | `createIndexDoc` never invoked |
| 3 | dataset id shape | `ds-{yyyymmdd}-{origin}-{8 hex}` — params+time+nonce hashed, so same-day same-config runs still get distinct ids |
| 4 | index doc on real Firestore | `status:'generating'` + all params stored as provenance |
| 5 | enqueue payload | `{datasetId, params}` forwarded verbatim |
| 6 | writeDataset → ready | real GCS upload + index doc flips `ready` with `rowCount`/`gcsPath` |
| 7 | GCS bytes | object downloads; header equals `ANALYSIS_COLUMNS` order |
| 8 | lossless numbers | 3-decimal price `119.465` survives verbatim in the CSV |
| 9 | failure path | stubbed upload throw → real doc flips `failed` + `error` — never wedged at `generating` |
| 10 | enqueue seam | real `taskQueue('analysisDatasetTask').enqueue()` → deployed stub task flips probe doc to `failed`/`not implemented` — the true end-to-end hop |

## SKIP semantics

Check 10 needs the `analysisDatasetTask` function deployed and a service
account resolvable for OIDC signing — neither exists under local ADC before
the first deploy containing this task. Until then it reports `⊘ SKIP`.
After `firebase deploy --only functions`, rerun: the check must flip to ✔
(the stub marks docs `failed` by design until #1077/#1078 land).

A skip is not a pass — the gate only counts checks 1–9 pre-deploy.
