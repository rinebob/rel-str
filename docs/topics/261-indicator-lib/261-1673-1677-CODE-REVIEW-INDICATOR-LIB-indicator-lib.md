**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** Intraday Bar Strength (IBS)  
**Thread Slug:** intraday-bar-strength  
**Issue:** #1673  
**Thread Parent:** #1665  
**Topic Parent:** #261  
**Task:** #1677  
**Domain:** INDICATOR-LIB  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-23  
**Last Updated:** 2026-11-23  

# Code Review — BE: IBS gate in ST Trend Rider signal detection (#1677)

**Verdict: PASS** — 3 parallel axes, 0 critical, 2 major (both resolved in-gate:
one documented deviation, one consciously deferred with a tracked
recommendation), all actionable minors remediated.

## Scope reviewed

- `functions/src/st-cloud-function/strategies/signal-detection.ts` —
  `IbsGateConfig` (extends `IbsAvailabilityContext`), `barIbs()` helper, gate
  inside `detectAllStTrendRiderSignals`, `ibs?` trailing params,
  `indicators.ibs`
- `functions/src/st-cloud-function/strategies/st-trend-rider/st-trend-rider.strategy.ts` —
  `ibsGateFromConfig`, `configSchema` block, gate wired to all 4
  `detectLastBarSignals` calls
- `tests/functions/st-signal-detection-ibs-1677.test.ts` — new node:test spec
  (registered under `test:signal-detection`)
- `functions/package.json` — spec registration (foreign hunks in the same file
  belong to other sessions — mine-only staging required at ship)
- `shared/st-ibs.ts` — one comment correction (weekday numbering)
- IMPL/TEST doc annotations

## Findings — MAJOR

### M1 — `indicator-computation.ts` marker path ungated (thermo + spec)

`generateZoneSignals` feeds `dotMarkers` — chart markers, not `st-signals`
ledger writes. Its `OHLCV` is a zero-filled date shim (`IndicatorDataPoint`
carries no OHLC), so real IBS cannot be computed there; passing a gate config
would fabricate `IBS=0.5` per bar and silently suppress every marker under any
non-default threshold. **Resolution:** deliberate deviation — left unfiltered;
the emitted/suppressed partition belongs to FE tasks #1679/#1680, which need
the full candidate set for the suppressed-marker series anyway. Recorded in the
IMPL doc's as-built notes; TEST doc's stale "gated markers" line annotated.

### M2 — Paper-trading replay models an ungated cohort (thermo)

`replay.ts` injects `detectAllStTrendRiderSignals` as a 5-arg dep → replayed
cohorts now include signals production would IBS-suppress. **Resolution:**
deferred — the fix is a one-line `replayDeps()` wrap (`detectSignals: (z,w,b,v,t)
=> detectAllStTrendRiderSignals(z,w,b,v,t,{})`), deterministic for historical
bars, but it crosses into Topic #553 and its wiring spec pins
`detectSignals === detectAllStTrendRiderSignals`. Documented in the IMPL doc's
as-built notes as a known gap with the concrete recommendation; needs a
paper-trading follow-up decision.

## Findings — MINOR (all remediated in-gate)

| # | Finding | Fix |
|---|---|---|
| m1 | `barIbs` ran per bar even when `ibs` omitted — per-bar `Intl.formatToParts` cost on unfiltered paths | compute lazily inside each candidate branch (long/short windows mutually exclusive) |
| m2 | `IbsGateConfig` redeclared `IbsAvailabilityContext` fields | `extends IbsAvailabilityContext`; only `threshold` declared |
| m3 | `detectLastBarSignals` JSDoc lacked `@param ibs` | added |
| m4 | `functions/package.json` diff carries foreign hunks (`test:gh-lifecycle`, `test:paper-trading`) | staging-hygiene note — mine-only hunk at commit |
| m5 | `1 − T` can round a ulp below the literal bound (T=0.15 → `0.8499…`); exact-boundary short wrongly suppressed | `<= 1 − T + Number.EPSILON` + spec pin (IBS 0.85 @ T=0.15 emits) |
| m6 | non-string/malformed `date`/`t` field bypassed availability silently | `typeof date === 'string'` guard in `barIbs` → `undefined` |
| m7 | short-side + V1-W spec coverage thinner than TEST doc scope | added V1-W short spec (suppress + emit) |

## NITs

- Fixed: "ISO weekday (0=Sun…6=Sat)" mislabel (it's `Date.getDay` numbering) —
  corrected in `IbsGateConfig` doc and `shared/st-ibs.ts`; merged duplicate
  `signal-detection` imports; `configSchema.step` hints added; spec assertion
  cleanup (`typeof ibs === 'number' && ibs > 0.8`); monotonic fixture dates;
  wall-clock assumption comment on `execute()` fixture.
- Consciously deferred: `threshold > 1` clamp (real paths validate via
  `configSchema`/`validateConfig` first — scope discipline); `activateAtWeekday`
  semantics for Sat/Sun (documented in schema description); verify script is
  task #1678's deliverable.

## Verified clean

- Suppression is emission-only — `FIRED` set before the gate check; spec pins
  no-refire on continued uptick and re-arm + new-uptick cases.
- `ibs` param omitted vs `{}` distinction — replay/`indicator-computation` stay
  regression-identical; `execute()` always gates (pinned).
- 6-param signature remains assignable to the 5-arg `ReplayDeps.detectSignals`
  dep; `paper-trading` suite 443/443 green.
- `indicators.ibs` (`number | null`) fits `ZoneSignal.indicators` and flows
  through `StrategyOutput.indicators` → persisted `st-signals` docs.
- `configSchema` fields are valid `ConfigSchemaField` shapes enforced by
  `StrategyRegistry.validateConfig` on worker + backtest paths.
- `@st/ibs` consumed via the path alias; `undefined` pass-through honored.

## Verification

| Check | Result |
|---|---|
| `test:signal-detection` (zero-cross + new IBS spec) | 52/52 |
| `execute()` integration (pinned 49-bar last-bar uptick) | 3/3 |
| `test:paper-trading` (injected-detector regression) | 443/443 |
| `test:sds` | green |
| `shared/st-ibs.spec.ts` | 26/26 |
| `npx jest --coverage=false` (full suite) | 6270/6270 |
| `npx tsc --noEmit -p functions/tsconfig.json` | clean for touched files (one pre-existing foreign error in `options-engine-eod-selection-1501.ts`) |
| `cd functions && npm run build` | clean |

## Convergence

Second pass complete — every finding across the three axes re-checked against
the final diff. Both majors have explicit resolutions (documented deviation +
documented deferral with recommendation); all minors remediated; remaining
nits consciously deferred with rationale.
