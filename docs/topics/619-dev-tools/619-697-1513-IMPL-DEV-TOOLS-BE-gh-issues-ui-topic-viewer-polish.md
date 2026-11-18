**Topic:** GitHub read-only issue UI  
**Topic Slug:** `gh-issues-ui`  
**Thread:** Topic Viewer UI polish & misc fixes  
**Thread Slug:** `topic-viewer-polish`  
**Issue:** #1513  
**Thread Parent:** #697  
**Topic Parent:** #619  
**Domain:** DEV-TOOLS  
**Type:** IMPL  
**Status:** Draft  
**Created:** 2026-11-14  
**Last Updated:** 2026-11-14  

# Implementation Plan — BE: root filter, flat emit, label write path

## Scope

Three work items in `functions/src/gh-lifecycle/`: (1) kill fake roots
and emit the new flat response shape, (2) add the label read + write
callables, (3) the `GITHUB_WRITE_TOKEN` secret config task.

## 1. Root filter + flat emit (`github-client.ts`, `callables.ts`)

- `SEARCH_PAGE` gains `title` on the search nodes (one field — cheap).
  `searchTopicRoots` filters refs through shared `isTopicRoot(title)`
  **before** BFS — fake roots never enter `numToId`, so they can't steal
  real nodes via `buildTree` dedup.
- `handle()` replaces `orderTopics(trees, groups)` with
  `assignGroups(trees, groups)` and returns `{topics, groupOrder,
  fetchedAt, groupingWarning?}` per the SHARED contract.
- Everything else in the walk is unchanged (search → batched `nodes(ids)`
  → paged `subIssues` → `truncatedNodes` guard).

## 2. Label callables (`functions/src/gh-lifecycle/`)

All three follow the `getLifecycleTree` pattern: `onCall` + CORS +
`request.auth?.uid` guard + `SUPPORTED_REPOS` validation + `mapGitHubError`
+ `internalGuard`.

- **`listRepoLabels`** (read — `GITHUB_READ_TOKEN`): `GET
  /repos/{o}/{r}/labels?per_page=100` paged to completion → `RepoLabel[]`.
- **`updateIssueLabels`** (write — `GITHUB_WRITE_TOKEN`): request per
  SHARED contract.
  - `remove`: `DELETE /repos/{o}/{r}/issues/{n}/labels/{name}` per name.
  - `add`: names not in the repo's label set are created first
    (`POST /repos/{o}/{r}/labels` with a default color), then
    `POST /repos/{o}/{r}/issues/{n}/labels`.
  - **Server-side stage-label guard**: any `add` name matching
    `/^[1-8]_/` → `invalid-argument` (protects workflow state; the FE
    picker already hides a wider set).
- **`manageRepoLabel`** (write — `GITHUB_WRITE_TOKEN`):
  - `create` → `POST /repos/{o}/{r}/labels` (name required; color default
    when absent; description optional).
  - `update` → `PATCH /repos/{o}/{r}/labels/{name}` with
    `new_name`/`color`/`description`.
  - `delete` → `DELETE /repos/{o}/{r}/labels/{name}` — returns the label's
    issue-usage count in the response so the FE can confirm deletes on
    in-use labels (counted via `GET /repos/{o}/{r}/issues?labels={name}
    &state=all` paged — the `labels/{name}/issues` endpoint this plan
    referenced does not exist; the filter is eventually consistent,
    ~seconds behind a fresh attach; GitHub detaches on delete; the count
    includes PRs — GitHub's issue model — matching what a delete
    detaches).
  - **Server-side guards (as built):** `updateIssueLabels` rejects
    stage-label names (`/^[1-8]_/`) in both `add` and `remove` plus
    empty/whitespace names; `manageRepoLabel` rejects `isSystemLabel`
    targets entirely plus `newName` minting a system/taxonomy name, and
    validates `newName`/`color`/`description` types when present — the
    guard shared with the FE picker is enforced here per #1523.
- REST over GraphQL for the write surface — simple CRUD, no batching
  need, matches `fetchFileText`'s existing REST precedent. A small
  `githubRest(token)` transport sits next to `githubGql` with the same
  error envelope (`GitHubApiError`, rate-limit detection).

## 3. `BE-CONFIG`: mint `GITHUB_WRITE_TOKEN`

Fine-grained PAT, **Issues: read-write** (+ Metadata read, implicit) on
`rinebob/rel-str` + `rinebob/av-proxy-api`. Set via
`firebase functions:secrets:set GITHUB_WRITE_TOKEN`; declared in
`secrets: ['GITHUB_WRITE_TOKEN']` on the two write callables only —
read callables keep `GITHUB_READ_TOKEN` (least privilege per function).
Same recipe as task #638's read-token mint.

## Error mapping

`mapGitHubError` already covers 401/403/429/other →
`unauthenticated`/`permission-denied`/`resource-exhausted`/`internal`.
Label additions: 422 on create-existing → `already-exists` with a clean
message; 404 on update/delete of a missing label → `not-found`; empty
`name` or a stage-label `add` → `invalid-argument`.

## Dependencies

- SHARED contract + `isTopicRoot` + label contracts must land first.
- Token mint is independent; write callables can't deploy without it but
  can build/spec before the secret exists (specs use injected transport).

## Test seams

- `githubRest` transport is injectable (`Gql`-style) — callable specs
  drive fixture responses for add/remove/create/update/delete without
  network.
- Root filter tested via `fetchLifecycleData` spec fixtures: a
  `subIssues`-reachable "Thread: Topic X" node present in search results
  must end up as a child, never a root.
