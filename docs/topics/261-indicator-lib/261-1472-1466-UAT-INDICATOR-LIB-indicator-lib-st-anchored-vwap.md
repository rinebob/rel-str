# UAT — SHARED: ST Anchored VWAP leg-semantics rework, shared trigger dots, persist mode (#1466)

**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** ST Anchored VWAP  
**Thread Slug:** indicator-lib-st-anchored-vwap  
**Issue:** #1472  
**Thread Parent:** #835  
**Topic Parent:** #261  
**Task:** #1466  
**Domain:** INDICATOR-LIB  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-12  
**Last Updated:** 2026-11-12  

## Scope

Task #1466 reworked the engine's leg semantics (surviving-chain vertices,
trigger-bar line starts, shared `computeTriggerPoints` dots, gap-through
dots on the bar open, per-set persist) and the code review's in-gate fixes
then simplified the render contract: **14 fixed series** — one packed
`history` series + one `active` per set-side — with every terminated
segment (including the unbounded persist fan) packed `y:null`-separated.

The end-user-visible surface was already executed under QA #1467 / UAT
`261-1467-1459-UAT-…md` (M1–M12 PASS on `/dev/flex-chart`, NFLX +
presets). This UAT covers what the in-gate collapse changed since that
pass: the render contract itself, not the controls.

## Getting to the feature

- **Route:** `/dev/flex-chart` (Savant Trader sandbox).
- **Entry point:** sidenav → Dev → Flex Chart Sandbox; enable **Anchored
  VWAP** in the indicators dropdown; open per-line controls via the
  `AVWAP…` toolbar button → Line 1 → `Persist` / `Confirms` toggles.
- **Surface:** the main chart pane — VWAP lines, teal leg overlay,
  confirmation dots.

## Automated scenarios

| # | Scenario | Evidence | Result |
|---|----------|----------|--------|
| A1 | 14-key fixed contract | `indicator-registry.spec.ts`, `chart-data-adapter.service.spec.ts`, indicator spec `EXPECTED_KEYS` | **PASS** |
| A2 | Unbounded persist packing — every terminated segment draws | indicator spec persist describe (`[[7,30],[17,30]]` spans, chunk count = terminated count) | **PASS** |
| A3 | No emitted index exceeds `lastBar` (clamped break) | `pack()` clamp + non-persist/persist span assertions | **PASS** |
| A4 | Non-persist alternation — line ends at next trigger bar | engine spec `endBar = next.trigger.barIndex`; invariant trigger-bar starts | **PASS** |
| A5 | Trigger-dot parity + gap-open dots | engine spec parity test (bar-for-bar vs fresh `computeTriggerPoints`); triggers spec | **PASS** |
| A6 | Legs/developing from surviving chain only | engine + invariants specs (superseded anchors draw neither) | **PASS** |
| A7 | Regression | `npx jest st-anchored-vwap st-zigzag.triggers chart-data-adapter indicator-registry flex-chart-sandbox avwap-settings-dialog` — 12/12 suites, **296/296 tests** | **PASS** |

## Manual checklist

| # | Check | Result |
|---|-------|--------|
| M1 | Persist ON (Line 1) on a busy symbol — the full fan renders: every confirmation dot gets a line to the right edge, no missing early lines, no stray "teleport" connectors inside the fan | PASS — tester |
| M2 | Right edge — no artifact/dot past the last bar (clamped break removed the phantom `bars.length` point) | PASS — tester |
| M3 | Persist OFF — alternating lines behave exactly as before (line ends where the next opposite-side line begins) | PASS — tester |

## Findings

None — full pass. QA issue #1472 → RESOLVED.

## Results log

**2026-11-12:** A1–A7 automated PASS (296/296 targeted tests). M1–M3 PASS
on tester confirmation — persist fan verified visually post-collapse
(single packed history series per side). Code review doc:
`261-835-1466-CODE-REVIEW-INDICATOR-LIB-indicator-lib-st-anchored-vwap.md`
(2 rounds, verdict PASS).
