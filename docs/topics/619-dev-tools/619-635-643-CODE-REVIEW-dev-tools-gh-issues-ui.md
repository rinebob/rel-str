**Topic:** GitHub read-only issue UI  
**Topic Slug:** `gh-issues-ui`  
**Thread:** Lifecycle viewer  
**Thread Slug:** `lifecycle-viewer`  
**Blueprint:** #635  
**Task:** #643  
**Domain:** DEV-TOOLS  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-09-28  

# Code Review — FE `LifecyclePage` + `LifecycleTree` components

## Files changed

- `src/app/features/dev-lifecycle/lifecycle-page.component.ts` — header row, banners, grouped topic list, tree pane
- `src/app/features/dev-lifecycle/lifecycle-tree.component.ts` — expandedIds-gated flat-row renderer
- `src/app/features/dev-lifecycle/lifecycle-*.spec.ts` — 13 component specs (+ store spec deltas)

## Review axes

**Combined standards+spec+deep:** PASS — zero write affordances (verified every binding); standalone/OnPush/signals/data-testid conventions match allocation-page prior art.

## Iterations and fixes

**Round 1** — applied:

- **Spec gaps** — added page specs: expand-all/collapse-all → store calls; show-closed checkbox → `setShowClosed($event.checked)`; refresh disabled while `loading`; repo picker emits `{value:1}` (a real switch, not a no-op)
- **Caret/expandableIds gated on visible children** — a node whose children are all closed no longer shows an expandable caret or enters `expandAll` when `showClosed=false` (identical rule in store + component)
- **`setShowClosed(v)` setter** — checkbox forwards `$event.checked` instead of blind toggle
- **Dead imports removed** (`MatIconModule`/`MatTooltipModule` in page, `MatTooltipModule` in tree); `role="alert"`/`role="status"` on banners
- **`ngOnInit` also skips when `loading()`** — in-flight fetch owns the slot (commented rationale)

**Iteration 2** — CLEAN. Two non-blocking notes acted on anyway:

- `selectRepo` bounds guard (unreachable via mat-select; protects programmatic calls)
- Tree spec added for the closed-children caret gating

## Deliberate decisions (kept)

- `collapseAll` → root row only, vs `selectTopic` seeding root expanded — explicit collapse is an all-off gesture; asymmetry is intended
- Raw ISO `fetchedAt` — precision preferred over a localized pipe
- Nav retry on error — self-healing; error stays visible under the banner

## Evidence

| Check | Result |
|---|---|
| `jest src/app/features/dev-lifecycle` | 28/28 pass |
| `tsc -p tsconfig.app.json --noEmit` | clean |

## Verdict

**PASS**
