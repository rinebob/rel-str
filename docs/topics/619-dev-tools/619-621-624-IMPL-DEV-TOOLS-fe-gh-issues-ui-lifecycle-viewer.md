**Topic:** GitHub read-only issue UI  
**Topic Slug:** `gh-issues-ui`  
**Thread:** Lifecycle viewer  
**Thread Slug:** `lifecycle-viewer`  
**Issue:** #624  
**Thread Parent:** #621  
**Topic Parent:** #619  
**Domain:** DEV-TOOLS  
**Type:** IMPL  
**Area:** FE  
**Status:** Complete  
**Created:** 2026-09-27  
**Last Updated:** 2026-09-27  

---

# Implementation Plan — FE: Lifecycle viewer page

## 1. Scope

New feature area `src/app/features/dev-lifecycle/` — a master-detail read-only page rendering `LifecycleTreeResponse` from the `getLifecycleTree` callable. Follows the `portfolio-dashboard` feature conventions (standalone components, NgRx SignalStore, service seam, `data-testid` hooks).

## 2. Files

- `dev-lifecycle.service.ts` — thin callable wrapper: `getLifecycleTree$({owner, repo}): Observable<LifecycleTreeResponse>` via `httpsCallable` (same pattern as `paper-trading.service.ts`); exposes `SUPPORTED_REPOS` for the picker (shared const or mirrored from BE config — decision: FE keeps its own 2-entry constant; the BE whitelist is authoritative).
- `lifecycle.store.ts` — SignalStore: `repos`, `selectedRepo`, `response`, `topicSections` (view models), `selectedTopic`, `expandedIds` (`number[]` — serializable signal state; Set semantics applied at use sites), `groupingWarning` (BE degrade notice passthrough), `showClosed`, `loading`, `error`, `fetchedAt`. Methods: `selectRepo(i)`, `selectTopic(n)` (seeds the topic into `expandedIds` so depth-1 shows), `refresh()`, `toggleExpanded(n)`, `expandAll()`, `collapseAll()`, `toggleShowClosed()`. Repo list exported as `DEV_LIFECYCLE_REPOS` on the service; when #638 adds the SA repo BE-side, this mirror must update in the same change.
- `lifecycle-page.component.ts` — the page shell (header row + two panes).
- `lifecycle-tree.component.ts` — recursive tree renderer (component-per-node is fine at this scale; indentation by depth).
- `core-routes.ts` — lazy route `/dev-lifecycle`, auth-gated like sibling pages.
- `core/common/constants.ts` — nav entry "Dev Lifecycle" appended to the nav list.
- Specs alongside each file (`allocation-page.component.spec.ts` pattern).

## 3. View model

The store maps `LifecycleTreeResponse` → display rows, not the raw payload:

- `topicSections()` → `{ name: string; topics: TopicRow[] }[]` — maps the response's pre-ordered `sections`; closed topics filtered unless `showClosed`. Empty sections dropped.
- `TopicRow = { number, title, stageLabel?, status?, closed }`.
- `treeRows()` → flattened visible nodes of `selectedTopic` honoring `expandedIds` — `{ node, depth }[]`. Children of closed-by-default nodes hidden until expanded; `expandAll` walks every node.
- `error` surfaces the HttpsError message (banner names the cause — auth/token/rate-limit).

## 4. Layout (from PRD)

- **Header:** repo dropdown, Refresh button (disabled + spinner while loading), `as of {fetchedAt}` timestamp, "Show closed" toggle.
- **Left pane:** section headings (group names) + topic rows (`#NNN`, title, stage chip, Status badge, dimmed when closed).
- **Right pane:** selected topic's tree — indent by depth; each row: expand caret (when children exist), `#NNN`, linked title (opens github.com in new tab), stage chip, Status badge, tag chips, closed styling. Expand-all/collapse-all buttons above the tree.
- **Empty state:** "No Topics found in this repo" when `sections` is empty and no error.
- **Error state:** banner with the error message; previously loaded tree stays visible beneath it.

## 5. Boundaries

- Types come from `shared/lifecycle-contracts.ts` — no GitHub types in FE code.
- No mutations — the template contains zero write affordances; links open github.com only.
- Callable name added to the FE's callable registry the same way `CallableName` entries were added for paper trading.

## 6. Testing

- Store specs: section assembly (grouped vs ungrouped vs no-doc flat), closed filtering, selection, expand/collapse state, error retention.
- Page specs: repo switching triggers reload, list selection renders tree, expand-all reveals full depth, error banner + preserved tree, refresh calls service.
- Tree component specs: depth indentation, caret visibility, github link hrefs.
- Prior art: `allocation-page.component.spec.ts` (tab/section specs, `data-testid` queries, mocked store).
