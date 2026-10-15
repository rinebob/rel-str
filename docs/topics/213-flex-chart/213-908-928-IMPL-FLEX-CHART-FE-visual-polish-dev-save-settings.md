**Topic:** Flex Chart Visual Polish  
**Topic Slug:** visual-polish  
**Thread:** Dev Flex Chart - enable save settings for dev use  
**Thread Slug:** dev-save-settings  
**Issue:** #928  
**Thread Parent:** #908  
**Topic Parent:** #213  
**Domain:** FLEX-CHART  
**Type:** IMPL  
**Status:** Draft  
**Created:** 2026-10-08  
**Last Updated:** 2026-10-08  

# Implementation Plan: Flex Chart Sandbox — Persisted Settings & Param Editing (FE)

Single area: **FE**. All code lives under
`src/app/features/savant-trader/pages/flex-chart-sandbox/`. No changes to
`FlexChartComponent`, `indicator-registry`, shared flex-chart services, or
any prod consumer.

## 1. Design

### 1.1 Persistence module — `sandbox-settings.ts` (new, colocated)

Pure, injectable-free module — trivially unit-testable, no Angular deps:

```ts
export const SANDBOX_SETTINGS_KEY = 'flex-chart-sandbox-settings';
export const SANDBOX_SETTINGS_VERSION = 1;

export interface SandboxSettings {
  version: number;
  symbol: string;
  interval: ChartIntervalKey;
  logScale: boolean;
  dataMode: 'real' | 'synthetic';
  preset: SyntheticPreset;
  triggerBandsDots: boolean;
  enabledIndicators: string[];
  /** optionId → paramKey → override value (sparse; absent key = default). */
  paramOverrides: Record<string, Record<string, number | string | boolean>>;
}
```

- `defaultSandboxSettings()` — current hardcoded defaults (QQQ, DAILY,
  logScale true, real, wide-ratio, TB dots off, DEFAULT_ENABLED_INDICATORS,
  empty overrides).
- `loadSandboxSettings(raw: string | null, options: IndicatorOption[]):
  SandboxSettings` — tolerant merge: `null`/malformed JSON/wrong `version` →
  defaults. Otherwise field-by-field validation against the live registry:
  drop unknown indicator ids; drop unknown param keys per option; coerce
  numbers and clamp to `min`/`max`; booleans/strings type-checked; missing
  fields fall back to defaults. Never throws.
- `saveSandboxSettings(settings: SandboxSettings)` → `localStorage.setItem`.
- `clearSandboxSettings()` → `localStorage.removeItem`.
- All three wrap `localStorage` access in try/catch (private-mode /
  disabled storage degrades silently to defaults).

### 1.2 Component wiring — `flex-chart-sandbox.component.ts`

- Every persisted signal initializes from `loadSandboxSettings` at field
  declaration: `symbol`, `interval`, `logScale`, `dataMode`, `preset`,
  `triggerBandsDots`, `enabledIndicators` (rebuilt as `ReadonlySet` from the
  stored array), and the new `paramOverrides` signal.
- **`paramOverrides` replaces `avwapOverrides`**: generalized to
  `signal<Record<string /*optionId*/, Record<string, number|string|boolean>>>`.
  `avwapValues` reads `paramOverrides()[avwapId]`; `setAvwapOverride` becomes
  a generic `setParamOverride(optionId, key, value|undefined)` — `undefined`
  deletes the key. The existing AVWAP block's semantics are unchanged
  (overrides kept across enable/disable).
- `config()` applies overrides generically: after `buildDefaultConfig(o)`,
  merge `{...cfg.params, ...paramOverrides()[o.id]}` for any option with
  overrides — not just AVWAP.
- Auto-save: one `effect()` in the constructor reads every persisted signal
  and calls `saveSandboxSettings`. Restoration happens via signal
  initializers (before the constructor runs), so the effect never writes
  stale state on load.
- Reset: a "Reset to defaults" button in the header calls
  `clearSandboxSettings()` and `.set()`s each signal back to
  `defaultSandboxSettings()` values.

### 1.3 ZigZag params strip — bespoke form (template)

Per the Thread decision: **each indicator gets its own form**, following the
existing `avwap-params` precedent. No generic editor is built.

- New `<div class="zigzag-params">` strip beside the AVWAP block, gated on
  `enabledIndicators().has(ST_ZIGZAG_INDICATOR.id)`.
- Fields (math params only — `lineColor` is appearance, excluded):
  - `devThreshold` — number input, min 0.1, max 50
  - `leftDepth`, `rightDepth` — number inputs, min 2, max 100
  - `allowZigZagOnOneBar`, `projectionPivots`, `showTriggerDots` — checkboxes
- Commits through `setParamOverride('st-zigzag', key, value)`; empty /
  non-numeric number inputs delete the override (same rule as AVWAP).
- AVWAP's existing strip (including the `historyStart` datepicker) is
  untouched except its overrides now route through `paramOverrides` and
  persist.

### 1.4 Prod isolation

Nothing in `shared/components/flex-chart/` or prod pages changes. The
`dev` flag and `ST_DEV_INDICATOR_OPTIONS` boundaries are untouched. The
localStorage key is sandbox-scoped; nothing else reads it.

## 2. File changes

| File | Change |
|---|---|
| `pages/flex-chart-sandbox/sandbox-settings.ts` | NEW — blob type, defaults, load/validate/merge, save, clear |
| `pages/flex-chart-sandbox/sandbox-settings.spec.ts` | NEW — unit tests for the module |
| `pages/flex-chart-sandbox/flex-chart-sandbox.component.ts` | Init signals from storage; `paramOverrides` signal replacing `avwapOverrides`; generic override merge in `config()`; auto-save effect; `resetSettings()` |
| `pages/flex-chart-sandbox/flex-chart-sandbox.component.html` | ZigZag params strip; Reset button |
| `pages/flex-chart-sandbox/flex-chart-sandbox.component.spec.ts` | Persistence round-trip, restore-on-init, reset, zigzag override → config.params |

## 3. Risks & edge cases

- **localStorage exceptions** (private mode, quota): all access wrapped; page
  still works, just doesn't persist.
- **Stale param values** (param renamed/removed): tolerant merge drops them;
  worst case the dev re-enters one field.
- **Enabled dev indicator + synthetic mode**: persisted enabled dev ids stay
  enabled; existing disable logic still applies (no callable data to draw).
- **Effect writes on first run**: restoration happens in field initializers,
  so the auto-save effect's first pass writes the already-restored state —
  a harmless no-op write.
- **`enabledIndicators` shape**: stored as `string[]` (JSON-safe), rebuilt to
  `ReadonlySet` on load.
