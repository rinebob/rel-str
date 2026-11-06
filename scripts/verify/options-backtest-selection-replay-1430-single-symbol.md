# Verification Guide — Selection Replay Single-Symbol Runs (#1430)

Task [#1430](https://github.com/rinebob/rel-str/issues/1430) — the
single-symbol run model: `optionsReplayStart` with N symbols creates N
independent run docs (`st-options-replay-runs/{runId}`), each carrying a
scalar `symbol` and its own status — no `symbols[]`, `listOutcomes`, or
progress counters. The contract list is keyed at `docId == runId`
(`st-options-contract-lists/{runId}`), and analysis results key off it as
`st-options-analysis-results/{runId}_{exitId}`.

## Scripts

| Script | Stage | Purpose |
|---|---|---|
| `functions/scripts/verify/options-replay-single-symbol-1430.ts` | live doc audit | Scans the three collections: FAILs on new-model runs missing scalar `symbol`, a `symbol`/`runId` suffix mismatch, out-of-vocabulary status, a **`completed` run with no list doc** (the worker writes the list before close-out — genuinely corrupt; every other status may legally lack one), list↔run field disagreement, or malformed `{contractListDocId}_{exitId}` result keys; WARNs on legacy multi-symbol docs (migration candidates), non-completed runs without lists (pending/running pre-enqueue, enqueue-died `failed`, `cancelled`), run/list status disagreement, and result docs keyed off non-live list ids |

### Usage

```bash
cd functions
npx tsx scripts/verify/options-replay-single-symbol-1430.ts [--run <runId>]
```

Needs ADC (`firebase login` / application-default credentials). Read-only —
never writes. `--run` scopes the audit to one run and its result docs.

**Pass:** `0 FAIL` in the summary line + `AUDIT PASS` (exit 0).

**Fail:** each violation prints `FAIL {docId}: {detail}`; exit 1.

## Offline coverage

Logic-level coverage for the same invariants lives in the unit suites —
run these first; the audit is the live-data counterpart:

```bash
cd functions && npm run test:options-replay   # fanout, closeout, retry
npx jest shared/options-replay-contracts.spec.ts shared/st-collections.spec.ts
npx tsx scripts/verify/options-backtest-selection-replay-1275-contracts.ts
npx tsx scripts/verify/options-backtest-selection-replay-1276-registry-collections.ts
npx tsx scripts/verify/options-backtest-analytics-1368-results-collection.ts
```

The shared-side scripts (1275/1276/1368) now pin the #1430 keying:
`stOptionsContractListDocId(runId)` is identity, result keys compose as
`{runId}_{exitId}`.

## Setup / teardown

None — read-only. **Note:** the audit only sees what exists in Firestore;
run it after a post-deploy `optionsReplayStart` submission so new-model
docs are present. Legacy multi-symbol WARNs clear after the #1430
migration deletes the pre-existing docs.
