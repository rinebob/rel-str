**Topic:** Option chain percent change grid  
**Topic Slug:** `option-chain-pct-change-grid`  
**Thread:** Pivot-signal selector  
**Thread Slug:** `pivot-signal-selector`  
**Issue:** #418  
**Thread Parent:** #359  
**Topic Parent:** #326  
**Domain:** OPTIONS  
**Type:** IMPL  
**Area:** FE  
**Status:** Complete  
**Created:** 2026-09-18  
**Last Updated:** 2026-09-18  

---

# Implementation Plan — Pivot-signal selector (FE)

## Architecture decision

**Shared snapshot cache + per-run local compute** (grilled, approved).
The store keeps its date→snapshot cache as the shared data layer and
gains `ensureSnapshots(dates)`. Each run section computes its own grids
from cached snapshots via the existing pure utils (`buildPctChangeGrid`).
No `runAnalysis` refactor; the existing single-analysis flow is
untouched. Filters stay global — identical contract universe across runs
is required for valid comparison.

## Data flow

```
symbol set
  → SwingAnalysisService.loadSavedAnalyses(symbol)   // swing-sets, where symbol ==
  → SignalService.getSymbolSignalHistoryFromHistory(symbol)

savedAnalyses (per symbol, each = config + pivots + swings)
  → frameSet picker  → mini zigzag expando → click swing → frameSwing [start,end]
  → extremesSet picker → confirmed pivots inside frame
  → signals inside frame (barDate + direction)
  → dateList (merged, sorted, labeled: swing-high / swing-low / LONG / SHORT)

run builder: start (dropdown, ≥ frameStart) + targets (checkboxes, > start)
  → runs[] { id, startDate, targetDates[], type }   // type defaulted by direction
  → run section: ensureSnapshots(dates) → buildPctChangeGrid per target
```

## State (option-chain-pct-change.store.ts)

New state:
- `savedAnalyses: SwingAnalysisDoc[]`
- `signals: StSignalItem[]`
- `frameSetId: string | null`, `extremesSetId: string | null`
- `frameSwing: Swing | null`
- `runs: SwingCompareRun[]` — `{ id, startDate, targetDates[], type }`

New methods:
- `loadSwingData()` — called when symbol set; populates analyses + signals
- `selectFrameSet(id)` / `selectExtremesSet(id)` / `selectFrameSwing(swing)`
- `addRun(startDate, targetDates, type)` / `removeRun(id)`
- `ensureSnapshots(dates: string[])` — fetch missing dates into cache

New computed:
- `frameSwings()` — swings of the selected frame set
- `dateList()` — merged confirmed pivots (extremes set) + signals inside
  `[frameStart, frameEnd]`, plus the frame start itself, sorted, labeled
- `targetCandidates(startDate)` — dateList entries after the start

## Components

- **`SwingSetPickerComponent`** — set dropdown (params label) + expando
  panel rendering a mini zigzag SVG from the set's pivots; each swing
  segment is a clickable hit-target → `selectFrameSwing`. Reused for the
  frame picker.
- **`SwingCompareComponent`** — the section container: set pickers,
  date list, run builder (start dropdown + target checkboxes + type
  select), run list.
- **`RunSectionComponent`** — collapsible (`<details>`-style or CDK
  accordion); on first expand calls `ensureSnapshots` then computes
  grids via `buildPctChangeGrid(startSnapshot, targetSnapshots, type,
  filters)` and renders existing `PctChangeGridComponent` per target —
  chart popup works per grid unchanged.

## Pure utils (pct-change-config.utils.ts or new swing-compare.utils.ts)

- `mergeDateList(pivots, signals, frame): DateItem[]` — filter to frame,
  label, sort, dedupe same-date entries (keep both labels on collision)
- `defaultTypeForStart(item): OptionType` — low/LONG → CALL, high/SHORT → PUT
- `swingPolyline(pivots): string` + `swingSegments(swings): Segment[]` —
  mini-chart geometry

## Firestore contract

- Read `swing-sets` with `where('symbol','==', sym)` — already
  implemented (`loadSavedAnalyses`). No writes. Rules already allow
  user-scoped reads.
- Signals: `SignalService.getSymbolSignalHistoryFromHistory(symbol)` —
  existing read path, no schema change.

## Risks / mitigations

- **DOM weight** — N runs × grids. Mitigate: collapsed by default,
  `@defer`-style lazy render on expand, destroy on collapse optional.
- **Duplicate dates** — signal and pivot on the same bar: one list entry,
  combined label; still one date.
- **Missing start snapshot** — a contract absent at the run's start is
  simply excluded from that run's grid (existing matching behavior).
