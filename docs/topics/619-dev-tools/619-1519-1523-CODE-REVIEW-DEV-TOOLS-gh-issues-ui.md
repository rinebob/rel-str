**Topic:** GitHub read-only issue UI  
**Topic Slug:** gh-issues-ui  
**Thread:** Topic Viewer UI polish & misc fixes  
**Thread Slug:** topic-viewer-polish  
**Issue:** #1519  
**Thread Parent:** #697  
**Topic Parent:** #619  
**Task:** #1523  
**Domain:** DEV-TOOLS  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-15  
**Last Updated:** 2026-11-15  

# Code Review — #1523 SHARED: Label write contracts + system-label guard

Three review axes (Standards / Spec / Thermo-nuclear) plus the full test
suite. Two rounds: round 1 surfaced one major finding and one spec miss;
all findings were remediated and re-verified before this verdict.

## Scope reviewed

- `shared/lifecycle-labels.ts` (new — RepoLabel + 3 callable request/response
  contract pairs + `isSystemLabel`/`SYSTEM_LABEL_PATTERNS` guard)
- `shared/lifecycle-labels.spec.ts` (new — 90 jest assertions)
- `@lifecycle/labels` alias lines in `tsconfig.json`,
  `functions/tsconfig.json`, `jest.config.js`
- Consumer contract check: `functions/src/gh-lifecycle/label-callables.ts`
  (validateUpdate boundary enforcement — remediated in round 2)

## Round 1 findings and remediation

| Severity | Axis | Finding | Resolution |
|---|---|---|---|
| Spec miss | Spec | `SYSTEM_LABEL_PATTERNS` — named in issue #1523 and IMPL-SHARED §3 as the exported constant — did not exist; structural/Category sets were private | Exported the aggregate `SYSTEM_LABEL_PATTERNS` (union of the three sets) plus `STRUCTURAL_LABELS`/`CATEGORY_LABELS` |
| Major | Thermo-nuclear | `validateUpdate` normalized `add`/`remove` into locals but returned raw `req` — truthy non-array `add:'foo'` passed validation then iterated characters at the create loop, minting junk repo labels `'f','o','o'` | Rejects non-array `add`/`remove` outright; returns the normalized `{...req, add, remove}` |
| Minor | Thermo-nuclear | `isSystemLabel` was case-sensitive — GitHub resolves label names case-insensitively, so `'impl'` would attach `'IMPL'` | Name-set check compares `name.toUpperCase()`; documented |
| Minor | Thermo-nuclear | `it.each([...DOMAIN_LABELS])` was tautological (set-membership testing itself); the hand-mirrored vocabulary had zero content-pinning | Exact-membership assertions pin all three sets against literal lists + aggregate-is-union check |
| Minor | Standards | Stage vocabulary duplicated: `[1-8]` regex vs `STAGE_LABELS` exact list in `lifecycle-tree.ts` with silently divergent semantics | Documented the intentional broader-match semantics — `5_FOO` mints/erases workflow state just like `5_IMPLEMENT` |
| Minor | Standards | `UpdateIssueLabelsRequest.add/remove` declared required but treated as optional at the boundary | Contract fields now optional — matches the wire shape; validator normalizes |
| Minor | Thermo-nuclear | JSDoc claimed the stage guard covers `add` only; BE rejects both directions | Comment corrected |
| Minor | Spec | `RepoLabel.description` sketch was `?: string`; GitHub's payload returns `null`, never omits | As-built `string \| null` is correct; IMPL-SHARED sketch updated |
| Nit | Standards | Mirror comment cited config sources for all sets but `STRUCTURAL_LABELS` comes from proj REFERENCE.md | Provenance comments added per set |
| Nit | Thermo-nuclear | Spec fixture `remove: ['5_IMPLEMENT']` self-contradicted the guard | Fixture uses non-system names |
| Judgement | Standards | Fixture-shape tests are compile-checks rather than behavior assertions | Accepted — pure-type contracts have no runtime behavior; supplemented with the optional-field check |

## Deferred / justified deltas from the plan sketch

- `ListRepoLabelsResponse.fetchedAt` — beyond the `{labels}` sketch but
  consistent with `LifecycleTreeResponse.fetchedAt`; kept.
- `UpdateIssueLabelsResponse.created[]` and
  `ManageRepoLabelResponse.usageCount` — not in the plan sketches but
  consumed by the verify script and the FE confirm-delete flow; kept.
- `RepoLabelOp` → `ManageRepoLabelOp` rename — clearer; kept.
- Structural extras `REFACTOR/TESTING/BLOCKED/WONTFIX` — repo-observed
  superset, consistent with the mirror's deliberate-superset doc.

## Test results

- `npx jest` full suite: **315 suites / 5823 tests, all pass**
- `npx tsx --test tests/functions/gh-lifecycle/*.test.ts`: **55/55 pass**
- `shared/lifecycle-labels.spec.ts`: **90 assertions pass**
- `functions && npm run build`: clean

## Verdict: **PASS** (2 rounds)

Next: `/proj qa 619 1523`.
