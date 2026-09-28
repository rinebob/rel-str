**Topic:** GitHub read-only issue UI  
**Topic Slug:** `gh-issues-ui`  
**Thread:** Lifecycle viewer  
**Thread Slug:** `lifecycle-viewer`  
**Issue:** #624  
**Thread Parent:** #621  
**Topic Parent:** #619  
**Domain:** DEV-TOOLS  
**Type:** IMPL  
**Area:** BE  
**Status:** Complete  
**Created:** 2026-09-27  
**Last Updated:** 2026-09-27  

---

# Implementation Plan — BE: `getLifecycleTree` callable

## 1. Scope

One callable that walks a repo's GitHub issue tree and returns grouped, topic-rooted `LifecycleNode`s. New folder `functions/src/gh-lifecycle/` matching the `paper-trading/` layout. Read-only — the function performs no GitHub mutations.

## 2. Files

- `functions/src/gh-lifecycle/config.ts` — `SUPPORTED_REPOS: { owner, repo, projectNumber? }[]` (initially `rinebob/rel-str` + the SA repo, projectNumber where one exists). Checked-in constant — adding a repo = one-line change + redeploy.
- `functions/src/gh-lifecycle/github-client.ts` — the fetch shell (GraphQL over `fetch`, Node 24 native — no Octokit dependency for a single query shape).
- `functions/src/gh-lifecycle/callables.ts` — the `onCall` endpoint, auth guard, error mapping, deps injection (mirroring `read-callables.ts`).
- `tests/functions/gh-lifecycle/github-client.test.ts` — pagination/truncation logic tests against fixture pages (never asserting on Octokit/fetch internals); `tsx --test` convention, wired as `npm run test:gh-lifecycle`.
- `functions/src/index.ts` — re-export.

## 3. Auth

- **PAT:** `GITHUB_READ_TOKEN` via `secrets: ['GITHUB_READ_TOKEN']` on the `onCall` options (same wiring as `RH_CREDENTIAL_BUNDLE`). Accessed via `process.env.GITHUB_READ_TOKEN`; missing/unset → `failed-precondition` HttpsError naming the missing secret.
- **Manual prerequisite (user):** mint a fine-grained PAT at github.com → Settings → Developer settings → Fine-grained tokens: repos = `rel-str` + SA repo, permissions = `Issues: Read` + `Projects: Read`, expiry ≤ 1 yr. Store via `firebase functions:secrets:set GITHUB_READ_TOKEN`. The callable cannot be deployed or verified until this exists — it blocks the deploy+verify tasks.
- Firebase auth still gates the endpoint (`internalGuard` unauthenticated check — same as existing callables).

## 4. Fetch shell (`github-client.ts`)

GraphQL BFS with mandatory truncation detection — the "never silently miss issues" guarantee:

1. **Roots** — `search(query: "repo:{o}/{r} is:issue Topic: in:title", type: ISSUE, first: 100)` paginated via `pageInfo.hasNextPage` to completion. Open + closed both returned (UI filters).
2. **Expansion** — BFS by level. For each pending node, a `nodes(ids: [...])` batch query fetching `number, title, state, url, updatedAt, labels(first: 50), projectItems(first: 10) { nodes { project { number } fieldValues(first: 20) { ... SingleSelectValue { name field { name } } } } }, subIssues(first: 100) { nodes { number } totalCount pageInfo { hasNextPage endCursor } }`.
3. **Pagination guard** — `subIssues.pageInfo.hasNextPage` (or `totalCount > fetched`) triggers a follow-up paginated query for that node until complete. The response carries `truncatedNodes: number` — must be 0, else the callable throws `internal` with the count rather than returning a partial tree. The same counter covers: search pages that cannot advance (`hasNextPage` + null `endCursor` or `issueCount` not collected), `nodes()` null slots (deleted/transferred/inaccessible issues), issues vanishing mid-walk (`repository.issue === null`), and a hard `SUBISSUES_PAGE_CAP` (50 pages/node). The transport is an injectable `Gql` fn so tests drive fixture pages without mocking fetch; `subIssues` selects `id` alongside `number` for the `nodes(ids)` batch expansion. `fetchFileText` (raw contents-API read for the inventory doc) also lands here — it's GitHub I/O, used by both the callable and the verify script.
4. **Depth** — unbounded; BFS terminates when a level yields no children. Cycle safety: a seen-set per repo walk (a node already visited as a child is not re-expanded — GitHub sub-issues can't technically cycle, but belt-and-suspenders against duplicate edges).
5. **Status decode** — per node, `projectItems` → find the item whose `project.number` matches the repo's configured `projectNumber` → `fieldValues` → the field named `Status` → its `name`. Repo with no `projectNumber` skips the lookup entirely (`status` unset).

## 5. Callable (`callables.ts`)

```ts
export const getLifecycleTree = onCall<LifecycleRepoRequest, Promise<LifecycleTreeResponse>>(
  { cors: OPTIONS_STRATEGY_ALLOWED_ORIGINS, secrets: ['GITHUB_READ_TOKEN'], timeoutSeconds: 120, memory: '512MiB' },
  (request) => internalGuard('getLifecycleTree', () => handleGetLifecycleTree(request, ghLifecycleDeps())),
);
```

- `handleGetLifecycleTree(request, deps)`: validate `{owner, repo}` against `SUPPORTED_REPOS` (unknown → `invalid-argument` naming the pair); run fetch → `buildTree` + `parseInventoryGroups` + `orderTopics` (all imported from `shared/`); return `{sections, fetchedAt, truncatedNodes}` (+ `groupingWarning` when the inventory doc errored non-404 or parsed to zero groups — distinguishes "doc exists but drifted" from "no doc").
- Error mapping via the existing `internalGuard`/`HttpsError` pattern: HTTP 401/403 from GitHub → `unauthenticated`/`permission-denied` with a token-expiry hint in the message; 403+rate-limit headers → `resource-exhausted`; fetch/parse failures → `internal`. The raw GitHub message is included so the UI error banner can name the cause.
- `ghLifecycleDeps()` exported — the verify script shares the wiring (`paperReadDeps` precedent).

## 6. Inventory doc fetch

- `GET https://api.github.com/repos/{owner}/{repo}/contents/docs/dev-notes/TOPICS-INVENTORY.md` (Accept: `application/vnd.github.raw`) via the same PAT. 404 → flat `Ungrouped` section, no warning. Other errors → treat as non-fatal: log + flat sections (the tree still renders ungrouped) but surface a `groupingWarning` in the response so the UI can show "grouping unavailable" distinctly from "no doc".

## 7. Verification

`scripts/verify/gh-lifecycle-tree.ts` — calls the deployed `getLifecycleTree` against `rel-str`, asserts: response parses to `LifecycleTreeResponse`; a known Topic (e.g., #619 itself) appears with `nodeType: 'topic'` and at least one child; every node has `number/title/state/url`; `truncatedNodes === 0`; `sections` contains ≥1 named group plus topic trees when the inventory doc exists. Per repo convention — real prod, no emulator. `npm run build` + `firebase deploy --only functions` as usual.

## 8. Risks

- **Query complexity/timeouts** — ~700 issues × fields is well under limits, but BFS latency grows with depth; 120s timeout covers it. If a repo's tree outgrows the timeout, the level-batched `nodes()` query (batches of ~50 ids) is the tuning knob.
- **Search indexing lag** — a brand-new Topic may take seconds to appear in `search`. Acceptable for a refresh-driven viewer; noted in PRD technical context.
- **SA repo shape** — no `projectNumber` → status columns simply empty; tree still works.
