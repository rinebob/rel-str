**Topic:** GitHub read-only issue UI  
**Topic Slug:** gh-issues-ui  
**Thread:** Topic Viewer UI polish & misc fixes  
**Thread Slug:** topic-viewer-polish  
**Issue:** #1521  
**Thread Parent:** #697  
**Topic Parent:** #619  
**Task:** #1531  
**Domain:** DEV-TOOLS  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-18  
**Last Updated:** 2026-11-18  

# CODE-REVIEW — #1531 FE Store v2

**Verdict: PASS** — after one in-gate remediation round (1 major + 5
minor/nit findings fixed and re-verified).

## Diff under review

Uncommitted working-tree slice (all session-owned files):

- `src/app/features/topic-viewer/topic-viewer.store.ts` — v2 view state
- `src/app/features/topic-viewer/topic-viewer.store.spec.ts` — 41 specs
- `src/app/features/topic-viewer/topic-viewer.service.ts` — 3 label callables
- `src/app/features/topic-viewer/topic-viewer.service.spec.ts` — +3 specs
- `src/app/features/topic-viewer/topic-viewer-tree.component.ts` —
  `expandedSet` → `effectiveExpandedIds`
- `src/app/features/topic-viewer/topic-viewer-tree.component.spec.ts`
- `src/app/features/topic-viewer/topic-viewer-page.component.spec.ts` —
  stub gained `effectiveExpandedIds` (latent #1532 gap)
- `src/app/core/common/constants.ts` — `CallableName` +3

Note: `constants.ts` also carries a **foreign** `GET_STRATEGY_EQUITY_CURVE`
deletion from another session (#1564 cleanup) — verified legitimate, to be
excluded from this task's commits, not reverted.

## Pass sequence

First pass complete — 3 axes (parallel sub-agents): 1 MAJOR
(toggleExpanded pollutes manual `expandedIds` when clicking an
auto-expanded match ancestor — visual no-op + inverted parity surviving
the query), minors: write-success doesn't clear a prior `error`,
expandableIds placement/comment drift, all-topics match-scope edge, page
spec stub missing `effectiveExpandedIds`; nits: `as LifecycleTopic[]`
cast, non-null assertion on selectedTopic, per-node needle
re-normalization, service boilerplate ×3, `sortMode` naming, `matchInfo`
public, file size 492>400, foreign enum deletion in-diff.
Second pass complete — all remediations verified (59/59 topic-viewer
specs incl. 2 new suppression specs; tsc app clean); no new findings;
every axis finding accounted for.
Convergence: PASS — remaining items are documented deferrals, not
defects.

## Findings by severity

### Major (remediated in-gate)

- **`toggleExpanded` couldn't collapse an auto-expanded match ancestor
  and leaked inverted state into `expandedIds`.** `effectiveExpandedIds
  = manual ∪ ancestors` had no subtraction path — clicking an expanded
  caret *added* the id to the manual set (visual no-op; after the query
  cleared the node stayed expanded — the inverse of intent).
  **Fix:** new `suppressedIds` overlay — `effective = (manual ∪
  ancestors) − suppressed`. `toggleExpanded` now routes through the
  effective set: collapsing an auto-ancestor records a suppression
  (manual untouched); re-toggling lifts it; `expandAll` clears
  suppressions; `collapseAll` suppresses live ancestors (explicit
  collapse wins); suppressions retire on query-clear / selectTopic /
  selectRepo. Two new specs cover collapse-during-query and
  expand/collapse-all interaction.

### Minor (remediated in-gate)

- `updateIssueLabels` success now clears `error` — symmetric with the
  failure path (store.ts).
- `patchLabelsInResponse` retyped `<T extends LifecycleNode>(n: T): T` —
  `as LifecycleTopic[]` cast removed.
- `expandableIds` hoists `selectedTopic()` (no double-read / `!`) and
  moved to the expansion-machinery block.
- `matchesQuery` takes a pre-normalized needle — no per-node re-trim.
- Page spec stub gained `effectiveExpandedIds` — a non-empty `treeRows`
  in a future spec can no longer hit an undefined signal.

### Deferred (documented, non-blocking)

- **Store file ~510 lines** (>400 "strong smell" bar, <1k hard limit) —
  pure helpers (`foldGroups`/`flattenTopic`/`matchesQuery`/
  `patchLabelsInResponse`) are a clean `topic-viewer.derive.ts`
  extraction candidate; deferred to #1532 which will touch the file
  again anyway.
- **Service boilerplate ×3** — identical `httpsCallable` +
  `runInInjectionContext` + `map(res.data)` bodies; kept for repo-pattern
  consistency (mirrors `getLifecycleTree$`; PaperTradingService does the
  same). A private `call$` helper is defensible either way.
- **`sortMode: 'grouped' | 'number'`** — "grouped" is a layout not a
  sort; name kept — it's the contract's vocabulary (IMPL §1, the page
  toggle is labelled "Grouped | Issue #").
- **`listRepoLabels$`/`manageRepoLabel$` have no consumer yet** —
  contract-first per IMPL §1; the label-surface tasks (#1532/#1533)
  consume them.
- **`matchInfo` publicly exposed** — the spec names only `matchSet`/
  `matchAncestorIds`/`matchCount`; `matchInfo` is needed by
  `toggleExpanded` (ancestor membership) and is the single-walk
  derivation the three public signals read. Kept.
- **`selectRepo` clears `query`** — sensible, unspecified in plan.
- **Exact-number matching** — `15` will not find `#154` (requires exact
  `#154`/`154`); defensible read of "`#{n}`/`{n}` on number" — substring
  number matching would be noise. Flag if UAT surprises.
- **All-topics + query match scope** — `matchSet`/`matchAncestorIds`
  cover the *selected* tree only (spec literal: "applied to the selected
  tree"). In all-topics mode a hit inside a non-selected topic's tree
  doesn't auto-expand (though the topic itself still filters in/out of
  the list). Revisit in #1532 if the right-pane render makes this
  visible.
- **Dead `expandedIds` after all-topics `expandAll`** — switching back to
  single-topic view leaves ids from other trees in the manual set;
  latent and invisible (ids are issue numbers, each in exactly one
  tree). Accepted.

## Test results

- `src/app/features/topic-viewer/` — **59/59** specs (41 store incl.
  new sort/search/match/all-topics/label-patch/suppression coverage,
  8 service, existing page + tree suites).
- Full suite `npx jest` — **5,984/5,984 green** (the foreign
  strat-manage residue from the implement-time run has since been fixed
  by its session).
- `tsc -p tsconfig.app.json --noEmit` — clean.

## Axis summaries

- **Standards:** no critical/major. Documented-convention conformance
  good (feature-state-in-store, enum comment style, spec conventions);
  contract baseline clean — wrappers mirror `getLifecycleTree$` exactly
  and `@lifecycle/labels` types are used correctly.
- **Spec:** every in-scope AC **MET** (flat fold, sort union, query
  predicates, match machinery, all-topics rows, label patch +
  orchestration, service wrappers, preserved v1 behavior); page/dialog/
  highlight items correctly DEFERRED to #1532/#1533. Two flag items
  answered above (match scope, foreign deletion).
- **Thermo-nuclear:** state flow sound; four-block computed layering is
  forced (depth-4 dependency chain), not decorative; `foldGroups`/
  `flattenTopic` sharing prevents view divergence. The one-directional
  expansion union was the major — fixed via the suppressedIds overlay.
