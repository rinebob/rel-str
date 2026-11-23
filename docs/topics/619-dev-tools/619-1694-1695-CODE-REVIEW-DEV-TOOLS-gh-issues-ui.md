**Topic:** GitHub read-only issue UI  
**Topic Slug:** `gh-issues-ui`  
**Thread:** Lifecycle tree fetch performance & caching  
**Thread Slug:** `lazy-loading`  
**Issue:** #1694  
**Thread Parent:** #1609  
**Topic Parent:** #619  
**Task:** #1695  
**Domain:** DEV-TOOLS  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-23  
**Last Updated:** 2026-11-23  

# Code Review — #1695: BE-IMPL issue-map doc + seed + tree-upsert + index emit + resolveIssue

Gate review of the issueNumber → Topic-root map: Firestore doc
`gh-lifecycle-issue-map/{owner}-{repo}`, BFS-inverted seed, per-tree-fetch
sync, index emit, and the `resolveLifecycleIssue` parent-chain resolver.

## First pass findings

Three parallel axes (Standards, Spec, Thermo-nuclear) converged on the
same core issues:

| Sev | Finding | Axis | Disposition |
|-----|---------|------|-------------|
| CRITICAL | `callables.test.ts` `deps()` missing the 4 new `GhLifecycleDeps` members → `typecheck:tests` TS2741, masked at runtime by the best-effort catches | Thermo, Standards | **Fixed** — 4 stubs added |
| MAJOR | Tree sync ran before the truncation guard → a partial fetch `FieldValue.delete()`d honest entries | all three | **Fixed** — sync gated on `truncatedNodes === 0` + spec |
| MAJOR | Resolver returned no `path` for a `Topic:` root (map self-maps roots — asymmetric) | Thermo, Spec, Standards | **Fixed** — self-root branch + spec |
| MAJOR | Read→write RMW could clobber a concurrent resolver upsert / resurrect a stale pointer (queue concurrency 4) | Thermo | **Fixed** — `db.runTransaction`; deletes recompute on retry; stale-snapshot window documented |
| MAJOR | Zero coverage of the real Firestore write shape — the dotted-key bug class would escape dep-fake specs again | Thermo, Spec | **Fixed** — structural-fake specs pin `set(merge)`, nested `entries`, `DeleteTransform` sentinel, no-op/skip paths |
| MINOR | Duplicated positive-int validation (`topicNumber`/`issueNumber`) | Standards | **Fixed** — `requirePositiveInt` shared |
| MINOR | `callables.ts` crossed the 400-line guideline; stale file header | Standards | **Fixed** — `handleResolve`/`resolveLifecycleIssue` extracted to `resolve-callable.ts` (label-callables precedent); header updated |
| MINOR | Seed single-repo `SUPPORTED_REPOS[0]`; merges but never prunes on re-seed | Spec, Thermo | **Fixed** — loops all repos (per-repo skip on error); complete census prunes stale entries |
| MINOR | Depth-5 parent chain can't distinguish truncation from natural end | Spec, Thermo | **Deferred** — real chains are ≤4 edges; noted for #1696 follow-up if deeper nesting appears |
| MINOR | Single-doc write hotspot + unconditional rewrite per fetch | Thermo | **Fixed** — transaction + skip-unchanged (no write when stored agrees, no `updatedAt` churn) |
| MINOR | Stale map *hit* has no liveness signal — FE must verify the node exists in the fetched tree and fall back to the resolver | Thermo | **Deferred to #1696** — added as a review-derived AC on the FE task |
| NIT | `constants.ts` doc line, redundant cast, tsconfig missing seed include, README dup `67.`, asymmetric value validation, `buildTreeIssueMap` cycle guard | Standards, Thermo | **Fixed** |
| NIT | Older live verify scripts now implicitly touch Firestore via map sync (degrade to warn) | Thermo | **Accepted** — behavior already degrade-safe |
| NIT | Resolver abuse surface (shared GITHUB_READ_TOKEN budget); doc-size ceiling (~30k+ issues); `projectItems` in chain query unused | Thermo | **Accepted/documented** — single-user app; ceiling far off; query-cost trivial |

## Fixes verified

- `npm run test:gh-lifecycle` (tsx, functions): **130/130** (was 123; +7 new:
  truncation gate, self-root resolve, 4 structural-fake Firestore specs,
  readIssueMap coercion)
- `npm run typecheck:tests`: gh-lifecycle errors gone (suite still carries
  pre-existing foreign errors outside this scope)
- `functions` `tsc --noEmit`: clean on this surface (pre-existing
  foreign `options-engine-eod-selection-1501.ts` error remains)
- FE parity spec: 15/15 (`RESOLVE_LIFECYCLE_ISSUE` row green; `index.ts`
  re-export split reflected)
- Verify `--live`: 15/15 — real `#1696 → … → #619` chain + populated doc
  (1,417 entries); `db.runTransaction` probed live (read-only) OK

## Second pass findings

Post-fix re-check of every AC and each finding's disposition: no new
defects. The extraction to `resolve-callable.ts` keeps one import
direction (resolve → callables, no cycle); `ghLifecycleDeps()` stays the
single wiring point. Remaining open items are documented deferrals, not
defects.

## Test results

| Check | Result |
|---|---|
| tsx gh-lifecycle suite | 130/130 pass |
| Jest topic-viewer service | 15/15 pass |
| Jest full suite (pre-fix run) | 6,276/6,276 pass |
| functions tsc | clean (foreign error excluded) |
| Verify DRY | 11/11 |
| Verify `--live` | 15/15 |

## Verdict

**PASS** — all critical and major findings fixed and re-verified green;
remaining minors/nits are fixed, accepted with documentation, or deferred
to #1696 as explicit acceptance criteria.
