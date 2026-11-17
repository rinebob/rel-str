**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** ST Anchored VWAP  
**Thread Slug:** st-anchored-vwap  
**Issue:** #1568  
**Thread Parent:** #835  
**Topic Parent:** #261  
**Task:** #873  
**Domain:** INDICATOR-LIB  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-15  
**Last Updated:** 2026-11-17  

# UAT — #873: Refine Pine Anchored VWAP to match web

## Scope

The Pine port (`rb-ps/rb-ta/ind/rb-st-anchored-vwap.pine`, Pine v6)
brought to semantic parity with the shipped web AVWAP after three review
rounds. The causal contract: VWAP accumulates from the historical pivot
bar but each line renders only from its trigger bar; the previous line
ends at the next vertex's trigger; supersession reconciliation
(dot move, predecessor re-end, demote→resurrect) mirrors the web's batch
recompute; persist produces a fan; history windows keep the first cap in
era mode and the most recent cap otherwise.

**Task acceptance criteria (issue body):**

1. Pine script renders each VWAP line only from the confirmation/trigger
   bar forward — no segments drawn on bars before the trigger.
2. VWAP values for each line are computed from the pivot bar forward.
3. Removed or gated-out: hindsight backfill, confirmation-bar markers as
   step plots, thin step duplicate lines.
4. Pine respects retracement inputs, colors, weights, show-high/show-low,
   persist, dots, and history controls equivalent to the web.
5. Visual side-by-side check vs the web sandbox shows matching anchor
   bar, trigger bar, and first drawn VWAP values.
6. No unresolved runtime errors, compile warnings beyond expected Pine
   limits, or timeouts on typical daily charts.
7. Documentation and manual verification notes captured.
8. Code review PASS + UAT document exists.

## Prerequisites

- **TradingView side (the deliverable):** a TradingView account, the Pine
  Editor on any chart, and the file `rb-ps/rb-ta/ind/rb-st-anchored-vwap.pine`
  pasted into it. **This file has never been compiled** — S1 is the first
  compile; watch `array.indexof` on a label array and the UDT method sites.
- **Web side (the reference):** repo at `C:\aa\projects\rel-str`, deps
  installed, `npm start` → `{origin}/dev/flex-chart` (auth-guarded —
  sign in). Enable **ST Anchored VWAP** from the Indicators dropdown;
  `AVWAP…` toolbar button opens the settings dialog.
- A liquid daily chart on both sides (NFLX is the established choice —
  it has a gap-through trigger; ~2y daily gives multi-hundred-bar
  history). Match retracement/depth inputs between the two surfaces.

## Getting to the feature

- **TradingView:** open any symbol chart → **Pine Editor** (bottom
  panel) → paste the file contents → **Add to chart**.
- **Web reference:** app nav → dev flex-chart sandbox at
  `/dev/flex-chart` → Indicators dropdown → **ST Anchored VWAP** →
  `AVWAP…` button for the settings dialog.

## Automated scenarios (executed by QA agent)

| # | Scenario | Command | Expected | Result |
|---|---|---|---|---|
| A1 | Static parity audit — 60 checks pinning the causal contract, supersession/collapse/resurrection machinery, budgets, inputs, fix-set | `cd functions && npx tsx scripts/verify/indicator-lib-873-pine-parity.ts` | 60 PASS / 0 FAIL | **PASS** — 60/60 (2026-11-15) |
| A2 | Web reference suites (engine/adapter/indicator/invariants) | `npx jest src/app/features/shared/components/flex-chart` | all suites green | **PASS** — 16/16 suites, 358/358 (2026-11-15) |

## Manual scenarios (TradingView — tester-executed)

### S1 — First compile (gate for everything below)

1. Paste the file into the Pine Editor → **Add to chart**.
2. **Expect:** compiles with no errors. Warning-free or only benign
   warnings. If a compile error appears, record it verbatim — likely
   suspects: `array.indexof` on the label array, UDT method calls,
   `chart.point.from_time` argument shapes.
3. **Result:**

### S2 — Causal contract: nothing before the trigger

1. Daily chart, defaults (2%/5%, depths 5/2). Zoom to any pivot region.
2. **Expect:** each VWAP line starts at a bar where a reversal was
   already visible — never retro-attached to the pivot bar itself.
   Cross-check against the web sandbox on the same symbol/range: same
   anchor bars, same trigger bars, same first drawn values.
3. **Result:**

### S3 — Handoff: previous line ends at the next trigger

1. Find a pair of consecutive segments on one side.
2. **Expect:** the earlier line runs through the later vertex's trigger
   bar and stops; the new line starts there. No gap, no overlap.
3. **Result:**

### S4 — Persist fan

1. Line 1 settings → **Persist lines** ON.
2. **Expect:** every triggered segment keeps running to the last bar —
   a fan, not single-line replacement. Toggle off → returns to
   single-line mode.
3. **Result:**

### S5 — History window

1. Set **Limit history to a start date** with a date mid-chart.
2. **Expect:** only segments anchored on/after that date draw — era mode
   keeps the *first* `Max history` segments (cap eats the recent end).
3. Unset the date → most-recent `Max history` segments instead.
4. Set persist ON + era date → the fan keeps the first cap in-window.
5. **Result:**

### S6 — Trigger dots

1. **Show trigger dots** ON for line 1.
2. **Expect:** a dot per confirmed trigger, at the deviation level —
   or at the bar open when a gap carried price through it.
3. Hide one side (**Show lows** OFF) → the low side's *lines* hide but
   its dots still draw (web parity — confirmations aren't side-gated).
4. **Result:**

### S7 — Supersession reconciliation (review fix-set spot checks)

1. Find a segment of one side that gets overtaken by a more extreme
   same-side pivot (a steepening leg) — or on the web side note a
   vertex that refined after its trigger.
2. **Expect:** the dot moves to the refined trigger bar; the
   predecessor's line extends to it — no frozen endpoint at the ghost
   trigger, no stale dot.
3. If a refined vertex loses its trigger entirely (deep retrace between
   refinement and confirm): the previous vertex's line keeps running —
   no gap — until the new vertex re-triggers.
4. **Result:**

### S8 — Zero/missing volume bars

1. An instrument with zero-volume bars (thin ETF or synthetic index)
   or just scan a normal chart.
2. **Expect:** the VWAP line carries flat across zero-volume bars —
   never breaks or drops to zero.
3. **Result:**

### S9 — Long history + realtime (platform limits)

1. Load a chart >10k bars (e.g., SPY 1h max range or daily max).
2. **Expect:** segments anchored deep in history still draw —
   `xloc.bar_time` removes the ~10k-bar `bar_index` ceiling. A segment
   spanning >10k bars may truncate its tail (accepted, documented).
3. Persist ON during a live session on a long intraday chart: watch for
   compute timeout (per-tick polyline rebuild — known cost, bounded by
   fan size).
4. **Result:**

### S10 — Same-bar collapse

1. A single bar that is simultaneously a local high and local low
   extreme (huge range bar) within the depth window.
2. **Expect:** the collapsed vertex leaves no orphaned dot and no
   ghost segment; its predecessor's line keeps running to the
   replacement's trigger.
3. **Result:**

## Traceability

| Acceptance criterion | Scenario(s) |
|---|---|
| AC1 — render only from trigger bar | A1, S2 |
| AC2 — VWAP computed from pivot bar | A1, S2, S8 |
| AC3 — scaffolding/backfill removed | A1, S1 |
| AC4 — input parity (retracement/colors/weights/visibility/persist/dots/history) | A1, S4, S5, S6 |
| AC5 — side-by-side anchor/trigger/first-value match | S2, S3 |
| AC6 — no compile errors/timeouts | S1, S9 |
| AC7 — docs + manual notes | this doc + code review doc |
| AC8 — review PASS + UAT exists | review doc `261-867-873-CODE-REVIEW-…` |
| Supersession reconciliation (round-1 fix-set) | S7 |
| Era/persist bookkeeping (round-2 fix-set) | S5, S7 |
| Same-bar collapse (round-2 fix-set) | S10 |

## Regression / smoke checklist

- [ ] Standalone **ST ZigZag** indicator still available and unchanged
      in `rb-ps/rb-ta/ind/`
- [ ] Web sandbox AVWAP unchanged (no web files touched by this task)
- [ ] Pine inputs render grouped (Line 1 / Line 2 / History window)

## Findings

- None — no QA-found defects. Every defect this task surfaced was caught
  and fixed during the three review rounds (incl. the `hist` constructor
  type mismatch found before first compile).

## Results log

- 2026-11-15 — UAT drafted. A1 60/60 PASS, A2 358/358 PASS executed by
  QA agent. S1–S10 pending tester on TradingView — **the Pine file has
  never been compiled**; S1 is the first compile gate.
- 2026-11-15 — S1–S10 PASS, user-executed on TradingView: compiles
  clean, causal contract + handoffs + persist fan + history windows +
  dots + supersession all verified visually ("it looks great").
  **QA PASS.** Status → Complete; QA issue #1568 → RESOLVED.
