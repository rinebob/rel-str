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
**Last Updated:** 2026-11-07  

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
- Picker dialog — TestBed specs over a stubbed session store (method
  spies), asserting store calls and rendered state, not chart pixels.
  (The mini-controls strip was removed in #1402 — see UX batch below.)

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
  never selectable. DOW preset (#1402): weekly union of checked days;
  biweekly alternating 7-day blocks anchored on first pick; monthly same
  week-of-month block; replace semantics; empty set → no-op.
- **Chunking:** partition by pick days; remainder chunk; cursor
  clamp/wrap at ends; `i/n · start→end · days · unique` info correct
  per chunk — a partial tail chunk reports its own last pick (#1402);
  add-chunk accumulates into selection.
- **Persistence:** `rs-optlist:{SYMBOL}` blob round-trip; version guard;
  symbol swap loads that symbol's blob; stale docId → failed status.
- **Chooser transform:** sort (symbol asc → generatedAt desc);
  default symbol filter + widen; `status==='success'` only.

## Component specs

- Dialog opens populated; selection starts EMPTY (fresh workspace —
  nothing is checked until the user selects).
- Checkbox toggles update selection + readout (`N rows → M unique`).
- Toolbar ops check the expected rows after each op.
- `no-selection` rows render greyed/disabled with reason.
- `⇄ repeat` badge on `repeatsPrevious` rows.
- Lines preview equals emit output for the selection; Copy writes
  clipboard.
- Stepper `▶` moves the cursor without emitting (#1419 — navigation
  only); `Add chunk` checks the chunk's rows into the selection.
- ~~Mini-controls render only with an active session~~ — strip removed
  in #1402-D2; the page's Picker entry point reopens the dialog and
  dialog Send is the only emit surface.
- Chart-range apply (#1402): bound brush → `Range start → end` button
  selects inclusive pick rows; unbound → disabled with explain-title;
  no `input[type=date]` remains. Month banding (#1402): alternate
  `entryDate` months carry `.month-alt` — including no-selection rows.
- DOW preset (#1402): five toggles Mo–Fr render `on`/`aria-pressed`
  from `store.dowDays`; Days apply disabled when nothing checked;
  cadence select drives `store.cadence`.
- `?list=` nav: doc loads, picker auto-opens; cross-symbol doc → page
  symbol switch fires first; missing doc → named error, chart untouched.
- Chooser: lists recent docs, filters to current symbol, toggle widens,
  select → loadList + open.
- `Send` writes emitted lines into the pairs input, calls the existing
  load path (spy on the page handler), then closes the dialog (#1419);
  `Close` closes without emitting.

## E2E journeys (QA)

1. Replay send → chart: `?list=` lands, dialog open, select rows → Send →
   `date,id` lines in textarea, marks + per-day dots + one span per
   contract, underlying starts ~50 sessions before earliest marker.
2. Chooser path: open chooser, filter/switch symbol, load, pick rows,
   send — same end state.
3. Chunk accumulate: stepper + timeline navigate chunks — chart does
   not move while the dialog is open; Add chunk unions each chunk's
   days; Send plots the accumulated set and closes (#1419).
3a. Timeline selection parity + chunk-toggle (#1420): every selected
   day renders a solid tick — a stride/random/range selection lights
   up the matching ticks across all chunks, not just the cursor's.
   The cursor is a filled mint band (distinct from selection).
   Clicking a tick toggles its WHOLE chunk (partial → fill, full →
   clear) AND jumps the cursor there; the Rows checks and Lines
   preview mirror every toggle. Fresh loads open with nothing
   selected. Still no emit — Send is the only plot path.
4. ~~Mini-controls: close dialog, page via `◀ ▶`~~ — superseded
   (#1402-D2): the page offers only the Picker entry point; reopen
   preserves cursor and selection; no page-level emit exists.
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
