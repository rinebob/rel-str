**Topic:** Flex Chart Visual Polish  
**Topic Slug:** visual-polish  
**Thread:** Dev Flex Chart - enable save settings for dev use  
**Thread Slug:** dev-save-settings  
**Issue:** #940  
**Thread Parent:** #908  
**Topic Parent:** #213  
**Task:** #934  
**Domain:** FLEX-CHART  
**Type:** UAT  
**Status:** Draft  
**Created:** 2026-10-09  
**Last Updated:** 2026-10-09  

# UAT — Persisted sandbox settings (restore, auto-save, reset)

## Scope

Task #934 delivers the sandbox persistence layer: every control on
`/dev/flex-chart` (symbol, interval, Log Y, data mode, preset, TB dots, the
enabled indicator set, per-indicator param overrides) lives in one versioned
`localStorage` blob under key `flex-chart-sandbox-settings`. Changes
auto-save; a **Reset** button restores factory defaults; a stale or corrupt
blob degrades to defaults instead of crashing. Covers PRD user stories
US-1 (restore), US-3 (reset), US-4 (prod isolation), US-5 (tolerant merge).
US-2 (ZigZag param editor UI) is task #935 — not in scope here.

## Prerequisites

- Dev server running: `npm start` (ng serve on `:4200` + observation API `:3456`).
- Signed in (the route is auth-guarded).
- Chrome/Edge devtools open: **Application → Local Storage →
  `http://localhost:4200`** to watch/edit the `flex-chart-sandbox-settings`
  key, and the **Network** tab for the regression check.

## Start

1. Navigate to `http://localhost:4200/dev/flex-chart`.
2. In devtools Local Storage, delete `flex-chart-sandbox-settings` if present
   (fresh-slate start).

## Scenarios

### 1. First load → factory defaults

- **Start:** storage key absent.
- **Expected:** Symbol `QQQ`, interval `D`, Log Y checked, Real mode, indicator
  picker shows the default set (~7 enabled), AVWAP params strip hidden.
- **Result:**

### 2. Scalar controls persist

- **Steps:** Set symbol `MSFT` (commit with Tab/Enter); click `W`; uncheck
  Log Y; enable `ST Trigger Bands` in the picker, then check `TB dots`.
- **Then:** refresh the page (F5).
- **Expected:** Symbol `MSFT`, `W` active, Log Y unchecked, TB dots checked,
  Trigger Bands still enabled.
- **Result:**

### 3. Indicator selection persists

- **Steps:** In the picker enable `ST ZigZag` and `ST Anchored VWAP`.
  Refresh.
- **Expected:** Both stay checked (picker count unchanged); the ZigZag overlay
  draws on the chart; the AVWAP params strip renders under the header.
- **Result:**

### 4. AVWAP param override persists

- **Steps:** With AVWAP enabled, set `Max History` to `7` (blur to commit).
  Refresh.
- **Expected:** The field still shows `7`; the AVWAP lines recompute from the
  override.
- **Result:**

### 5. Auto-save — no save button

- **Steps:** With devtools Local Storage visible, toggle any control.
- **Expected:** `flex-chart-sandbox-settings` updates immediately — a
  `version: 1` JSON blob carrying every control's value. No explicit save step.
- **Result:**

### 6. Reset to defaults

- **Steps:** After scenarios 2–4, click **Reset** (header, right of TB dots).
- **Expected:** Symbol `QQQ`, `D`, Log Y on, Real mode, TB dots off, default
  indicator set, AVWAP strip gone; the stored blob rewrites to defaults.
- **Result:**

### 7. Tolerant merge on hand-edited blob

- **Steps:** In devtools, edit the blob's value: add `"bogus-id"` to
  `enabledIndicators`; add `paramOverrides."st-zigzag".devThreshold = 999`;
  set `symbol` to `"  msft "`. Refresh.
- **Expected:** No crash. `bogus-id` is dropped, `devThreshold` restores
  clamped to `50`, symbol reads `MSFT` (normalized).
- **Result:**

### 8. Unsupported version discarded

- **Steps:** Edit the blob's `version` to `999`. Refresh.
- **Expected:** Factory defaults load; the blob rewrites at `version: 1`.
- **Result:**

### 9. Production isolation

- **Steps:** Navigate to a production chart surface — quick-charts or a
  signal-detail chart. Watch Local Storage.
- **Expected:** No reads/writes of `flex-chart-sandbox-settings` on prod
  surfaces; dev indicators (ST ZigZag, AVWAP, Std Dev Lines) are not offered
  in production indicator menus.
- **Result:**

### 10. Refinement pass — Reset control

- **Steps:** Inspect the Reset button in the header row.
- **Expected:** Sits with the other button groups, same styling, has a hover
  tooltip ("Clear saved settings and restore defaults"), keyboard-focusable.
- **Result:**

## Regression / smoke

- **Synthetic mode:** switch to Synthetic → presets draw; D/W/M + callable
  indicator checkboxes disable; switch back to Real.
- **Trigger Bands request:** with TB enabled in Real mode, the lean
  `stGetSymbolIndicatorSeriesV2` call fires (Network tab); disabling TB stops
  further requests.
- **AVWAP date param:** `historyStart` still commits via the ISO input and
  the datepicker; the × button clears it.
- **Result:**

## Automated evidence (executed 2026-10-09)

| Check | Result | Evidence |
|---|---|---|
| `npx jest src/app/features/savant-trader/pages/flex-chart-sandbox` | PASS | 3 suites, 73/73 tests — covers all load-validation branches, storage failure, restore/auto-save/reset |
| `npx jest src/app/features/shared/components/flex-chart` | PASS | 16 suites, 297/297 |
| `npx ng build` | PASS | bundle generation complete |
| Full `npx jest` | 43 unrelated failures | `order.component.spec.ts` (NG0201 Functions — screenshot WIP) + `screenshot-capture-contracts.spec.ts` (PositionType options WIP); neither touches this task's surface |

## Traceability

| Acceptance criterion | Scenario(s) |
|---|---|
| US-1 — full sandbox state restores after refresh | 1, 2, 3, 4, 5 |
| US-3 — reset to defaults | 6 |
| US-4 — prod isolation (all machinery sandbox-local) | 9 |
| US-5 — versioned blob + tolerant merge | 7, 8 |
| Auto-save on every change | 5 |
| `paramOverrides` generic map (AVWAP rides it; ZigZag-ready) | 4, 7 |
| Versioned blob, version mismatch discards | 8 |

## Results log

| # | Scenario | Result | Evidence |
|---|---|---|---|
| 1 | First load → defaults | | |
| 2 | Scalar controls persist | | |
| 3 | Indicator selection persists | | |
| 4 | AVWAP param persists | | |
| 5 | Auto-save | | |
| 6 | Reset | | |
| 7 | Tolerant merge | | |
| 8 | Version mismatch | | |
| 9 | Prod isolation | | |
| 10 | Refinement — Reset control | | |
| R | Regression / smoke | | |
