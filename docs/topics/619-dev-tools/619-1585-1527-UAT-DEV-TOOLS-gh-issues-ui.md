**Topic:** GitHub read-only issue UI  
**Topic Slug:** gh-issues-ui  
**Thread:** Topic Viewer UI polish & misc fixes  
**Thread Slug:** topic-viewer-polish  
**Issue:** #1585  
**Thread Parent:** #697  
**Topic Parent:** #619  
**Task:** #1527  
**Domain:** DEV-TOOLS  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-17  
**Last Updated:** 2026-11-17  

# UAT — Root filter `^Topic:` + flat emit (#1527)

## Scope

`searchTopicRoots` now fetches `title` on search nodes and filters
through shared `isTopicRoot` pre-BFS, so substring-search hits like
`Thread: Topic …` can never enter `numToId`, steal real nodes via
`buildTree` dedup, or render as top-level topics. Truncation counts
classifiable hits *seen* (filtered fakes included) — never `refs.length`
— and unclassifiable hits (missing id/number/title) count as missed and
trip the guard. Flat `{topics, groupOrder, fetchedAt, groupingWarning?}`
emit shipped under #1522 and is re-confirmed here at handler level.

Task acceptance criteria:
1. `#697`/`#713`/`#1509` never appear as roots on rel-str; they always
   render inside `#619`'s/`#697`'s trees.
2. Response carries `topics`+`groupOrder`, no `sections`.
3. `groupingWarning` semantics unchanged; truncation guard unchanged.
4. Specs: fake-root-present-in-subissues renders as child only.

## Prerequisites

- Repo: `rinebob/rel-str` working tree on branch `prod` (the code under
  test is uncommitted — run everything from the repo root).
- `GITHUB_READ_TOKEN` env, or `gh auth token` works (scripts fall back).
- `npx tsx` available (repo devDependency).
- The dev server is already running at `http://localhost:4210` — do NOT
  start a server or open a browser for the tester. S4 is the only manual
  step.
- **Deploy-lag note (important):** the running UI calls the *deployed*
  `getLifecycleTree` callable (`environment.useEmulators === false`,
  port 5002 emulator unused). The deployed function predates this task's
  code, so S4's observations describe the deploy boundary — pre-deploy
  proof lives in S1/S2/S3.

## Getting to the feature

Route: `/tools/topic-viewer` — `http://localhost:4210/tools/topic-viewer`.
Entry point: signed-in app shell → **Topic Viewer** nav item (icon
`account_tree`). Surface: repo picker tabs `rel-str` / `av-proxy-api`
above a tree of topic cards — top-level cards are the fetch's `roots`.

## Automated evidence (executed this session)

- `npx tsx scripts/verify/dev-tools-gh-lifecycle-639-fetch.ts` —
  **ALL CHECKS PASSED** (live GitHub: 43 roots, all pass `^Topic:`,
  #697 under #619, #713/#1509 under #697, `truncatedNodes === 0`)
- `npx tsx scripts/verify/dev-tools-gh-lifecycle-640-callable.ts` —
  **ALL CHECKS PASSED** (real handler: v2 shape, `sections` absent,
  #619→#621 nested, auth/validation error mapping)
- `npx tsx --test tests/functions/gh-lifecycle/github-client.test.ts` —
  **19/19 PASS** (4 new root-filter specs + 15 regression specs)

## Scenarios

### S1 — Live fetch: roots filtered, fakes nested

- **Confirms:** AC1 — `#697`/`#713`/`#1509` never root, always nested.
- **Steps:** run `npx tsx scripts/verify/dev-tools-gh-lifecycle-639-fetch.ts`.
- **Expected:** `=== ALL CHECKS PASSED ===`, exit 0. Required PASS lines:
  `every root passes the ^Topic: filter` (offenders would be listed
  `#N "title"`), `#697 thread renders inside #619, not as a root`,
  `#713/#1509 render inside #697, not as roots`,
  `truncatedNodes === 0`. Console prints `roots: 43` (approx — live
  count grows as Topics are added).
- **Result:** ☒ PASS — live run: ALL CHECKS PASSED; 43 roots, every root `^Topic:`, #697 under #619, #713/#1509 under #697, truncatedNodes 0 (2026-11-17)

### S2 — Handler-level flat emit, no `sections`

- **Confirms:** AC2 — the callable response is `{topics, groupOrder,
  fetchedAt}` and carries no legacy `sections` key.
- **Steps:** run `npx tsx scripts/verify/dev-tools-gh-lifecycle-640-callable.ts`.
- **Expected:** `=== ALL CHECKS PASSED ===`, exit 0. Required PASS lines:
  `response parses to LifecycleTreeResponse v2 shape`,
  `no legacy sections key on the response`,
  `every topic carries a group`,
  `every stamped group appears in groupOrder`,
  `topic #619 emitted as nodeType topic`,
  `unsupported repo → invalid-argument`,
  `no auth → unauthenticated`.
- **Result:** ☒ PASS — ALL CHECKS PASSED incl. `no legacy sections key`; v2 shape, groups stamped, #619→#621, error mapping (2026-11-17)

### S3 — Unit specs: filter, dedup-steal, unclassifiable

- **Confirms:** AC3 (truncation guard) + AC4 (fake-in-subissues renders
  as child only) + the review-pass unclassifiable-hit fix.
- **Steps:** run
  `npx tsx --test tests/functions/gh-lifecycle/github-client.test.ts`.
- **Expected:** `pass 19`, `fail 0`. The `root filter (#1527)` describe
  covers: fake filtered without false truncation; non-topic search hit
  reachable via `subIssues` lands as a child; fake-first search order
  can't steal a real subtree via dedup; a hit with no title counts as
  missed (`truncatedNodes === 1`). Pre-existing specs cover
  `searchStuck` truncation and over-counted `issueCount` truncation.
- **Result:** ☒ PASS — 19/19 pass; filter, dedup-steal, unclassifiable→truncated, and pre-existing truncation specs all green (2026-11-17)

### S4 — Manual UI pass on the running app (deploy-lag aware)

- **Confirms:** the deployed-callable boundary is understood and the
  tree currently rendered is self-consistent.
- **Steps:** at `http://localhost:4210/tools/topic-viewer`, tab
  `rel-str`: (a) confirm the page loads a topic tree (not an error
  card); (b) look at the top-level cards — if any card's title does NOT
  start with `Topic:`, that is the *deployed* function's unfiltered
  output, expected until ship+deploy; (c) after this task ships and
  functions deploy, re-check: every top-level card's title must start
  with `Topic:` and Thread `#697`'s subtree must appear nested under
  Topic `#619`.
- **Expected (pre-deploy):** page loads; report what the top-level
  titles look like — either is acceptable pre-deploy, the post-deploy
  re-check is the binding assertion.
- **Result:** ☒ PASS — user-observed on running app (2026-11-17): page loads a topic tree in the left panel, no non-`Topic:` top-level cards visible on a spot pass (not all 43 roots individually expanded — live 639 remains the exhaustive check); deployed-callable re-check scheduled post-ship+deploy

## Manual UI/UX refinement pass

- Loading/error/empty states unaffected by this change (BE contract
  only); the rendered tree's content correctness is S4's concern.
- Visual hierarchy/spacing/keyboard theming: no new UI surface — no
  component or stylesheet was touched.
- **Result:** ☒ PASS — no component/stylesheet surface in this task; tree renders and selection works (user clicked a topic and the detail view loaded, 2026-11-17)

## Findings

- None.

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| AC1 — #697/#713/#1509 never root, nested inside #619/#697 | S1, S4 |
| AC2 — `topics`+`groupOrder`, no `sections` | S2 |
| AC3 — `groupingWarning`/truncation guard unchanged | S2, S3 |
| AC4 — fake-in-subissues renders as child only | S1, S3 |

## Regression / smoke

- `npx jest` full suite ran green at review (315 suites / 5832 tests);
  no spec outside `github-client.test.ts` needed changes for this task
  other than the shared-fixture default title.
- `functions && npm run build` compiled clean during the same session.
- Nearby behavior: `searchStuck` truncation, sub-issue pagination, and
  status decoding specs all still pass inside the 19-test file (S3).

## Verdict

**Result:** PASS — S1–S4 green; UI re-check after functions deploy is the only deferred confirmation

## Results log

| Date | Run | Outcome |
|---|---|---|
| 2026-11-17 | S1/S2/S3 executed (session gh-issues-ui-labels) | ALL CHECKS PASSED / 19-19 |
| 2026-11-17 | S4 user-observed on running app | PASS — tree loads, no non-Topic top-level cards seen (spot pass); post-deploy re-check pending |
