**Topic:** GitHub read-only issue UI  
**Topic Slug:** `gh-issues-ui`  
**Thread:** Topic Viewer UI polish & misc fixes  
**Thread Slug:** `topic-viewer-polish`  
**Issue:** #713  
**Thread Parent:** #697  
**Topic Parent:** #619  
**Domain:** DEV-TOOLS  
**Type:** INVENTORY  
**Status:** Draft  
**Created:** 2026-09-30  
**Last Updated:** 2026-09-30  

# Item Inventory — Topic Viewer misc-fixes lane

Living capture point for Topic Viewer (`/tools/topic-viewer`) visual-polish items. Append one-liners under **Open Items** — no issue needed at capture time. When an item is ready to work, promote it to a task issue under Thread #697 (labeled `4_BACKLOG`) and move its entry to **Promoted** with the task number.

Scope reminder: **visual polish only** — page functions correctly and both supported repos render live data. No behavior changes, no new features, no backend work unless a visual item genuinely requires it. App-wide nav/header restyling is out of scope (owned by Workflows topic #625/#661).

## Open Items

<!-- Add items here, one line each: short description + where it lives (page/component). -->

### Right pane — tree (`topic-viewer-tree.component.ts`)
- Chip soup — every row renders type-badge + stage chip + status chip + tag chips for all non-stage labels; rows overflow horizontally (`.title` needs `flex:1; min-width:0`; tag chips → hover/tooltip or filter to meaningful labels only)
- No topic context header in the right pane — selecting a topic should show "#N Title" + GitHub link above the tree
- Depth indentation is bare padding — add guide lines/stripes so parentage reads at depth 2–3
- Stage chips all one blue — color-code by lifecycle position (backlog/implement/review/qa/live)
- No row hover affordance or visual separation between sibling branches

### Left pane — topic list (`topic-viewer-page.component.ts`)
- Pane too narrow — widen from fixed 320px (titles + chips crowd); consider min-width + resizable or 360–400px
- Same chip layout problem as the tree — `.t-title` ellipsis fights stage+status chips; consider dropping the status chip (status exists on rel-str only) or a colored stage dot
- Section names (inventory-doc groups) render as tiny 0.7rem grey — read as disabled; needs hierarchy weight

### Header (`topic-viewer-page.component.ts`)
- No page title at all — just a picker/buttons/checkbox row; add "Topic Viewer" heading (page-level, not app nav)
- Header doesn't wrap — narrow viewport clips "Show closed"; add `flex-wrap: wrap`

### General
- Error/warn banners + empty states are unstyled background swatches — icons, consistent padding, center/boundary states
- Dark-theme sanity check — hardcoded hex colors (#eee, #f5f5f5, #888) ignore the Material theme; move to `--mat-sys-*` tokens where a token exists

## Promoted

| # | Item | Task | Status |
|---|------|------|--------|
| 1–11 | Full seed list (tree pane, left pane, header, theming) | #715 | 4_BACKLOG |

## Parking Lot (maybe-out-of-scope)

<!-- Items that might be too big for the lane — park here until sized. -->
- Shared design-token/theming pass for the app — belongs to the nav-reorg work (#661), not this lane
