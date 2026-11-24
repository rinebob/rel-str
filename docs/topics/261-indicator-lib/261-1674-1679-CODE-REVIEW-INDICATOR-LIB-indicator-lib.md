**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** Intraday Bar Strength (IBS)  
**Thread Slug:** intraday-bar-strength  
**Issue:** #261  
**Thread Parent:** #1665  
**Topic Parent:** #261  
**Task:** #1679  
**Domain:** FE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-23  
**Last Updated:** 2026-11-23  

# CODE-REVIEW — #1679 FE: IBS gate in `detectZoneUptickDots` + `UptickDotResult` partition

**Verdict: PASS** — 3 axes (standards / spec / thermo) over the FE diff:
the IBS gate + emitted/suppressed partition in `detectZoneUptickDots`,
both dots indicators' `showSuppressedSignals`/`ibsThreshold` params, the
`-suppressed` ghost-series machinery in `base-indicators`, and the
sandbox TWO_DAY caller + params strip. Four MAJOR findings raised and
resolved in-gate; all actionable minors fixed; remaining items are
documented NITs/deferrals.

## Scope reviewed

- `src/app/features/shared/components/flex-chart/indicators/st-trend-rider-dots.indicator.ts` — `UptickDotResult`, `UptickDotsIbsConfig`, IBS gate, indicator params
- `src/app/features/shared/components/flex-chart/indicators/st-trend-rider-dots.indicator.spec.ts` — new (13 cases)
- `src/app/features/savant-trader/utils/chart-indicators/base-indicators.ts` — `addSuppressedDots` + `ChartExtras.uptickDotsV{1,2}Suppressed`
- `src/app/features/savant-trader/utils/chart-indicators/base-indicators.spec.ts` — 3 suppressed-series cases
- `src/app/features/savant-trader/utils/chart-indicators.ts` — barrel export
- `src/app/features/savant-trader/pages/flex-chart-sandbox/flex-chart-sandbox.component.{ts,html}` — caller update, dots params strip
- `src/app/features/savant-trader/pages/flex-chart-sandbox/flex-chart-sandbox.component.spec.ts` — 4 params-strip/ghost-seam cases
- `shared/flex-chart-indicator-visuals.ts` — `ST_SUPPRESSED_DOT_COLORS`

## Findings — resolved in-gate

| Severity | Finding | Resolution |
|---|---|---|
| MAJOR (standards) | FIRED-parity spec vacuous — `DATES` had 4 entries, the 5-bar fixture produced a NaN date and the candidate never reached the gate | `zones(ys, dates)` parameterized; test feeds all 5 dates; suppression now genuinely exercises FIRED-consumption |
| MAJOR (standards) | Gate-active specs used the wall clock — a run before noon ET on a fixture date would flake every `suppressed` assertion | `NOW` pinned (2026-12-01) on every gate-active call; availability specs inject their own `now` |
| MAJOR (standards + spec + thermo, all three axes) | `showSuppressedSignals`/`ibsThreshold` had no UI writer — the ghost path was dead code reachable only via hand-edited localStorage; IMPL §5 scoped the toggle | ZigZag-pattern params strip added (`dots-params-{id}`, one per enabled dots option) + 4 component specs pinning strip→override→ghost-series |
| MAJOR (spec) | IMPL's caller premise wrong — only the sandbox consumes `detectZoneUptickDots`; prod surfaces use BE `dotMarkers` | As-built notes on IMPL + TEST docs; not a code defect — the AC "all callers compile" held trivially |
| MINOR (all axes) | Missing BE non-finite OHLC guard — NaN IBS would suppress where BE emits | `barIbs` guards finiteness → `undefined` → pass-through; spec added |
| MINOR (standards) | `rgba()` literals hand-copied RGB triples — comment-pinned hue parity | Ghost colors derived via hex-8 alpha (`solid + '59'`) — structural parity |
| MINOR (standards) | `UptickDotsIbsConfig` truncated `IbsAvailabilityContext` (no activation fields) | Now `extends IbsAvailabilityContext` — full BE `IbsGateConfig` parity |
| MINOR (standards) | Stale JSDoc/file header (missing `@param ibs`/`@returns`, "Pre-computed in signal-detail") | Header rewritten — gate semantics + the one real caller documented |
| MINOR (standards) | Mid-file import block in `base-indicators.spec.ts` | Imports consolidated at top |
| MINOR (standards) | `addSuppressedDots` absent from the `chart-indicators` barrel while every sibling `add*` is exported | Exported |
| MINOR (thermo) | No component spec for the only live seam (param→suppressed→series) | 4-case describe added: strip visibility, override commit/clear, threshold clamp→gate, ghost series id+color+placement |
| NIT | Test-name mismatches, stray `?`, duplicated fixture branch, `ibsT` naming, hard-coded suppressed ids | Fixed |
| NIT (accepted) | Two push-site gate expressions duplicate the bound formulas | Accepted — mirrors the BE's own side-by-side layout; side-specific parity comments |
| NIT (accepted) | `?? p.color` fallback renders unknown-color suppressed dots solid | Unreachable with canonical colors; noted |
| NIT (accepted) | No clamp inside `detectZoneUptickDots` for out-of-range `threshold` | Unreachable — `onParam`/`sanitizeParamValue` clamp on both write paths; library-hygiene only |

## Deferred / documented (not defects in this task)

- **D/W suppressed markers**: BE `dotMarkers` are deliberately the
  ungated candidate view (zero-OHLC shim can't compute IBS — #1677
  as-built). The suppressed data source for D/W is #1680's scope;
  `ChartExtras.uptickDotsV{1,2}Suppressed` + `addSuppressedDots` are the
  generic machinery ready to receive it.
- **Sandbox 2D `emitted` is now gated at 0.5** — intended per the PRD,
  but the IMPL's blanket "existing charts render identically" claim is
  inaccurate for the ONE surface that calls the function. As-built noted.
- **FE-vs-BE null-gap pairing** (pre-existing): FE zone calculators
  filter null warmups so the machine pairs across gaps where BE resets.
  Requires corrupt/missing bars; warmup-equivalent in practice.
- **Leading-zero / htf-null handling** — structural divergences from BE
  in unreachable branches; noted by thermo, no action.

## Verified correct (all three axes agree)

- **Gate arithmetic**: `v >= T` long / `v <= 1−T + Number.EPSILON` short
  — line-for-line parity with `signal-detection.ts`; inclusive bounds spec'd.
- **Suppression is emission-only**: FIRED consumed either way — spec'd.
- **`undefined` IBS pass-through** — unfiltered arg, unavailable bar, and
  non-finite OHLC all emit; spec'd.
- **`emitted` regression-identical** — same push sites, same order, same
  objects; partition is additive.
- **Mutual exclusivity**: long needs `htfZone > 0`, short `< 0` — a bar
  can't produce both; a candidate lands in exactly one bucket.
- **Params additive** — sparse `paramOverrides` blob; persisted configs
  unaffected; `sanitizeOverrides` clamps numbers.
- **Suppressed series identity** — `${cfg.id}-suppressed` collides with
  nothing; `@for` track keys, `enabledIndicators`, and converter
  type-matching are unaffected.
- **2D 'D' availability** — `foldBars` stamps the pair's end date; a pair
  ending today is developing pre-noon ET — correct parity.

## Verification

- `npx jest st-trend-rider-dots base-indicators flex-chart-sandbox` → 128/128
- `npx jest chart-indicators signal-detail quick-charts` → 60/60
- `npx tsc --noEmit -p tsconfig.app.json` → clean
