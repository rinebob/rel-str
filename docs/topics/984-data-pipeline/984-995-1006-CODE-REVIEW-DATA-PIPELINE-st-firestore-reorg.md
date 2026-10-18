**Topic:** ST Firestore Reorg  
**Topic Slug:** st-firestore-reorg  
**Thread:** Data Plane Consolidation  
**Thread Slug:** data-plane-consolidation  
**Issue:** #995  
**Thread Parent:** #985  
**Topic Parent:** #984  
**Task:** #1006  
**Domain:** DATA-PIPELINE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-18  
**Last Updated:** 2026-10-18  

# CODE-REVIEW — #1006 st-strategy-instances migration + re-point

## Scope

Filtered working-tree diff covering only the #1006 files (the tree also holds
unrelated in-flight work for #1042/#1043/#1074/#1076 — excluded): engine
`strategy-instance-repository` re-point to `st-strategy-instances` with a
union-read soak bridge over `paper-trading/instances/items`; `daily-analysis`
subcollection re-point (open-pass, overnight-simulation-writer,
position-repository settlement txn); `repository.ts` `getInstance`/`setInstance`
delegation; `deepEqual` NaN fix in `legacy-order-intents.ts`; migration script
`migrate-strategy-instances-1006.ts`; read-only audit
`verify/data-pipeline-st-strategy-instances-1006.ts` + guide; verify README /
run-all registration; repository test rewrite + `exit-eval-pass` fixture fix +
`st-order-ticket-writer` test-helper typing.

## Round 1 — three axes

**Standards (MINOR).** Conforms: `st-` prefix, anchor-pattern paths, segment
parity, migration script clones the #1003/#1004 convention (`--apply`, batch
limit, unchanged detection), tests use real path constants. Flagged:
`daily-analysis`/`'latest'`/`'options-strategy-instances'` literals duplicated
across sites; `listAllInstances` name lied post-filter; `normalizeInstance`
leaked the anchor-era `kind` discriminator into returned shapes; settlement
txn read canonical-only (asymmetric with `getInstance`).

**Spec (PASS w/ conditions).** Checklist 1+2 met. Checklist 3
("paper-trading/instances anchor removed") is deliberately **deferred to
#1014** — the FE Strategy Builder still writes the anchor, so the read bridge
must stay until the FE re-points; the anchor is removed from the *primary*
path, not the union seam. Verified zero remaining `INSTANCE`-kind /
`options-strategy-instances` readers outside the intentional bridge + scripts.

**Thermo-nuclear (CONCERNS → remediated).** Two MAJORs found and fixed:

1. **Union-read shadowed post-migration UI edits.** Canonical-wins-always
   meant a Strategy-Builder pause/edit (which lands on the anchor until #1014)
   would be invisible — the engine would keep trading a STOPPED instance.
   → `listInstances`/`getInstance` now merge **newest `updatedAt` wins**
   (tie → canonical). No BE writer touches instance docs post-migration, so
   anchor edits always win during soak; after #1014 the anchor freezes and
   canonical wins permanently.
2. **Migration rerun stomped canonical state.** `mode:'paper'`/`enabled`/
   `paperAccountId`/`lastFiredAt` are now write-if-absent on rerun — a
   kill-switch or `mode:'live'` promotion on the canonical doc is never
   reverted. Divergent `daily-analysis` docs overwrite only when the legacy
   copy is provably newer (`overnightDeltaSimulation.computedAt`), else WARN
   + keep canonical.

Minors fixed: settlement txn gained the legacy-anchor txn fallback;
`listAllInstances` → `listRunnableInstances` (honest name); `LATEST_DOC`,
`daily-analysis`, and the legacy root literal now share constants
(`LATEST_DAILY_ANALYSIS_DOC_ID`, `STRATEGY_INSTANCE_DAILY_ANALYSIS_SUBCOLLECTION`,
`LEGACY_OPTIONS_STRATEGY_INSTANCES`); `normalizeInstance` strips `kind`;
`getInstance` falls back past a malformed canonical doc; verify script gained
a non-runnable exclusion sanity check and timestamp-aware drift classification
(post-migration churn WARNs instead of false-FAILs).

Known residual (accepted): verify scripts 724/669/562 still probe
`PaperTradingKind.INSTANCE` — intentional legacy leftovers, cleaned in #1013.
`deepEqual` still treats class instances (Timestamp/GeoPoint) as equal —
unchanged-detection only; documented.

## Round 2 — convergence pass (two new findings, both fixed)

**CRITICAL → fixed.** The lifecycle `where` was applied per-collection
*before* the newest-wins merge — a twin whose newer copy moved out of the
queried state never entered the merge, so a UI pause (anchor PAUSED+newer)
left the stale canonical ACTIVE copy winning `listActiveInstances`: the
engine would keep opening positions on a stopped instance — exactly what the
bridge exists to prevent. → `listInstances` now reads both collections
unfiltered, merges, then applies `lifecycleStates` post-merge
(`listActiveInstances`/`listManageableInstances`/`listRunnableInstances`
all share it; collections are 4-doc tiny). Regression test asserts a paused
anchor twin drops the instance from `listActiveInstances` while keeping it
in `listManageableInstances`.

**MAJOR → fixed.** Migration rerun still reverted non-preserved fields when
canonical was newer (FE/engine writes post-#1014). → the script now skips
the doc wholesale when canonical `updatedAt` is newer than the legacy source
(Timestamp-normalized via `toIso`), warning "canonical doc newer —
preserved". Also: `updatedAt` on a migrated doc falls back to `createdAt`
instead of fabricating `now()` (a fabricated newest stamp would win the
union merge forever).

Plus: `tsMillis` (`Date.parse`, NaN→oldest) replaces raw string compare for
newest-wins — non-ISO/mixed-format timestamps can't mis-order.

## Round 3 — convergence pass (MINOR)

- `existing.updatedAt` could be a Firestore Timestamp, bypassing the
  canonical-newer guard → compared via `toIso` now.
- Accepted residuals: `setInstance` merge-vs-overwrite (no callers);
  root↔anchor id-collision drops the root's `daily-analysis` (anchor empty);
  verify `soakDrift` fails-safe on Timestamp-typed `updatedAt` (false-FAIL,
  never false-PASS).

## Test results

- `tsx --test` repository suite: **19/19 pass** (newest-wins collisions,
  paused-anchor shadowing regression, malformed-canonical fallback,
  mode/enabled filters, normalization).
- `npm run test:paper-trading`: **272/272 pass**.
- `tsc --noEmit` clean; `esbuild` build clean.
- Prod live: migration dry-run `created 0 / updated 0 / unchanged 4`;
  audit **0 FAIL, 0 WARN — canonical 4, seam listed 4** (post-`--apply`).

## Verdict

**PASS** — three rounds: round 1 fixed two MAJOR soak-window findings,
round 2 caught and fixed the pre-merge `where` defeat of newest-wins
(CRITICAL) plus the canonical-newer rerun stomp (MAJOR), round 3 converged
to MINOR (all fixed). The anchor-removal checklist item is satisfied as
"removed from the primary BE path; union-read bridge retained until #1014"
— tracked on the task.
