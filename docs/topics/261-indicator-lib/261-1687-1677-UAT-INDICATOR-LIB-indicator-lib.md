**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** Intraday Bar Strength (IBS)  
**Thread Slug:** intraday-bar-strength  
**Issue:** #1687  
**Thread Parent:** #1665  
**Topic Parent:** #261  
**Task:** #1677  
**Domain:** INDICATOR-LIB  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-23  
**Last Updated:** 2026-11-23  

# UAT — BE: IBS gate in ST Trend Rider signal detection (#1677)

## Scope

Backend contract change — no user-facing route. The IBS gate inside
`detectAllStTrendRiderSignals`, `StrategyConfig` plumbing through
`st-trend-rider.strategy.ts`, `configSchema` validation, and `indicators.ibs`
on emitted signals.

## Getting to the feature

There is no UI surface. Entry points are the test/script commands:

- `cd functions && npm run test:signal-detection` — node:test suite
  (`signal-detection-zero-cross` + `st-signal-detection-ibs-1677`)
- `cd functions && npm run test:paper-trading` — injected-detector regression
- `cd functions && npm run build` — esbuild bundle

## Prerequisites

- Review PASS: [CODE-REVIEW doc](261-1673-1677-CODE-REVIEW-INDICATOR-LIB-indicator-lib.md)
- #1675 (shared `computeIbs`) shipped — `600201b8`
- Working tree contains this task's diff: `signal-detection.ts`,
  `st-trend-rider.strategy.ts`, `functions/package.json` (own hunk),
  `tests/functions/st-signal-detection-ibs-1677.test.ts`

## Scenarios

### S1 — Gate semantics (long/short bounds, inclusive)

- **Confirms:** long emits iff signal-bar IBS ≥ T; short iff IBS ≤ 1−T.
- **Evidence:** spec pins 0.8/0.4/0.5 long and 0.2/0.6/0.5 short at default
  T=0.5; threshold override T=0.6 (long 0.55 suppressed, 0.65 emitted; short
  bound tightens to 0.4); ulp pin T=0.15 exact-0.85 short emits.
- **Result:** ☒ PASS — `st-signal-detection-ibs-1677.test.ts` describes
  "long signals" / "short signals" / "threshold override" all green.

### S2 — Suppression is emission-only (state integrity)

- **Confirms:** a suppressed candidate still transitions READY→FIRED; a
  continued uptick does not re-fire; re-arm + new uptick is gated on its own bar.
- **Evidence:** state-machine-integrity describes (4 specs) — suppressed-then-
  continued = 0 signals; re-arm + passing bar emits at its index; re-arm +
  failing bar suppressed again; omitted-param regression `[2,4]` both emit.
- **Result:** ☒ PASS.

### S3 — Availability pass-through

- **Confirms:** `undefined` IBS (developing bar pre-activation, or missing
  OHLC) lets the candidate through; post-activation the gate applies.
- **Evidence:** injected `now` — daily today @09:00 ET emits (ibs→null) vs
  @13:00 ET suppressed; weekly Mon emits vs Wed suppressed; missing-H/L/C bar
  emits with `ibs: null`.
- **Result:** ☒ PASS.

### S4 — `indicators.ibs` on emitted signals

- **Confirms:** emitted signals record `ibs` (`number | null`) and it flows
  through `StrategyOutput.indicators` to the persisted `st-signals` doc.
- **Evidence:** spec asserts `indicators.ibs` values (0.8/0.2/0.9/0.5/null);
  `ZoneSignal.indicators` type `Record<string, number|string|null>`;
  `signal-date-writer.ts` persists `indicators` verbatim (verified in review);
  `execute()` spec asserts `typeof ibs === 'number' && ibs > 0.8` on the
  emitted `D_ST_TREND_RIDER_V1_LONG`.
- **Result:** ☒ PASS.

### S5 — `StrategyConfig` plumbing + `configSchema` validation

- **Confirms:** `ibsThreshold`/`ibsActivateAtEtMin`/`ibsActivateAtWeekday`
  map through `ibsGateFromConfig`; `now` never set (wall clock); the registry
  validates declared fields.
- **Evidence:** `ibsGateFromConfig` specs (mapping, empty→defaults, non-numeric
  ignored); `execute()` empty-config spec gates at default; live
  `strategyRegistry.validateConfig` run 2026-11-23:

  ```text
  { ibsThreshold: 'high' }   → invalid: "expected number, got string"
  { ibsThreshold: 1.5 }      → invalid: "1.5 > max 1"
  { ibsActivateAtWeekday: 9} → invalid: "9 > max 6"
  { ibsActivateAtEtMin: 12.5}→ invalid: "expected integer, got 12.5"
  { 0.6, 600, 4 }            → valid
  {}                         → valid
  ```
- **Result:** ☒ PASS.

### S6 — Regression-identical unfiltered paths

- **Confirms:** `ibs` param omitted → identical candidate list; replay and
  `indicator-computation` call sites unaffected.
- **Evidence:** spec pins `[2,4]` both emitting unfiltered; `test:paper-trading`
  443/443 (injects the real detector as 5-arg dep); `indicator-computation.ts`
  untouched (documented deviation — chart markers are the candidate view until
  #1679/#1680 partition them).
- **Result:** ☒ PASS.

### S7 — `execute()` end-to-end on real zone math

- **Confirms:** the full strategy path — `computeStTrendBands` →
  `computeStZone`/`V2` → `detectLastBarSignals` — suppresses/emits on the
  last bar's IBS under config.
- **Evidence:** pinned 49-bar fixture (zone tail …2→3 on last bar); IBS≈0.43
  → no `D_ST_TREND_RIDER_V1_LONG`; IBS≈0.86 → emits with `indicators.ibs` >0.8.
- **Result:** ☒ PASS.

### S8 — Suites + build

- **Confirms:** the change is green in every suite that touches it.
- **Evidence (2026-11-23, post-review-fixes):**
  `test:signal-detection` 52/52 · `test:paper-trading` 443/443 ·
  `test:sds` green · `shared/st-ibs.spec.ts` 26/26 ·
  `npx jest --coverage=false` 6270/6270 · `cd functions && npm run build`
  clean · `npx tsc --noEmit -p functions/tsconfig.json` clean for touched
  files (one pre-existing foreign error in
  `options-engine-eod-selection-1501.ts`).
- **Result:** ☒ PASS.

## Manual UI/UX refinement pass

Not applicable — no user-facing surface (pure BE detection contract).

## Findings

None. The replay-parity known gap (`replay.ts` injects the detector
unfiltered → replayed cohorts include IBS-suppressed signals) is a documented
deferral in the IMPL as-built notes — a Topic #553 follow-up decision, not a
QA failure of this task's scope.

## Traceability

| QA checklist item | Scenario |
|---|---|
| Gate semantics + `undefined` pass-through | S1, S3 |
| Emission-only suppression / FIRED consumed | S2 |
| `indicators.ibs` → `st-signals` | S4 |
| `StrategyConfig` keys + `configSchema` | S5 |
| Omitted param → regression-identical | S6 |
| Suites green | S8 |
| Doc set | header links + IMPL/TEST annotations |

## Verdict

**PASS** — all 8 scenarios green with recorded evidence.

## Results log

| Date | Scenario / check | Result | Evidence |
|---|---|---|---|
| 2026-11-23 | S1–S3, S6 gate + state machine | PASS | spec suite 27 IBS specs green (`test:signal-detection` 52/52 total) |
| 2026-11-23 | S4 indicators.ibs | PASS | spec asserts values incl. null; writer persists verbatim |
| 2026-11-23 | S5 validateConfig | PASS | live registry run — 4 rejections + 2 acceptances printed above |
| 2026-11-23 | S7 execute() integration | PASS | 3 specs on pinned 49-bar uptick fixture |
| 2026-11-23 | S8 suites/build/tsc | PASS | numbers in S8 evidence |
