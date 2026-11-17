**Topic:** GitHub read-only issue UI  
**Topic Slug:** gh-issues-ui  
**Thread:** Topic Viewer UI polish & misc fixes  
**Thread Slug:** topic-viewer-polish  
**Issue:** #1592  
**Thread Parent:** #697  
**Topic Parent:** #619  
**Task:** #1528  
**Domain:** DEV-TOOLS  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-17  
**Last Updated:** 2026-11-17  

# UAT — `listRepoLabels` callable (read) (#1528)

## Scope

New callable `listRepoLabels` — `GET /repos/{o}/{r}/labels?per_page=100`
paged to completion through a new injectable `githubRest` transport
(same `GitHubApiError`/rate-limit envelope as `githubGql`), returning
`{labels: RepoLabel[], fetchedAt}` with labels projected to the
`{name, color, description}` contract (`description` → `null` when
absent). Same envelope as `getLifecycleTree`: auth guard →
`SUPPORTED_REPOS` validation → injected transport → `mapGitHubError`.

Task acceptance criteria:
1. Returns full label list over >100 labels (paged).
2. Auth guard + unsupported-repo rejection specced.
3. `githubRest` transport shares `GitHubApiError`/rate-limit handling.

Review-round remediations this UAT also confirms: spec registered in
`test:gh-lifecycle`; `PAGE_CAP=50` hard stop; non-array page body →
`internal`; contract projection; independent count check on the live
verify.

## Prerequisites

- Repo: `rinebob/rel-str` working tree on branch `prod`.
- `GITHUB_READ_TOKEN` env, or `gh auth token` works (the script falls
  back to `gh auth token`).
- `npx tsx` available (repo devDependency).
- `gh` CLI authenticated for the independent count check
  (`gh label list`).
- Live values as of 2026-11-17: rel-str has **68 labels**,
  av-proxy-api has **49 labels**. Both <100 — the multi-page path is
  unit-spec evidence, not live-observable today.
- The dev server is already running — no server start, no browser
  needed (no UI surface in this task).

## Getting to the feature

The feature is a callable, not a page: `listRepoLabels` in
`functions/src/gh-lifecycle/label-callables.ts`, exercised through
`handleListRepoLabels(request, deps)` — same deps-injection seam as
`getLifecycleTree`. Entry points for verification: the live verify
script (S1) and the node:test spec file (S2). The wire-level onCall
export lands in `functions/src/index.ts` at ship; nothing UI-facing
consumes it yet (the FE label picker is #1521).

## Automated evidence (executed this session)

- `npx tsx scripts/verify/dev-tools-gh-lifecycle-1528-labels-read.ts` —
  **ALL CHECKS PASSED** (live: 68 labels rel-str, 49 av-proxy-api,
  counts match `gh label list`, taxonomy + 6-hex colors)
- `npm run test:gh-lifecycle` (from `functions/`) — **60/60** across
  the three spec files (includes `label-callables.test.ts`, the file
  this review found orphaned)
- `npx jest --coverage=false` — **315 suites / 5853 tests** (review run)
- `cd functions && npm run build` — clean
- `npm run typecheck:tests` — zero gh-lifecycle diagnostics

## Scenarios

### S1 — Live handler round-trip on both repos

- **Confirms:** AC1 (full list returned), real transport wiring,
  contract shape on the wire, taxonomy presence.
- **Steps:** run
  `npx tsx scripts/verify/dev-tools-gh-lifecycle-1528-labels-read.ts`.
- **Expected:** `ALL CHECKS PASSED`, exit 0. Required PASS lines:
  `labels non-empty`, `fetchedAt is fresh ISO`,
  `every label has name + 6-hex color`, all four taxonomy checks
  (`INTERNAL`, `5_IMPLEMENT`, `DEV-TOOLS`, `FEATURE`),
  `handler count matches gh label list (rel-str)`,
  `second repo labels fetch succeeds`,
  `handler count matches gh label list (av-proxy-api)`. Console prints
  `labels: 68` for rel-str and the `<100` paging-honesty note.
- **Result:** ☒ PASS — `ALL CHECKS PASSED`, exit 0; 68 labels rel-str (matched `gh label list`), 49 av-proxy-api (matched), all 4 taxonomy labels present, every label `name` + 6-hex `color`; paging-honesty note printed (68<100 → multi-page is spec-only)

### S2 — Spec coverage: paging, validation, error mapping

- **Confirms:** AC1's >100 path (101-label two-page fixture), AC2
  (unauth + unsupported-repo rejected with zero transport calls), AC3
  (error mapping), plus review fixes (non-array body, 403 rate-limit,
  projection, ISO `fetchedAt`, read-path 404).
- **Steps:** run `npm run test:gh-lifecycle` from `functions/` — or
  focused: `npx tsx --test tests/functions/gh-lifecycle/label-callables.test.ts`.
- **Expected:** `pass 60` / `fail 0` for the whole suite
  (`label-callables.test.ts` alone: 22). Key specs in the file's
  `handleListRepoLabels` + `validation` + `error mapping` describes.
- **Result:** ☒ PASS — `npm run test:gh-lifecycle`: 60/60 (13 suites), `label-callables.test.ts` registered and running inside the suite (focused file alone: 22 specs)

### S3 — Wire-shape spot check (contract projection)

- **Confirms:** the response carries exactly `{labels, fetchedAt}` and
  each label exactly `{name, color, description}` — GitHub's
  `id`/`node_id`/`url`/`default` never leak.
- **Steps:** run
  `npx tsx -e "process.env.GITHUB_READ_TOKEN ??= require('node:child_process').execSync('gh auth token',{encoding:'utf8'}).trim(); import('./functions/src/gh-lifecycle/label-callables.ts').then(async m => { const r = await m.handleListRepoLabels({data:{owner:'rinebob',repo:'rel-str'},auth:{uid:'qa'}}, m.ghLabelReadDeps()); console.log(Object.keys(r), JSON.stringify(r.labels[0])); })"`
  — or write the same call into `.devin/tmp/` and run `npx tsx` on it
  if the eval form doesn't resolve imports on your shell.
- **Expected:** keys are `labels,fetchedAt`; first label is exactly
  `{"name":"1_IDEA","color":"…","description":"…"}`-shaped — no `id`,
  `node_id`, `url`, or `default` keys.
- **Result:** ☒ PASS — live handler: top-level keys `labels,fetchedAt`; first label `{"name":"1_IDEA","color":"BFD4F2","description":"Idea being captured and grilled"}`; zero leaked GitHub keys (no `id`/`node_id`/`url`/`default`)

### S4 — Regression: getLifecycleTree unaffected

- **Confirms:** the shared `resolveSupportedRepo` extraction in
  `callables.ts` did not change the existing callable's behavior.
- **Steps:** run
  `npx tsx scripts/verify/dev-tools-gh-lifecycle-640-callable.ts`.
- **Expected:** `ALL CHECKS PASSED` — v2 shape, `no legacy sections
  key`, `#619 → #621` nested, `invalid-argument`/`unauthenticated`
  mapping unchanged.
- **Result:** ☒ PASS — 640 `ALL CHECKS PASSED`: v2 shape, `no legacy sections key`, #619→#621 nested, `invalid-argument`/`unauthenticated` unchanged

## Manual UI/UX refinement pass

- Not applicable — no user-facing surface. The callable has no UI
  consumer until the FE label picker (#1521). Deploy-side behavior
  (cold start, secret wiring) is exercised by the live verify's
  `ghLabelReadDeps()` path.
- **Result:** ☒ N/A — BE callable, no UI

## Findings

- None.

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| AC1 — full label list over >100 labels (paged) | S1 (completeness via count check), S2 (101-label spec) |
| AC2 — auth + unsupported-repo rejection specced | S2 |
| AC3 — githubRest shares GitHubApiError/rate-limit handling | S1 (live transport), S2 (error-mapping specs) |
| Contract shape `{labels, fetchedAt}` / `RepoLabel` | S1, S3 |
| getLifecycleTree unaffected (shared `resolveSupportedRepo`) | S4 |

## Regression / smoke

- `npm run test:gh-lifecycle` runs all three spec files — the sibling
  `callables.test.ts` (17 specs) and `github-client.test.ts` (19
  specs) must stay green inside the same 60-count suite.
- `functions && npm run build` — clean esbuild after the index export.
- Deploy note for ship: only `listRepoLabels` must be exported for
  this task; `updateIssueLabels`/`manageRepoLabel` stay unexported
  until #1529 + #1526 (GITHUB_WRITE_TOKEN).

## Verdict

**Result:** ☒ QA PASS — S1 live handler both repos (count-verified), S2 60/60 registered suite, S3 wire-shape projection clean, S4 sibling callable regression-free; UI pass N/A (no user-facing surface; FE picker is #1521)

## Results log

| Date | Run | Outcome |
|---|---|---|
| 2026-11-17 | S1 `1528-labels-read.ts` + S2 `test:gh-lifecycle` + S3 wire-shape + S4 `640-callable.ts` (session gh-issues-ui-labels) | ALL CHECKS PASSED; 60/60; `{labels,fetchedAt}` + `RepoLabel` keys only; 640 green → QA PASS |
