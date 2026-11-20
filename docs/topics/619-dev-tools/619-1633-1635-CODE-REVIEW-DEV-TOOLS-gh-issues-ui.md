**Topic:** GitHub read-only issue UI  
**Topic Slug:** `gh-issues-ui`  
**Thread:** Lifecycle tree fetch performance & caching  
**Thread Slug:** `lazy-loading`  
**Issue:** #1633  
**Thread Parent:** #1609  
**Topic Parent:** #619  
**Task:** #1635  
**Domain:** DEV-TOOLS  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-19  
**Last Updated:** 2026-11-19  

# Code Review — #1635 BE-IMPL: getLifecycleTopicIndex callable

**Verdict: PASS** — three parallel axes (Standards / Spec / Thermo-nuclear);
one major remediated in-gate and spec-pinned; second pass clean.

Scope: slim roots-only index callable — `fetchTopicIndexData`
(`ISSUE_FIELDS_CORE` + `INDEX_NODES_BATCH`, no `subIssues`),
`handleGetLifecycleTopicIndex`/`getLifecycleTopicIndex`,
`fetchIndexData` dep, `assembleTreeResponse` + `fetchAndAssemble`
extractions, `LifecycleTopicTreeRequest` contract, `index.ts` export,
14 new node:test specs, live verify script + registry.

## Passes

```text
First pass complete — three axes converged on one real finding:
  Standards M2 / Thermo-nuclear MAJOR — the index path counted only
  literal null slots and dropped the monolith's missingRoots recount,
  silently violating "never silently miss issues" for a whole anomaly
  class (mismatched node.number, short nodes array, non-Issue result).
  Plus: raw TypeError on missing nodes payload (asymmetric with the
  search leg's explicit guard), handle/handleIndex near-verbatim
  duplication, updatedAt index-mode semantic divergence undocumented,
  IMPL naming drift, false "existing parity coverage" claim in TEST
  doc, missing positive-grouping spec on the index handler.
Second pass complete — remediation verified against the diff:
  missingRoots recount mirrors the monolith (simpler AND covers the
  whole class); explicit missing-nodes-payload guard; handle bodies
  collapsed into fetchAndAssemble (#1636-ready); updatedAt divergence
  documented on the contract; both docs corrected; positive-grouping
  spec added. No new findings; coverage union confirmed (code, tests,
  verify script, docs all touched by at least one axis).
Convergence: PASS — remaining items are nits or documented deferrals.
```

## Remediated in-gate

- **`missingRoots` parity** (`github-client.ts`) — index now recounts
  `rootRefs` without a record at end-of-fetch, exactly like the
  monolith: null slots, short arrays, and mismatched `node.number` all
  count as truncated. New spec pins the mismatched-number case; the
  docstring's "identical guarantees" claim is now literally true.
- **Explicit payload guard** — `!Array.isArray(data.nodes)` throws
  `GitHubApiError('missing nodes payload')`, matching the search leg;
  the spec asserts the descriptive error, not `instanceof TypeError`.
- **`fetchAndAssemble` extraction** (`callables.ts`) — `handle` /
  `handleIndex` collapsed from ~15-line near-verbatim duplicates into
  auth → resolve → shared fetch→map→assemble; `#1636`'s per-topic
  handler can reuse the seam after its own request validation.
- **`updatedAt` semantics documented** (`lifecycle-contracts.ts`) —
  index-mode `updatedAt` is the root's own, not subtree-max; recorded
  on `LifecycleNode` so the FE task doesn't build on a false invariant.
- **Doc corrections** — IMPL-BE: `INDEX_ISSUE_FIELDS` → as-built
  `ISSUE_FIELDS_CORE`/`INDEX_NODES_BATCH`; both docs: callable-name
  parity described honestly (manual review today, FE task owns it —
  no automated check exists).
- **Positive-grouping spec** — index handler now has a happy-path
  inventory-group spec alongside the drift leg.

## Findings by severity

- **Critical:** 0
- **Major:** 1 — missing-roots silent-drop (remediated in-gate)
- **Minor:** remediated — TypeError asymmetry, handler duplication,
  undocumented `updatedAt` divergence, doc inaccuracies.
- **Nit (accepted / deferred):**
  - `github-client.ts` at 456 lines crosses the 400-line guideline;
    `#1636` will push it further — a `github-transport.ts` split is a
    reasonable follow-up when that task lands.
  - `labels(first:50)` tail-loss could silently drop a stage label on
    a >50-label root; soft-degrade is parity with the monolith —
    accepted (widening to `first:100` is free if it ever bites).
  - `LifecycleTopicTreeRequest` is exported-but-unused until `#1636`
    (approved blueprint scoping).
  - `as never` in the verify script vs `as any` convention — deliberate
    guard-exercising cast in diagnostics tooling.
  - `assembleTreeResponse` JSDoc names the per-topic handler before
    `#1636` lands — forward-looking but correct per blueprint.

## Test results

- `npm run test:gh-lifecycle` — **83/83** (14 new index specs incl.
  query-text `subIssues` absence, mismatched-number, malformed-batch
  guard, positive + drifted grouping, never-calls-fetchData).
- `npm run build` (functions) — clean.
- `npx jest --coverage=false` — **6,126/6,126** (full suite).
- Live verify `dev-tools-gh-lifecycle-1635-index.ts` — **ALL CHECKS
  PASSED**: real GitHub index fetch 3.5s, 43 roots, `children: []`,
  `^Topic:` filter, grouping + Status decode, error mapping.

## Spec-axis AC table

| AC | Verdict |
|---|---|
| Index query contains no `subIssues` (spec-pinned) | MET — query-text assertion |
| `children: []` + full metadata + grouping parity | MET — empty `childrenOf` → buildTree; shared `assembleTreeResponse` |
| Search-leg truncation → `internal` | MET — propagated + counted at both legs |
| `LifecycleTopicTreeRequest` exported | MET — `{owner, repo, topicNumber}` |
| Callable registered in `index.ts` | MET |
| Specs + build green | MET — 83/83 + build |
