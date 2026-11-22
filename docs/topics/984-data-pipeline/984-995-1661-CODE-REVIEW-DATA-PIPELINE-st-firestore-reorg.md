**Topic:** ST Firestore Reorg  
**Topic Slug:** st-firestore-reorg  
**Thread:** Data Plane Consolidation  
**Thread Slug:** data-plane-consolidation  
**Issue:** #995  
**Thread Parent:** #985  
**Topic Parent:** #984  
**Task:** #1661  
**Domain:** DATA-PIPELINE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-22  
**Last Updated:** 2026-11-22  

# Code Review — #1661 BE-IMPL: cohort drain — cut cohorts to st-position-groups + delete legacy paper-trading root

Three-axis gate review (Standards / Spec / Thermo-nuclear sub-agents) of
the last legacy leg of the ADR-009 tree: the `paper-trading/cohorts/items`
repository path cut over to `st-position-groups`, the `cohortId` →
`positionGroupId` lineage remap, and the deploy-gated purge artifact
(`purge-legacy-cohorts-1661.ts`).

## First pass — three axes

### Standards

No hard violations — path math, `where()` operators, and enum excision are
clean; canonical `cohort-*` stats scopes and `AnalysisCohort` untouched.
Findings: stale `cohortId` mocks in `order-ticket.store.spec.ts` +
`gallery-card-actions.service.spec.ts` (major); `deps.groups` still
optional post-cutover (major); purge `--apply` ungated on missing group
docs (major); stale comments; `cohortId` never deleted by the purge;
scope-id discontinuity `stats-cohort-cohort-*` (minors); backtick pin gap,
snackbar "group undefined", nested ternary, hardcoded collection literal
(nits).

### Spec

AC-1/2/5 met; AC-3 partial (dangling-stamp risk + `memberTradeIds` coverage
unverified); AC-4 met/deferred (same comment-gate shape as #1566);
AC-6 partial (`scripts/verify/paper-trading-contracts-560-ids.ts` +
`data-pipeline-st-collections-997.ts` still import deleted symbols);
AC-7 partial/deferred (post-deploy probe inherently deferred;
`order-ticket.store.spec.ts` breakage). Also: frozen ghost
`stats-cohort-cohort-*` docs unhandled; pre-backfill retry window drops
the group stamp; stale "cohort" comments.

### Thermo-nuclear

Verdict: cutover clean but the deploy→purge window is sharp —
`groups.create` fail-soft on the sole anchor (major); pre-backfill retry
emits group-less staged tickets (major); apply proceeds past missing
groups (major); `test:st-position-groups` references the deleted
cohort-mapper spec (major); stale `order-ticket.store.spec` (major);
`groupIdFor` throws on hostile ids; `cohortId` never deleted; anchor-doc
gap; dead `paper-trading` rules block comment; `live-snapshot` column
name lie (minors).

## In-gate fixes (all findings dispositioned)

| # | Finding | Fix |
|---|---|---|
| 1 | Purge `--apply` ungated on missing groups | hard gate — refuses when any cohort maps to a missing `st-position-groups` doc |
| 2 | `memberTradeIds` coverage unverified | purge now reports + heals stamped-but-unlisted trades via `arrayUnion` |
| 3 | Stale FE spec mocks | `order-ticket.store.spec` + `gallery-card-actions.service.spec` → `positionGroupId`; store spec now carries a `positionGroupId`-primary fixture (union fallback still covered by `cohortId` fixtures) |
| 4 | `deps.groups` optional + fail-soft on sole anchor | `groups` dep is now required; fail-soft preserved where the AC intended — `create() → null` still completes the accept unstamped |
| 5 | Pre-backfill retry orphans | new shared `cohortIdToGroupId` normalizes both fields to the canonical group id; `groupId` derives from `cohortId` when `positionGroupId` is absent; `retryOrigin` always stamps; retry response always returns `positionGroupId` |
| 6 | `test:st-position-groups` dead file ref | deleted-file entry removed from `functions/package.json` |
| 7 | Ghost `stats-cohort-cohort-*` docs | purge enumerates + deletes them (the pre-cutover scope ids never recompute) |
| 8 | `cohortId` field never deleted | purge backfill stamps `positionGroupId` AND `FieldValue.delete()`s `cohortId` in one update |
| 9 | Anchor-doc gap | purge `listDocuments()`s the root and deletes real anchors before the final empty check |
| 10 | `groupIdFor` throw on hostile ids | shared `cohortIdToGroupId` wraps `stPositionGroupId` in try/catch → null |
| 11 | Broken repo-root verify scripts | `paper-trading-contracts-560-ids.ts` + `data-pipeline-st-collections-997.ts` repointed to canonical surface — both run green |
| 12 | Stale comments/rules | `firestore.rules` block comment, `callables.ts`, `signal-order-retry.ts`, `read-callables.ts`, `legacy-roots-1013`, `st-runs-symbols-1159`, `paper-trading.service.ts`, `paper-ticket.util.ts`, FE component comments |
| 13 | Snackbar "group undefined" | message guarded on `res.positionGroupId` |
| 14 | Backtick pin gap | `legacy-cohort-retirement-1661.test.ts` pins the backtick literal too (14/14) |
| 15 | Nested ternary (backfill-1013) | `LEGACY_ANCHOR` record map |
| 16 | Hardcoded `'st-strategy-instances'` | `ST_STRATEGY_INSTANCES_ROOT` shared constant |

### Deliberately left

- `live-snapshot.ts` `cohortId` column name — schema-pinned analysis CSV
  column (now carries `grp-*` ids); comment added, rename deferred.
- `listPaperTrades` `cohortId` filter — removed with no replacement; no
  caller existed, FE groups client-side.
- `stats-cohort-*` (non-ghost) docs — canonical scope family, recomputing.
- The deprecated `PaperTrade.cohortId` contract field — stays until the
  purge deletes the last doc carrying it; union reads span the window.

## Second pass — coverage re-check

Re-ran the full union: every finding mapped to a fix or an explicit
deferral above; no diff surface left unreviewed (foreign-session hunks —
options-engine, rh-agent, scanner, strategy-manage, topic-viewer —
excluded per scoping). Re-verified post-fix:

- `legacy-cohort-retirement-1661` pin spec: **14/14**
- `tests/functions/paper-trading/*` + `collection-renames-1007`: **126/126**
- jest — FE touched specs + shared specs: **371/371** (12 suites)
- `functions` tsc + `tsconfig.app.json` tsc: clean
- Repo-root verifiers `paper-trading-contracts-560-ids` +
  `data-pipeline-st-collections-997`: run green
- Foreign failures excluded: `analysis-dataset-writer` x4
  (`deps.writeChunks` — another session's in-flight dep change) and the
  `options-engine-eod-selection-1501` fixture type error.

## Pass log

```text
First pass complete — 3 axes; consensus majors: apply-gate, stale FE specs, optional/fail-soft sole anchor, retry-window orphans, dead test ref, ghost stats scopes, broken repo-root verifiers
Second pass complete — all majors fixed in-gate and re-verified green; minors fixed or dispositioned; no new findings
Convergence: PASS — every finding has a fix or a documented deferral; suite surfaces green
```

## Verdict

**PASS** — advance to `7_QA`.
