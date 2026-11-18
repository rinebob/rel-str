**Topic:** GitHub read-only issue UI  
**Topic Slug:** gh-issues-ui  
**Thread:** Topic Viewer UI polish & misc fixes  
**Thread Slug:** topic-viewer-polish  
**Issue:** #1608  
**Thread Parent:** #697  
**Topic Parent:** #619  
**Task:** #1531  
**Domain:** DEV-TOOLS  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-18  
**Last Updated:** 2026-11-18  

# UAT — #1531 FE Store v2 (sort, search, all-topics, label patch)

## Scope

Store/service slice of Blueprint #1521 — no new page controls (those are
#1532). Delivers: `sortMode` + `visibleTopics` union; `query` +
`filteredTopics` (title/`#n`/label predicates); in-tree `matchSet`,
`matchAncestorIds`, `matchCount` with auto-expansion via
`effectiveExpandedIds` and the `suppressedIds` overlay (review fix);
`showAllTopics` + `allSectionsRows`; `expandableIds` spanning all trees;
`applyLabelUpdate` + `updateIssueLabels` orchestration; three service
wrappers + `CallableName` entries; tree caret/aria reads the effective
expansion.

Task acceptance criteria (IMPL §1 + TEST unit/integration rows):
1. Flat response consumption + groupOrder fold preserved identically.
2. `sortMode`/`visibleTopics` — grouped renders `topicSections`, number
   renders one flat ascending list.
3. `query` predicates — title CI substring, `154`/`#154`, label
   substring; empty query disables filtering.
4. `matchSet`/`matchAncestorIds`/`matchCount` — ancestors auto-expand,
   clearing restores manual expansion; closed match hidden until
   Show-closed; toggle on an auto-ancestor collapses honestly
   (suppressedIds — review M1).
5. `showAllTopics`/`allSectionsRows` — all trees flattened, shared
   expansion, roots collapsed by default, expandableIds spans all trees.
6. `applyLabelUpdate` immutable patch; absent number no-op.
7. `updateIssueLabels` — success patches + clears error; failure leaves
   response untouched + sets error.
8. `listRepoLabels$`/`updateIssueLabels$`/`manageRepoLabel$` +
   `CallableName` ×3 — same callable pattern.
9. Selection preserved when the selected topic is query-filtered.
10. Existing refresh/stale-guard/showClosed behavior unregressed.

## Prerequisites

- Repo checkout on `prod` with the #1531 working-tree changes.
- Dev server already running at `http://localhost:4200` (verified
  200 OK this session).
- No seed data needed — the page reads live GitHub via the deployed
  `getLifecycleTree` callable.

## Getting to the feature

Route: `/tools/topic-viewer`. Entry point: app nav → **Topic Viewer**
link (`constants.ts` nav item `tools/topic-viewer`). Surface: the
topic-viewer page — repo picker + Refresh + Show-closed header, grouped
topic list on the left, selected topic's tree on the right.

## Automated evidence (executed this session)

- `npx jest src/app/features/topic-viewer/` — **4 suites / 59 specs
  green** (41 store incl. sort/search/match/all-topics/label-patch/
  suppression, 8 service, page + tree).
- `npx jest` full suite — **5,996/5,996 green** (319 suites, post-remediation run).
- `npx tsc -p tsconfig.app.json --noEmit` — **clean**.
- Deployed-name parity — `CallableName` values match live v2 callables
  in `us-central1` (`listRepoLabels`, `updateIssueLabels`,
  `manageRepoLabel` — confirmed deployed during #1526).

## Scenarios

### S1 — Store v2 unit coverage (the ACs themselves)

- **Confirms:** AC2–AC7, AC9 — every new signal/computed/method has
  spec-level behavioral proof.
- **Steps:** `npx jest src/app/features/topic-viewer/topic-viewer.store.spec.ts`
- **Expected:** all specs pass — grouped/number sort, closed filtering
  both modes, title/`154`/`#154`/label predicates, matchSet + ancestor
  auto-expand + count, expansion restore on clear, closed-match
  reveal under showClosed, suppression toggle round-trip, all-topics
  rows + expandableIds span, applyLabelUpdate isolation + absent no-op,
  updateIssueLabels success/failure, query reset on selectRepo,
  selection-survives-filter.
- **Result:** ☑ PASS — 41/41 green (2026-11-18).

### S2 — Service wrapper contract

- **Confirms:** AC8 — the three wrappers call the right `CallableName`
  with the right payload shape and unwrap `.data`.
- **Steps:** `npx jest src/app/features/topic-viewer/topic-viewer.service.spec.ts`
- **Expected:** 8/8 pass incl. the three new callable specs.
- **Result:** ☑ PASS — 8/8 green (2026-11-18).

### S3 — Full-suite regression

- **Confirms:** AC10 + no blast radius on unrelated features (the
  `suppressedIds` state field, four-block computed restructure, and the
  tree's `effectiveExpandedIds` switch touch shared surfaces).
- **Steps:** `npx jest --coverage=false`
- **Expected:** whole suite green.
- **Result:** ☑ PASS — 5,996/5,996 (2026-11-18, post-remediation).

### S4 — Typecheck

- **Confirms:** the `withComputed` layering and `VisibleTopics` union
  compile under strict mode; `LifecycleTopic` generic patch types.
- **Steps:** `npx tsc -p tsconfig.app.json --noEmit`
- **Expected:** no errors.
- **Result:** ☑ PASS — clean (2026-11-18).

### S5 — Callable-name parity with deployed functions

- **Confirms:** the three `CallableName` strings match live v2
  functions (a typo'd name would fail only at runtime).
- **Steps:** compare `CallableName` values against `firebase
  functions:list` output / #1526 deploy evidence.
- **Expected:** `listRepoLabels`, `updateIssueLabels`,
  `manageRepoLabel` all deployed in `us-central1`.
- **Result:** ☑ PASS — parity confirmed (deploy evidence from #1526;
  verified via functions list this session).

### S6 — Live page regression smoke (user-run, ~30s)

- **Confirms:** AC10 end-to-end — the page renders **identically**
  today: new view state is inert until #1532 wires controls; the only
  shipped surface change is the tree reading `effectiveExpandedIds`
  (identity when no query exists).
- **Steps:** open `http://localhost:4200/tools/topic-viewer` → wait for
  the fetch → grouped topic list appears → click a topic → expand/
  collapse a thread caret → toggle Show-closed.
- **Expected:** sections in groupOrder, topic row stage chips/dots as
  before, carets expand/collapse normally, closed rows appear/disappear
  with the toggle. No console errors.
- **Result:** ⊘ WAIVED — owner decision 2026-11-18 (ship before the
  caching thread #1609; the 30-second eyeball defers to the post-cache
  smoke). Partial live evidence exists: the same day the deployed
  `getLifecycleTree` hit GitHub's GraphQL hourly limit and the page
  surfaced the designed error state on real production failure — the
  highest-risk shipped path. The only shipped surface change is the
  tree's caret/`aria-expanded` reading `effectiveExpandedIds`, which is
  identity-equal to `expandedIds` whenever no query exists (the query
  input is unwired until #1532). Residual risk: none identified beyond
  a cosmetic caret-state drift that cannot trigger without a query.

## Manual UI/UX refinement pass

- **Result:** N/A — no new user-facing surface. The page has no new
  controls (#1532); the only rendered difference is the caret reading
  `effectiveExpandedIds`, which equals `expandedIds` with no query —
  S6 covers the no-regression check.

## Findings

- None from automated execution. Review-deferred items recorded in the
  code-review doc (store ~510 lines, service boilerplate, all-topics
  match scope, dead expandedIds) are tracked there, not re-opened here.

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| AC1 flat fold preserved | S1 (existing section specs green), S6 (waived) |
| AC2 sortMode/visibleTopics | S1 |
| AC3 query predicates | S1 |
| AC4 match machinery + suppression | S1 |
| AC5 all-topics rows | S1 |
| AC6 applyLabelUpdate | S1 |
| AC7 updateIssueLabels | S1 |
| AC8 service wrappers + CallableName | S2, S5 |
| AC9 selection survives filter | S1 |
| AC10 no regression | S3, S6 (waived) |

## Regression / smoke

- `npx jest` — 5,996/5,996 (whole suite, incl. page + tree suites that
  bind the changed computeds).
- `tsc --noEmit` — clean.
- S6 live smoke — waived by owner (partial live evidence: real
  deployed-failure error surface observed same-day).

## Verdict

**PASS** — all automated scenarios green; S6 waived by owner with
documented partial live evidence and a bounded residual-risk statement
(the waived surface is inert until #1532 wires the query input).

## Results log

| Date | Task | Executor | Result | Notes |
|---|---|---|---|---|
| 2026-11-18 | #1531 | devin+user | PASS | S1–S5 green; S6 waived (owner) — error surface observed live on the 2026-11-18 GraphQL rate-limit incident; post-cache eyeball to double as the deferred page smoke |
