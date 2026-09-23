# CODE REVIEW — Edge cases + PRD acceptance pass in sandbox

**Topic:** Flex Chart Maintenance  
**Topic Slug:** flex-chart-maint  
**Thread:** Fix Log Scale Y-Axis  
**Thread Slug:** fix-log-y-axis  
**Issue:** #476  
**Thread Parent:** #469  
**Topic Parent:** #468  
**Task:** #482  
**Domain:** FLEX-CHART  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-09-22  
**Last Updated:** 2026-09-22  

## Verdict: PASS (two majors found, both fixed in-gate before this doc)

The gate initially returned FAIL on two Thermo-nuclear majors. Both were
fixed immediately with regression tests, the flex-chart suite re-verified
green, and the gate re-evaluated as PASS.

## Summary of axes

### Standards — clean

- `nicePriceTicks` decade-aware branch consumed correctly by the facade
  (`chart-lifecycle-facade.service.ts:171`); floor clamp consistent with
  `toLogAxis`.
- Adapter spec assertions match the real contract: `pane === 'main' |
  'overlay'` transform (`chart-data-adapter.service.ts:164`), OHLC for
  trend bands, `y` for std-dev/zigzag; lower-pane ST indicator stays raw.
- Fullscreen (`setFullscreen` in OnInit/OnDestroy), `document:click` +
  Escape dismissal, and `height="100%"` flex chain all match established
  sibling patterns (option-chain, option-chain-pct-change, swing-analysis).
- Spec hygiene clean: jest APIs, no `fakeAsync`/`as any`/no-assert tests.
- Out-of-scope note: `app.config.ts` carries an unrelated auth fix —
  `setPersistence` guarded to once-per-page-load so dev-server HMR
  re-bootstrap can't wipe the Firebase session. Reviewed lightly; correct
  and consistent with the file's existing idioms. Flagged for ship-time
  (consider a separate commit or call-out in the commit body).

### Spec — acceptance criteria

| Criterion | Status |
|---|---|
| ≤0 values clamp to floor and render without error | Met in math (floor clamp unit-tested + `non-positive` preset); render is manual-verify |
| Empty / single-bar / all-equal | Met at strategy level (`computeViewport([])` → `{0,1}`, `FLAT_PAD`); render is manual-verify |
| Rapid linear↔log toggling during dataBind | Race-mitigation code present (try/catch dataBind, scale-flip re-snap, non-clearing resetViewport); **manual-verify only** |
| Extreme ratio 0.01→10,000 extents + labels | Met (unit): decade ticks, extents below/above bounds asserted |
| PRD stories verified in sandbox; debug readout | Readout implemented + spec'd; numeric confirmation is manual-verify |

### Thermo-nuclear — two majors, both fixed

1. **MAJOR (fixed)** — `formatPrice` collapsed every sub-$1 label to
   `"$0"`/`"$1"`, defeating the `penny` preset. Now magnitude-aware:
   ≥$1 unchanged (round + separators); <$1 renders significant decimals
   (`$0.15`, `$0.001`). `price-format.spec.ts` added.
2. **MAJOR (fixed)** — `nicePriceTicks` linear fallback emitted
   non-positive ticks when `priceLo ≤ 0` (floor-pinned viewport + penny
   range) — a smear of stripLines clamped to the axis floor. Loop start
   now clamps to `LOG_AXIS_FLOOR`; FP drift removed via integer
   multiplier + `toFixed(10)` (also fixes the drift nit). Regression
   tests: non-positive lo, inverted range → `[]`, flat range → `[min]`,
   and an all-ticks-positive-and-in-range invariant.

### Minors / nits (non-blocking, recorded)

- `chart-data-adapter.service.spec.ts:32` — `as unknown as FlexChartDataset`
  fixture cast; harmless, adapter only reads `bars`/`interval`.
- `nicePriceTicks` ignores `targetCount` in the multi-decade branch —
  doc-comment could note it.
- Sandbox spec header cites task #477; newer files cite #478/#482 —
  cosmetic traceability drift.
- No `LinearScaleStrategy` regression spec — linear pass-through is
  covered indirectly by adapter specs.
- No facade-level integration spec (axis min/max written in log units,
  stripLines populated) — candidate follow-up; the strategy and label
  seams are unit-covered, the rest is manual sandbox verification.
- Callable indicator pipeline (`indicatorStore.responseFor`) is triggered
  but not consumed by the sandbox — overlays are computed locally from
  bars. Meets PRD intent for axis-alignment verification; noted.
- `document:click` HostListener schedules a CD pass per click — trivial on
  a dev sandbox page.

### Deferred to manual QA pass (documented for the QA issue)

- Render check: `non-positive` preset clamps and renders without error.
- Rapid linear↔log toggle during live dataBind — watch for artifacts.
- Tooltip/crosshair/gutter label correctness on real Syncfusion events.
- Debug readout values match the displayed axis numerically.

## Test results

Full suite: **1721 passed / 125 suites** (includes unrelated option-chain
work in the tree — all green). Flex-chart scope: **162 passed / 13
suites** after the two fixes (+6 tests).
