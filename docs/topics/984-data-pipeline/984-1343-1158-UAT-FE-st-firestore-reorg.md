**Topic:** ST Firestore Reorg  
**Topic Slug:** st-firestore-reorg  
**Thread:** Data Plane Consolidation  
**Thread Slug:** data-plane-consolidation  
**Issue:** #1343  
**Thread Parent:** #985  
**Topic Parent:** #984  
**Task:** #1158  
**Domain:** FE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-03  
**Last Updated:** 2026-11-05  

# UAT — #1158 analysis.service → st-paper-trading analysis anchors

Verifies the analysis workbench reads and writes exclusively through the
canonical `st-paper-trading/analysis-{datasets,slices}/items` anchors:
migrated prod data is verbatim, the workbench behaves identically to
pre-cutover, and the security-rule grants match the real client flows
(including the chunk-delete parity-fix).

## Scope

- `StPaperTradingKind` gains `ANALYSIS_DATASET`/`ANALYSIS_SLICE` with
  `analysis-datasets`/`analysis-slices` anchors under `st-paper-trading`
- `analysisDatasetsPath()`/`analysisSlicesPath()` resolve canonical —
  every FE and BE caller (analysis.service, callables, dataset-writer,
  dataset-task) cut over through the one shared seam
- `firestore.rules` st-paper-trading block: slices authed CRUD, datasets
  update+delete (create stays callable-only), `chunks` sub-doc delete
  for `analysis-datasets` (fixes the prod bug where chunked datasets
  were undeletable)
- Migration applied: 4 dataset docs + 4 chunk docs + 3 slice docs
  copied verbatim; parity relay registered in both run-alls

## Prerequisites

- `npx ng serve` dev server at `localhost:4200`, authenticated session
- ADC credentials for the verify/migration scripts:
  `gcloud auth application-default login`, project `rel-str`
- IPv4 preload: `NODE_OPTIONS=--require C:\Users\bob\.config\node\ipv4-only.cjs`
- Prod state at QA time: 4 datasets + 1 chunk each + 3 slices, already
  mirrored verbatim to canonical (migration applied 2026-11-03)

## Deploy gating

`firebase deploy --only firestore:rules` ran **2026-11-05** during QA —
the canonical analysis write grants are live. Functions + FE deploy at
`/proj ship`. Scenarios marked `[post-deploy]` need the functions deploy
(BE writes still target legacy until then) — everything else is
executable now.

## Scenarios

### S1 — Parity relay (automated, pre-delete gate)

From `functions/`:

```powershell
npx tsx scripts/verify/data-pipeline-analysis-anchors-1158.ts
```

Expected: `=== ANALYSIS-ANCHORS PARITY OK ===` — 4/4 dataset docs and
3/3 slice docs verbatim incl. chunks; exit 0.

### S2 — Migration idempotency (automated)

```powershell
npx tsx scripts/migrate-analysis-anchors-1158.ts                # dry-run
npx tsx scripts/migrate-analysis-anchors-1158.ts --no-create    # straggler dry-run
npx tsx scripts/migrate-analysis-anchors-1158.ts --only bogus   # must error
```

Expected: both dry-runs report `unchanged=4` / `unchanged=3`, zero
would-create/update; `--only bogus` (and `--only constructor`) exit 1
with a usage error.

### S3 — Workbench dataset list (dev-server smoke, user)

Navigate to `trading/analysis` → dataset library/dropdown.

Expected: the 4 migrated datasets appear (titles/dates match the
Firestore console `st-paper-trading/analysis-datasets/items`).

### S4 — Saved-slice list (dev-server smoke, user)

On the same page, open the saved-slices menu.

Expected: the 3 migrated slices listed, selectable, applying a slice
filters the dataset view as before.

### S5 — Dataset CSV mirror read (dev-server smoke, user)

Open a dataset that has chunk docs (`ds-*` entries with `ready`
status). Expected: the row/CSV view renders — this path reads
`{dataset}/chunks/*` from canonical Firestore.

### S6 — Slice save/update/delete [post-deploy, user]

Save a new slice, edit an existing slice, delete it. Expected: all
succeed (pre-deploy these correctly 403 — that failure is the
deploy-gating signal, not a bug).

### S7 — Dataset delete incl. chunks [post-deploy, user]

Delete a generated dataset. Expected: index doc + `chunks` subdocs all
removed (verify `st-paper-trading/analysis-datasets/items/{id}/chunks`
empty in console). This exercises the parity-fix rules leg — on the old
legacy path this flow threw `PERMISSION_DENIED` mid-delete.

### S8 — Generate dataset [post-deploy, user]

Run a dataset generation from the workbench. Expected: new `ds-*` doc
appears under `st-paper-trading/analysis-datasets/items` (NOT under
legacy `paper-trading/...`), status transitions `generating → ready`.

### S9 — Straggler re-run + parity [post-deploy]

```powershell
npx tsx scripts/migrate-analysis-anchors-1158.ts --apply --no-create
npx tsx scripts/verify/data-pipeline-analysis-anchors-1158.ts
```

Expected: stragglers pulled (any legacy docs minted during the deploy
window), canonical-only docs reported INFO, parity OK. A legacy doc
with NO canonical twin (post-cutover delete) reports WARN-skip —
never resurrected.

### S10 — Legacy-root tripwire (automated)

```powershell
npx tsx scripts/verify/data-pipeline-legacy-roots-1013.ts
```

Expected: legacy `paper-trading/analysis-*` anchors still listed
(BLOCKED until ship-time delete) — confirms no premature deletion.

### S11 — Regression: adjacent surfaces (user, dev-server)

Paper-trading accounts/trades views, position groups, order tickets —
any page that reads `paper-trading` or `st-paper-trading` data.
Expected: unchanged behavior (cohorts still routes legacy by design).

## Traceability

| AC | Scenarios |
|---|---|
| StPaperTradingKind analysis anchors | S1, S2, S10 + spec pins (84 jest) |
| Rules grant FE read/write on new paths | S3–S7 + rules pin suite (25 node:test) |
| analysis.service → canonical paths | S3–S8 |
| Cutover allowlist clean | spec `st-path-cutover-1014.spec.ts` (jest green) |
| Legacy docs migrated verbatim | S1, S2 |
| Straggler-safe re-run | S2, S9 |
| Chunk-delete rules parity-fix | S7 |
| No composite indexes needed | S5 (single-field orderBys verified in review) |

## Results log

| Scenario | Result | Evidence |
|---|---|---|
| S1 parity relay | PASS | `=== ANALYSIS-ANCHORS PARITY OK ===`, 4/4 + 3/3 verbatim, run 2026-11-03 post-remediation |
| S2 migrator idempotency | PASS | both dry-runs `unchanged=4`/`unchanged=3`, zero would-write; `--only constructor` → usage error exit 1 |
| S3 dataset list | PASS | user-confirmed dev-server smoke 2026-11-05 — 4 datasets listed |
| S4 slice list | PASS | user-confirmed — 3 slices listed + apply correctly |
| S5 CSV mirror | PASS | user-confirmed — ready dataset rows render from canonical chunks |
| S6 slice CRUD | PASS | user-confirmed post-rules-deploy — save/edit/delete succeed |
| S7 dataset delete | _ship runbook_ | rules legs deployed; deferred — no sacrificial dataset mintable until functions deploy |
| S8 generate | _ship runbook_ | functions-gated (BE writes legacy until deploy) |
| S9 straggler+parity | _ship runbook_ | post-deploy by nature |
| S10 legacy tripwire | PASS | `All parity checks pass`; analysis anchors correctly reported as "migrated to st-paper-trading in #1158" |
| S11 regression | PASS | user-confirmed — paper-trading surfaces unchanged |
