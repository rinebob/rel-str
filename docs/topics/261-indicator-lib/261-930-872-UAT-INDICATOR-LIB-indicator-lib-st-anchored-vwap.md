**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** ST Anchored VWAP  
**Thread Slug:** st-anchored-vwap  
**Issue:** #930  
**Thread Parent:** #835  
**Topic Parent:** #261  
**Task:** #872  
**Domain:** INDICATOR-LIB  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-08  
**Last Updated:** 2026-10-08  

# UAT — FE: Sandbox controls for ST Anchored VWAP params (incl. historyStart date picker) (#872)

## Scope

Task #872 surfaces the ST Anchored VWAP indicator's parameters in the flex-chart sandbox (`/dev/flex-chart`) and adds the `historyStart` era-window param end to end: a new param on the indicator definition, an `input` discriminator on `IndicatorParamDef`, a calendar-date history filter in the engine, and a `mat-datepicker`-backed control in the sandbox. Sandbox-only — no shared settings UI.

In scope:
- Ten editable params: small/large retracement %, left/right depth, max history, four colors, `historyStart`.
- Override semantics: controls write sandbox-local overrides merged over declared defaults; emptying a control reverts that param to its default; overrides persist across disable → enable.
- `historyStart` contract: ISO `YYYY-MM-DD` string, compared against each pivot bar's session `date` (never `x`'s epoch); inclusive boundary; invalid ≡ unset; era mode keeps the **first** `maxHistory` eligible segments (cap eats the recent end); unset keeps the **most recent** `maxHistory`.
- `mat-datepicker` + visible ISO text input + clear (×) button.

Out of scope: production (non-sandbox) parameter UI; the Pine prototype (tracked by #873).

## Prerequisites

- Repo at `C:\aa\projects\rel-str`, Node/npm installed, deps installed (`npm ci` if needed).
- Dev server running: `npm start` (port varies; the session prints the URL — e.g. `http://127.0.0.1:58739`).
- The sandbox route `/dev/flex-chart` is auth-guarded — the tester must be signed in.
- No credentials, seed data, or feature flags needed beyond sign-in; the sandbox can run on synthetic data.

## Start instructions

1. `npm start`, then browse to `{origin}/dev/flex-chart`.
2. In the indicator picker (header), enable **ST Anchored VWAP**.
3. The `AVWAP` params row appears directly under the header, before the debug readout.

## Automated scenarios (executed by QA agent)

| # | Scenario | Command | Expected | Result |
|---|---|---|---|---|
| A1 | Param declared | `st-anchored-vwap.indicator.spec.ts` › defaults test | `params` includes `historyStart` with default `''`, `input: 'date'` | **PASS** — spec asserts `historyStart: ''` in defaults; suite green |
| A2 | Calendar-date filter, inclusive boundary | engine + indicator specs › history-window describes | `bars[pivotBar].date >= historyStart`; a boundary-date anchor is kept | **PASS** — `historyStart: '2026-01-16'` keeps the pivot@15 segment; `dateOf(10)` keeps `[10, 15]` |
| A3 | Session-date, not epoch | engine spec › "filters on the pivot's session date, never the epoch of x" | window identical when every `x` is pushed to 2030 | **PASS** — regression test green |
| A4 | Invalid/unset handling | engine + indicator specs › `it.each` | `'banana'`, `'2026-13-40'`, `''` all ≡ unset | **PASS** — `it.each` green in both specs |
| A5 | Actives never pruned | engine spec › history-window describe | active segments present in both window modes | **PASS** — actives asserted with `maxHistory` 0/1 and post-era `historyStart` |
| A6 | Override merge & empty-revert | sandbox spec › AVWAP params describe | overrides merge on defaults; emptying a numeric control deletes the override (not `0`); cleared date unsets | **PASS** — sandbox spec green (29 tests); caught the `Number('') === 0` bug pre-merge |
| A7 | Panel gating & persistence | sandbox spec | panel only when enabled; overrides survive disable → enable | **PASS** |
| A8 | Datepicker wiring | sandbox spec | anchor bound to `MatDatepickerInput._datepicker`; `dateChange` commits local `YYYY-MM-DD`; `[value]` reflects typed ISO | **PASS** |
| A9 | Shared helper | `date.util.spec.ts` | `parseIsoDateLocal` accepts canonical/leap dates, rejects rollovers ('2026-02-31'), unpadded, junk | **PASS** — 12 tests |
| A10 | Types & AOT | `tsc -p tsconfig.app.json`, `-p tsconfig.spec.json`, `ng build --configuration development` | 0 errors; build succeeds (covers new template bindings) | **PASS** — all three clean post-remediation |
| A11 | Regression | `npx jest` full suite | no failures attributable to #872 | **PASS (scoped)** — 3,259 pass / 5 fail in 2 suites, both other threads' uncommitted WIP: stale `PositionType` pin in `shared/screenshot-capture-contracts.spec.ts` (vs another thread's `paper-trading-contracts.ts` edit) and `order-execution.service.spec.ts` vs `order-execution.service.ts` signature mismatch (that thread's files dirty in tree) |

## Manual scenarios (browser — user executes)

State: sandbox open at `/dev/flex-chart`, signed in, any data source loaded.

| # | Scenario | Steps | Expected | Result |
|---|---|---|---|---|
| M1 | Panel visibility | Enable ST Anchored VWAP in the indicator picker | An `AVWAP` params row appears under the header: Small/Large Retracement %, Left/Right Depth, Max History, four color swatches, History Start ISO box + calendar icon + × | **PASS** — user confirmed 2026-10-08 |
| M2 | Gated | Disable the indicator | The params row disappears | **PASS** — user confirmed |
| M3 | Datepicker opens positioned | Click the calendar icon | A Material datepicker popup opens adjacent to the field — not at the top-left corner | **PASS** — user confirmed |
| M4 | Picker commit | Select e.g. the 1st of a month a few months back | The visible ISO box shows `YYYY-MM-DD`; the chart redraws with history segments from that era (up to Max History) | **PASS** — user confirmed |
| M5 | Text → picker sync | Type a valid ISO date into the History Start box, Tab out | The date applies; reopening the picker shows that date highlighted | **PASS** — user confirmed |
| M6 | Clear | Click the × button | The field empties; history reverts to the most-recent `maxHistory` view | **PASS** — user confirmed |
| M7 | Empty-revert on numbers | Clear the Small Retracement % field, Tab out | The value reverts to `2` (default), not `0`; the chart uses the default | **PASS** — user confirmed |
| M8 | Param effects | Change Small Retracement % to e.g. `4`; change a color swatch | New pivot set on the small scale; recolored lines | **PASS** — user confirmed |
| M9 | Persistence | With several overrides set, disable then re-enable the indicator | The panel returns with the overrides intact | **PASS** — user confirmed |
| M10 | Hygiene | Throughout: devtools console | No errors; panel legible in dark theme | **PASS** — user confirmed |

## Era-view semantics to confirm while testing (M4–M6)

With `historyStart` set, the window keeps the **first** `maxHistory` terminated segments on or after the date — the cap prunes the *recent* end. This is the PRD's "era view"; with Max History at the default 100 it is rarely visible on daily bars, but testers should know a very long era can window out the newest terminated segments. Active lines are never pruned.

## Traceability

| Acceptance criterion | Scenario(s) |
|---|---|
| `historyStart` param (ISO date) on the indicator definition, surfaced to the engine | A1, A2 |
| Date filter on session `date`, inclusive, invalid ≡ unset | A2, A3, A4, M4 |
| Active lines never pruned; `maxHistory` per scale across both sides | A5 |
| Controls for every declared param; gated on enable | A7, M1, M2 |
| Overrides merge over defaults; empty input reverts to default | A6, M7 |
| Color params as hex swatches | A6, M1, M8 |
| `mat-datepicker` + ISO text input + clear; local-date commit | A8, M3–M6 |
| Overrides survive disable/enable | A7, M9 |
| Sandbox-only surface; no shared settings UI | M1 (no panel elsewhere), code review |
| Types/build/tests green | A10, A11 |

## Regression checklist

- [ ] Other sandbox indicators still toggle and render (Trigger Bands, ZigZag).
- [ ] `buildDefaultConfig` names unchanged for indicators with no empty-string params.
- [ ] Full `npx jest` suite: failures only in other threads' files (screenshot `PositionType` pin; order-execution WIP).
- [ ] Engine: no-lookahead invariant spec passes (causal rendering untouched).

## Results log

**2026-10-08 (QA session):** A1–A11 all PASS — evidence in the table. Commands executed: `npx jest st-anchored-vwap flex-chart-sandbox indicator-registry date.util --coverage=false` (7 suites, 135 tests, all pass), `tsc` app + spec (0 errors), `ng build --configuration development` (clean), full `npx jest` (3,259 pass / 5 fail in 2 suites — both other threads' WIP, see A11). M1–M10 all PASS — user confirmed in the running sandbox (`npm start` → `/dev/flex-chart`), 2026-10-08. Regression checklist: other sandbox indicators unaffected; `buildDefaultConfig` names unchanged (empty-string params filtered); no-lookahead invariants green.
