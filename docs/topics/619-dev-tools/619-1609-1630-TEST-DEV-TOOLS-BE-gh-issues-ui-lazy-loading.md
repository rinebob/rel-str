**Topic:** GitHub read-only issue UI  
**Topic Slug:** `gh-issues-ui`  
**Thread:** Lifecycle tree fetch performance & caching  
**Thread Slug:** `lazy-loading`  
**Issue:** #1630  
**Thread Parent:** #1609  
**Topic Parent:** #619  
**Domain:** DEV-TOOLS  
**Type:** TEST  
**Status:** Complete  
**Created:** 2026-11-19  
**Last Updated:** 2026-11-20  

# BE TEST — lazy-loading callables: topic index + per-topic subtree

## Scope

The two new callables and their fetch seams:

- `getLifecycleTopicIndex` — `searchTopicRoots` + slim `nodes()` batch
  (no `subIssues` expansion) → `LifecycleTreeResponse` with
  `children: []` roots, `groupOrder`, `groupingWarning` parity.
- `getLifecycleTopicTree` — root probe + `isTopicRoot` guard → existing
  BFS scoped to one root → full `LifecycleTreeResponse`.
- Shared BFS extraction — `fetchLifecycleData` (monolith) and the
  per-topic path must produce identical semantics (paging, truncation,
  `childrenOf`/`statusOf`).

## E2E User Journeys

N/A at this layer — the callables are exercised through injected `Gql`
fixture pages; live verification happens in FE UAT (page loads the
index in seconds; click → subtree).

## Integration Tests

- `handleGetLifecycleTopicIndex` — auth check, `resolveSupportedRepo`
  validation, handler → fetch → `buildTree` → response assembly.
- `handleGetLifecycleTopicTree` — same guard chain plus `topicNumber`
  validation; non-topic number → `invalid-argument`; unknown number →
  `not-found`.
- Truncation propagation: a fixture that truncates mid-subtree throws
  `internal` on both handlers (per-topic parity).

## Unit Tests

### `fetchTopicIndexData` (github-client.test.ts)

- Slim field set — the `nodes()` query issued contains no `subIssues`
  (assert on the query text or fixture dispatch).
- Index assembly — `children: []` on every topic; `groupOrder` and
  `groupingWarning` behave identically to the monolith path (inventory
  doc present/absent/drifted).
- Search truncation still counted (`truncatedNodes` non-zero on a
  truncated `searchTopicRoots`).

### `fetchTopicSubtreeData` / shared BFS

- Single-root scoping — fixture with multiple roots: only the requested
  root's subtree is walked (assert fetched node set).
- Paging + `collectSubIssues` unchanged — a fat root still pages to
  completion; cap behavior identical.
- `statusOf`/`childrenOf` parity — the single-topic subtree's maps
  equal the monolith's restricted to that subtree.

## Test Seams

- `Gql` injection — fixture pages per query (search page, `nodes()`
  batch, subIssues page, root probe). The existing spec already drives
  `fetchLifecycleData` this way; the new specs reuse the fixture
  harness.
- `GhLifecycleDeps` injection — handlers spec'd with a stubbed
  `fetchData`/`fetchInventoryDoc` as today.

## Test data / fixtures

- Reuse the existing gh-lifecycle fixture builders (raw issue nodes,
  subIssues connections, inventory doc markdown).
- New: a root-probe fixture (`repository.issue(number)`), and a
  two-topic fixture proving single-root scoping.

## Existing Test Coverage

- `tests/functions/gh-lifecycle/github-client.test.ts` — monolith BFS,
  search truncation, collectSubIssues paging.
- `tests/functions/gh-lifecycle/callables.test.ts` — handler guards,
  error mapping, grouping warnings.

## Edge Cases

- Requested `topicNumber` is a non-`Topic:` issue → `invalid-argument`.
- Requested `topicNumber` doesn't exist → `not-found`.
- Root deleted between index and tree fetch → `not-found` per-topic
  (FE renders the section's error state).
- Topic with >100 subIssues → `collectSubIssues` pages to completion
  (existing cap + truncation semantics).

## Verify relay

- `cd functions && npm run test:gh-lifecycle`
- `cd functions && npm run build`
- Callable-name parity: `index.ts` exports ↔ FE `CallableName` entries —
  asserted at the FE seam in #1637/#1638 (no automated parity check
  exists yet; FE registration is that task's acceptance criterion).
