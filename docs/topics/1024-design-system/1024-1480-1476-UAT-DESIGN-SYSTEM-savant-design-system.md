**Topic:** Savant Design System  
**Topic Slug:** design-system  
**Thread:** Savant Design System  
**Thread Slug:** savant-design-system  
**Issue:** #1480  
**Thread Parent:** #1163  
**Topic Parent:** #1024  
**Task:** #1476  
**Domain:** DESIGN-SYSTEM  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-13  
**Last Updated:** 2026-11-13  

# UAT — #1476: Run-controls toolbar dedup (.pill-btn → dse-chip, .filter-input → dse-input)

Pure visual/style dedup — no behavior change intended. The acceptance
bar is: identical-or-better toolbar appearance, active chips still tint,
filter inputs still type + emit, no layout breakage.

## Getting to the feature

- **Route:** `/options/strategy/backtest`
- **Entry point:** Sidenav → Options → Backtest
- **Live surface:** ONE filter toolbar — the "Selection Replay" strip
  (New Replay · Status chips · Template select · Symbol input · Sort ·
  Clear filters) = `OptionsReplayRunControlsComponent`.
- **Dead surface:** the upper "New Backtest" strip
  (`BacktestRunControlComponent` — Date pills, Config input, Include
  archived chip) is gated by `showSimRuns = false`
  (`backtest-dashboard.component.ts:61`) — it renders nowhere today.
  Its chip/input swap is pinned by the new component spec; no manual
  leg exists for it.

## Automated acceptance

| # | Scenario | Command | Expected | Result |
|---|----------|---------|----------|--------|
| A1 | Run-control spec coverage — dse-chip markup, active state, dse-input pin, emissions (covers the flag-gated strip too) | `npx jest src/app/features/savant-trader/backtest/components/` | 7 suites / 70 tests pass | **PASS** (70/70) |
| A2 | styles.scss compiles; `input.dse-input` emits ds-input-chrome | `npx sass src/styles.scss out.css --load-path=vendor/savant-ds/styles --load-path=src/styles` | clean compile; `.dse-input` rules in output | **PASS** |
| A3 | Residual check — no `.pill-btn` / bare `.filter-input` chrome in the two components | grep | zero `.pill-btn` in either component; `.filter-input` appears only as `width` hook | **PASS** |

## Manual acceptance (live surface: the Selection Replay strip only)

| # | Scenario | Steps | Expected | Result |
|---|----------|-------|----------|--------|
| M1 | Chip appearance | Look at the Status pills (All/Pending/Running/Success/Failed/Cancelled) | Pills are DS chips — 12px radius, muted border/text; slightly rounder + a hair more padding than before (intended) | |
| M2 | Active chip | Click a Status chip (e.g. Failed), then back to All | Selected chip gets primary-tinted bg + accent-colored border/text; the rest stay muted; list filters | |
| M3 | Clear filters chip | Set any filter → "Clear filters" chip appears | Renders as a chip; click resets all filters and the chip disappears | |
| M4 | Input chrome | Click into the Symbol field | Accent border at rest; **accent glow ring on hover/focus** (the visibly new DS chrome); 24px tall, aligned with adjacent selects | |
| M5 | Input emits | Type `SPY` in Symbol | Table filters to SPY rows | |
| M6 | Mixed-row seam | Look at the full strip at rest | The ds-token input sits comfortably next to the mat-sys-token chips/selects — transitional mix is expected; flag only if it looks broken | |
| M7 | Wrap/narrow | Shrink the window to ~700px | Strip wraps without chips/inputs overlapping or overflowing | |
| M8 | Light theme | Toggle light theme, repeat M1/M4 | Chips + input render correctly on light tokens | |

## Results log

- 2026-11-13 — automated acceptance A1–A3 PASS (70/70 tests, sass
  compile clean, residual grep clean).
- 2026-11-13 — **Doc corrected:** user's page scrape showed one
  toolbar, not two. Verified the upper sim-runs strip is flag-gated
  off (`showSimRuns = false`) — dead code, spec-pinned via A1.
  Manual legs rewritten for the replay strip only.
- 2026-11-13 — **QA PASS.** M1–M8 user-confirmed ("all uat passes").
  #1480 → RESOLVED.
