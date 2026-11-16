**Topic:** GitHub read-only issue UI  
**Topic Slug:** `gh-issues-ui`  
**Thread:** Topic Viewer UI polish & misc fixes  
**Thread Slug:** `topic-viewer-polish`  
**Issue:** #1513  
**Thread Parent:** #697  
**Topic Parent:** #619  
**Domain:** DEV-TOOLS  
**Type:** TEST  
**Status:** Draft  
**Created:** 2026-11-14  
**Last Updated:** 2026-11-14  

# Test Plan: gh-lifecycle root filter, flat emit, label callables (BE)

## E2E User Journeys
- Prod verify (existing `scripts/verify` pattern): `getLifecycleTree`
  on rel-str returns `topics`+`groupOrder`, no `sections`; #697/#713/
  #1509 absent from roots but present inside #619's/#697's trees.
- Post-token: `updateIssueLabels` on a sacrificial issue attaches +
  detaches a scratch label; `manageRepoLabel` create/rename/delete
  round-trips a scratch label.

## Integration Tests
- `handleGetLifecycleTree` with injected `fetchData`: roots lacking
  `Topic:` titles are filtered pre-BFS; response shape matches the
  SHARED contract; `groupingWarning` paths extended — stale-doc case
  (parses but lists no fetched topics) warns; 404 still silent.
- Write callables with injected `githubRest`: add-existing → POST
  labels only; add-missing → create + attach order; remove → DELETE per
  name; `manageRepoLabel` ops map to POST/PATCH/DELETE correctly;
  delete returns usage count.

## Unit Tests
- Root filter inside `searchTopicRoots`/walk fixtures: a
  subIssues-reachable "Thread: Topic X" in search results renders as
  child only — never a root, never deduped away.
- `updateIssueLabels` validation: stage label in `add` →
  `invalid-argument`; empty `add`+`remove` → `invalid-argument`;
  `issueNumber` non-integer → `invalid-argument`.
- `manageRepoLabel` validation: missing name → `invalid-argument`;
  unknown op → `invalid-argument`.
- Error mapping: 401/403/429 → mapped HttpsError codes; 422 create →
  `already-exists`; 404 → `not-found`; raw upstream body never leaks.

## Test Seams
- Highest seam: callable handler + injected transports (`Gql`/`Rest`)
  — the same spec seam `github-client.ts` already uses; no network.
- Lower seams: validation + mapping pure logic.

## Existing Test Coverage
- `github-client` spec fixtures cover search paging, batch `nodes()`,
  subIssues paging, truncation counting — new cases add the title
  filter and the flat emit only.
- Auth guard + `SUPPORTED_REPOS` validation already specced on
  `getLifecycleTree` — the three new callables get the same cases.

## Edge Cases
- Issue not in repo's label set yet (add of brand-new label name) →
  create-then-attach order.
- Attaching a label already on the issue → GitHub no-ops; response
  still success.
- Removing a label not on the issue → GitHub 404 → treated as no-op
  success (idempotent remove) or surfaced — spec whichever is
  implemented; document in task ACs.
- Rate-limited mid-sequence (remove ok, add fails) → error surfaces;
  partial state is GitHub-truth (visible on refetch).
- `listRepoLabels` over >100 labels → pages to completion.
