**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** ST Anchored VWAP  
**Thread Slug:** st-anchored-vwap  
**Issue:** #902  
**Thread Parent:** #835  
**Topic Parent:** #261  
**Task:** #871  
**Domain:** INDICATOR-LIB  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-08  
**Last Updated:** 2026-10-08  

# UAT — FE: Anchored VWAP indicator in the flex-chart (#871)

## Scope

Task #871 makes the Anchored VWAP visible: **ST Anchored VWAP** appears in the flex-chart sandbox's ST indicator menu, and enabling it draws four lines (small/large retracement scale x high/low) plus history, computed locally from the bars with the default params. The chart always uses a fixed 12 series (4 slots, each with an active series and two alternating history series), so tuning params or loading new data never changes the series structure. It is opt-in only.

Decisions in force (2026-10-08): history is drawn in the same colour and width as the active line (no fading); there is no `historyStart` param or date picker; Anchored VWAP is sandbox-only (it is deliberately not in the signal-detail menu).

Covers Task #871 acceptance criteria, the FE Implementation Plan (modules 3 and 4) and PRD user stories 3 to 7 and 9 to 11 on the rendering side. Param controls (T4) are out of scope here.

## Prerequisites

- Repo `C:\aa\projects\rel-str`, branch `prod`, dependencies installed (`npm install`).
- The #871 files are present (uncommitted is fine).
- For the browser scenarios: the dev server running (`npm start`) and a signed-in user; `/dev/flex-chart` sits behind the auth guard. Real mode needs a symbol with a few years of daily bars (for example `AAPL`); synthetic mode needs no data.
- No secrets, feature flags or seed data beyond that.

## Start instructions

Automated scenarios: run the commands from the repo root in PowerShell. Scenario A8 temporarily edits two source files and restores them; do not run it while other edits to those files are in flight.

Browser scenarios: `npm start`, then open `http://localhost:4200/dev/flex-chart`.

## Automated scenarios

### A1. Definition and fixed-slot series builder

- **Command:** `npx jest st-anchored-vwap.indicator`
- **Expected:** all pass: identity and every param default; always the same 12 keys in the same order (empty bars, flat series, hand-built fixture, random walk); alternation between the two history series; no two points at one index; one null break between packed segments and never leading or trailing; every chunk equals an engine segment's points; large thicker than small; history identical to the active line; default and custom colours; names; param clamping and defaults.
- **Result:** PASS — 1 suite, 28/28 (2026-10-08).

### A2. Registry wiring and opt-in only

- **Command:** `npx jest indicator-registry base-indicators`
- **Expected:** the indicator is in `ST_INDICATOR_OPTIONS` exactly once; `buildDefaultConfig` gives a valid overlay line config; `computeIndicators` tolerates it having no calculator; none of the daily, weekly or monthly base sets include it; `buildConfigForId` resolves it.
- **Result:** PASS — 2 suites, 8/8 (2026-10-08).

### A3. Adapter series

- **Command:** `npx jest chart-data-adapter`
- **Expected:** all pass, including: `[]` with no config, no data or no bars; works with no ZigZag; same 12 keys whatever the data or params; only the first AVWAP config used; log-space prices with null breaks preserved; vocabulary colours remapped per theme, custom colours untouched.
- **Result:** PASS — 1 suite, 42/42 (2026-10-08).

### A4. Chart component and consumers

- **Command:** `npx jest flex-chart signal-detail flex-chart-sandbox`
- **Expected:** all pass (these compile the chart template and cover the sandbox and signal-detail).
- **Result:** PASS — 21 suites, 346/346 (2026-10-08).

### A5. Engine and ZigZag underneath are unchanged

- **Command:** `npx jest st-anchored-vwap.engine st-anchored-vwap.invariants st-zigzag`
- **Expected:** all pass.
- **Result:** PASS — 9 suites, 150/150 (2026-10-08).

### A6. Type safety

- **Command:** `npx tsc -p tsconfig.app.json --noEmit` and `npx tsc -p tsconfig.spec.json --noEmit`
- **Expected:** no errors.
- **Result:** PASS — 0 errors in both (2026-10-08).

### A7. Production-mode template compile

- **Command:** `npx ng build --configuration development --output-path .devin/tmp/ng-build-out`, then delete that folder.
- **Expected:** exit code 0. Jest compiles templates in JIT mode; this is the ahead-of-time compile with strict template type checking, which covers the new `@for` and the exclusion condition.
- **Result:** PASS — exit 0 in 17 s (2026-10-08).

### A8. The tests are not vacuous — deliberate breakages (temporary edits)

- **Steps:** one at a time, edit the indicator or adapter source, run `npx jest st-anchored-vwap.indicator chart-data-adapter`, restore. Edits: history-b receives history-a's segments; remove the null separator between packed segments; push null points through the log transform; do not theme colours; render every AVWAP config instead of the first.
- **Expected:** each edit fails at least one test; restored files pass 70/70.
- **Result:** PASS (2026-10-08). Failing tests per breakage: history-b duplicates 6; no null break 3; null through log 1; colours not themed 1; all configs rendered 1. Both files restored byte-identical (verified); 70/70 after restore.

### A9. Full repository test suite

- **Command:** `npx jest --coverage=false`
- **Expected:** all pass.
- **Result:** PASS (scoped to this task) — 203 of 204 suites, 3,197 of 3,198 tests. The single failure is the stale `PositionType` assertion in `shared/screenshot-capture-contracts.spec.ts` (screenshot thread; unchanged since #869 and ruled out of scope by the user). Note: one earlier full run during this QA showed 17 failing suites; that was another thread editing the flex-chart sandbox, signal-detail and registry files at the same moment (a type error in `flex-chart-sandbox.component.spec.ts` from an in-progress edit), and it cleared when those edits settled — type-checks were clean again and the re-run is the result recorded here.

## Browser scenarios (need a person with the running app)

### M1. Enable it with ST ZigZag off

- **Confirms:** the indicator appears in the menu and renders without the ZigZag indicator.
- **Steps:** open `/dev/flex-chart`; load `AAPL` (or switch to synthetic data); make sure **ST ZigZag** is not enabled; open the indicator picker and tick **ST Anchored VWAP**.
- **Expected:** magenta lines (high anchors) and cyan lines (low anchors) appear on the price pane for two scales; the large-scale lines are visibly thicker than the small-scale ones; older segments of each line are visible as well as the live one.
- **Result:** PASS — user-confirmed 2026-10-08 (scenarios M1 to M6).

### M2. Gaps between history segments

- **Confirms:** the packed history segments do not join across gaps (the null break points work for Line series).
- **Steps:** with the indicator on, zoom to a stretch with several same-colour segments.
- **Expected:** each segment is a separate piece; no diagonal connector joins the end of one segment to the start of a later one of the same colour.
- **Note:** Syncfusion's source marks a null-y point empty and, in Gap mode, restarts the path at the next visible point; this scenario is the visual confirmation.
- **Result:** PASS — user-confirmed 2026-10-08 (scenarios M1 to M6).

### M3. No back-attachment, handoff on the confirmation bar

- **Confirms:** the product semantics, visible on the chart.
- **Steps:** pick one segment; find its pivot (the swing high or low it anchors on; it helps to compare with ST ZigZag temporarily).
- **Expected:** the line starts a few bars after the pivot (about the right-depth, 5 bars by default), never at the pivot bar; when a new same-side line begins, the previous one runs through that same bar and stops there.
- **Result:** PASS — user-confirmed 2026-10-08 (scenarios M1 to M6).

### M4. Robustness

- **Steps:** toggle the indicator off and on; switch Daily, Weekly and Monthly; toggle log scale; change symbol; try synthetic data presets.
- **Expected:** no console errors; no stale or stuck lines after any change; the lines recompute for each dataset.
- **Result:** PASS — user-confirmed 2026-10-08 (scenarios M1 to M6).

### M5. Legibility and tooltips

- **Steps:** look at the lines over the candles in the default dark theme; hover a line.
- **Expected:** lines read clearly without hiding the candles; the tooltip names look like `AVWAP-H 2%`, `AVWAP-L 5%`.
- **Result:** PASS — user-confirmed 2026-10-08 (scenarios M1 to M6).

### M6. Opt-in only; not in other surfaces

- **Steps:** open quick-charts, the gallery, and a signal-detail chart; open the signal-detail indicator menu.
- **Expected:** none show Anchored VWAP lines by default, and the signal-detail menu does not offer it (Trigger Bands is there; AVWAP is sandbox-only by design).
- **Result:** PASS — user-confirmed 2026-10-08 (scenarios M1 to M6).

## Negative / edge scenarios

Covered by A1 and A3 rather than by manual steps: empty bars; a flat series with no pivots; only one side having pivots; out-of-range and non-numeric params; `maxHistory` of 0; a second AVWAP config; log scale with null breaks; custom and vocabulary colours.

## Traceability

| Task #871 acceptance criterion | Scenario |
|---|---|
| Enum member; definition with every param and default | A1 |
| Registered in the menu and series-type map; nothing auto-enables it | A2 |
| `buildDefaultConfig` valid; `BASE_CONFIGS` module load does not throw | A2 |
| Builder: 12 series always; alternation; unique indices; null separators | A1, A8 |
| History matches active; large thicker; hue encodes side (no fading) | A1, M1, M5 |
| Adapter: themed, mapped y, null breaks kept, `[]` without a config | A3, A8 |
| Template renders the 12 series with Gap; generic loop excludes it | A7, M1, M2 |
| `computeIndicators` and the legend tolerate no calculator | A2 |
| Enabling it in the sandbox shows four lines plus history; works without ZigZag | A3, M1, M3 |
| Indicator, registry and adapter tests pass | A1 to A5 |
| (Regression) engine, ZigZag, consumers, build, repo | A4 to A7, A9 |

## Regression / smoke checklist

- [x] Related suites green (A1 to A5)
- [x] Typecheck and production-mode template compile clean (A6, A7)
- [x] Repo suite has no failure attributable to this task (A9)
- [x] Mutation edits restored byte-identical (A8)
- [ ] Browser: lines render, gaps work, semantics correct (M1 to M3)
- [ ] Browser: robustness, legibility, opt-in only (M4 to M6)

## Verdict

**Complete** — all automated scenarios (A1 to A9) pass; the six browser scenarios M1 to M6 pass as user-confirmed on 2026-10-08, including the gaps-between-segments check (no diagonal joins) and the start-on-confirmation-bar check. The only repo-suite failure remains the unrelated, pre-existing screenshot `PositionType` assertion.

**Result: PASS**
