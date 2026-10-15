**Topic:** Flex Chart Visual Polish  
**Topic Slug:** visual-polish  
**Thread:** Dev Flex Chart - enable save settings for dev use  
**Thread Slug:** dev-save-settings  
**Issue:** #928  
**Thread Parent:** #908  
**Topic Parent:** #213  
**Domain:** FLEX-CHART  
**Type:** TEST  
**Status:** Draft  
**Created:** 2026-10-08  
**Last Updated:** 2026-10-08  

# Test Plan: Flex Chart Sandbox — Persisted Settings & Param Editing (FE)

## E2E User Journeys

- Journey 1 (manual): open sandbox → change symbol, interval, indicators,
  toggle a ZigZag param → refresh → everything restores.
- Journey 2 (manual): click Reset to defaults → controls and chart return to
  factory state; refresh → still defaults (storage cleared).

## Integration Tests

- `flex-chart-sandbox.component.spec.ts`:
  - Seed `localStorage` with a valid blob → create component → signals
    restore (symbol, interval, logScale, dataMode, preset, TB dots,
    enabledIndicators, paramOverrides).
  - Change `enabledIndicators` / `paramOverrides` → auto-save effect writes
    the blob to `localStorage` (flush via `await setTimeout(0)` per
    AGENTS.md — `fakeAsync`/`tick` can't flush effect timing under native
    async).
  - A ZigZag override lands in `config().indicators` for `st-zigzag` —
    `params.devThreshold` reflects the override, other params stay default.
  - AVWAP overrides continue to reach `config().params` after the
    `paramOverrides` refactor (regression guard for the #872 form).
  - `resetSettings()` clears the key and resets every signal to defaults.
  - `localStorage` throwing (mocked `setItem` throwing) → component still
    renders, no error.

## Unit Tests

- `sandbox-settings.spec.ts` (pure functions — fastest seam):
  - `loadSandboxSettings(null)` → defaults.
  - Malformed JSON → defaults. Non-object → defaults.
  - `version` mismatch → defaults (whole blob discarded).
  - Unknown indicator id in `enabledIndicators` → dropped; known ids kept.
  - Unknown param key in `paramOverrides` → dropped.
  - Out-of-range number → clamped to `min`/`max`; wrong-type value → dropped.
  - `paramOverrides` for an option not in the picker list → dropped.
  - Round-trip: `save` → `load` returns the same settings.

## Test Seams

- Highest seam: component spec + jsdom `localStorage` (or a `setItem` spy) —
  covers restore-on-init, auto-save effect, reset, override→config path.
- Lower seam: pure `sandbox-settings` functions — all validation/drift rules
  tested without Angular.

## Existing Test Coverage

- `flex-chart-sandbox.component.spec.ts` already covers mode switching,
  interval buttons, indicator toggling, and the AVWAP param strip — extend it
  for persistence rather than creating a parallel harness.
- `IndicatorParamDef` consumers (`buildDefaultConfig`) already tested in
  `indicator-registry.spec.ts` — unchanged.

## Edge Cases

- Empty blob `{}` → all defaults.
- Blob with only some fields → those restore, rest default.
- `enabledIndicators` stored as `[]` → picker shows 0 enabled (an explicit
  user choice, not "missing" → does NOT fall back to defaults).
- Corrupt `localStorage` value mid-session (externally cleared/edited) →
  next load handles it; no crash.
- Dev indicator persisted as enabled while in synthetic mode → still enabled
  in state; checkbox remains disabled per existing synthetic-mode rule.
