**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Signal Selection  
**Thread Slug:** signal-selection  
**Issue:** #1740  
**Thread Parent:** #1117  
**Topic Parent:** #553  
**Task:** #1655  
**Domain:** PAPER-TRADING  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-25  
**Last Updated:** 2026-11-26  

# UAT — #1655 FE-IMPL: chart + signal markers on /signals/symbol-review (Phase 3)

## Scope

Phase 3 of the `/signals/symbol-review` pane (Thread #1117 — Signal
Selection): the right pane now renders chart-view's chart stack for the
selected symbol with a dot marker at every occurrence's signal bar
(close price). Checked rows plot solid; unchecked rows plot ghost-dimmed
(the IBS-suppressed alpha convention). V1/V2 signal families reuse the
uptick-dot palette; other types fall back to the plain signal-dot hues.
Toggling a row re-shades its dot. Signals older than the loaded bar
range simply don't dot — the list still shows them.

Task acceptance criteria:
1. Chart-view's chart component/bar-load path reused on the page (no
   new chart machinery).
2. Every bundle occurrence → marker on the chart (unchecked visible
   too — the pane exists to see them).
3. Checked vs unchecked markers visually distinguished.
4. Occurrences older than the cached bar range don't plot — the list
   still renders them.
5. (Deferred) Row↔marker hover/click affordance — spec's "if cheap"
   clause; needs flex-chart click plumbing, not shipped.
6. Component + marker specs per TEST-FE; `npx jest` + `tsc --noEmit`
   green.

Review-round fixes this UAT also confirms:
- **Stale-symbol bars:** markers are keyed to BOTH the bundle and the
  loaded chart dataset by symbol — during a symbol switch the new
  bundle can never plot at the previous symbol's closes (S6).
- Markers are injected on the daily indicator stack only (the two-day
  interval is unreachable here — the toolbar is suppressed).

## Prerequisites

- The dev server is running (`npm run start`) — app builds clean.
- Normal signed-in session.
- At least one queue symbol with recent occurrences — **AAPL** is the
  known-good example (V1 + V2 rows, incl. the 2026-10-12 `V1 LONG`
  INTERIM row and the 2026-11-09 `V2 LONG` row exercised in #1654's
  UAT).
- **Ledger side-effect warning (carried from #1654):** checking a row
  mints a REAL PaperTrade and unchecking hard-deletes it. S4 toggles a
  row — restore it to its prior state afterward.

## Getting to the feature

- **Route:** `/signals/symbol-review`
- **Entry point:** left nav → **Signals** section → **Symbol Review**
  (between "Signal Review" and "Chart View")
- **Surface:** three-pane shell — 220px symbol picker on the left, the
  occurrence list in the middle, and the **chart on the right** (the
  chart is this task's new surface).

## Automated evidence (executed this session)

- Focused jest: **88/88** — `signal-marker-converters.spec` (6),
  `base-indicators.spec` (+4), `signal-detail.component.spec` (+3),
  `symbol-review.component.spec` (+12)
- Full suite: **6,770/6,770** green (342 suites)
- `tsc --noEmit` — 0 errors on all touched files (2 pre-existing foreign
  errors in `scripts/bulk-swing-sweep.ts` +
  `portfolio-dashboard.store.spec.ts` — other sessions' uncommitted
  work, untouched)
- Review-fixed seams pinned by specs: stale-symbol bars guard ("does not
  plot against the previous symbol's bars while the new fetch is in
  flight"), stale-bundle guard, ghost-alpha colors, bar-miss → no point.

## Scenarios

### S1 — Chart renders on symbol select

**Confirms:** AC1 — chart-view's stack reused; no interaction needed
beyond selecting a symbol.

- Steps: open `/signals/symbol-review`; click **AAPL** in the picker.
- Expected: the right pane fills with the daily chart — candle/line
  series for AAPL's loaded history, legend strip, and scrubber — the
  same chart anatomy as Chart View. No interval toolbar above it.
- Result/evidence: ☐ PASS ☐ FAIL ☐ BLOCKED

### S2 — Occurrence dots at signal-bar closes

**Confirms:** AC2 — every occurrence produces a dot (unchecked ones
visible too), positioned at the signal bar.

- Steps: on AAPL, look at the chart around the occurrence dates in the
  list (e.g. **2026-11-09 V2 LONG**). Scrub/zoom to those dates.
- Expected: a small dot per listed row whose date is inside the loaded
  range — positioned the way all price-pane signal dots are: **longs
  below the bar, shorts above it** (2.5×ATR clearance — never inside
  the candle). V2-family dots use the V2 uptick hues, V1 the V1 hues
  (longs green-family, shorts red-family).
- Result/evidence: ☐ PASS ☐ FAIL ☐ BLOCKED

### S3 — Checked vs unchecked distinction

**Confirms:** AC3 — solid vs ghost.

- Steps: compare a checked row's dot with an unchecked row's dot (the
  list shows which is which — checked rows are tinted).
- Expected: the checked row's dot is fully saturated; the unchecked
  row's dot is the same hue but visibly dimmed/translucent — same
  treatment suppressed IBS dots get on Chart View.
- Result/evidence: ☐ PASS ☐ FAIL ☐ BLOCKED

### S4 — Toggle flips the dot

**Confirms:** AC3 live — `patchRow` → markers recompute.

- Steps: toggle an unchecked row's checkbox. When the mint confirms
  (box lands checked — may take a second), look at that bar's dot.
  Then restore the row to its original state.
- Expected: the dot flips ghost → solid when the toggle confirms, and
  back on restore. No page reload, no chart reload — the marker layer
  updates in place.
- Result/evidence: ☐ PASS ☐ FAIL ☐ BLOCKED

### S5 — Older-than-cache signals don't dot (conditional)

**Confirms:** AC4 — documented behavior, not an error.

- Only arm if the selected symbol has occurrences older than the
  chart's loaded range (visible in the list but before the chart's
  first bar).
- Expected: no dot for those rows; the list still renders them fully;
  no error or empty-marker weirdness.
- If no such rows exist on any queue symbol: record N/A (spec-pinned —
  "signal-bar miss → no point").
- Result/evidence: ☐ PASS ☐ FAIL ☐ BLOCKED ☐ N/A

### S6 — Symbol switch leaves no stale dots (review fix)

**Confirms:** review major #2 — markers keyed to both bundle and bar
dataset by symbol.

- Steps: with AAPL loaded (dots visible), click a different queue
  symbol — e.g. **MSFT** if present, otherwise any symbol with
  occurrences. Watch the chart during the transition.
- Expected: AAPL's dots never linger against MSFT's bars, and the
  incoming bundle never plots at AAPL's closes. During the fetch gap
  the chart may clear or hold its own loading state — but no
  wrong-symbol dots, even transiently. When the new data lands, only
  the new symbol's dots appear.
- Result/evidence: ☐ PASS ☐ FAIL ☐ BLOCKED

### S7 — Toolbar suppressed; scrub/legend still work

**Confirms:** AC1 detail — `showToolbar=false`, the rest of the chart
stack intact.

- Steps: on the review chart, confirm there is no interval/toolbar row
  above it (unlike Chart View). Scrub across the price series; toggle
  a legend entry if present.
- Expected: no toolbar; crosshair/scrub values update; legend toggles
  series normally.
- Result/evidence: ☐ PASS ☐ FAIL ☐ BLOCKED

### S8 — Neighbors unaffected

**Confirms:** regression — `SignalDetailComponent` is shared; the new
`reviewMarkers` input defaults empty so **Chart View is unchanged**.
Occurrence list + picker behavior from #1653/#1654 intact.

- Steps: open **Chart View** (`/signals/chart-view`) — the same chart
  component — confirm the normal toolbar IS present there and the chart
  behaves as before (no stray occurrence dots). Back on Symbol Review,
  confirm the picker dot still clears on open and the occurrence list /
  divider behave per #1654's UAT.
- Expected: Chart View identical to before this task; the two panes
  beside the chart unchanged.
- Result/evidence: ☐ PASS ☐ FAIL ☐ BLOCKED

## Manual UI/UX refinement pass

- Three-pane layout at typical widths — chart legible beside the list;
  no pane crushing at laptop width; narrow-window behavior degrades
  sanely.
- Dot legibility — ghost dots distinguishable from solid at a glance;
  dots don't collide unreadably on signal-dense stretches.
- Loading state — chart area while bundle/bars fetch (blank vs spinner
  vs stale frame) reads intentional.
- **Result:** ☐ PASS ☐ FAIL — {notes}

## Findings

User-driven pass surfaced four out-of-scope improvements — consolidated
into two follow-up tasks, not gate blockers:

- #1751 — FE-IMPL: symbol-review pane UX — picker collapse + filter/sort
  + marker hover (under #1648; folds in former #1752/#1753 — the hover
  leg revives the deferred AC5 seam)
- #1754 — BUG: daily-signal confirmed-vs-interim lifecycle (under
  #1647) — old-date INTERIM docs can't mint; today's INTERIMs lack
  `indicators.ibs`

**F1 — dot placement inside candles (fixed in-gate 2026-11-25):** the
converter plotted dots at the signal bar's *close* — copied from the
dead `uptickDotsFromHistory` prior art — so dots rendered inside candle
bodies and were unreadable ("undetectable"). Fixed to the live
convention: longs at `low − 2.5×ATR(14)`, shorts at `high + 2.5×ATR(14)`
via a shared `signalDotY` helper; `computeATR`/`ATR_OFFSET_MULT` now
exported from `st-trend-rider-dots.indicator.ts` (single source — the
dead function was realigned too). Specs pin long→325/short→385 on a
real-range fixture.

**F2 — review markers coincident with zone dots (fixed in-gate
2026-11-25):** F1's own fix made every review marker share the zone
dots' exact `2.5×ATR` position *and* family hue — a persisted
occurrence nearly always corresponds to a computed zone-dot candidate
on the same bar, so the ghost-alpha unchecked marker sat literally on
top of an opaque same-hue zone dot. Checked-vs-unchecked (AC3, S3) was
imperceptible and the toggle's dot flip (S4) invisible even though the
`reviewMarkers` computed → `dailyIndicators` → `addReviewMarkers`
re-render path is sound. Fixed via a dedicated outer band: review dots
now render at `REVIEW_DOT_ATR_MULT = 2 × ATR_OFFSET_MULT` (longs
`low − 5×ATR`, shorts `high + 5×ATR`) — separable from the detector
layer, never occluded. Specs pin long→300/short→410. **Re-verify S3/S4
after refresh** — if a checkbox snaps back or a row error shows, that
is a separate defect (mint/delete failure), not this one.

**F3 — toolbar absence is a requirements change, not a defect (S7):**
the pane spec strips the chart toolbar; the user wants the full
toolbar on this surface. Folded into #1751 as a new AC.

**F4 — ghost treatment rejected; two-series overlay confusing
(fixed in-gate 2026-11-25):** the user never wanted the ghost-alpha
unchecked treatment ("impossible to see them") and finds two dot
series confusing. In-gate: unchecked review dots now render solid
neutral gray (`#9e9e9e`) — checked keep the family hue; the
`ST_SUPPRESSED_DOT_COLORS` path is gone. The deeper resolution (one
dot series total) is architectural — see F5.

**F5 — pane re-sourced from computed output (requirements change,
filed):** the list should enumerate the cloud function's computed
signal candidates over the full bar history — not persisted
`st-signals` docs. Filed as #1759 (drops the `reviewMarkers` overlay
entirely → single solid dot series; checked = minted-trade join).
This supersedes the doc-depth problem outright — #1757 closed.

**F6 — ATR dot placement rejected (filed):** varying per-bar distance
is "incomprehensible"; user wants fixed distance above/below the ST
StdDev band centerline — a new flex-chart placement mechanism. Filed
as #1760. The in-gate 5×ATR outer band stands until it lands.

**F7 — snap-to-bar cursor + row highlight (filed):** #1761 — snaps
the cursor to bars and highlights the list row(s) for the bar's
signals; supersedes the #1751 marker-hover AC (kept as fallback).

## Traceability

| AC | Scenario |
|----|----------|
| AC1 chart stack reused | S1, S7, S8 |
| AC2 all occurrences → markers | S2 |
| AC3 checked vs unchecked visual | S3, S4 |
| AC4 older-than-cache no-dot | S5 |
| AC5 row↔marker affordance | deferred — not shipped |
| AC6 specs + suite green | Automated evidence |
| Review fix (stale-symbol bars) | S6 |
| Review fix (typed bar lookup) | S2 (indirect — any miss is silent) |

## Regression / smoke

- `/signals/chart-view` — shared component unchanged (S8).
- `/signals/symbol-review` picker + occurrence list — #1653/#1654
  behavior intact (S8).
- `/signals/review` + `/trading/paper` — untouched by this task; spot
  check during S8's navigation.

## Results log

| Date | Scenario | Result | Evidence |
|------|----------|--------|----------|
| 2026-11-25 | S1 chart renders on select | PASS | user drive, AAPL |
| 2026-11-25 | S2 markers at occurrences | PASS | post-F1 dots below/above bars |
| 2026-11-25 | S3 checked vs unchecked | PASS | F2+F4 fixed — gray unchecked dots visible on outer band ("the grey dots appear") |
| 2026-11-25 | S4 toggle flips the dot | PASS | F2/F4 fixed — flip now visible on the outer band |
| 2026-11-25 | S5 older-than-cache | N/A | all AAPL occurrences in-range; AC4 is the documented contract |
| 2026-11-25 | S6 no cross-symbol linger | PASS | user drive |
| 2026-11-25 | S7 toolbar suppressed | requirements change | F3 → #1751 toolbar AC; pane works as specced |
| 2026-11-25 | S8 regression nav | PASS | user drive |
| 2026-11-25 | Refinement pass | PASS | "overall it looks good" |
| 2026-11-25 | Automated gates | PASS | 65/65 focused, suite green, tsc clean |
