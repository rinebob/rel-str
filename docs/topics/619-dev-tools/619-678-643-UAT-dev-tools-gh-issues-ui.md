**Topic:** GitHub read-only issue UI  
**Topic Slug:** `gh-issues-ui`  
**Thread:** Lifecycle viewer  
**Thread Slug:** `lifecycle-viewer`  
**Issue:** #678  
**Task:** #643  
**Topic Parent:** #619  
**Domain:** DEV-TOOLS  
**Type:** UAT  
**Area:** FE  
**Status:** Complete  
**Created:** 2026-09-28  
**Last Updated:** 2026-09-28  

---

# UAT — #643 FE-IMPL: Lifecycle viewer page + tree component

## Scope

`lifecycle-page.component.ts` + `lifecycle-tree.component.ts` — header (repo picker, Refresh+spinner, as-of, show-closed), grouped topic list, expandable tree (depth indent, carets, github.com links, chips, closed styling), expand/collapse-all, error banner over preserved tree, grouping-warning banner, empty states. Not yet routed — route + nav are #644.

## Prerequisites

- `npm install` done.

## Scenarios

### S1 — Component specs

```powershell
npx jest src/app/features/dev-lifecycle --coverage=false
```

Expected: 28/28 — init-fetch skip/cache, header controls, repo picker → `selectRepo(1)`, section rows + `selectTopic`, error/grouping banners, empty states, refresh-disabled-while-loading, expand/collapse-all calls, tree depth indent, caret visibility (incl. closed-children gating), `aria-expanded`, link href/target/rel, chips, closed styling.

**Result:** PASS — 28/28.

### S2 — Typecheck + read-only audit

```powershell
npx tsc -p tsconfig.app.json --noEmit
```

Expected: clean. Zero write affordances — template review confirms only outbound `<a href>` to github.com and read-only store methods.

**Result:** PASS.

### S3 — Convention reads

- `nodeType` badge + stage chip + status chip + tag chips; stage label not duplicated as tag.
- `expandableIds`/`hasVisibleChildren` consistent — closed-children nodes not expandable with showClosed off.
- `role="alert"`/`role="status"` on banners.

**Result:** PASS.

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| Repo switch reloads; topic select renders tree; timestamp renders | S1 |
| Titles link github.com new tab; zero write affordances | S1, S2 |
| Error banner names cause; prior tree stays; empty state | S1 |
| Expand-all full depth; collapse-all resets | S1 |
| Page + tree specs per test plan | S1 |

## Refinement pass

Deferred to #644 UAT — the page isn't routed yet; rendered-surface review happens when it's reachable.
