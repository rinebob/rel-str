**Topic:** GitHub read-only issue UI  
**Topic Slug:** gh-issues-ui  
**Thread:** Topic Viewer UI polish & misc fixes  
**Thread Slug:** topic-viewer-polish  
**Issue:** #1521  
**Thread Parent:** #697  
**Topic Parent:** #619  
**Task:** #1532  
**Domain:** DEV-TOOLS  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-18  
**Last Updated:** 2026-11-18  

# CODE-REVIEW — #1532 FE page controls

**Verdict: PASS** — after one in-gate remediation round (2 majors + a
batch of minors/nits fixed and re-verified).

## Diff under review

- `src/app/features/topic-viewer/topic-viewer-page.component.ts` — header
  controls (search + match count, Grouped|Issue # pills, All-topics
  checkbox, disabled Labels button), `visibleTopics` union dispatch via
  shared `#topicRow` ng-template, stage chip replacing `.stage-dot`,
  all-topics right pane, `#treeActions` template, `emptyCopy()`.
- `src/app/features/topic-viewer/topic-viewer-page.component.spec.ts` —
  stub v2, 15 specs covering controls/panes/empties/match badge.
- `src/app/features/topic-viewer/topic-viewer-tree.component.ts` —
  `rows` input (defaults to `treeRows`), `.match` class, palette dedupe.
- `src/app/features/topic-viewer/topic-viewer-tree.component.spec.ts` —
  rows-input + match specs.
- `src/app/features/topic-viewer/_stage-chips.scss` — new shared
  `stage-chip-palette` mixin (removes the page/tree copy-pasted palette).
- `src/app/features/topic-viewer/topic-viewer.store.ts` — in-gate:
  `matchInfo` scope widened to rendered trees; `selectTopic` additive
  seed in all-topics mode.
- `src/app/features/topic-viewer/topic-viewer.store.spec.ts` — in-gate:
  3 all-topics match/expansion specs.

## Axes

### Standards — PASS (findings remediated in-gate)

- minor: unused `By` import in page spec — removed.
- minor: dead `expandedIds` stub in page spec — removed.
- minor: `.tree-head`/`.tree-actions` duplicated across the two right-pane
  branches — deduped via `#treeActions` ng-template.
- minor: mixed `$any($event.target)` vs bare `.checked` idioms — unified
  on `$any`.
- nit (confirmed working, noted for the record): `@use './stage-chips'`
  inside inline `styles` is a first-in-repo pattern; valid under
  `inlineStyleLanguage: scss` (angular.json), jest + tsc verify it.
- nits left in place: `allsec-{name}` testids (quoted attribute
  selectors work), `title` tooltip on the disabled Labels button
  (placeholder until #1533), `.chip` base fallback absent on the page
  (unreachable — `decodeLabels` only emits `N_*` labels), pre-existing
  `isExpanded`/`tags` visibility + empty `imports: []` on the tree.
- Clean axes: dumb-view contract (page binds store computeds, no view
  logic duplicated — `emptyCopy`/`stripTopicPrefix` are display-only),
  standalone/OnPush/signal-input/`@if`-`@for` style, DS idioms
  (`pill-group`, `dse-field`, `dse-check`, `ds-btn`), accessibility
  (`aria-pressed`, `aria-current`, `aria-expanded`, `role=alert`),
  spec conventions (signal stubs, zoneless CD, jest.fn, testids).

### Spec — PASS (all 4 ACs met)

| AC | Status | Evidence |
|---|---|---|
| Controls work at ~1024px; search filters list + highlights tree hits | met (1024px = flex-wrap, manual-check flag for QA) | header `flex-wrap`; `setQuery`→`filteredTopics`; `.match` via `matchSet` |
| Stage chip (full label, color-coded) replaces the dot | met | `.chip.stage` + `data-stage` + shared palette; spec asserts dot absent |
| Long titles ellipsis; chips never leave the row | met (CSS-verified) | `.t-title`/`.title` `flex:1;min-width:0` + `flex:none` chips |
| TestBed specs with fixture response | met | 15 page specs on fixture `LifecycleTreeResponse` |

- Deviation recorded: page spec stubs the whole store with signals
  rather than the TEST plan's "real store + stubbed service" seam.
  Coverage-equivalent (store computeds spec'd directly in
  `topic-viewer.store.spec.ts`, template bindings spec'd against the
  stub); the stub must be hand-kept in sync — mitigated by the typed
  union contract.
- Test-plan rows attributable to #1532 all covered (grouped/number
  views, match highlight, chip replacement, all-topics sections,
  empty-section drop, disabled Labels placeholder).

### Thermo-nuclear — FAIL → remediated → PASS

- **MAJOR (fixed):** `matchSet`/`matchAncestorIds`/`matchCount` were
  scoped to `selectedTopic()` only, but `.match` now renders across
  every all-topics tree — a hit in a non-selected topic stayed
  unhighlighted/unexpanded, and the badge could read "1 match" over
  "No topics to show". This is the edge the #1531 review explicitly
  deferred to this task. Fix: `matchInfo` walks the *rendered* roots —
  `filteredTopics()` in all-topics mode, `selectedTopic()` otherwise —
  unioning set + ancestors. `allSectionsRows` already gates on
  `effectiveExpandedIds`, so widened ancestors auto-expand across all
  section trees. Store spec pins hits + ancestors spanning trees and
  the consistent "descendant-only query → 0 matches + empty pane" case.
- **MAJOR (fixed):** `matchCount` badge lied when no match surface
  existed — "0 matches" next to a plainly-filtered list when nothing
  was selected. Fix: badge renders only when
  `query() && (selectedTopic() || showAllTopics())`. Spec'd both
  directions + singular/plural copy.
- **minor (fixed):** `selectTopic` reseeded `expandedIds: [number]`
  unconditionally — clicking a topic row in all-topics mode collapsed
  every other rendered tree. Now additive under `showAllTopics`
  (union seed); single-topic behavior unchanged. Spec'd.
- **minor (fixed):** empty-state copy ignored an active query
  ("No Topics found in this repo" under a filter-empty pane). New
  `emptyCopy()` → `No topics match "{q}"`; all-topics empty gained the
  missing `!error()` guard for parity with the left pane. Spec'd.
- **minor (fixed):** spec gaps — zero-match badge path, all-topics+query,
  all-topics empty, `setShowAllTopics` args, impossible `{rows:[]}`
  fixture, weak `[value]` round-trip assertion (now drives the signal).
- Clean axes: `track` keys (node numbers globally unique via
  `buildTree`; `sec.name` deduped by contract), `rows` input precedence
  (`rows() ?? treeRows`), shared expansion across section trees (ids
  unique), reactivity (all signal reads, no stale captures), SCSS mixin
  mechanics, no type-erased fixtures.

## Pass protocol

```text
First pass complete — Standards PASS (4 minors + nits), Spec PASS
  (4/4 ACs, seam deviation noted), Thermo FAIL (2 majors: match scope +
  badge semantics; both the #1531-deferred all-topics edge made visible)
Second pass complete — 2 majors + 8 minors/nits remediated and
  re-verified (76/76 focused specs incl. 7 new, tsc clean); axes'
  residual items dispositioned as nits/deferred/documented
Convergence: PASS — majors resolved at the contract layer (matchInfo
  scope = rendered trees), no new findings on the remediation diff,
  remaining items are nits or documented deviations
```

## Evidence

- `npx jest src/app/features/topic-viewer/` — 76/76 (69 → 76 with the
  in-gate specs).
- `npx jest` — full suite green on the final diff (see task notes).
- `npx tsc -p tsconfig.app.json --noEmit` — clean.
- Manual check deferred to QA: ~1024px control wrap (flex-wrap in
  place; jsdom can't measure) + live visual pass.

## Deferrals

- `visibleTopics` dead `@if` wrapper (harmless — union is never falsy).
- `allsec-{name}` testids could slugify for selector robustness.
- TEST-plan seam deviation (stubbed store vs real store + stubbed
  service) — worth revisiting if the stub ever drifts.
- ~1024px wrap + full visual pass → QA live check.
