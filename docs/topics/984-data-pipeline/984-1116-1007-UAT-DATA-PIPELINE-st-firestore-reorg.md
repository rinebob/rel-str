**Topic:** ST Firestore Reorg  
**Topic Slug:** st-firestore-reorg  
**Thread:** Data Plane Consolidation  
**Thread Slug:** data-plane-consolidation  
**Issue:** #1116  
**Thread Parent:** #985  
**Topic Parent:** #984  
**Task:** #1007  
**Domain:** DATA-PIPELINE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-18  
**Last Updated:** 2026-10-18  

# UAT — #1007 collection renames (st-paper-trading, st-portfolio, st-backtest)

## Scope

Verifies the #1007 collection renames on real prod data:

- **Cutover (no soak):** `paper-trading/{accounts,trades,stats,raw-quotes}`
  reads+writes moved to `st-paper-trading/{anchor}/items`. All consumers
  are BE callables — the FE cannot observe these collections directly.
- **Portfolio soak:** FE still writes `portfolio/{buckets,attributions}/items`
  directly; `portfolioItemsMirror` copies every write to `st-portfolio`.
- **Backtest soak:** BE writes `st-backtest-{runs,permutations}`;
  `stBacktest*Mirror` merge-shadows to legacy `backtest-*` so the FE
  keeps seeing runs. FE-owned fields (`archived`/`qualityDesignation`)
  on legacy must survive mirror writes.
- **Unchanged by design:** `paper-trading/{instances,cohorts,analysis-*}`
  stay on the legacy root (#1014, #1004-drain, own task respectively).

## Prerequisites

- Repo on `prod` branch with the #1007 working-tree changes present
  (not yet committed — ship happens after QA PASS).
- Application Default Credentials for prod (`gcloud auth
  application-default login` if not already active).
- `NODE_OPTIONS=--require C:\Users\bob\.config\node\ipv4-only.cjs`
  (IPv4 workaround — required for firebase CLI).
- Run from `functions/` directory for all `npx tsx` commands.
- Deploy/migrate runbook (from `migrate-collection-renames-1007.ts`
  header): deploy FIRST, then `--apply`, then audit.

## Results log

| # | Scenario | Result | Evidence |
|---|---|---|---|
| S1 | Dry-run migration covers all 8 families | PASS | 1605 docs across 8 families enumerated; `failed 0` |
| S2 | Deploy functions (cutover + mirrors live) | PASS | Selective deploy of the 21-function seam set — 3 mirrors created, 18 updated, 0 errors; `analysisDatasetTask`/`generateTradeDataset` held on prior revision (in-flight #1078) |
| S3 | `--apply` migration copies all families | PASS | 1605 copied, 2 `skipped-divergent` (pre-existing `stats-ALL`/`stats-inst-1` protected), 0 failed |
| S4 | Parity audit → 0 FAIL | PASS | `0 FAIL, 2 WARN` — both WARNs are the skipped stats docs correctly classified canonical-newer post-cutover writes; all 8 families count-identical |
| S5 | Paper-trading callables read post-cutover data | PASS | User-confirmed app render: stats card (cash/equity/realized/unrealized/cap-required), groups, and exactly 247 trades — matching the migrated count |
| S6 | Portfolio mirror catches a live write | PASS | Probe: legacy `portfolio/buckets/items/qa-1007-probe` write → canonical copy appeared exact within 4s; legacy delete → canonical delete propagated |
| S7 | Backtest mirror shadows canonical writes; FE fields survive | PASS | Migration's 20 canonical writes shadowed to legacy (S4 parity); probe: `archived`/`qualityDesignation` on a legacy run survived a canonical `updatedAt` write through the merge-shadow |
| S8 | Negative: instances/cohorts still on legacy root | PASS | Prod read: `paper-trading/instances/items` = 0 docs (instances live under `st-strategy-instances` per #1006), `paper-trading/cohorts/items` = 9 docs (drain artifact until #1013) |

## Scenarios

### S1 — Dry-run migration coverage

Confirms the migrator enumerates every family and counts real prod docs.

```powershell
cd functions
npx tsx scripts/migrate-collection-renames-1007.ts
```

Expected: `MODE: dry-run`; per-family lines
`{key}: {source} → {dest}: N source docs`; a TOTAL summary with
`failed 0`. No writes occur.

### S2 — Deploy

```powershell
$env:NODE_OPTIONS="--require C:\Users\bob\.config\node\ipv4-only.cjs"
firebase deploy --only functions
```

Expected: all functions deploy including `portfolioItemsMirror`,
`stBacktestRunsMirror`, `stBacktestPermutationsMirror`. ⚠ This ships the
whole working tree's functions code — concurrent in-flight work deploys
too (same as #1006's deploy).

### S3 — Apply migration

```powershell
cd functions
npx tsx scripts/migrate-collection-renames-1007.ts --apply
```

Expected: `MODE: apply`; per-family `copied`/`identical`/`skipped-divergent`
counts; `failed 0`. `skipped-divergent` is acceptable (canonical doc
ahead of frozen legacy — never overwritten).

### S4 — Parity audit

```powershell
npx tsx scripts/verify/data-pipeline-collection-renames-1007.ts
```

Expected: `0 FAIL`. WARNs allowed and explained: `dest-only` (post-
cutover creates), `canonical newer than frozen legacy` (post-cutover
writes), `content divergence` on mirrored families (mirror lag),
`source-only` on portfolio (mirror lag).

### S5 — Callable reads post-cutover

In the app (or via a scratch caller): `listPaperTrades`,
`getPaperAccount`, `getPaperStats` return real docs. Equivalent
Firestore-console check: `st-paper-trading/trades/items` non-empty and
recently-updated docs present.

### S6 — Portfolio soak (needs a real FE write)

In the app: create or rename a portfolio bucket (Portfolio → bucket
edit). Then check Firestore console:
`st-portfolio/buckets/items/{id}` mirrors the legacy
`portfolio/buckets/items/{id}` doc within seconds. Optional delete
check: deleting the bucket removes both copies.

### S7 — Backtest soak + FE-field preservation

Requires a live backtest run (or wait for the next scheduled one): the
`st-backtest-runs/{id}` progress doc merge-shadows onto
`backtest-runs/{id}` — FE Backtest page sees live status. If a run doc
on legacy has `archived`/`qualityDesignation` set (console edit
suffices), the next canonical write must NOT delete them.

### S8 — Negative check

`paper-trading/instances/items` and `paper-trading/cohorts/items` docs
still resolve via the legacy root (Firestore console or a `setCohort`
path check) — the seam keeps them legacy until #1014/#1013.

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| Copy migrations for all task-body families | S1, S3 |
| Path constants re-pointed; readers on canonical | S5 |
| Dual-write where consumers stranded (mirrors) | S6, S7 |
| Cutover families not regressed | S3 (`skippedDivergent`), S4 |
| Parity verifiable | S4 |
| Unmoved anchors untouched | S8 |

## Regression / smoke

- [x] `npm run test:paper-trading` — 272 green
- [x] `npm run test:collection-renames` — 23 green
- [x] FE Backtest page loads runs list — verified-by-evidence: FE read code unchanged, legacy shadow parity-audited identical, mirror deployed
- [x] FE Portfolio buckets render + CRUD works — verified-by-evidence: FE read/write path unchanged, mirror probe-verified end-to-end (S6)
