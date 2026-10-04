**Topic:** Gallery Order Ticket View  
**Topic Slug:** order-ticket-gallery-view  
**Thread:** Gallery View Page  
**Thread Slug:** gallery-view-page  
**Issue:** #753  
**Thread Parent:** #744  
**Topic Parent:** #743  
**Task:** #783  
**Domain:** GALLERY-VIEW  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-04  
**Last Updated:** 2026-10-04  

# Code Review — Task #783: Grouped expando layout

## Scope

Diff base: `HEAD` (post-#754 ship, commit `261c977a`). The gallery's flat card
grid is replaced by signal-review-style expansion-panel groups.

**Change set:**

- `utils/gallery-cards.util.ts` + spec — `sortGalleryCards`/`GallerySortKey`/
  `GALLERY_SORT_OPTIONS` removed (sort control deleted per product decision);
  `groupGalleryCards(cards, GroupDimension)` added — reuses `getGroupKey`,
  `getGroupLabel`, `marketCapTierRank`, `UNKNOWN_GROUP` from `utils.ts`.
- `stores/gallery-ui.store.ts` + spec — `sort` removed; `groupDimension`
  (default INDUSTRY) + `expandedGroups` added.
- `stores/gallery.facade.ts` + spec — `groups`, `allGroupsExpanded`,
  `isGroupExpanded`, `setGroupExpanded`, `toggleAllGroups`,
  `setGroupDimension`; `visibleCards` = filter only.
- `components/gallery-header/` — Sort select removed; "Group" dimension
  select + expand-all button added (same options/labels as signal-review).
- `components/gallery-group/` — NEW: mat-expansion-panel hosting the card
  grid; label + card count header.
- `pages/gallery-view/` — `.gallery-groups` stack replaces `.gallery-grid`.

**Spec source:** issue #783 body (corrected by user — original
interval/side/list design superseded by signal-review parity:
sector/industry/marketCap dimensions, list stays a filter, no sort
dropdown).

## Round 1 — 2026-10-04

Two parallel review agents (Standards + Spec) over the full change set.

### Spec axis — all acceptance criteria verified

- "Group" select options/labels identical to signal-review (`Sector` /
  `Industry` / `Market Cap`); default INDUSTRY matches `GroupStore`.
- Each group = expansion panel, label + card count; `(Unknown)` sinks last;
  market-cap groups order by tier rank with uppercase labels via shared
  `getGroupLabel`/`marketCapTierRank`.
- Within-group order = marketCap desc — same as `buildSymbolGroups` rows.
- `expandedGroups` + expand/collapse-all in `GalleryUiStore`; filters apply
  before grouping; empty groups impossible (buckets form from cards only).
- No sort dropdown; all four page states preserved verbatim.
- Dimension-prefixed group keys noted as a genuine improvement over
  signal-review's raw keys (collapsing `(Unknown)` under one dimension no
  longer collapses it under all dimensions).

### Findings fixed this round

1. `allGroupsExpanded` vacuously true on zero groups (both axes) → added
   `groups().length > 0` guard, matching `signal-review-ui.store` prior art.
2. Stale "sort"/"groupBy" references across nine comments/spec names → swept.
3. `list:`-prefixed fake group keys in specs (leftover from the superseded
   interval/side/list design) → renamed to `sector:`/`industry:` fixtures.
4. `.gallery-groups` leftover `align-content` no-op and missing `flex: 1;
   min-height: 0` → fixed.
5. `isGroupExpanded()` method call in the page template → replaced with the
   `expandedGroups` map passthrough + `expandedMap[group.key] ?? true`,
   matching signal-review's explicit reactive dependency.
6. Header control order — signal-review renders Group before List → swapped
   for parity.
7. Spec gaps → added `groupGalleryCards([])` empty-input case and a facade
   dimension-isolation test (`sector:Tech` vs `industry:Tech`).
8. IMPL doc Phase 1b still described the pre-correction interval/side/list
   design → updated to the signal-review-parity description.

### Noted, not fixed (judgement calls)

- **Expanded-by-default** — signal-review panels default collapsed; gallery
  defaults expanded. Deliberate: the gallery's purpose is scanning many
  cards/charts side by side, and collapse state still persists per group.
- **`setAllGroupsExpanded` merges** rather than replaces the record —
  deliberate, preserves collapse state across dimension switches (prefixed
  keys make cross-dimension collisions impossible).
- **~15-line bucketing overlap** with `buildSymbolGroups` — the reference is
  too monolithic to reuse wholesale; both comparators are tested.
- **`DIMENSION_OPTIONS` duplicated** in the gallery header — 5 lines; will
  extract only if a third consumer appears.
- **Possible redundant `expandedChange` emissions** when `[expanded]` flips
  programmatically — idempotent store write either way; benign.
- **No per-panel expand button** inside each panel header (signal-review's
  GroupPanel has one) — spec-literal; the page-level expand-all covers it.

## Post-review changes — 2026-10-04

Per user direction after the review:

- Page-entry defaults changed from All/All/All/Industry to
  **Daily + Long + PRIMARY + Sector** — the gallery opens on the primary
  workflow slice. `GalleryUiStore.initialState` only; verified by updated
  store + facade specs.
- Group expansion default flipped to **collapsed** (the expanded-by-default
  judgement call below is superseded — now matches signal-review). Group
  headers gained "N signals" + D/W + long/short count chips, mirroring
  GroupPanel conventions.

## Verdict

**PASS.** No blockers on either axis; all acceptance criteria implemented
and spec-verified; round-1 nits remediated. Remaining items are documented
judgement calls. Verified: 55 gallery tests green, `ng build` clean.

