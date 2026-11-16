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

# Implementation Plan — FE: store v2, search/sort/all-topics, tags, row polish

## Scope

`src/app/features/topic-viewer/` — migrate the store to the flat
contract, add sort + search + all-topics view state, wire the label
surfaces (per-row tag editor + manager dialog), and the two row-readability
fixes. Read path stays read-only; the only new service methods wrap the
three label callables.

## 1. Store (`topic-viewer.store.ts`)

- **Flat response**: `response.topics: LifecycleTopic[]` replaces
  `sections`. `topicSections` recomputed = group by `group`, order groups
  by `groupOrder` (+ Ungrouped last), topics sorted updatedAt-desc within
  group, `showClosed` filter — preserves today's default view exactly.
- **Sort**: `sortMode: 'grouped' | 'number'` signal + `visibleTopics`
  computed — `grouped` renders `topicSections`; `number` renders one flat
  ascending-by-`number` list (no section headers).
- **Search**: `query: string` signal. Topic filter = case-insensitive
  substring on title, `#{n}`/`{n}` on number, substring on label names —
  applied to `visibleTopics`. In-tree `matchSet` = nodes in the selected
  tree whose title/number/labels match; `matchAncestorIds` auto-expands
  their ancestors; `matchCount` displayed; clearing restores prior
  `expandedIds`.
- **All-topics**: `showAllTopics: boolean` signal; when on, the right pane
  renders every section's tree (selected topic unchanged). Expand/collapse
  state is shared (`expandedIds` already keyed by issue number — a node
  expanded in one tree is expanded everywhere it appears; acceptable).
  Collapsed-by-default roots; expand-all is opt-in. No virtualization in
  v1 — measure during impl; CDK virtual scroll is the follow-up if it
  stutters.
- **Label freshness**: `applyLabelUpdate(issueNumber, labels)` patches the
  node's `labels` in the stored response after a successful write;
  `refresh()` refetches as usual.
- **Service**: three thin methods (`listRepoLabels$`, `updateIssueLabels$`,
  `manageRepoLabel$`) — same `httpsCallable` + `runInInjectionContext`
  pattern; `CallableName` gains the three names.

## 2. Page (`topic-viewer-page.component.ts`)

- Header adds (in order): repo picker, Refresh, as-of, Show-closed,
  **search input**, **sort toggle** (Grouped | Issue #), **all-topics
  toggle**, **Labels button** (opens manager dialog). `flex-wrap` already
  handles narrow widths.
- Left pane: renders `visibleTopics` — grouped sections in `grouped`
  mode, flat list in `number` mode; filtered by `query`.
- Topic rows: **stage-dot removed → stage chip** (same pale-bg/dark-text
  color-coded chip the tree uses, full label text); `.t-title` keeps
  ellipsis.
- Right pane: `showAllTopics` → render each section header + that
  section's trees; else the selected topic's tree (unchanged).
- Match count shown next to the search box when a query is active.

## 3. Tree (`topic-viewer-tree.component.ts`)

- **Tag editor**: each row's `.row-meta` gains an edit affordance (a `+`
  chip). Clicking opens an inline picker — autocomplete over
  `listRepoLabels` filtered by `isSystemLabel` (hidden, still displayed on
  rows), plus a create-new entry when the typed name doesn't exist.
  Confirm → `updateIssueLabels` → patch store on success → chips update.
- **Title overflow**: `.title` gets `flex: 1; min-width: 0` so
  `.row-meta` chips never leave the row — long titles ellipsis.
- Match-highlight class on rows in `matchSet`.

## 4. `LabelManagerDialogComponent` (new)

- Lists all repo labels (name, color swatch, description, issue-count
  when cheap).
- Create (name + color + description), rename, recolor, delete.
- Delete confirms first — dialog shows the label's issue-usage count
  when nonzero ("in use by N issues") before allowing confirm.
- Backed by `listRepoLabels` + `manageRepoLabel`; refetches the list
  after each write.

## 5. Error surface

Failed label writes reuse the page banner (message from `HttpsError`),
the row's chips untouched; the dialog surfaces the same error inline.

## Dependencies

- SHARED contract lands first (types); BE emit + callables needed for
  live data but the store/specs can build against fixture responses —
  the `LifecycleTreeResponse` shape is the only boundary.
- Label UI can build/spec independently; live writes need the BE
  callables + token deployed.

## Test seams

- Highest: TestBed specs on the page with a stubbed `TopicViewerService`
  (fixture `LifecycleTreeResponse`) — exercises store computeds through
  the real template.
- Lower: store specs for sort modes, search predicates, matchSet +
  ancestor expansion, all-topics row builder, `applyLabelUpdate`.
- Spec-local mock components use `@Input()`/`@Output()` decorators
  (AGENTS.md convention — signal APIs break `jest.mock` hoisting).
