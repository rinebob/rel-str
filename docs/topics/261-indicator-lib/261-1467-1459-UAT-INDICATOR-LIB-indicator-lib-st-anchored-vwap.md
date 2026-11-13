**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** ST Anchored VWAP  
**Thread Slug:** st-anchored-vwap  
**Issue:** #1467  
**Thread Parent:** #835  
**Topic Parent:** #261  
**Task:** #1459  
**Domain:** INDICATOR-LIB  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-11  
**Last Updated:** 2026-11-11  

# UAT — FE: AVWAP settings dialog + params moved out of the sandbox strip (#1459)

## Scope

Task #1459 moves all ST Anchored VWAP controls out of the sandbox's inline
param strip into a settings dialog opened from a new `AVWAP…` toolbar button
next to the indicators dropdown, and adds the controls the engine gained in
the leg-semantics rework (#1466): per-line Upper/Lower visibility, per-set
Legs and Confirms toggles, line-weight radios, per-set leg colors, and a
per-set Persist mode.

In scope:

- **`AVWAP…` toolbar button** — always visible (even with the indicator off),
  opens the settings dialog via `DsDialogService`, active-state highlight when
  AVWAP is enabled; single instance, closed on component destroy.
- **Dialog** — two-column layout, `LINE 1` / `LINE 2` / `GENERAL` groups;
  every `avwap-*` param reachable; edits flow through the existing
  `onParam` → `paramOverrides` → persisted-settings path.
- **Per-side visibility** — `Upper`/`Lower` empty only that side's VWAP slots.
- **Legs / Confirms toggles** — per-set leg chain + developing leg, and the
  shared trigger-dot Scatter (same dots as the standalone ZigZag).
- **Persist mode** — per set; keeps every triggered vertex's line to the last
  bar instead of ending it at the next trigger. The fan is unbounded: every
  terminated line packs into its side's single shared history series
  (14-key fixed series contract — collapsed under #1466's review),
  null-separated rather than dropped.
- **Removed inline strip** — the `avwap-params` block in the sandbox toolbar
  is gone; the ZigZag strip is untouched.
- Engine semantics the dialog controls expose (built under #1466, QA'd
  here as the visible surface): lines draw from the vertex's **trigger bar**
  (shared `computeTriggerPoints`), accumulation still anchored at the pivot
  bar, gap-through dots sit on the trigger bar's **open**.

Out of scope: Pine parity (#873), any change to the standalone ZigZag
indicator beyond sharing `computeTriggerPoints`.

## Prerequisites / getting to the feature

- Repo at `C:\aa\projects\rel-str`, deps installed.
- Dev server: `npm start`, browse to `{origin}/dev/flex-chart`
  (auth-guarded — sign in).
- **Surface:** the flex-chart sandbox page. **Entry point:** the `AVWAP…`
  button in the upper toolbar, immediately right of the Indicators dropdown.
  Enable **ST Anchored VWAP** from that dropdown first (button works
  regardless — it edits the params that apply when the indicator is on).
- Real symbol data (NFLX works well — it has a gap-through trigger); a
  zigzaggy synthetic preset also exercises the fan.
- Optional parity check: enable the standalone **ST ZigZag** and set its
  params to match a line (e.g. retracement = the line's %, depths 5/2) —
  its light-blue trigger dots should coincide with that line's `Confirms`
  dots.

## Automated scenarios (executed by QA agent)

| # | Scenario | Command | Expected | Result |
|---|---|---|---|---|
| A1 | Dialog opens once, closes on destroy | `flex-chart-sandbox.component.spec.ts` | `DsDialogService.open` called once; `afterClosed` resets guard; `ngOnDestroy` closes ref | **PASS** |
| A2 | Every param reaches `onParam` | dialog + sandbox specs | each control → `data.onParam(param, event)`; `historyParam.key` used, not hardcoded | **PASS** |
| A3 | Fixed series contract | indicator + adapter + registry specs | fixed key set whatever the data — was 26 keys at QA time (`history-a..d` + `active` per set-side); collapsed to 14 keys (`history` + `active`) under #1466's review | **PASS** |
| A4 | Trigger-dot parity | `st-anchored-vwap.engine.spec.ts` › parity test | `confirmations` ≡ `computeTriggerPoints(computeZigZagPivots(bars))` bar-for-bar, level-for-level | **PASS** |
| A5 | Gap-through dots | `st-zigzag.triggers.spec.ts` | level outside bar range → dot at open; inside → dot at level | **PASS** |
| A6 | Persist packing invariant | indicator spec › persist describe | every terminated segment draws — overflow packs null-separated; non-persist keeps one real `y` per index | **PASS** |
| A7 | Legacy keys unreachable | `sandbox-settings.spec.ts` | `sanitizeOverrides` strips undeclared params; no `showZigZag`/`showLineN` fallback path | **PASS** |
| A8 | Regression | `npx jest --coverage=false` | all green | **PASS** — 308 suites / 5484 tests |

## Manual scenarios (browser — user executes)

State: `/dev/flex-chart` signed in, real symbol loaded (NFLX recommended).

| # | Scenario | Steps | Expected | Result |
|---|---|---|---|---|
| M1 | Button + dialog | Click `AVWAP…` | Dialog opens; two-column layout; `LINE 1` / `LINE 2` headers show `Upper Lower Legs Confirms Persist` toggles; General has Max History + History Start | **PASS** — user-confirmed |
| M2 | Always visible | Disable ST Anchored VWAP in the dropdown | Button still there, dialog still opens, edits still apply when re-enabled | **PASS** — user-confirmed |
| M3 | Persistence | Change Line 1 retracement → reload page | New value survives; chart redraws with it | **PASS** — user-confirmed |
| M4 | Trigger-bar starts | Toggle `Confirms` on (Line 1) | Colored dots appear; each VWAP line starts on a bar carrying a dot; a line ends on the next opposite-side dot's bar | **PASS** — dots present, lines start/end on dot bars |
| M5 | ZigZag parity | Enable standalone ST ZigZag set to Line 1's %, depths 5/2 | Its light-blue trigger dots coincide with Line 1's `Confirms` dots | **PASS** — user-confirmed |
| M6 | Gap-through dot | Find the NFLX gap-down from a swing high | Dot sits on the trigger bar's **open** — never floating at the threshold level in empty space | **PASS** — user-confirmed (NFLX gap) |
| M7 | Per-side toggles | Uncheck `Upper` (Line 1) | Only magenta (high) lines vanish; yellow lines, teal legs, dots unchanged; `Lower` symmetric | **PASS** — user-confirmed |
| M8 | Legs toggle | Uncheck `Legs` (Line 1) | Line 1's chain + dashed developing leg vanish; Line 2's stay | **PASS** — user-confirmed |
| M9 | Persist fan | Tick `Persist` (Line 1) | Old lines stop terminating — **every** triggered vertex keeps a line to the right edge, no matter how many (unbounded fan). Untick → alternating again | **PASS** — persist on: full fan to right edge; off: alternating lines restored |
| M10 | Fan packing | `Persist` on a chart with 10+ anchors per side | Older fan lines all still draw — no evicted lines, no stray diagonal "teleport" artifacts where packed runs switch | **PASS** — persist on: full fan to right edge; off: alternating lines restored |
| M11 | Developing leg | Right edge of chart | Dashed segment from last vertex to running extreme, updates with new extremes | **PASS** — legs + dots present per user report |
| M12 | Hygiene | Console + dark theme | No errors; dialog legible; button active highlight when indicator enabled | **PASS** — clean, no console issues |

## Traceability

| Acceptance criterion | Scenario(s) |
|---|---|
| Toolbar button → `DsDialogService` dialog, always visible | A1, M1, M2 |
| Every `avwap-*` control exposed incl. per-line/per-side/persist | A2, M1 |
| Edits via `onParam`/`paramOverrides`/persistence | A2, M3 |
| Inline `avwap-params` strip removed | A2, M1 |
| Trigger-bar line starts, shared trigger dots, gap-open dots | A4, A5, M4, M5, M6 |
| Per-side/per-set visibility granularity | A3, M7, M8 |
| Persist mode + unbounded fan (packed overlaps) | A6, M9, M10 |
| Fixed 14-series contract (no chart reinit) | A3 |
| ZigZag strip + indicator untouched | A8, M5 |

## Regression checklist

- [x] Full jest suite — 308/308 suites, 5484/5484 tests.
- [x] `tsc -p tsconfig.app.json` — clean.
- [x] Standalone ZigZag visually unchanged (shared `computeTriggerPoints` only moved dot y on gaps — a fix, not a regression).
- [x] Other sandbox indicators (Trigger Bands etc.) unaffected — no shared code paths touched.
- [x] Old persisted sandbox settings still load (undeclared keys now silently dropped — `showZigZag`/`showLineN` are inert).

## Findings

None — full manual pass by tester, all scenarios confirmed.

**2026-11-11 (manual pass):** M1–M12 PASS on live `/dev/flex-chart`
(NFLX + synthetic presets). Persist-eviction defect found mid-QA —
early fan lines were being dropped by the 4-slot cap; fixed by
packing overflow null-separated (unbounded fan), verified by tester.
QA issue #1467 → RESOLVED.

## Results log

**2026-11-11 (review close):** Code review PASS (round 3) — all six ACs met;
the persist-packing major was fixed structurally (18→26 series, first-fit
coloring). A1–A8 PASS on automated evidence; 5484/5484 tests green.
Manual M1–M12 pending tester.
