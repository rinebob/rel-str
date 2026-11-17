**Topic:** GitHub read-only issue UI  
**Topic Slug:** gh-issues-ui  
**Thread:** Topic Viewer UI polish & misc fixes  
**Thread Slug:** topic-viewer-polish  
**Issue:** #1520  
**Thread Parent:** #697  
**Topic Parent:** #619  
**Task:** #1528  
**Domain:** DEV-TOOLS  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-17  
**Last Updated:** 2026-11-17  

# Code Review — #1528 BE: `listRepoLabels` callable (read)

Three review axes (Standards / Spec / Thermo-nuclear) plus the full test
suite and live verification. Two passes: round 1 surfaced three majors;
all remediated in-round and re-verified before the coverage pass.

## Scope reviewed

- `functions/src/gh-lifecycle/github-client.ts` — uncommitted `Rest`
  type + `githubRest` transport block (the file's remaining diff after
  #1527 shipped)
- `functions/src/gh-lifecycle/label-callables.ts` (new) — header/deps/
  `ghLabelReadDeps`/`mapLabelError`/`call`/`labelsPath`/`collectPages`/
  `handleListRepoLabels`/`listRepoLabels` export. The
  `updateIssueLabels`/`manageRepoLabel` sections are **#1529 scope** —
  read for shared-scaffolding impact only
- `functions/src/gh-lifecycle/callables.ts` — `mapGitHubError`/
  `internalGuard` exported; new shared `resolveSupportedRepo`
- `functions/src/index.ts` — `listRepoLabels` export (ship slices this
  to #1528-only; write exports stay out until #1529)
- `tests/functions/gh-lifecycle/label-callables.test.ts` (new)
- `tests/functions/gh-lifecycle/callables.test.ts` — sibling fixture
  fixed in-round (same defect class)
- `scripts/verify/dev-tools-gh-lifecycle-1528-labels-read.{ts,md}`
- `scripts/verify/run-all.ts` + `README.md` — labels-read registry rows
- `functions/package.json` — `test:gh-lifecycle` registration

## Round 1 findings and remediation

| Severity | Axis | Finding | Resolution |
|---|---|---|---|
| Major | Spec + TN | `label-callables.test.ts` orphaned — `test:gh-lifecycle` named only the two older spec files; the 20+ specs had no runner | Added to `test:gh-lifecycle` in `functions/package.json`; `npm run test:gh-lifecycle` now runs all 60 |
| Major | TN | `typecheck:tests` — `import type { CallableRequest }` unresolvable from `tests/` (firebase-functions lives under `functions/node_modules`); sibling `callables.test.ts` had the identical latent TS2307 | Both files switched to the repo's generic-factory pattern (`USER_REQ<T>`/`UNAUTH<T>` inferring the handler's request type at the call site); zero gh-lifecycle diagnostics remain |
| Major | TN | Deploy coupling — `index.ts` exports `updateIssueLabels`/`manageRepoLabel` which declare `secrets:['GITHUB_WRITE_TOKEN']`; the secret isn't minted yet (#1526) and deploying the whole export block would fail | Resolved by commit slice: `index.ts` stages only the `listRepoLabels` export line — unexported onCall objects don't deploy or validate secrets. Write callables deploy with #1529 after #1526 |
| Minor | TN + Standards | `collectPages` unbounded (vs `SUBISSUES_PAGE_CAP` precedent) | `PAGE_CAP = 50` added |
| Minor | TN | Non-array page body — a `200` string would splinter into chars onto the wire | Explicit `Array.isArray` guard → `internal`; spec added |
| Minor | TN + Spec | Raw GitHub label objects leaked `id`/`node_id`/`url`/`default` beyond the `RepoLabel` contract | Projected to `{name, color, description}` with `description ?? null` |
| Minor | TN | `mapLabelError` 404 message "label or issue not found" misdiagnoses a read-path repo 404 | Neutral `not found` message |
| Minor | Spec | Live paging evidence implicit — script never proved completeness | Independent `gh label list` count check on both repos (68 / 49); guide documents >100 paging is spec-only (both repos <100 — count check becomes live paging proof automatically if crossed) |
| Minor | Spec | Verify guide overstated: auth/repo rejection not exercised live | Guide corrected with a coverage-honesty note |
| Nit | Spec + TN | Missing specs: unsupported-repo `calls===0`, 403 rate-limit → `resource-exhausted`, non-`GitHubApiError` → `internal`, `fetchedAt` ISO shape, read-path 404 | All added (60/60 green) |
| Nit | TN | Sanitization test comment over-claimed ("raw body never reaches client" — GitHub's `.message` legitimately does) | Comment corrected to describe the actual boundary |
| Deferred | Standards | `mapLabelError` maps every 422 → `already-exists`; a #1529 PATCH validation failure would misreport | #1529's semantics domain — flagged for its review |
| Deferred | Standards | Rate-limit predicate duplicated 3× (`githubGql`/`githubRest`/`fetchFileText`) | Consistent behavior; extraction not worth the churn |
| Accepted | TN | `fxRest` substring matching (`page=1` ~ `page=10`), verify-script tsc exclusion | Harmless fixture detail / pre-existing convention |

## Second pass (serial coverage check)

Re-checked the union of the axes over the full diff: every finding
captured above; the shared-`callables.ts` extraction verified against
`getLifecycleTree`'s unchanged call order (auth → repo → handle); the
`index.ts` export block confirmed contiguous and sliceable; both
remediation edits typecheck-clean and covered by the new specs.
Converged — no third pass needed.

## Test results

- `npx jest` full suite: **315 suites / 5853 tests, all pass**
- `npm run test:gh-lifecycle` (functions): **60/60** (56 baseline + 4 new)
- `npx tsx scripts/verify/dev-tools-gh-lifecycle-1528-labels-read.ts`
  (live): **ALL CHECKS PASSED** — 68 labels rel-str, 49 av-proxy-api,
  counts match independent `gh label list`
- `typecheck:tests`: zero gh-lifecycle diagnostics (suite has
  pre-existing errors in unrelated files owned by other sessions)
- `functions && npm run build`: clean

## Verdict: **PASS** (2 passes: axes in parallel + serial coverage pass; in-round remediations verified)

Next: `/proj qa 619 1528`.
