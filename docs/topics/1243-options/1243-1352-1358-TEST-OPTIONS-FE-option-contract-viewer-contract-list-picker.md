**Topic:** Option Contract Time-Series Viewer  
**Topic Slug:** option-contract-viewer  
**Thread:** Selected Contract List Picker  
**Thread Slug:** contract-list-picker  
**Issue:** #1358  
**Thread Parent:** #1352  
**Topic Parent:** #1243  
**Domain:** OPTIONS  
**Type:** TEST  
**Area:** FE  
**Status:** Draft  
**Created:** 2026-11-01  
**Last Updated:** 2026-11-01  

# Test Plan — FE: Selected Contract List Picker

External behavior only — assert emitted lines, marker series inputs,
store outputs, and rendered states; never Syncfusion internals, dialog
animation, or private state shape. Fixture list docs mirror
`OptionsContractListDoc` exactly (pick + `no-selection` rows,
`repeatsPrevious`, `pickDocMeta`).

## Test seams

- `ContractListService` — injectable; specs stub doc reads + recent-list
  queries (same posture as the replay runs service / availability
  service).
- `contract-list-session` store — spec'd directly at the store seam:
  load, selection ops, cursor, emit.
- Emit util — pure `ContractListPickRow[] → string` — primary pure seam.
- `computeMarkerSpans` / `unionAxisLabels` / `buildSeriesCollection` —
  already pure; extend existing specs for multi-vertex markers.
- `loadPlotted` — existing feature spec extends to markerDates union.
- Picker dialog + mini-controls — TestBed specs over a stubbed session
  store (method spies), asserting store calls and rendered state, not
  chart pixels.

## Unit targets

- **`toPairLines`:** duplicates preserved verbatim; order = entryDate
  then contractId; `no-selection` excluded; single-row and empty inputs.
- **Pair parser round-trip:** duplicate `date,id` lines →
  `markerDates` union; `openDate` = earliest; bare `id` → empty
  markerDates and no span — existing single-date behavior unchanged.
- **`loadPlotted` fold:** repeated contractId with different dates → one
  contract, markerDates = union, openDate = earliest; a kept contract
  retains data while gaining new dates.
- **`computeMarkerSpans`:** vertices = each pick date + expiration;
  skipped when no dates; reversed (all dates > expiration) skipped;
  single date → identical to today's two-point marker.
- **Underlying window:** dated load sets window `[earliestMarker −
  ~70d, today]`; clip (`displayWindow='position'`) never mutates
  `underlyingBars`/`underlyingWindow`; `addPadDays` widens deliberately;
  axis domain unions underlying bar dates (clip cannot remove them).
- **Session ops:** all/none/invert; stride k over days (unique readout);
  random N (bounded, deterministic with seeded fixture); date-range;
  text filter; ops compose with manual toggles; `no-selection` rows
  never selectable.
- **Chunking:** partition by pick days; remainder chunk; cursor
  clamp/wrap at ends; `i/n · days · unique` info correct per chunk;
  add-chunk accumulates into selection.
- **Persistence:** `rs-optlist:{SYMBOL}` blob round-trip; version guard;
  symbol swap loads that symbol's blob; stale docId → failed status.
- **Chooser transform:** sort (symbol asc → generatedAt desc);
  default symbol filter + widen; `status==='success'` only.

## Component specs

- Dialog opens populated; first-10 rows checked on load.
- Checkbox toggles update selection + readout (`N rows → M unique`).
- Toolbar ops check the expected rows after each op.
- `no-selection` rows render greyed/disabled with reason.
- `⇄ repeat` badge on `repeatsPrevious` rows.
- Lines preview equals emit output for the selection; Copy writes
  clipboard.
- Stepper `▶` calls `sendSteppedChunk` and emits the landed chunk's
  rows (live-drive); `Add chunk` checks the chunk's rows.
- Mini-controls render only with an active session; each button calls
  the matching store method; `i/n` reflects cursor.
- `?list=` nav: doc loads, picker auto-opens; cross-symbol doc → page
  symbol switch fires first; missing doc → named error, chart untouched.
- Chooser: lists recent docs, filters to current symbol, toggle widens,
  select → loadList + open.
- `Send` writes emitted lines into the pairs input and calls the
  existing load path (spy on the page handler).

## E2E journeys (QA)

1. Replay send → chart: `?list=` lands, dialog open, first-10 → Send →
   `date,id` lines in textarea, marks + per-day dots + one span per
   contract, underlying starts ~50 sessions before earliest marker.
2. Chooser path: open chooser, filter/switch symbol, load, pick rows,
   send — same end state.
3. Filmstrip: stepper through chunks — chart replaces per step; Add
   chunk accumulates; final Send emits union.
4. Mini-controls: close dialog, page via `◀ ▶`, resize chunks, `All`,
   reopen picker — cursor and selection preserved.
5. Clip invariant: dated set loaded → toggle clip-to-entry → contract
   marks clip, **underlying unchanged** (regression for the reported
   issue).
6. Repeat markers: a contract picked 3 days → 3 dots + 1 span
   earliest→expiration at strike.
7. Round-trip: reload page after send — textarea lines reproduce the
   same markers.
8. All-send: send the full list — every unique contract plots; readout
   warned of count.
9. Error states: missing doc, failed-status doc, empty-rows doc —
   each names its cause; chart untouched.
10. Reload-restore: session persisted per symbol; switching symbols
    keeps each symbol's session.

## Edge cases

- Chunk size larger than list → single chunk, `1/1`.
- Cursor at last chunk + `▶` → clamp (no wrap) or wrap — pin whichever
  lands; spec asserts it.
- Selection empty → Send disabled; lines preview shows empty state.
- `?list=` on a page with an existing plotted set → session send
  replaces it (no merge).
- Rows whose `entryDate` precedes all corpus dates — marker lands via
  axis-union, no crash.
- `All` on a truncated/multi-hundred list — sends everything; no
  implicit cap (scale warning belongs to the readout, not a gate).
