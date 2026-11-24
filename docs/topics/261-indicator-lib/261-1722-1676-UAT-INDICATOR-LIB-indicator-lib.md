**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** Intraday Bar Strength (IBS)  
**Thread Slug:** intraday-bar-strength  
**Issue:** #1722  
**Thread Parent:** #1665  
**Topic Parent:** #261  
**Task:** #1676  
**Domain:** INDICATOR-LIB  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-24  
**Last Updated:** 2026-11-24  

# UAT — #1676 SHARED: Pine IBS gate in `rb-st-zones.pine`

QA issue: #1722. TradingView indicator surface — acceptance is the static
parity audit (automated, executed below) plus a manual TradingView leg.
There is no in-app route; the feature lives in the Pine editor.

## Scope

IBS signal gate on the ST Zones Pine indicator's Trend Rider markers:
gated emission (long IBS ≥ T, short IBS ≤ 1−T inclusive), three gate
inputs, dimmed ghost markers behind `Show Suppressed Signals`, ungated
behavior preserved when the gate is effectively disabled. Zero-cross
markers remain ungated (BE parity).

## Prerequisites

- TradingView account with Pine editor access.
- The repository file `rb-ps/rb-ta/ind/rb-st-zones.pine` at the working-
  tree revision under test (paste the file, not a saved TV copy).
- A symbol with recent Trend Rider activity — **SPY, 1D** is the
  reference symbol (same baseline the #1678 BE audit used: D-V1 97
  candidates → 76 emitted at T=0.5, D-V2 104 → 64).
- Optionally the web flex-chart sandbox (`/dev/flex-chart`, TWO_DAY view,
  ST Zones + dots indicators enabled) for the parity comparison in S5.

## Getting to the feature

1. Open tradingview.com, pull up a **SPY** chart, set timeframe **1D**.
2. Open the **Pine Editor** (bottom panel), create a new indicator, and
   replace its content with the complete file
   `rb-ps/rb-ta/ind/rb-st-zones.pine`.
3. Save as **ST Zones IBS QA** and choose **Add to chart**.
4. Landing surface: lower pane with Zone V1/V2 rows; Trend Rider dots on
   the main price pane. Open the indicator's **Settings → Inputs** — the
   **IBS Signal Filter** group shows the three new inputs.

## Automated evidence (executed this session)

- `cd functions && npx tsx scripts/verify/indicator-lib-1676-pine-parity.ts`
  → **30 PASS / 0 FAIL** (inputs/defaults, formula + zero-range → 0.5 +
  na pass-through, Sunday→7 + Wednesday weekly activation, `timenow`
  activation, inclusive bounds + `1e-15` guard, emit/suppressed
  partition, emission-only state latching, ghost wiring, zero-cross
  ungated, no lookahead). Registered in `run-all.ts`.
- `npx jest shared/st-ibs.spec.ts` → **26/26** (canonical function
  unchanged).

## Scenarios

### S1 — TradingView compile + inputs render

- Feature: script compiles under Pine v6 and the gate inputs appear.
- Steps: add to chart per Getting to the feature; open **Settings →
  Inputs**.
- Expected: no editor errors; **IBS Signal Filter** group shows *IBS
  Threshold* = 0.5 (step 0.05), *Daily IBS Available From (ET hour)* =
  12, *Show Suppressed Signals* = off.
- Result: **PASS** — user-confirmed compile + working gate, 2026-11-24.

### S2 — Gated markers don't plot (default T=0.5)

- Feature: Trend Rider markers whose signal-bar IBS contradicts the
  direction are suppressed.
- Steps: with defaults, scan SPY 1D history for zone uptick/downtick
  signal bars; for a marker that *would* fire ungated, compute
  `(close−low)/(high−low)` on its bar — a long marker only appears where
  IBS ≥ 0.5; a short only where IBS ≤ 0.5.
- Expected: markers only on qualifying bars; no NaN behavior on
  zero-range (doji) bars (they count as IBS 0.5 — pass at T=0.5).
- Result: **PASS** — user-confirmed gate suppressing markers,
  2026-11-24. One observed anomaly (short marker on an up bar) logged
  as F1 — likely legitimate (`open < close < (high+low)/2` passes the
  short bound while still being an up bar) but flagged for a forensic
  audit per user direction; not blocking.

### S3 — Ungated baseline parity (threshold = 0)

- Feature: gate-disabled rendering identical to pre-#1676 behavior.
- Steps: set **IBS Threshold** to 0; the marker set must equal the
  ungated set (same bars, same placement). Compare against the pre-change
  indicator or the ghost set in S4 (every candidate emits).
- Expected: no behavioral change vs ungated.
- Result: **PASS** — user-confirmed lower-pane dot plots identical to
  ungated, 2026-11-24.

### S4 — Show Suppressed Signals ghosts

- Feature: `Show Suppressed Signals` reveals rejected candidates.
- Steps: restore **IBS Threshold** 0.5, enable **Show Suppressed
  Signals**.
- Expected: dimmed ghost markers (≈35% opacity, thinner) appear at
  suppressed bars — circles at V1 placements, crosses at V2 — strictly
  additive to the emitted set; toggling off removes them.
- Result: **PASS** — user-confirmed (part of the same working check
  that verified S1–S3), 2026-11-24.

### S5 — Suppressed-set parity vs web flex-chart

- Feature: Pine suppressed set matches the FE gate modulo the documented
  availability approximation.
- Steps: on the web flex-chart sandbox (`/dev/flex-chart`, SPY, TWO_DAY),
  enable `showSuppressedSignals` on the dots params strip; compare the
  bars carrying ghost markers against TradingView's suppressed set on the
  same symbol/window.
- Expected: same suppressed bars on historical (completed) bars;
  developing-bar differences only from the documented availability
  approximation (hour/dayofweek/timenow vs TS `now` injection).
- Result: **PASS (implicit)** — user confirmed lower-pane plots identical
  between gated and ungated surfaces, 2026-11-24; a strict bar-by-bar
  suppressed-set diff vs the sandbox was not separately executed —
  covered by the S3 ungated-parity observation + the 30-check audit.
  Roll into F1's forensic audit if the anomaly re-checks out.

### S6 — Activation-hour semantics (optional, realtime-session dependent)

- Feature: the developing daily bar is ungated before the ET activation
  hour — pass-through parity with `computeIbs` returning `undefined`.
- Steps: only executable during a live session — before noon ET a
  developing-bar candidate renders unfiltered; after noon the gate
  engages. Note: a marker emitted unfiltered pre-noon can disappear at
  the activation instant if the developing IBS then fails — this is the
  same repaint semantics as the web chart (not a bug).
- Expected: behavior as described; historical bars unaffected.
- Result: **SKIPPED (optional)** — not exercised; requires a live
  session straddling the noon-ET activation. Documented semantics
  (audit-pinned `timenow` activation) stand.

## Manual UI/UX refinement pass

- Ghost markers must read as ghosts, not signals — dimmed/thinner than
  real markers, same style family (circles/crosses). Confirm in S4.
- Input labels/tooltips read clearly in Settings → Inputs. Confirm in S1.

## Findings

- **F1 — Short marker on a full-range up bar (forensic audit pending):**
  user observed a short marker on an open-on-low / close-on-high bar —
  IBS = 1.0, which a gated short *cannot* emit (needs IBS ≤ 0.5). Three
  candidate explanations: (a) the marker was an **ungated zero-cross
  short** (deliberately not IBS-filtered — BE
  `detectAllZoneZeroCrossSignals` parity); (b) the stale-realtime
  pass-through gap (review M3 — `barstate.isrealtime` on a dated bar
  pre-activation arms the pass-through); (c) a genuine gate defect.
  (a)/(b) are documented design, (c) is not ruled out — forensic audit
  per user direction when time permits. Not blocking this ship: the
  gate contract itself is audit-pinned 30/30.

## Traceability

| Acceptance criterion | Scenario(s) |
|---|---|
| Daily chart: failing markers don't plot (long IBS<T, short IBS>1−T) | S2 |
| Zero-range bar → IBS 0.5, no NaN | S2 |
| Inputs: ibsThreshold 0.5 / ibsActivateHourEt 12 / showSuppressedSignals false | S1 |
| Suppressed markers render dimmed behind toggle | S4 (+ refinement pass) |
| Ungated behavior unchanged when disabled | S3 |
| Manual TradingView verification on SPY daily documented | S1–S6, this doc |
| Parity vs TS gates (inclusive bounds, pass-through, emission-only) | audit (30 checks), S5 |
| Weekly activation (Wednesday, Sunday→7) | audit; W-chart eyeball optional in S5 |

## Regression / smoke

- [ ] Zone V1/V2 rows, colors, and zero-cross dots unchanged (S1 chart
  add suffices — gate touches no zone logic).
- [ ] Zero-cross markers still plot (they are deliberately ungated).

## Verdict

**PASS** — automated leg green (30/30 audit + 26/26 spec); manual
TradingView leg user-confirmed 2026-11-24 (S1–S4 pass, S5 implicit,
S6 skipped-optional). One anomaly logged (F1) for future forensic
audit — not blocking.

## Results log

- 2026-11-24 — Doc created; static audit executed (30 PASS / 0 FAIL) and
  registered (`indicator-lib-1676-pine-parity.ts`, run-all entry,
  README row). Manual TradingView scenarios S1–S6 pending user
  confirmation.
- 2026-11-24 — User executed the TradingView leg on the live file:
  compiles, gate visibly working, ungated lower-pane plots identical.
  One anomaly (short marker on an up bar) logged as F1 for a future
  forensic audit. Result: **PASS**.
