**Topic:** ST Firestore Reorg  
**Topic Slug:** st-firestore-reorg  
**Thread:** Data Plane Consolidation  
**Thread Slug:** data-plane-consolidation  
**Issue:** #995  
**Thread Parent:** #985  
**Topic Parent:** #984  
**Task:** #1013  
**Domain:** DATA-PIPELINE  
**Type:** CODE-REVIEW  
**Status:** Approved  
**Created:** 2026-10-24  
**Last Updated:** 2026-10-24  

# Code Review — #1013 legacy roots archive/diff/delete (final)

Three-axis review of the working-tree changeset: soak-mirror deletion +
undeploy, legacy-fallback removal, dead-constant sweep, rules/indexes
ACL retirement, parity relay, archive+delete op, and the pin spec.

## Standards

- ~~major — `occurrence-decisions`/`symbol-meta` declared retired (rules
  comments, pin spec) but absent from RETIRED/CHECKS manifests~~ —
  REMEDIATED: added to both manifests; archived+deleted via
  `--only savant-trader-occurrence-decisions,savant-trader-symbol-meta`
  (both empty, verified 0 remaining).
- ~~major — `match /portfolio/{anchor}` ACL still granted CRUD on the
  deleted legacy root~~ — REMEDIATED: block removed; retired-root
  comment updated to name every deleted root.
- ~~major — `paper-trading-signal-order-564.ts` read deleted
  `paper-trading/{trades,accounts}/items` literals~~ — REMEDIATED: all
  raw literals re-pointed through `paperTradingDocPathFor`/`paperItemsRef`
  (single routing point in `collections.ts`).
- ~~major — "HARD GUARD" header claimed relay enforcement that doesn't
  exist~~ — REMEDIATED: reworded to describe the real gates (archive-file
  validation, mirror-undeploy ordering note, relay-recommended).
- minor — `--only` substring matching could hit unintended roots
  (`--only status` → 2 roots) — REMEDIATED: exact name/path match.
- minor — `--resume` undocumented — REMEDIATED: usage block updated.
- nits — stale comments fixed: `st-collections.ts` "removed in #1013" on
  still-live constants (reworded to #1159), `collections.ts` ST_KINDS
  note, `repository.ts` union-read note, `backtest-collections.ts`
  mirror reference, `migrate-order-intents-1003.ts` soak-mirror refs,
  `st-cloud-function/README.md` table rows, `scripts/verify/README.md`
  #1003 row. Single-write batch in `addSymbolToDefaultList` collapsed to
  a direct `set(merge)`. `withRetry` attempt-count comment corrected.

## Spec

- ~~major — parity relay `canonicalPaths.find(last-segment === )` never
  matched renamed roots → vacuous OK on 5/8 checks; `items::` pooling
  was kind-blind across anchors~~ — REMEDIATED: positional legacy↔canonical
  path pairing; malformed pairings FAIL loudly; refId-absent legacy docs
  now flagged instead of skipped.
- ~~major — `functions/scripts/verify/run-all.ts` still listed 6 deleted
  relays~~ — REMEDIATED: list now matches on-disk set; `legacy-roots-1013`
  relay wired in.
- ~~nit — `getStorage` re-export in `firebase-admin-init.ts` unclaimed,
  zero consumers~~ — REMEDIATED: reverted (out of scope).
- PRD US-6 partials, by design: `savant-trader/data/{runs,symbols}`+subcols
  (#1159/#1019), `paper-trading/{cohorts,analysis-*}` (#1160),
  `rh-agent-credentials` (permanent) — all preserved, verified populated
  post-delete.

## Thermo-nuclear

- ~~major — `strategy-instance-repository.test.ts` still asserted the
  removed legacy union-read (6 failing tests)~~ — REMEDIATED: soak
  describe-block deleted; `LEGACY` const, `makeLegacyInstance`, and
  unused imports removed; header updated.
- ~~major — delete gate was `existsSync` on a non-atomic write~~ —
  REMEDIATED: tmp+rename atomic archive writes; delete gate now requires
  a JSON-parseable archive with `docs[]`.
- minor — pin-spec needle `'portfolio'` could never match anchored legs —
  REMEDIATED: needles now `'portfolio/`, `'paper-trading/{accounts,
  trades,stats,raw-quotes,instances}` (leading quote prevents
  `st-`prefixed false-positives).
- minor — archive JSON drops Firestore types — REMEDIATED: fidelity
  disclaimer in script header.
- Verified: `getTicketDoc`/`paperItemsRef`/`getInstance` transitive
  consumers all canonical-only; no surviving `functions/src` references
  to deleted mirrors/constants.

## Test results

| Suite | Result |
|---|---|
| `tsc --noEmit` + esbuild bundle | clean |
| `legacy-roots-cleanup-1013` pin spec | 48/48 |
| `strategy-instance-repository` | 11/11 (was 13+6 FAIL before remediation) |
| `collection-renames-1007` | 10/10 |
| `firestore-rules-indexes-1012` | 13/13 |
| `run-jobs-ttl`, `new-list-sweep`, `st-position-groups`, `st-run-completion`, `st-signals`, `st-order-tickets` | 111/111 |
| `paper-trading` suite | 272/272 |
| parity relay `data-pipeline-legacy-roots-1013` | all checks green, `legacy=0` on all 26 retired roots |

Ops evidence: `firebase deploy --only functions --force` confirmed all 8
retired functions deleted; `--apply` archived 317,028 docs to
`functions/scripts/output/legacy-archive-1013/` (26 files, ~219MB) and
deleted 26 collections, each verified at 0 remaining. Blocked roots
probed post-delete: runs=233, symbols=926, cohorts=9, analysis=7,
credentials=1 — untouched.

FE suite not run — changeset touches zero `src/app` files.

## Verdict

**PASS** (round 1, remediated) — all major/minor findings fixed and
re-verified; no critical findings on any axis.
