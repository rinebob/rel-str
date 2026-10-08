# Code Review — FE: Gallery flat mode — 'None' group option (#820)

**Topic:** Gallery Order Ticket View  
**Topic Slug:** gallery-view  
**Thread:** Gallery View Page  
**Thread Slug:** gallery-view-page  
**Issue:** #753  
**Thread Parent:** #744  
**Topic Parent:** #743  
**Task:** #820  
**Domain:** FE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-06  
**Last Updated:** 2026-10-06  

## Review — 2026-10-06 (round 1 — GATE PASS)

Scope: `GroupDimension.NONE` (gallery-only flat-mode sentinel), 'None' option in
the header Group dropdown, `facade.ungrouped`/`flatCards` (non-sunk visible
cards sorted marketCap desc, missing caps last), `groups()` returning the sunk
panel only under NONE, flat `.gallery-grid` branch in the page template,
`getGroupKey` NONE handling, plus page/facade/ui-store/header spec coverage.

**Verdict: PASS.** Standards: PASS — no critical/major; minors fixed (flat-grid
gutter parity, enum/view doc updates, header spec 'None' assertion, facade
double-read + empty-toggle guard, `makeReject` spec hoist). Spec: all four ACs
verified met in production code through the real pipeline — None option, flat
no-expando layout, market-cap-desc order, sunk panel preserved below. Thermo:
PASS — exhaustive consumer check found no reachable mis-bucket path; expansion
keys can't collide (`:`-prefixed vs bare `sunk`); no serialization leak;
`flatCards` inherits the retained-identity pipeline.

### Findings — fixed in remediation

- **Minor (thermo M1)** — `GroupDimension.NONE` is type-compatible with
  signal-review's grouping path (`GroupStore.setGroupDimension` →
  `buildSymbolGroups` → `getGroupKey`); a stray NONE there would silently
  collapse every symbol into `(Unknown)`. No UI path today. Fixed loud:
  `getGroupKey` now throws on NONE (documented flat-mode-only sentinel) instead
  of returning `UNKNOWN_GROUP`; the enum doc carries the constraint.
- **Minor (standards)** — flat `.gallery-grid` lacked the grouped panels' side
  gutters and double-padded the top. Fixed: `margin: 0 16px 12px`,
  `padding-top` dropped (container pads already).
- **Minor (standards)** — empty `.gallery-grid` rendered when all visible cards
  are sunk. Fixed: flat branch gated on `flatCards().length`.
- **Minor (standards)** — `toggleAllGroups` issued a no-op `patchState` under
  NONE with zero groups. Fixed: early return on empty keys.
- **Minor (standards)** — `groupDimension()` read twice in `groups()`. Hoisted.
- **Minor (standards)** — `makeReject` duplicated verbatim across two spec
  describes. Hoisted to module scope.
- **Nit (standards/spec)** — header spec didn't assert the 'None' option; stale
  file docs in `constants.ts`/`gallery-view.component.ts`. Both fixed; ui-store
  spec gained a NONE case; view spec gained the flat+sunk composite DOM-order
  test.

### Findings — carried to QA (deferred judgement calls)

- **Sunk cards under flat mode** — a strict reading of "all cards in rows
  sorted by market cap" could include sunk cards in the flat list; the
  implementation keeps the #755 lifecycle model (sunk collect in the pinned
  Sunk expando below the flat grid). Deliberate — flag for the ticket owner to
  confirm at QA.
- `cardCount` in the header counts `visibleCards` including sunk — under flat
  mode the number exceeds the flat grid's rendered count. Same semantics as
  grouped mode; consistent, not a regression.
- Expand-all button under NONE only toggles the Sunk panel — inert when no
  sunk cards exist; harmless, and useful when one does.
- Equal/missing marketCaps fall back to stable-sort input order (no secondary
  key) — matches the "market cap only" spec literally.
