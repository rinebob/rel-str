**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** ST Anchored VWAP  
**Thread Slug:** st-anchored-vwap  
**Issue:** #855  
**Thread Parent:** #835  
**Topic Parent:** #261  
**Domain:** INDICATOR-LIB  
**Type:** Implementation Plan  
**Area:** SHARED  
**Status:** Draft  
**Created:** 2026-10-07  
**Last Updated:** 2026-10-07  

# SHARED Implementation Plan: ST Anchored VWAP Pine Refinement

## Overview

Stage 1 produced a Pine v6 prototype, `rb-ps/rb-ta/ind/rb-st-anchored-vwap.pine`, that confirmed the indicator's relevance on real charts. It was a relevance check, not a refined reference, and it still implements the earlier **backfill-to-pivot-bar** model. This plan is **Stage 1b**: after the web build (FE T1 to T4) is complete, return to the Pine script and refine it to match the finished web behaviour and the approved PRD. It is deliberately sequenced after FE so TradingView iteration is not on the critical path.

Governing PRD: `261-835-836-PRD-INDICATOR-LIB-indicator-lib-st-anchored-vwap.md` (Approved).

## Module

### Pine Refinement — `rb-st-anchored-vwap.pine`

**Location:** `rb-ps/rb-ta/ind/rb-st-anchored-vwap.pine`

**What the prototype does today (to be changed)**

- Rebuilds each active line as a `polyline` from the **pivot bar** to the current bar, and trims the previous same-side line back to the new **pivot bar** — i.e. lines are back-attached in hindsight.
- Adds thin full-colour `plot()` step lines (the "causal" lines), confirmation-bar `plotshape` markers, and a debug table, all to compare the hindsight picture against what was knowable.
- Caps history **per line** (`cap = min(maxHist, 48)` applied to each of the four `AnchorLine`s), which can create up to `4 × 48` history polylines against TradingView's 100-polyline budget (the script sets `max_polylines_count = 100`; the cap math assumed 48 *per scale*).

**Target behaviour (matches the PRD and the web build)**

- **No back-attachment.** A line is drawn only from its anchor's **confirmation bar** forward; the previous same-side line runs through that confirmation bar and stops there. The VWAP still accumulates from the **pivot bar**, so the first drawn value is the VWAP of pivot bar through confirmation bar.
- **Replaced anchors are real anchors.** When a more extreme same-side pivot replaces the current anchor, the replaced anchor's line is drawn and ends at the replacement's confirmation bar, as in the web `AnchorEvent` model. The Pine detection core already tracks the replace-in-place case (`updateLastPivot`); it must emit an anchor-change on both new and replaced pivots.
- **Drop prototype scaffolding.** Remove the confirmation-bar markers, the thin step "causal" duplicate lines, the hindsight polylines, and the debug table — none are part of the approved design. Keep confirmed-pivot-only anchoring.
- **Active lines as `plot()`.** Because each bar's value now depends only on the anchor known at that bar, the four active lines can be plain `plot()` series with `plot.style_linebr`: no drawing-object limits, no per-bar polyline rebuild, no 5000-bar `max_bars_back` issue, and usable in strategies and alerts. Because adjacent segments of one slot share the confirmation bar and one `plot()` holds one value per bar, a handoff shows as a step at the confirmation bar; confirm this is acceptable visually, otherwise draw the active segment as a polyline.
- **History as polylines.** Terminated segments remain `polyline`s (a `plot()` cannot hold a variable number of historical segments), faded. Keep the per-bar arrays (`cumPV`, `cumV`, `tp`, `ts`) indexed by `bar_index` — the array approach is what resolved the history-buffer errors.
- **History Window and cap.** Implement the PRD semantics (`historyStart` era mode keeps the first `maxHistory`; unset keeps the most recent). **Apply the cap per scale across both sides, as the PRD reads, and clamp so `4 actives (if polylines) + 2 × cap ≤ 100`.** This fixes the prototype's per-line cap, which can exceed the polyline budget.
- **Palette.** Magenta highs, cyan lows; large = saturated and thick, small = pale and thin; red/green avoided. Keep the colors as inputs.
- **Defaults.** Small retracement 2%, large 5%, depths 5/5, `maxHistory` 100 (clamped as above).
- **Verification against web.** Run the refined script and the web sandbox on the same symbol, interval and params and compare anchor bars, confirmation bars, handoff bars and first drawn values.

**Constraints already learned (do not re-discover)**

- `var` globals cannot be read inside methods (CE10182) — pass series and arrays as parameters.
- `max_bars_back` accepts only global series identifiers, not builtins (`hlc3`, `time`) or function parameters (CE10164); runtime-offset series reads inside conditionally-executed functions overrun the history buffer. Use arrays indexed by `bar_index` instead.
- `array.last()` on an empty array is a runtime error; guard bar 0.
- Polylines are capped; verify the exact maximum against current Pine documentation before changing `max_polylines_count`.

**License / attribution:** the detection core is derived from TradingView's ZigZag library (v9) ported in `rb-st-zigzag.pine`; keep the MPL 2.0 header and attribution as in that file.

## Phases

### Phase 1: Pine refinement

- **T5** — Refine `rb-st-anchored-vwap.pine` to the no-backfill, confirmation-bar model; remove prototype scaffolding; fix the history cap; verify against the web sandbox. Blocked by FE T4.

## Cross-Area Dependencies

- Blocked by the FE Blueprint's final task (T4): the finished web behaviour is the reference this refinement matches.
- No BE.

## Risks

- **Divergence from web.** Without a shared test harness, Pine and web can drift. Mitigation: a manual verification checklist (see the SHARED test plan) comparing the same symbol, interval and params.
- **Plot vs polyline for active lines.** `plot()` is limit-free and strategy-usable but shows a step at each handoff; a polyline avoids the step but costs polyline budget. Decide visually during T5.
- **Polyline budget.** Per-scale history cap plus any active polylines must stay within TradingView's polyline limit; the exact maximum should be re-verified against current Pine docs.
- **Cannot compile locally.** Pine has no local toolchain; each iteration round-trips through TradingView. Keep changes small and compile often.
- **Execution time.** Keep the single-pass design; avoid per-bar rebuild of any drawing object.
