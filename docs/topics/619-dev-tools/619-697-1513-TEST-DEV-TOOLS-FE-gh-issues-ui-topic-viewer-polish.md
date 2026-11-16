**Topic:** GitHub read-only issue UI  
**Topic Slug:** `gh-issues-ui`  
**Thread:** Topic Viewer UI polish & misc fixes  
**Thread Slug:** `topic-viewer-polish`  
**Issue:** #1513  
**Thread Parent:** #697  
**Topic Parent:** #619  
**Domain:** DEV-TOOLS  
**Type:** TEST  
**Status:** Draft  
**Created:** 2026-11-14  
**Last Updated:** 2026-11-14  

# Test Plan: topic-viewer store + page + tag surfaces (FE)

## E2E User Journeys
- `/tools/topic-viewer`: topic list groups exactly as before; "Issue #"
  sort renders one flat ascending list; back to "Grouped" restores
  sections.
- Search `lifecycle` filters topics; search `154` finds the issue;
  search `BACKTEST` matches label carriers; with a topic selected, hits
  highlight and ancestors auto-expand; clearing restores expansion.
- All-topics toggle renders every section; Expand-all + Show-closed
  shows the whole graph.
- Tag a node: `+` picker offers non-system labels only; attach → chip
  appears immediately; detach → chip removed; create-new label →
  created + attached. Labels dialog: create/rename/recolor/delete
  round-trip.
- #137's tree shows the full declared hierarchy (retrofit acceptance).

## Integration Tests
- Page + real store + stubbed `TopicViewerService` (fixture response):
  every computed above exercised through the rendered template —
  grouped/number/ views, match highlight, chip replacement, dialog
  open.
- Store + stubbed callable methods: `applyLabelUpdate` patches node
  labels; failed writes leave the response untouched and set `error`.

## Unit Tests
- Sort modes: grouped (groupOrder + updatedAt-desc within) vs number
  (asc flat); closed filtering in both.
- Search predicates: title substring (case-insensitive), `154`/`#154`
  number match, label substring; empty query → no filtering/matching.
- MatchSet/ancestors: match at depth 3 expands its ancestors only;
  unrelated subtrees stay collapsed; count equals matchSet size.
- All-topics row builder: every section's trees flattened with depth;
  showClosed on/off respected; expandableIds spans all trees.
- `applyLabelUpdate`: only the named node changes; sibling nodes and
  order untouched.
- `isSystemLabel`-filtered picker list (shared fn re-spec'd at
  boundary if FE wraps it).

## Test Seams
- Highest seam: TestBed component specs with fixture
  `LifecycleTreeResponse` — real store + template, stubbed service.
- Lower seams: store computed specs; service callable specs mock
  `httpsCallable`.
- Spec-local mocks use `@Input()`/`@Output()` decorators (not signal
  APIs) per AGENTS.md — prevents silent `jest.mock` bypass.

## Existing Test Coverage
- `topic-viewer.store.spec.ts`, `topic-viewer-page.component.spec.ts`,
  `topic-viewer-tree.component.spec.ts` — updated for the contract
  change (fixtures gain `topics`/`groupOrder`, lose `sections`); all
  new computeds and surfaces added.

## Edge Cases
- Query matches a closed node while Show-closed is off → not surfaced;
  toggling Show-closed reveals it.
- Selected topic filtered out by the query → selection retained but
  hidden; clearing restores.
- All-topics + query: non-matching sections empty → hidden, not
  rendered as empty headers.
- Label write on a node inside a closed/collapsed subtree → patch still
  applies (visible on expand).
- Picker with zero non-system labels (fresh repo) → create-new only.
- Long title + many chips → title ellipsizes, chips fully visible.
