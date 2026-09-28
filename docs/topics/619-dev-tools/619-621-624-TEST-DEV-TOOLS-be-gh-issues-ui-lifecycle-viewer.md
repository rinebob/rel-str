**Topic:** GitHub read-only issue UI  
**Topic Slug:** `gh-issues-ui`  
**Thread:** Lifecycle viewer  
**Thread Slug:** `lifecycle-viewer`  
**Issue:** #624  
**Thread Parent:** #621  
**Topic Parent:** #619  
**Domain:** DEV-TOOLS  
**Type:** TEST  
**Area:** BE  
**Status:** Complete  
**Created:** 2026-09-27  
**Last Updated:** 2026-09-27  

---

# Test Plan — BE: `getLifecycleTree` callable

## Seam

The callable's deps-injected handler (`handleGetLifecycleTree(request, deps)` — `paperReadDeps` precedent) splits pure assembly from the fetch shell. Mock-blindness rule applies: the GitHub query shape is verified by the **prod verify script**, not by unit-test mocks of the transport.

## Unit test targets (fixture-driven, no live GitHub)

**Request validation**
- Unknown `{owner, repo}` → `invalid-argument` naming the pair
- Missing fields → `invalid-argument`
- Repo entry without `projectNumber` → nodes carry no `status` (no crash)

**BFS fetch shell (`github-client.ts`)**
- Paginates `subIssues` past `first: 100` — a node reporting `hasNextPage` gets a follow-up page before the walk completes
- `subIssues.totalCount > nodesFetched` → treated as truncated even if `pageInfo` lies
- `truncatedNodes > 0` → `internal` error with the count (never a partial tree)
- Seen-set prevents re-expansion of a node appearing under two parents
- Search pagination — >100 root topics pages correctly
- Level batching — a level with N nodes issues `ceil(N/batchSize)` `nodes()` queries

**Status decode**
- `fieldValues` named `Status` → `name` surfaced; other fields ignored
- Issue in multiple projects → only the configured `projectNumber` item is read
- Item present but Status unset → `status` absent, not `"NOT STARTED"` invention

**Error mapping (`internalGuard`)**
- GitHub 401/403 → `unauthenticated`/`permission-denied` with token hint
- 403 + rate-limit headers → `resource-exhausted`
- Missing `GITHUB_READ_TOKEN` → `failed-precondition` naming the secret
- Inventory doc 404 → single flat `Ungrouped` section, no warning; other doc errors → `groupingWarning` set, tree still returns ungrouped

## Integration boundary (prod verify — no emulator)

`scripts/verify/gh-lifecycle-tree.ts` against the deployed callable on `rel-str`:
- Returns a parseable `LifecycleTreeResponse` with `truncatedNodes === 0`
- A known Topic (e.g. #619) appears as `nodeType: 'topic'` with its Thread child
- Every node has number/title/state/url; stage labels appear on stage-carrying issues
- `sections` is ordered by doc groups while `TOPICS-INVENTORY.md` exists and contains ≥1 group
- `fetchedAt` is a fresh ISO timestamp

## Edge cases

- Topic with zero children → leaf node, not an error
- Closed Topic → still in `sections[].topics` (UI filters), `state: 'closed'`
- Issue under two parents → listed under both in `childrenOf` (fetch layer keeps both edges); `buildTree` renders first-occurrence only
- `nodes()` returns a null slot (deleted/transferred issue) → dropped from `childrenOf`, counted in `truncatedNodes`
- Search page reports `hasNextPage` with a null `endCursor` → counted as truncation, no infinite loop
- Issue deleted between batch fetch and subIssue pagination → `repository.issue === null` counts as truncation, no crash
- PAT scoped to rel-str but not SA → SA request fails `permission-denied`, rel-str still works
