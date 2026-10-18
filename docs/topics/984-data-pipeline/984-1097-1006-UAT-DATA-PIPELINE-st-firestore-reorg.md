**Topic:** ST Firestore Reorg  
**Topic Slug:** st-firestore-reorg  
**Thread:** Data Plane Consolidation  
**Thread Slug:** data-plane-consolidation  
**Issue:** #1097  
**Thread Parent:** #985  
**Topic Parent:** #984  
**Task:** #1006  
**Domain:** DATA-PIPELINE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-18  
**Last Updated:** 2026-10-18  

# UAT — BE-IMPL: st-strategy-instances migration + re-point (#1006)

## Scope

Canonical `st-strategy-instances/{id}` as the single instance root for the
options strategy engine:

- `migrate-strategy-instances-1006.ts` — union of
  `options-strategy-instances` + `paper-trading/instances/items` →
  `st-strategy-instances` with `mode:'paper'`, `enabled:true`,
  `paperAccountId`; carries `daily-analysis`; additive/idempotent;
  canonical-newer docs preserved wholesale on rerun; canonical-managed
  fields (`mode`/`enabled`/`paperAccountId`/`lastFiredAt`) write-if-absent.
- `strategy-instance-repository.ts` — all reads on canonical, union-read
  with the legacy anchor (FE writes there until #1014); **newest
  `updatedAt` wins** on id collision (tie → canonical); lifecycle filtering
  post-merge; `getInstance` newest-wins + malformed-canonical fallback;
  `listRunnableInstances` (runnable-only, mode/enabled filter).
- `daily-analysis` re-point: `st-strategy-instances/{id}/daily-analysis`
  for open-pass read/write, overnight-simulation writer, and the
  position-repository settlement txn (with anchor fallback).
- `repository.ts` `getInstance`/`setInstance` delegate to the engine repo.
- `verify/data-pipeline-st-strategy-instances-1006.ts` — read-only audit:
  canonical shape, legacy⇄canonical parity (soak-drift aware), da
  carry-over, repo seam.

Acceptance criteria (from #1006): 4 `options-strategy-instances` docs
migrated with mode; strategy-instance-repository + engine + callables
re-pointed; `paper-trading/instances` anchor removed **(adjudicated:
removed from the primary BE path; union-read bridge retained until #1014
— the FE still writes there)**.

## Prerequisites

- Repo at `C:\aa\projects\rel-str`, `functions/node_modules` installed.
- ADC (`gcloud auth application-default login`) for prod reads/writes.
- `NODE_OPTIONS=--require C:\Users\bob\.config\node\ipv4-only.cjs` in any
  terminal that touches Firestore or `gh`.
- S5 needs `firebase deploy` permission on rel-str.

## Scenarios

### S1 — Migration already applied (prod state)

**Confirms:** the 4 canonical docs exist with the right shape; sources
untouched.

```
cd functions
npx tsx scripts/verify/data-pipeline-st-strategy-instances-1006.ts
```

**Expected:** `canonical 4 | legacy-root 4 | anchored 0`, `0 FAIL` —
canonical docs carry `mode:'paper'`, `enabled:true`, `paperAccountId`;
`daily-analysis` carried (incl. `latest`).

**Result:** PASS — `0 FAIL, 0 WARN — canonical 4, seam listed 4`
(2026-10-18, post-`--apply`; 13 da docs carried on initial run).

### S2 — Migration idempotence + canonical-state preservation

**Confirms:** rerun is a no-op on migrated data and cannot stomp
post-migration canonical state.

```
cd functions
npx tsx scripts/migrate-strategy-instances-1006.ts   # dry-run
```

**Expected:** `created: 0, updated: 0, unchanged: 4, failed: 0`.

**Result:** PASS — `unchanged: 4` on every rerun (2026-10-18, after the
canonical-newer-skip and write-if-absent hardening).

### S3 — Engine read seam (union read)

**Confirms:** the paper engine's instance lists resolve through the
canonical root + anchor bridge.

```
cd functions
npx tsx --test ../tests/functions/options-strategy-engine/strategy-instance-repository.test.ts
```

**Expected:** 19 pass — union coverage, newest-`updatedAt` collision wins,
paused-anchor twin drops from `listActiveInstances` but stays in
`listManageableInstances`, malformed-canonical `getInstance` fallback,
`mode:'live'`/`enabled:false` exclusion, `kind` stripped.

**Result:** PASS — 19/19 (2026-10-18).

### S4 — Consumers compile + pass

```
cd functions
npm run typecheck && npm run test:paper-trading && npm run build
```

**Expected:** tsc clean; 272 pass; bundle builds.

**Result:** PASS — 272/272, tsc clean, `lib/index.js` 1.9mb (2026-10-18).

### S5 — Deploy + post-deploy seam

**Confirms:** deployed functions read `st-strategy-instances`; open pass
still consumes the 4 instances; nightly `daily-analysis/latest` writes land
under the canonical doc.

```
cd functions && firebase deploy --only functions
# then, next open-pass/timer run or a manual read:
npx tsx scripts/verify/data-pipeline-st-strategy-instances-1006.ts
```

**Expected:** deploy clean; audit stays `0 FAIL`; on the next nightly run
`st-strategy-instances/{id}/daily-analysis/latest` gains a fresh
`overnightDeltaSimulation.computedAt` (canonical writes, not anchor).

**Result:** PASS — deployed 2026-10-18 (all functions; `paperSignalOrder`,
`cancelPaperTrade`, `updatePositionActuals` needed 429 quota retries, then
succeeded; `analysisDatasetTask` + `generateTradeDataset` created — the
concurrent #1076/#1077 work shipped in the same deploy). Post-deploy audit
`0 FAIL, 0 WARN — canonical 4, seam listed 4`. The next nightly
`daily-analysis/latest` write lands under the canonical doc — observed
passively on the next scheduled open pass; writer path is covered by unit
specs.

### S6 — Soak-window UI edit (post-deploy, optional sanity)

**Confirms:** newest-wins — a Strategy-Builder pause/edit lands on the
anchor and reaches the engine.

- In the FE, pause one strategy instance (writes the anchor doc with a
  newer `updatedAt`).
- `npx tsx scripts/verify/data-pipeline-st-strategy-instances-1006.ts` —
  expect `soak drift` WARN (not FAIL) on `lifecycleState`.
- `listActiveInstances` (repo seam) drops the paused instance.

**Result:** PASS (unit) — covered structurally by the S3 regression test
(`paused-anchor twin drops the instance from listActiveInstances but stays
in listManageableInstances`) and the newest-wins spec; not exercised live —
requires a manual Strategy-Builder edit, which also writes prod data. The
anchor collection is currently empty (0 anchored docs), so the first UI
edit post-migration is also the first bridge exercise; the audit's
soak-drift WARN classification makes that observable.

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| 4 options-strategy-instances docs migrated with mode | S1 |
| repo + engine + callables re-pointed | S3, S4, S5 |
| `paper-trading/instances` anchor removed (primary path; bridge → #1014) | S3 (union + newest-wins), S6 |
| `daily-analysis` carry + canonical re-point | S1, S5 |
| Idempotent / canonical-state-preserving migration | S2 |
| Audit script exists, registered, green | S1 |

## Regression / smoke

| Check | Result |
|---|---|
| Paper-trading suite (engine consumers incl. settlement txn) | PASS — 272/272 |
| tsc + esbuild | PASS |
| Legacy sources untouched | PASS — migration additive only |
| `options-strategy-instances` literal gone from functions/src | PASS — one constant, `LEGACY_OPTIONS_STRATEGY_INSTANCES`, scripts-only |
| Post-deploy audit on live prod | PASS — `0 FAIL, 0 WARN — canonical 4, seam listed 4` |
| Deploy clean | PASS — all functions updated; 429 retries recovered |

## Results log

- `firebase deploy --only functions` — all functions updated; 3 hit GCP
  per-minute mutation quota (429), retried, succeeded. `analysisDatasetTask`
  + `generateTradeDataset` created (concurrent #1076/#1077).
- Post-deploy `data-pipeline-st-strategy-instances-1006.ts` — 0 FAIL, 0 WARN.
- No user-facing UI surface — BE pipeline task; visual refinement N/A.
