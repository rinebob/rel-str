**Topic:** Savant Design System  
**Topic Slug:** savant-design-system  
**Thread:** De-Materify  
**Thread Slug:** de-materify  
**Issue:** #1163  
**Thread Parent:** #1163  
**Topic Parent:** #1024  
**Task:** #1347  
**Domain:** DESIGN-SYSTEM  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-19  
**Last Updated:** 2026-11-02  

# Code Review — #1347: element/component inventory + de-materify disposition matrix

## Verdict: PASS (after two remediation rounds)

No outstanding critical or major findings. Three review passes were
run; each found real counting bugs, all remediated in-flight.

**Test results:** full suite green — 287 suites, 4,954 tests, 0
failures (run during pass 1; subsequent rounds touched only
`scripts/` + `docs/`, outside jest discovery).

## Round history

### Round 1 — FAIL (2 majors)

- **M1** — `native-button` (314) double-counted ~110 `<button>`s
  already carrying DS widget classes — a third of the REPLACE row was
  already-adopted work, and phase-A's "~640" justification silently
  assumed dedup. *Fixed: negative lookahead excludes DS-classed
  buttons; total now 231.*
- **M2** — `mat-icon` disposition said "keep font" but the *element*
  still requires `MatIconModule` — 904 usages weren't actually
  disposed. *Fixed: §6/D2 rewritten around the element; recommends
  the ligature-span sweep (option b).*

Plus ~15 minors remediated in the same pass: comment stripping ported
from `inventory-ui-colors.mjs`, `matRowDef`/`mat-optgroup` tokens,
`native-input` split by `type=`, zero-hit archetype emission,
`mat-icon(?!-)`/`mat-button(?!-)` prefix fixes, `ds-pill-toggle`
vs `pill-btn` overlap, deterministic sort tiebreakers, `sites` emitted
with file:line, dead regex alternatives removed, trailing newline.

### Round 2 — FAIL (1 major, introduced by the fix)

- **M3** — close-tags counted as usages: switching to per-occurrence
  `matchAll` made `</mat-icon>` match `mat-icon` — ~850 phantom hits
  (~20% inflation; mat-icon read 882 vs true ~495). *Fixed: matches
  preceded by `/` are dropped.*
- Minor — `accept="image/*"` in `new-trade.dialog.html` tripped the
  `/* */` block-comment machine and ate 82 lines of file. *Fixed:
  .html files use the `<!--`/`-->` pair instead.*
- Minor — stale "counted per line" docs; trailing `//` comments now
  stripped.

### Round 3 — PASS (2 minors, fixed)

- `</app-rh-select-menu>` slipped the `/` filter (match preceded by
  `-`) — 11 of 43 hits (~26% row inflation). *Fixed: `app-rh-select-menu`
  alternative ordered first in the regex; total now 32.*
- Retire-scope footnote ambiguity (~2,110 vs 2,079) — *clarified.*

## Final artifact state

- `scripts/inventory-ui-elements.mjs` — 66 declared archetypes,
  comment-stripped whole-text matching with close-tag filtering,
  deterministic output, `sites` records with file:line.
- `ui-element-sites.json` — **3,219 usages · 54 nonzero archetypes ·
  291 files**, internally consistent (doc rows ↔ JSON verified).
- `1024-1163-ELEMENT-INVENTORY.md` — refreshed matrix; family totals
  reconcile exactly (Buttons 650, Overlays 455, Forms 460, Select
  140, Data ~210, Layout 135, Feedback ~60, Shell+Icons ~525);
  retire-scope ≈2,100; D2 resolved to element-level disposition.

## Residual notes (accepted, documented in `limitations`)

- ` //` inside a string/template literal would truncate a line's tail —
  no live instances in src/app.
- `/*` inside a `.ts`/`.scss` string would still engage the block
  machine — no live instances; HTML exempt.
- Order-of-magnitude accuracy is the artifact's stated contract;
  file counts are the reliable metric for phase sizing.
