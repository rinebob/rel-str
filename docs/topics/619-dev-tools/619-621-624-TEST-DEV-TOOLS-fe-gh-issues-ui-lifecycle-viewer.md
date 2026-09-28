**Topic:** GitHub read-only issue UI  
**Topic Slug:** `gh-issues-ui`  
**Thread:** Lifecycle viewer  
**Thread Slug:** `lifecycle-viewer`  
**Issue:** #624  
**Thread Parent:** #621  
**Topic Parent:** #619  
**Domain:** DEV-TOOLS  
**Type:** TEST  
**Area:** FE  
**Status:** Complete  
**Created:** 2026-09-27  
**Last Updated:** 2026-09-27  

---

# Test Plan — FE: Lifecycle viewer page

## Seam

`DevLifecycleService` is the seam — store/page specs mock it (`allocation-page.component.spec.ts` pattern: `useValue` store or service mocks, `data-testid` DOM queries, `await new Promise(r => setTimeout(r, 0))` flush — no `fakeAsync` on awaited paths).

## Unit test targets

**`lifecycle.store.ts`**
- `topicSections()`: maps response `sections` 1:1 (doc order preserved); closed topics filtered unless `showClosed`; empty sections dropped
- `showClosed` off → closed topics/nodes hidden; on → rendered with closed styling flag
- `selectRepo` clears previous tree/selection, triggers fetch, and an in-flight fetch for repo A can't overwrite repo B's selection (stale-response guard)
- `refresh()` refetches the current repo; `fetchedAt` updates; `error` clears on success
- Failed fetch keeps the previous tree visible while `error` is set (banner-over-data, not blank)
- `expandAll`/`collapseAll`/`toggleExpanded` drive `treeRows()` visibility; children of collapsed nodes omitted from flattened rows

**`lifecycle-page.component.ts`**
- Repo picker lists the configured repos; switching calls the service with the new `{owner, repo}`
- Topic list renders group headings + `#NNN` + stage chip + Status badge
- Selecting a topic renders the tree in the detail pane; header timestamp renders `fetchedAt`
- Show-closed toggle reveals closed topics dimmed
- Error banner shows the HttpsError message; tree remains beneath it
- Empty state text when `sections` is empty and no error
- Refresh button disables while `loading`

**`lifecycle-tree.component.ts`**
- Indentation by depth; caret only on nodes with children
- Title is an `<a>` to the node's `url` (new tab), not a routerLink
- Stage chip only when `stageLabel` present; status badge only when `status` present
- Closed nodes render with distinct styling

## E2E journey (manual / UAT)

`npm start` → Dev Lifecycle nav → pick repo → grouped topic list → select a Topic → tree expands → click a node → github.com issue opens → toggle Show closed → closed topics appear → Refresh → `fetchedAt` updates.

## Edge cases

- Service returns a single `Ungrouped` section (SA repo) → flat list, no crash
- Node with no `status` (repo without projectNumber) → badge slot empty, layout holds
- Very long titles truncate/wrap without breaking row layout
- Switching topics mid-fetch → stale response discarded
