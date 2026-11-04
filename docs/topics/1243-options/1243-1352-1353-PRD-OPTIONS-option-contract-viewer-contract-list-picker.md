**Topic:** Option Contract Time-Series Viewer  
**Topic Slug:** option-contract-viewer  
**Thread:** Selected Contract List Picker  
**Thread Slug:** contract-list-picker  
**Issue:** #1353  
**Thread Parent:** #1352  
**Topic Parent:** #1243  
**Domain:** OPTIONS  
**Type:** PRD  
**Status:** Approved  
**Created:** 2026-11-01  
**Last Updated:** 2026-11-01  

# PRD: Selected Contract List Picker

## Problem Statement

The Selection Replay engine (Topic #1238, Thread #1240) produces dated
contract lists — one row per trading day, each carrying a real OCC
contractId plus the day's strike, expiration, actual delta, IV, mark, and
underlying close. That is exactly the material a trader wants on the
multi-contract chart: a ladder of real picks, each anchored to its entry
day, viewable as price series.

Today there is no bridge. The replay run detail can chart one contract at
a time; the `/options/chart` page consumes `date,id` pair lines that must
be produced by hand or by the generator drawer's form. The drawer can only
emit one shared open date — it cannot express "each contract opened on its
own pick day," which is the whole point of a replay ladder.

A replay list is also *big* — a year of daily picks is ~250 rows. The
trader typically wants 10–20 contracts at a time: a time-windowed subset,
a stride sample, a random handful, or a sequential filmstrip through the
ladder — and once a subset is on the chart, stepping to the next group
must not require reopening a dialog.

## Solution

A **contract-list session** on the options chart page plus a **picker
dialog** — a full-size editor for selecting rows out of a dated contract
list and sending them to the plotted-set chart as `date,id` lines.

The list arrives two ways: a **Send to chart** action on the replay run
detail (sibling task #1354 under Thread #1240 — navigates to
`/options/chart?list={docId}` and auto-opens the picker), and a
**Contract lists…** chooser on the chart page itself that browses recent
`st-options-contract-lists` docs. The doc is read directly (authed read
already allowed by rules); the session holds the raw rows — one per pick
day, **no deduplication**: a contract picked on five consecutive days is
five rows, and that repetition is information the chart must render.

Selection happens in a large tabbed dialog: a raw row list with mass
operations, a sequential chunk stepper that live-drives the chart, and a
read-only lines preview of the exact `date,id` payload. On send, the
selected rows become pair lines (duplicates preserved) and replace the
plotted set through the existing `loadPlotted` path — the pair textarea
remains the single source of truth.

The chart gains **per-date entry markers**: one horizontal strike-level
span (earliest pick → expiration) plus a dot at *each* day the contract
was picked — repeat picks render as repeated dots on the same series. The
underlying window prepends ~50 sessions before the earliest marker date
so contracts open against the price action that produced them.

After the dialog closes, **chart mini-controls** (`◀ chunk i/n ▶`, chunk
size, `All`, reopen-picker) keep driving the same session — paging the
ladder without reopening the dialog.

## System Context

```mermaid
flowchart LR
    subgraph backtest["backtest page (Thread #1240)"]
        RD[Run detail<br/>contract-list table]
    end
    subgraph chart["/options/chart"]
        CHOOSER[Contract lists…<br/>recent list docs]
        DLG[Picker dialog<br/>tabs: rows · stepper+timeline · lines]
        MINI[Chart mini-controls<br/>◀ i/n ▶ · size · All · picker]
        STORE[contract-list-session store<br/>rows · selection · cursor · chunkSize]
        TA[Pair textarea<br/>date,id lines]
        CH[Plotted-set chart<br/>span + per-day dots · +50 session prefix]
    end
    FS[(st-options-contract-lists<br/>{runId}_{symbol})]

    RD -->|nav ?list=docId| CHOOSER
    CHOOSER -->|docId| FS
    FS -->|list rows| STORE
    STORE --> DLG
    STORE --> MINI
    DLG -->|send selected rows| TA
    MINI -->|step chunk| TA
    TA -->|loadPlotted replace| CH
```

## User Stories

1. As a trader, I want "Send to chart" on a replay run's contract list to
   open the chart page with the picker already open over that list, so
   that choosing contracts is one continuous flow — not a copy/paste
   exercise. **Verify:** navigating with `?list={docId}` loads the doc and
   opens the picker dialog populated with its rows.

2. As a trader, I want the first 10 rows pre-selected when the picker
   opens, so that a single Send click produces a reasonable chart without
   touching anything. **Verify:** opening a list shows rows 1–10 checked;
   Send with no further action plots those rows.

3. As a trader, I want to browse recent contract lists from the chart
   page itself, so that reaching the picker doesn't require leaving the
   chart to run a replay. **Verify:** a "Contract lists…" entry lists
   recent list docs (template, symbol, run date, pick count, date range)
   sorted by symbol then newest-first.

4. As a trader, I want the chooser default-filtered to the chart's
   current symbol with a visible toggle, so that the common case is one
   look and cross-symbol browsing stays possible. **Verify:** with QQQ
   loaded the chooser shows QQQ docs by default; the filter widens to all
   symbols without navigating away.

5. As a trader, I want picking a different-symbol list to switch the
   chart's symbol in the same action, so that contracts are never plotted
   against the wrong underlying. **Verify:** choosing a SPY list from a
   QQQ chart loads SPY as the page symbol and opens the picker on the SPY
   rows — one step.

6. As a trader, I want every pick day kept as its own row — repeats
   included — so that "this contract was picked five days running" is
   visible information, not collapsed away. **Verify:** a contractId
   appearing on N pick days produces N rows in the picker and N marker
   dots on the chart.

7. As a trader, I want checkboxes plus mass operations — all / none /
   invert, stride k, random N, date-range, text filter — so that
   selecting a subset is a click or two, not re-typing parameters.
   **Verify:** each op changes the checked set as described; ops compose
   with manual toggles.

8. As a trader, I want a live `N rows selected → M unique contracts`
   readout, so that the chart cost of my selection is always visible
   before I send. **Verify:** the readout updates on every selection
   change; M counts distinct contractIds.

9. As a trader, I want a chunk stepper that pages the ladder in groups of
   X pick days and live-loads each chunk onto the chart as I step, so
   that I can filmstrip the ladder through time — watching each cohort
   enter. **Verify:** stepping `▶` immediately replaces the plotted set
   with that chunk's rows; `i/n` and the chunk's `days · unique` counts
   display.

10. As a trader, I want "add chunk to selection" while stepping, so that
    a persistent set can accumulate from the filmstrip without returning
    to the raw list. **Verify:** adding the current chunk checks its rows
    in the selection; sending afterwards emits all accumulated rows.

11. As a trader, I want chunk `◀ i/n ▶`, chunk size, `All`, and a
    reopen-picker button as mini-controls on the chart page, so that
    paging the ladder after the dialog closes never requires reopening
    it. **Verify:** with a session active, the controls step the same
    cursor the dialog uses; closing and reopening the dialog preserves
    cursor and selection.

12. As a trader, I want an `All` action, so that the whole list can be
    viewed at once when the question is the full ladder, not a subset.
    **Verify:** All selects every row; Send plots every unique contract.

13. As a trader, I want a lines preview tab showing the exact `date,id`
    lines to be emitted — read-only, with a Copy button — so that I can
    sanity-check the payload before it hits the chart. **Verify:** the
    preview contains exactly the lines Send would emit, duplicates
    included, one per selected row.

14. As a trader, I want each plotted contract to show a marker dot at
    every day it was picked plus one span from earliest pick to
    expiration at the strike level, so that entry cadence and hold window
    are both visible on one series. **Verify:** a contract picked on
    d1/d2/d3 renders three dots and a single span d1→expiration on the
    underlying axis at strike.

15. As a trader, I want the chart's underlying to begin ~50 sessions
    before the earliest marker date, so that contracts open in the
    context of the price action that produced them. **Verify:** after a
    dated load, the underlying series starts ~50 sessions before the
    earliest entry; the prefix applies to every list-driven load.

16. As a trader, I want `no-selection` marker days excluded from sends
    and copies, so that gap days never produce broken lines. **Verify:**
    rows without a contractId never appear in emitted lines or the
    preview.

17. As a trader, I want sent lines written into the pair textarea
    verbatim — duplicates preserved — and the plotted set replaced
    through the existing load path, so that the textarea stays the single
    source of truth and round-trips keep all pick dates. **Verify:**
    after send, the textarea holds exactly the emitted lines; reloading
    the page or re-pasting them reproduces the same markers.

18. As a trader, I want clear loading, error, and empty states — missing
    doc, unreadable rows, zero rows — so that a broken list is
    distinguishable from an empty one. **Verify:** each failure mode
    names its cause; an empty list says so explicitly.

## Implementation Decisions

- **Session model:** a dedicated page-scoped store
  (`contract-list-session`) owns `activeList` (docId + raw rows),
  `selection` (checked row set), `chunkCursor`, and `chunkSize`. It is
  source-agnostic — rows are the pick-shape (`ContractListRow`-like);
  replay lists are the first source, pick-doc lists slot in later. The
  existing `option-group-generator` store stays availability-coupled and
  is NOT extended — the emit-to-textarea path is extracted as a shared
  util both stores call.
- **Working set is rows, not contracts** — one row per pick day, no
  dedupe anywhere. Dedup happens only at the chart seam (`loadPlotted`
  keys by contractId) and in the `M unique` readout.
- **Duplicate `date,id` lines are the multi-marker encoding.** The pair
  parser unions repeated contractIds' dates into `pickDates[]` rather
  than merging to earliest — the textarea remains the single source of
  truth and the marker set round-trips.
- **Marker model change:** `PlottedContract.entry.openDate` →
  `pickDates: string[]`. `computeMarkerSpans` emits one marker series per
  contract with vertices at each pick date plus expiration — the existing
  dash-at-strike rendering yields the span + per-day dots for free.
  Span = earliest pick → expiration (grilled: A — dots-per-entry, not
  per-entry spans).
- **`?list={docId}` transport:** the page reads
  `st-options-contract-lists/{docId}` directly (rules already allow
  authed read) and auto-opens the picker (grilled: A). No sessionStorage
  hand-off needed for whole-list sends; subset sends happen inside the
  session, not across navigation.
- **Chooser:** flat recent list docs, sorted symbol asc then run date
  desc, default-filtered to the chart symbol with an in-chooser toggle.
  Cross-symbol selection switches the page symbol — the underlying must
  always match the contracts (decided over filter-only, which forced a
  two-step).
- **Default selection:** first 10 rows checked on open (grilled: C →
  first-10, not stride).
- **Chunking unit:** X pick days (rows) — chunks march through time
  evenly; each chunk's unique-contract count varies (grilled: A). The
  readout shows `days · unique` per chunk.
- **Stepper:** stepping live-drives the chart — each step replaces the
  plotted set with that chunk (grilled: B). "Add chunk to selection"
  accumulates into the persistent selection.
- **Mini-controls:** `◀ i/n ▶ · size · All · picker` — dumb buttons over
  the same session store methods; zero parallel logic.
- **Underlying prefix:** ~50 sessions prepended before the earliest
  marker date on every load that has dated lines (user: "they're all
  going to have marker dates"). "Days" = underlying sessions/bars, not
  calendar days.
- **Form factor:** large `mat-dialog` (modal v1) — the selection surface
  needs screen space a sidenav can't give; the sidenav stays the
  generator's, not the picker's.
- **Lines preview:** read-only + Copy (clipboard stays a convenience —
  Send is the real path; preview's job is pre-send sanity check).
- **`no-selection` rows:** excluded from emitted lines, copy, preview,
  and chunk sends; still displayed in the row list as markers.
- **Seam for testing:** the list-doc read sits behind an injectable
  service (same shape as the replay runs service); selection ops,
  chunking, and line emission are pure functions over rows. The chart's
  series builder is already the pure seam for marker rendering — extend
  its spec coverage to multi-vertex spans.

## Testing Decisions

- Pure-function specs for: row → `date,id` emission (duplicates
  preserved, deterministic order), chunk partitioning by pick days
  (boundary chunks, remainder), stride/random/range/filter selection ops,
  chooser sort (symbol asc, date desc) + symbol filtering, marker-date
  union from duplicate pair lines, +50-session window math.
- Store specs: session load (doc → rows), cursor stepping (wrap/clamp),
  selection ops compose, send → emitted lines match selection,
  reopen preserves state.
- Component specs (TestBed, service-stubbed): dialog tabs and checkbox
  states, stepper live-drive behavior, mini-controls strip wiring,
  `?list=` auto-open + chooser filter/symbol-switch, empty/error states.
- Series-builder specs: multi-vertex marker series (dots per pick date +
  endpoint), span skipped when no dates, reversed-span guard unchanged.
- Prior art: `option-chart-generator.spec.ts`, the existing
  `options-contract-chart-series.builder` specs, `plotted-contracts`
  feature specs for load/replace semantics.

## Out of Scope

- **Multi-source merge** — combining two lists (or a list + availability
  results) into one session. One source at a time in v1.
- **Pick-doc lists as a source** — the chooser's second source group,
  pending the pick-doc surface landing (functions client exists as WIP).
- **Per-entry spans / per-entry P&L** — each pick day is a dot, not its
  own position window; entry-level analysis is a different feature.
- **Editable lines preview** — edits live in the textarea post-send or
  via selection ops; the dialog never forks the source of truth.
- **Non-modal / draggable dialog**, stride/random on the mini-controls
  strip, saved named selections.
- **Left-panel surgery** — retiring old left-drawer content and moving
  the generator drawer left stays under Thread #1325 (grilled: scope A —
  this thread adds only the "Contract lists…" entry point + mini-controls
  on the chart page).
- **The send button itself** — owned by task #1354 under Thread #1240;
  this thread consumes its `?list=` param.

## Technical Context

- **List doc:** `st-options-contract-lists/{runId}_{symbol}` — authed
  read allowed (`firestore.rules`); rows are per-day pick entries with
  contractId, strike, expiration, actual delta, IV, mark, bid/ask,
  volume, OI, underlyingClose, and `no-selection` markers on miss days.
- **Scale:** a year-long run is ~250 rows / ~60–250 unique contracts —
  `All` can push hundreds of mark series + spans onto one Syncfusion
  chart; renderable but visually dense. Judged live, not engineered
  against in v1.
- **Deep-link caveat:** `?list=` opening a dialog means a URL can pop a
  modal — acceptable because the param only arrives from the send action;
  a bare visit to `/options/chart` opens nothing.
- **Pair format:** `YYYY-MM-DD,OCC_ID` lines; duplicate IDs with
  different dates are valid and meaningful (per-day markers). Bare `id`
  lines keep current behavior — no markers, no underlying prefix.
- **Back-compat:** `loadPlotted` replace semantics, chip behavior, and
  the single-contract lower panes are unchanged; `openDate` consumers
  migrate to `pickDates[0]`/earliest semantics.
