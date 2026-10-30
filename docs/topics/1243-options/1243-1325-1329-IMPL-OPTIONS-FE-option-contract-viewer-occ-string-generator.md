**Topic:** Option Contract Time-Series Viewer  
**Topic Slug:** option-contract-viewer  
**Thread:** OCC Contract String Group Generator  
**Thread Slug:** occ-string-generator  
**Issue:** #1329  
**Thread Parent:** #1325  
**Topic Parent:** #1243  
**Domain:** OPTIONS  
**Type:** IMPL  
**Area:** FE  
**Status:** Draft  
**Created:** 2026-10-28  
**Last Updated:** 2026-10-28  

# Implementation Plan — FE: OCC Group Generator Drawer

## Architecture

Second `mat-sidenav` (`position="end"`, side mode) on `/options/chart`
hosting a dumb drawer component. All data lifecycle lives in a dedicated
signal store (`option-group-generator`) — fetch → refine → emit → persist.
The page coordinates: store output → textarea + `loadPlotted`; chart brush
output → store refine state.

## Task FE-1 — Generator utils + per-symbol persistence

**`utils/option-group-generator.utils.ts`** — pure functions:

- `toAvailabilityQuery(params)` — FE query state → `ContractAvailabilityRequest`
  (symbol injected; explicit expiry list wins over range; `firstObserved*`
  naming at the boundary).
- `refineContracts(records, refine)` — client-side narrowing on the same axes:
  strike range, expiry range/list, type, `firstObserved ≤ bound`, plus
  **alive-across-range**: `firstObserved ≤ range.start && lastObserved ≥ range.end`.
- `toPairLines(records, openDate?)` — emit `YYYY-MM-DD,ID` or bare `ID` lines,
  deterministic order (expiration → strike → id, matching endpoint sort).
- `isInvertedRange` / date-compare helpers for form validation.

**`utils/option-generator-settings.ts`** — persistence (the
`sandbox-settings.ts` pattern):

- Versioned blob: `{ version: 1, query: QueryState, refine: RefineState,
  useRangeAsOpenDate: boolean }` under key `rs-optgen:{SYMBOL}`.
- `load`/`save`/`clear` with wrapped localStorage access (private-mode safe),
  unknown `version` → defaults; open-date value itself is NOT persisted
  (date goes stale; params are what matter).

## Task FE-2 — Availability service + generator store

**`services/contract-availability.service.ts`** — injectable seam:

- `query$(req: ContractAvailabilityRequest): Observable<ContractAvailabilityResponse>`
  hitting the new proxy route (same HttpClient/function-URL pattern as the
  catalog consumer). Stubbed in specs — no Firebase dependency in unit tests.

**`stores/option-group-generator-feature.ts`** — signal store, scoped to the
options-chart page (provided at page level):

- State: `query` (axis params), `refine`, `records` (raw response),
  `filtered` (computed `refineContracts`), `status` (idle/loading/error),
  `truncated`, `corpusDates`, `openDate`, `useRangeAsOpenDate`,
  `lastEmitted` lines.
- Methods: `setQuery`, `run` (fetch via service), `setRefine`,
  `applyRange(range)` (writes refine bound; when `useRangeAsOpenDate` also
  writes `openDate = range.start`), `setOpenDate`, `clear`, `emit()` →
  produces pair lines for the page to inject into the textarea + `loadPlotted`.
- On `run`/`clear`: persist query+refine+toggle via FE-1 settings service.
- Symbol changes (page symbol input) → load that symbol's persisted blob.

## Task FE-3 — Generator drawer component + page wiring

**`components/option-group-generator/`** standalone component:

- Query form: strike from/to/step, expiry range (two text inputs,
  `YYYY-MM-DD`) + explicit-expiry list input, type radio (Calls/Puts/Both).
- Refine section: same axes, optional; the alive-across-range bound displays
  the active brush range (read-only, clearable).
- Open-date field + "use range start" toggle (toggle persisted; date not).
- **Run** → preview table: `contractId | expiration | strike | type |
  firstObserved | lastObserved`; count line `N contracts` (+ `truncated —
  showing first 2000, narrow filters` warning); loading spinner; error +
  retry; explicit empty state.
- **Send to chart** → emits `emit()` lines to the page.

**Page wiring (`option-chart.component`):**

- Right `mat-sidenav` (`position="end"`, side mode) + a toolbar button to
  toggle it; chart re-fits via existing `ResizeObserver` — no extra work.
- Send handler: write emitted lines into `pairsInput`, call existing
  `onLoadPlottedPairs` path (replace semantics preserved).
- Route chart's `studyRange` output into `store.applyRange`.

## Task FE-4 — Chart study-range brush (custom overlay)

In `options-contract-chart.component` (+ page toggle):

- **Brush-mode button** in the chart controls (alongside clip/underlying
  toggles): arms/disarms the study-range brush; `Esc` or re-click disarms.
  Cursor changes while armed.
- Armed: `mousedown` → capture start px; `mousemove` → draw selection rect
  (absolutely-positioned div over the chart host, synced with the chart's
  category-axis pixel math used by the hover layer); `mouseup` → snap both
  edges to nearest `corpusDates` entry (falls back to axis labels when the
  drawer hasn't fetched yet), emit `(studyRange)="{start,end}"`.
- **Never mutates the axis** — no Syncfusion `selectionMode`, no
  `visibleRange` writes. The overlay is decorative; the range is data.
- Renders the persisted range as a faint band on the chart while it remains
  the active refine bound (dismissed when the refine bound clears).
- Suppresses the connected-hover dimming while armed (mouse semantics are
  brush, not hover); normal hover resumes on disarm.

## Boundaries / risks

- **Service seam** is the only endpoint dependency — develop against stubbed
  fixture responses until the proxy + SA endpoint are live.
- **Overlay↔axis math** must reuse the same pixel→category mapping as hover;
  a second, divergent mapping is the main defect risk.
- Category axis → date conversion depends on label format — keep the
  `xLabels`-domain assumption explicit in a utils function.
- Right sidenav + existing left sidenav coexistence: `mat-sidenav-container`
  supports both natively; verify no z-index fight with the brush overlay.
