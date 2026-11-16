**Topic:** Option Contract Time-Series Viewer  
**Topic Slug:** option-contract-viewer  
**Thread:** OCC Contract String Group Generator  
**Thread Slug:** occ-string-generator  
**Issue:** #1335  
**Thread Parent:** #1325  
**Topic Parent:** #1243  
**Task:** #1514  
**Domain:** OPTIONS  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-14  
**Last Updated:** 2026-11-14  

# Code Review — #1514 Study-range brush hides crosshairs + tooltips

## Scope

Bug filed from QA #1479 (UAT S1): arming **Select study range** suppresses
all cursor-date feedback — the capture layer swallows Syncfusion's
mousemove, so crosshair, tooltips, and the top-edge date tag all die at
the moment the user needs axis dates most.

**Expected (issue body = spec):** while armed, the chart shows
cursor-date feedback — crosshair or a live date tag during hover and
drag — so the user can pick start/end precisely.

## Diff

- `options-contract-chart.component.ts` — `brushMoveTo` feeds
  `hoveredAxisIndex` via `trackHoveredIndex` (revives `.dw-date` tag +
  `pinnedWindow`); new `brushCursor` computed → `.brush-cursor` line;
  new `dragRange` computed → `.brush-rect-label` live resolved
  `{start} – {end}`; `releaseHoveredIndex` centralizes the anchor-keep
  guard across leave/cancel/disarm.
- `options-contract-chart-brush.utils.ts` — `MIN_DRAG_PX` extracted
  (single source for the click-vs-drag threshold).
- `.html` — `.brush-cursor` + `.brush-rect-label` elements.
- `.scss` — `.brush-cursor` line; shared `.dw-date`/`.brush-rect-label`
  chip rule (deduped ~10 verbatim properties).
- `.spec.ts` — 9 new specs in `cursor date feedback while armed`.

## Axes

### Standards — clean after remediation

- ~~`2px` magic constant in three sites~~ → `MIN_DRAG_PX` in
  brush.utils; dragRect, dragRange, brushUpAt all consume it.
- ~~`.brush-rect-label` duplicated `.dw-date` chip styling~~ → shared
  selector rule; per-class overrides only.
- ~~anchor-mode clear branches untested~~ → two new specs pin keep on
  leave + disarm, one spec pins armed `pinnedWindow` population.
- Nit fixed: `hoveredAxisIndex` doc comment now names all three
  consumers; px→index feed + anchor-guard clear deduplicated into
  `trackHoveredIndex`/`releaseHoveredIndex` (5 call sites → 2 helpers).

### Spec — MET

- Cursor-date feedback during armed hover — MET (tag + cursor line).
- During armed drag — MET (tag tracks moving edge; rect label previews
  the exact `{start,end}` the gesture will emit, corpus-snapped).
- Specs trace at the seam (public methods + DOM, no internals).
- Deferred/out-of-scope: Syncfusion float-mode value tooltip stays dead
  while armed — the Expected text asks for *date* feedback only; anchor
  mode still gets values via the panel.

### Thermo-nuclear — sound

- One signal (`hoveredAxisIndex`) drives tag, panel, and cursor line —
  no duplicated hover resolution; no signal writes inside computeds; no
  effect loops (`clearDragOnDisarm` reads arm/mode, writes drag/index).
- Edge cases verified: off-plot px clamps; `axisSpace` null is a no-op;
  `brushUpAt` clears drag before guards; tooltipMode flips re-resolve
  correctly including anchor→float disarm purging the kept index.
- Optional suggestions taken as far as warranted — helpers extracted,
  constant centralized; merging `dragRect`+`dragRange` into one
  computed rejected (two call sites of one pure helper is reuse, not
  duplication; coupling them buys nothing).

## Known minors (documented, not fixed)

- `.dw-panel` (z5, pointer-events:auto) occludes `.brush-capture` (z3)
  in anchor mode — a drag crossing the populated panel fires
  `mouseleave` → `brushCancel` drops the gesture. **Pre-existing**
  layering; the fix merely makes armed+anchor a reachable path. Flag
  for future UX pass if reported.
- `.dw-date` shows the axis label while `.brush-rect-label` shows the
  corpus-resolved bound — they can differ by a day mid-drag under a
  fetched corpus. Both truthful (cursor category vs. committed value);
  intentional.
- `.brush-rect-label` centers on the rect inside `overflow:hidden` —
  can half-clip at the domain's far edges. Cosmetic.
- Armed cursor persists at last position after mouseup — intended
  (mirrors Syncfusion crosshair behavior).
- Component is ~775 lines and accreting brush section — pre-existing
  size note, not this diff's scope.

## Test results

- `options-contract-chart` suites: **74/74** (9 new cursor-feedback
  specs incl. anchor keep + armed panel).
- Full suite: **312 suites / 5,595 specs** green (fresh run).
- `tsc -p tsconfig.app.json` clean.

## Round 2 — remediation delta re-review

Re-reviewed only the Round-1 fix surface (MIN_DRAG_PX extraction, the
two helpers, the CSS merge, 3 new specs) — a full re-axis on ~30 lines
of remediation would be theater.

- `hoveredAxisIndex.set` now exists in exactly two places —
  `trackHoveredIndex` (440) and `releaseHoveredIndex` (449); all five
  former sites call the helpers. The anchor-keep invariant is
  structural, not comment-maintained.
- `MIN_DRAG_PX` single-sourced at brush.utils:30; the live-snap gate,
  label gate, and emit gate all consume it.
- CSS: shared `.dw-date`/`.brush-rect-label` chip rule verified —
  `position:absolute` in the shared block, mode-specific `top`/z-index
  in overrides.
- New specs: anchor keep-on-leave + keep-on-disarm, armed `pinnedWindow`
  population, mid-drag cursor-line px — all pin previously-untested
  paths; none assert internals.
- No new findings.

## Verdict

**PASS** — all three axes clean; every Expected criterion met with
margin (resolved edge-date preview exceeds the stated ask). Remaining
items are documented minors/nits, none blocking.
