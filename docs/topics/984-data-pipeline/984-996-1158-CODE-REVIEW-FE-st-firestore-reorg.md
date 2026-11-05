**Topic:** ST Firestore Reorg  
**Topic Slug:** st-firestore-reorg  
**Thread:** Data Plane Consolidation  
**Thread Slug:** data-plane-consolidation  
**Issue:** #996  
**Thread Parent:** #985  
**Topic Parent:** #984  
**Task:** #1158  
**Domain:** FE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-03  
**Last Updated:** 2026-11-03  

# CODE REVIEW — #1158 analysis.service → st-paper-trading analysis anchors

## Verdict

**PASS** — three-axis review (Standards / Spec / Thermo-nuclear) on the
uncommitted change set plus the second implementation pass. No critical
or major findings. All minors and worthwhile nits were remediated in
review and re-verified (tsc, both migrator modes, parity relay, pin
suites). This task also covers every acceptance criterion of its BE
twin #1160.

## Round 2 — re-review findings and remediation

Re-run of all three axes against the post-R1 state (user-requested
repeat, scoped to convergence). Every R1 remediation verified in place
and correct — including the tricky paths: `--no-create` fires before
the unchanged/drift branches and early-returns before the subcollection
loop (no partial resurrection); parent `unchanged` still falls through
to chunk copy (parent equality ≠ chunk parity); `firstDiff` call sites
are all guarded by `.exists`.

**Spec: converged — zero findings.** Doc-drift fixes landed; AC map
re-verified post-remediation.

**Thermo-nuclear: converged — no MEDIUM+.** Three TRIVIALs, two
declined (retired-1159 labels, `--no-create` doc granularity) and one
fixed (see below).

**Standards: 2 LOWs introduced by R1 remediation — both fixed:**

- `!(only in LEGS)` traversed `Object.prototype` — `--only constructor`
  passed validation then silently ran no legs (false-success `--apply`)
  → `Object.hasOwn` (precedent: `st-collections.ts:163`); verified:
  `--only constructor` now errors
- The new "overwritten (legacy newer)" WARN printed literally in
  dry-run → `would overwrite` per the `would-` convention
- Also applied (Thermo TRIVIALs): migrator `firstDiff` polarity aligned
  with the relay's (`+key` for canonical-only fields); header clarifies
  `--no-create` is doc-granular (missing chunks under an existing twin
  still copy — that IS the straggler mechanism)

Re-verified post-R2: migrator dry-run + `--no-create` + `--only`
validation all correct; relay remains green. **No third round
warranted** — the remaining surface is the same ~20 files re-examined;
R2 produced only the two remediation-introduced LOWs, both mechanical.

## Scope reviewed

Cutover of the last FE+BE consumers of the legacy `paper-trading` root:
`analysisDatasetsPath()`/`analysisSlicesPath()` repointed to
`st-paper-trading/analysis-{datasets,slices}/items` (one shared seam
cuts FE service, BE callables, dataset-writer, dataset-task); new
`StPaperTradingKind` members + anchors + `ST_KINDS` routing; new
`firestore.rules` grant legs mirroring the retired legacy block plus a
chunk-delete parity-fix; verbatim migration script (applied: 4 datasets
+ 4 chunks + 3 slices) and a parity relay registered in both run-alls;
all pin specs updated. Prod data verified verbatim via the relay.

## Standards

Conventions clean — anchor pattern, singular-kind→plural-anchor naming,
kind-value parity (`analysis-dataset`/`analysis-slice` byte-identical to
`PaperTradingKind`, so doc `kind` fields and `is*` guards stay valid),
jest/tsx test split, run-all wiring, no runtime import cycle
(`st-collections` imports `PaperTradingKind` type-only). Rules legs
verified leg-by-leg vs the legacy block: exact grant parity, no
over-grant, `anchor`/`sub` wildcards correctly scoped.

**Findings — all remediated:**

- minor — migration direction guard covered parent docs but not `chunks`
  sub-docs → same updateTime guard now applied per chunk; also wrapped
  in fail-counting try/catch (`migrate-analysis-anchors-1158.ts`)
- minor — relay re-fetched each canonical chunk individually (extra
  reads + `data()!` crash-on-race) → diffs against the already-fetched
  snapshot via a Map
- minor — `process.exit(1)` inside the leg loop lost the second leg's
  scan → accumulates `anyFailed`, sets `exitCode` after all legs
- nit — dry-run printed `created`/`updated` (misleading) → `would-*`
- nit — `--only` as last argv silently ran all legs → usage error
- nit — `paper-trading-ids.ts` module header pre-dated the analysis-*
  exception → noted
- declined — migrator absent from functions tsconfig `include`:
  precedent-consistent (`migrate-st-runs-symbols-1159.ts` equally absent,
  one-shot-migrator pattern); tsx runs it untyped as designed

## Spec

All four #1158 checkboxes **met**. #1160 superset **met** with two
noted positions:

- "analysisDatasetsPath/analysisSlicesPath retired" — **met in intent**:
  helpers repointed in place rather than renamed/deleted; every caller
  (5+ sites, FE+BE) cuts atomically with zero churn. Documented judgment
  call from implementation.
- "legacy docs migrated" — implemented and **executed**: 4 datasets +
  4 chunks + 3 slices copied verbatim, relay confirms verbatim parity.
  Straggler-pick re-run remains a ship step by design.

Doc-drift findings remediated: `paper-trading-analysis-1073.md` and
`paper-trading-analysis-1076.md` still documented legacy paths;
`repository.ts` header still called analysis-* legacy. Declined:
retired `data-pipeline-st-runs-symbols-1159.ts` keeps its historical
"deferred to #1160" label (retired artifact, not in run-all).

## Thermo-nuclear

Cutover mechanics verified clean (verb legs, wildcard scoping, helper
coverage — zero `paper-trading/analysis-*` literals outside
migrator/relay; no composite indexes needed; firstDiff polarity
correct). Risk concentrated in the verbatim-copy migration model vs
post-cutover writes:

**Findings — disposition:**

- MEDIUM — straggler pass resurrects post-cutover deletes → **fixed**:
  new `--no-create` mode updates existing twins only; missing-canonical
  reported WARN, never recreated
- MEDIUM — migrator preserves canonical-newer drift (WARN-skip) while
  the relay FAILs the same drift → **mitigated by contract**: runbook
  in the migrator header now documents hands-off-workbench window
  (proportionate for a same-day single-user window; verbatim parity is
  the correct gate, drift is the user's signal to reconcile before
  delete)
- MEDIUM — legacy-newer overwrite clobbered silently → **fixed**: WARN
  logs the first divergent key on every non-equal overwrite
- MEDIUM-LOW — in-flight generation spanning the functions deploy can
  split-brain (legacy index + partial canonical chunks) → **documented**:
  quiesce-generation note in the deploy ordering contract
- LOW — ordering contract existed only implicitly → **fixed**: header
  now states rules+functions first, FE last (pre-deploy FE slice saves
  would 403 otherwise)
- LOW — #1076 probe cleanup orphaned `chunks` under canonical →
  **fixed**: cleanup deletes the subcollection
- TRIVIAL — double-FAIL when parent twin missing → gated on parent
- DRIVE-BY — `functions/scripts/analysis/signal-trades-export.ts:272`
  hardcodes legacy `paper-trading/trades/items` (stale since #1007;
  pre-existing, outside this task — **flagged for a separate task**)

## Test results

- Full jest suite: **281/281 suites, 4,851 tests** green (post-impl)
- Post-remediation re-verify: functions `tsc -p tsconfig.json` clean;
  migrator dry-run + `--no-create` dry-run both correct (all docs
  `unchanged`); parity relay green 4/4 datasets + 3/3 slices verbatim;
  shared specs 84/84; node:test pin files 25/25 (rules legs incl.
  chunk-delete pin, collection-renames paths)
- Analysis service/store specs: 133/133 (implementation pass)

## Ship sequence (carried into QA/UAT)

1. `firebase deploy --only firestore:rules` + `--only functions`
2. FE deploy (last — slice saves/dataset deletes 403 before rules land;
   quiesce dataset generation across the functions deploy)
3. `npx tsx scripts/migrate-analysis-anchors-1158.ts --apply --no-create`
   — straggler-pick, never resurrects
4. Parity relay: `data-pipeline-analysis-anchors-1158.ts`
5. FE workbench smoke (datasets listed, slice save/delete, dataset
   delete incl. chunks)
6. Archive + delete legacy `paper-trading/analysis-*` anchors —
   approval-gated
7. Retire the parity relay + legacy rules legs post-delete

**Next: `/proj qa 984 1158`**
