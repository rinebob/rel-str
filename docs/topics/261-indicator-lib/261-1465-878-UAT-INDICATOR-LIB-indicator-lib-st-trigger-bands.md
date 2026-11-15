# UAT — Trigger Bands Pine cleanup and engine alignment

**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** Implement ST Trigger Bands in ST Indicator Library  
**Thread Slug:** st-trigger-bands  
**Issue:** #1465  
**Thread Parent:** #862  
**Topic Parent:** #261  
**Task:** #878  
**Domain:** INDICATOR-LIB  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-11  
**Last Updated:** 2026-11-13  

## Results log

Automated acceptance was rerun for this QA invocation (audit 28/28, backend 38/38). Manual TradingView compilation and visual comparison were confirmed passing by the user on 2026-11-13; the specific symbol and date window were not separately recorded. Overall result: **PASS — all scenarios resolved**.

| Scenario | Result | Evidence |
|---|---|---|
| 1. Repository cleanup and static contract | PASS | Fresh audit: 28 PASS / 0 FAIL, exit 0 |
| 2. Backend contract regression | PASS | Fresh node test runner: 38 tests passed, 0 failed |
| 3. TradingView compile and inputs | PASS | User-confirmed TradingView compile and add-to-chart, 2026-11-13 |
| 4. Closed-bar bands, colours and breakout comparison | PASS | User-confirmed visual comparison vs web chart, 2026-11-13 |
| 5. Visual refinement and reset | PASS | User-confirmed overall UAT pass, 2026-11-13 |

## Scope and authoritative contract

Task: BE: Move and clean rb-st-trigger-bands.pine, align with engine (#878). QA: QA: BE: Move and clean rb-st-trigger-bands.pine, align with engine (#1465).

Covers file location, removal of dead/debug code, Pine v6 choice, body-based bands, expansion-gated arming, band colours and breakout-only envelope markers. The shipped FE: Trigger Bands prod promotion (#932) decision supersedes older PRD/IMPL/TEST text requesting dense pullback dots: pullbacks are warnings shown through band colour; breakout dots are discrete events. This is an indicator, not a standalone strategy.

Review: [PASS review](261-874-878-CODE-REVIEW-INDICATOR-LIB-indicator-lib-st-trigger-bands.md).
Verification guide: `functions/scripts/verify/indicator-lib-878-pine-parity.md`.

## Prerequisites

- Repository checkout with `rb-ps/rb-ta/ind/rb-st-trigger-bands.pine` and Node/npm dependencies installed.
- TradingView account with access to the Pine editor and AAPL daily candles.
- Authenticated web app with access to signal charts and the deployed indicator-series callable.
- Use ordinary candles, length **3**, daily interval, matching symbol/exchange, session and adjusted/unadjusted OHLC settings where available. Different source bars can produce legitimate mismatches; investigate OHLC first.
- Suggested comparison window: AAPL daily, 2026-09-01 through 2026-10-30. If that window lacks examples on both sides, expand it and record the actual dates.
- Compare closed candles away from the beginning of loaded history. Pine ATR first becomes valid at zero-based index 13; backend ATR retrospectively seeds earlier indexes. Different history starts can also affect accumulated state and ATR. Do not assert exact marker-height parity on mismatched history.

## Getting to the feature

### TradingView

Open an AAPL chart, select **1D**, open **Pine Editor**, create an indicator, and replace its content with the complete repository file `rb-ps/rb-ta/ind/rb-st-trigger-bands.pine`. Save as **ST Trigger Bands QA** and choose **Add to chart**. Landing surface: the main candle pane with Upper/Lower steplines and long/short breakout markers. Editor menu placement can vary with TradingView's current layout.

### Web

- Exact route: `/signals/charts` on the running app.
- Entry point: navigate directly to that route, select **AAPL**, open the chart's ST indicator menu, enable **ST Trigger Bands** and **ST Trigger Bands Signals**.
- Landing surface: signal-detail price charts with Trigger Bands on daily and weekly; use the daily chart for this comparison. Monthly does not render this production indicator.
- If needed, start the app from the repository root with `npm start`, then open `/signals/charts` on the origin printed by the server. Do not use the dev-only TB local computation as a substitute for the deployed backend acceptance path.

## Scenarios

### 1. Repository cleanup and static contract

Starting state: repository root, dependencies installed.

```powershell
cd functions
npx tsx scripts/verify/indicator-lib-878-pine-parity.ts
```

Expected: 28 PASS / 0 FAIL, exit 0. Pins target location, v6 header, cleanup, body-based bands, nz-free boolean expressions, unconditional rolling/cross calculations, expansion/state ordering and breakout-only envelope markers. This is a structural audit, not a Pine compilation or semantic proof.

Cleanup: none; script is read-only.
Result: **PASS** — fresh run observed during this QA invocation.

### 2. Backend contract regression

Starting state: `functions/` directory.

```powershell
npx tsx --test ../tests/functions/st-trigger-bands.test.ts ../tests/functions/st-trigger-bands-series.test.ts
```

Expected: no failures. Includes empty/short/flat input, dojis, body-not-wick bands, mirror cases, equality not breaking out, expansion-gated arming/reset, independent sides, exact envelope anchor and opt-in response filtering. These test backend behavior, not the Pine runtime.

Cleanup: none; tests do not deploy functions.
Result: **PASS** — 38 passed, 0 failed in a fresh run.

### 3. TradingView compile and inputs

Starting state: TradingView chart and Pine editor from Getting to the feature.

1. Paste the current repository file, not an older saved TradingView copy.
2. Save and Add to chart; capture any compiler errors or history-consistency warnings verbatim.
3. Confirm the indicator exposes Length and the three colour inputs, with Length = 3; no midpoint, offsets, library-import prompts or debug plots.
4. Confirm Upper/Lower and long/short breakout plots appear without runtime errors.

Expected: successful Pine v6 compile and no execution errors. Missing boolean `nz()` overload is not an outstanding check: those calls were removed in review.
Cleanup: keep the QA indicator for scenarios 4–5.
Result: **PASS** — user confirmed the current repository file compiles and adds to chart in TradingView, 2026-11-13.

### 4. Closed-bar bands, colours and breakout comparison

Starting state: scenario 3 passed; AAPL daily open on both surfaces, settings aligned.

1. Navigate both charts to the same date window; record actual exchange, interval, dates and adjustment settings.
2. Compare Upper and Lower on several matching dates against candle bodies, including a long-wick candle. Bands use the last three bodies, not wick extremes.
3. Identify at least one long and one short breakout. Record their dates on both charts. A long marker lies below Lower; a short marker lies above Upper. There are no repeated dots on every pullback bar.
4. Check pullback colours: upper uses the short colour on a long pullback; lower uses the long colour on a short pullback. Breakout bars use their own side's colour. Compare states, not exact palette hex codes across themes.
5. Inspect a breakout and the following pauses: a fresh same-side setup requires a new band expansion after the reset. No immediate repeated dot streak is expected.
6. If dates or band values differ, compare source OHLC/session/adjustments before treating it as an implementation defect. Report unexplained mismatches; do not mark PASS merely because both render.

Expected: matching closed-bar bands and breakout dates on matched bars; envelope-relative markers and state transitions consistent with the web contract. Exact ATR height requires matching history too.
Cleanup: none until scenario 5.
Result: **PASS** — user confirmed the TradingView overlay matches the web chart on the tested comparison, 2026-11-13. Exact symbol/window not separately recorded.

### 5. Visual refinement and reset

Starting state: both overlays visible.

1. Check that band step-lines and breakout markers remain legible while zooming/panning and do not hide the candles excessively. Pine uses cross-style markers; the web uses dots, so identical glyphs are not required.
2. Check neutral-band visibility on the tested theme. Pine defaults to white; if using a light chart, choose a visible neutral colour and record the setting.
3. Inspect indicator settings with the keyboard; verify inputs remain usable. Realtime candle changes are allowed; closed-bar comparison is the acceptance target.
4. Remove ST Trigger Bands QA from TradingView and disable the two web toggles. Candles and unrelated indicators remain intact. Re-enable once to confirm recovery, then restore your prior chart preferences.

Expected: usable comparison overlay, no runtime errors, clean removal/re-enable. A full responsive-app redesign is outside this Pine-only task.
Result: **PASS** — user confirmed visual/refinement behavior as part of the overall UAT pass, 2026-11-13.

## Traceability

| Requirement | Scenario |
|---|---|
| Task AC1: repository location | 1 |
| Task AC2: midpoint/retrace/wick/offset/import/constant/debug cleanup | 1, 3 |
| Task AC3: Pine version decided and header-noted | 1, 3 |
| Task AC4: bands, colours and markers per current shipped contract | 1, 2, 4, 5 |
| Task AC5 / PRD story 6 / BE TEST manual Pine comparison | 3, 4; record user result in this document |
| Empty/warm-up, mirrored/equality cases, reset and nearby backend regression | 2 |
| User-facing refinement and recovery | 5 |

## Final smoke checklist

- [x] Structural audit passes.
- [x] Backend engine/series tests pass.
- [x] Current Pine file compiles and executes in TradingView.
- [x] Same-symbol daily comparison confirmed by user (symbol/window not separately recorded).
- [x] Visual/refinement and remove/re-enable checks confirmed.
- [x] No unresolved defects; QA issue may be resolved only after all required checks pass.

No deployment, commit or push was performed for this QA run.
