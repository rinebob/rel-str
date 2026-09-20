# Code Review: SwingSetPickerComponent (dropdown + zigzag expando)

**Topic:** Option Chain Pct Change Grid
**Topic Slug:** option-chain-pct-change-grid
**Issue:** #420 (FE Blueprint)
**Task:** #423
**Topic Parent:** #326
**Domain:** OPTIONS
**Area:** FE
**Status:** Final
**Last Updated:** 2026-09-19

## Reviewed change

- NEW `components/swing-set-picker.component.ts` + `.spec.ts` — paramsId dropdown, collapsed zigzag expando, clickable swing segments
- `utils/swing-compare.utils.ts` — `SwingSegment`, `chartMappers`, `swingPolyline`, `swingSegments` (deferred from #422)
- NEW `testing/swing-fixtures.ts` — shared typed `Pivot`/`Swing`/`SwingAnalysisDoc`/`SwingStats`/`StSignalItem` factories
- `utils/swing-compare.utils.spec.ts` + `option-chain-pct-change.store.spec.ts` — migrated to shared fixtures

## Standards

- **Fixed — a11y:** segment `<line>`s were mouse-only → invisible wide hit lines carry `role="button"`, `tabindex`, `aria-label`, `aria-pressed`, Enter/Space handlers; visual strokes are `pointer-events: none` so hits stay generous on short/steep segments.
- **Fixed — `as`-cast fixtures** (`as DistributionSummary`/`as Histogram`) → real typed factories in `testing/swing-fixtures.ts`, shared by three spec files (kills the 3-4× `mkSwing`/`mkDoc`/`mkStats` duplication).
- **Fixed — mojibake** in utils comments → ASCII.
- **Fixed — non-null assertions** in `polyline`/`segments` computeds → local-var narrowing.
- **Noted:** component-scoped color hexes in `styles:` — conventional for Angular; no shared theme tokens exist for these.
- **Noted:** store file is 822 lines (still >400 guideline — pre-existing sprawl, unchanged by this task).

## Spec

All four acceptance criteria met:

- paramsId dropdown — ✓
- mini zigzag expando — ✓ (now **collapsed by default**, matching IMPL's compact intent)
- segment click emits the Swing — ✓ (emits the doc's `Swing` object, feeding `selectFrameSwing`)
- selected swing highlighted — ✓ (now **key-matched** on start/end times — survives doc refetches)

Deviations:

- `selectedSetId: string` input replaced with `selectedSet: SwingAnalysisDoc | null` — the parent already resolves the doc via the store; drops an internal re-find.
- Reusable for both frame + extremes pickers; `swingSelected` is optional for the extremes role.

## Thermo-nuclear

- Raw `<select>`/`<details>` is consistent with the page's existing controls (raw selects + details precedents elsewhere); `mat-expansion-panel` would import a heavier widget for a 48px preview.
- Hit-target layering (visual + invisible hit line) is the standard SVG pattern; `vector-effect="non-scaling-stroke"` keeps widths honest under `preserveAspectRatio="none"` stretching.
- `chartMappers` earns its keep — shared normalization for polyline + segments.
- **Noted:** degenerate zero-length segments remain unclickable (butt-cap zero-length strokes render nothing) — rare edge; circle handles would be the fix if it surfaces.
- Component is unwired until #424/#426 — expected at this stage.

## Test results

- pct-change suite: **317/317 green** (11 suites); both tsconfigs clean.
- New coverage: collapsed-by-default toggle, click + Enter/Space emit, key-matched highlight, a11y attrs, empty-swings edge, geometry normalization.

## Verdict

**PASS** — no critical/major findings remaining; nits recorded.
