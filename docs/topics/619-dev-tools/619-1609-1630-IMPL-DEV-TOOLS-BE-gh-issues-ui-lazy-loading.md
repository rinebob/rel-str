**Topic:** GitHub read-only issue UI  
**Topic Slug:** `gh-issues-ui`  
**Thread:** Lifecycle tree fetch performance & caching  
**Thread Slug:** `lazy-loading`  
**Issue:** #1630  
**Thread Parent:** #1609  
**Topic Parent:** #619  
**Domain:** DEV-TOOLS  
**Type:** IMPL  
**Status:** Draft  
**Created:** 2026-11-19  
**Last Updated:** 2026-11-19  

# BE IMPL — lazy-loading callables: topic index + per-topic subtree

## Architecture overview

Split `getLifecycleTree`'s monolithic corpus walk into two callables:

```text
getLifecycleTopicIndex(owner, repo)
  → searchTopicRoots (existing) + ONE nodes() batch over the roots
    with a SLIM field set (no subIssues expansion)
  → buildTree(roots, empty children, statusOf) + assignGroups
  → LifecycleTreeResponse { topics[], groupOrder, fetchedAt, groupingWarning? }

getLifecycleTopicTree(owner, repo, topicNumber)
  → light root probe (repository.issue(number) — id, title, state)
  → isTopicRoot(title) guard
  → existing BFS (NODES_BATCH + collectSubIssues + truncation guard)
    seeded with frontier = [that root]
  → same LifecycleTreeResponse, one topic fully populated
```

Both reuse the existing `Gql` injectable transport, `resolveSupportedRepo`,
`internalGuard`, `mapGitHubError`, inventory-doc grouping, and the
`LifecycleTreeResponse` contract unchanged — no new response shapes.

## Boundary

- **`functions/src/gh-lifecycle/github-client.ts`** — fetch mechanics:
  a slim `ISSUE_FIELDS_CORE` (shared by `ISSUE_FIELDS`/`INDEX_NODES_BATCH`), new `fetchTopicIndexData`, and the BFS
  entry point refactored so `fetchLifecycleData` and
  `fetchTopicSubtreeData` share it.
- **`functions/src/gh-lifecycle/callables.ts`** — two new handlers +
  `onCall` wrappers, sharing `resolveSupportedRepo`/`internalGuard`.
- **`functions/src/index.ts`** — export registrations (callable-name
  parity with the FE `CallableName` surface).
- **`shared/lifecycle-contracts.ts`** — one new request type
  (`LifecycleTopicTreeRequest`); zero new response types.

## Files

- `functions/src/gh-lifecycle/github-client.ts` (modified)
- `functions/src/gh-lifecycle/callables.ts` (modified)
- `functions/src/index.ts` (modified)
- `shared/lifecycle-contracts.ts` (modified — request type only)
- `tests/functions/gh-lifecycle/github-client.test.ts` (modified)
- `tests/functions/gh-lifecycle/callables.test.ts` (modified)

## Modules

- **`fetchTopicIndexData(entry, gql)`** — `searchTopicRoots` → one
  `nodes()` batch per BATCH_SIZE chunk of roots using
  `INDEX_ISSUE_FIELDS` → `LifecycleFetchResult` with empty `childrenOf`
  (roots carry full metadata minus subIssues). Truncation semantics
  preserved for the search leg.
- **`fetchTopicSubtreeData(entry, topicRef, gql)`** — the existing BFS
  extracted to take an explicit frontier of root refs;
  `fetchLifecycleData` becomes the all-roots caller of the same body.
  Single-root callers get identical truncation/`childrenOf`/`statusOf`
  guarantees.
- **Handlers** — `handleGetLifecycleTopicIndex`, `handleGetLifecycleTopicTree`
  in `callables.ts`; both validate auth + repo, call their fetch seam,
  throw `internal` on `truncatedNodes > 0` (per-topic parity), run
  `buildTree` + inventory grouping, stamp `fetchedAt`.

## Contracts

```ts
// shared/lifecycle-contracts.ts — the only new type
export interface LifecycleTopicTreeRequest extends LifecycleRepoRequest {
  topicNumber: number;
}
```

- `getLifecycleTopicIndex(LifecycleRepoRequest)` → `LifecycleTreeResponse`
  with each `LifecycleTopic.children === []`.
- `getLifecycleTopicTree(LifecycleTopicTreeRequest)` →
  `LifecycleTreeResponse` with `topics` of length 1 (the requested root
  fully populated). Requesting a number that isn't a `Topic:` root →
  `invalid-argument`; unknown issue → `not-found`.
- Callable names: `getLifecycleTopicIndex`, `getLifecycleTopicTree` —
  registered in `functions/src/index.ts` and the FE `CallableName`
  surface (parity check is existing coverage).
- `getLifecycleTree` is **retained and deployed** but no longer called
  by the page — rollback path; retirement is a separate decision.

## Decisions

- **Slim index fields** — `INDEX_ISSUE_FIELDS` = number, id, title,
  state, url, updatedAt, `labels(first:50)`, `projectItems` — identical
  to `ISSUE_FIELDS` minus `subIssues`. Labels and project Status are
  required: stage chips, group classification, search-by-label, and
  closed styling all read them at index level.
- **Root probe, not search-refs replay** — `getLifecycleTopicTree`
  resolves the root via `repository.issue(number: N) { id title state }`:
  one cheap node lookup, then `isTopicRoot(title)` as the guard. Cheaper
  and more direct than re-running the topic search to find an id.
- **BFS refactored, not duplicated** — the subtree walk extracts to a
  shared body so the monolith and the per-topic path can never diverge
  on truncation/paging semantics.
- **`groupingWarning` parity** — the index fetch runs the inventory-doc
  path too; group order and drift warnings reach the FE exactly as
  today.

## Sequence / phases

- **Phase 1** — contracts + `getLifecycleTopicIndex` (slim fields,
  index assembly, specs).
- **Phase 2** — `getLifecycleTopicTree` (BFS extraction + root probe +
  handler) + `index.ts` exports + specs.

## Prior art / regression

- `fetchLifecycleData` + its `Gql`-fixture specs are the template —
  new specs drive both callables through the same seam.
- Regression risk is low: the monolith code path is untouched except
  for the shared BFS extraction, which its existing specs pin.

## Verify relay

- `cd functions && npm run test:gh-lifecycle` (or the repo's
  `tsx --test` equivalent for the gh-lifecycle spec files)
- `cd functions && npm run build` — deploy-gate compile check
- Callable-name parity: FE `CallableName` entries ↔ `index.ts` exports

## Risks / open seams

- A topic root deleted/transferred between index and tree fetch →
  `not-found` (handled as a per-topic error on the FE).
- Fat topics still page `subIssues` to completion — unchanged cost
  model per topic, just no longer paid for every topic at once.
