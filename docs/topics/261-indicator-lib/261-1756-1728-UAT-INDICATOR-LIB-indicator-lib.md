**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** IBS — Intraday Bar Strength  
**Thread Slug:** ibs  
**Issue:** #1756  
**Thread Parent:** #1665  
**Topic Parent:** #261  
**Task:** #1728  
**Domain:** INDICATOR-LIB  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-25  
**Last Updated:** 2026-11-25  

## Scope

The BE marker path (`generateZoneSignals` → `st_indicator_series`
callable → `dotMarkers`) now partitions zone candidates through the
shared `partitionByIbs` on **real OHLC bars** — the fabricated
zero-OHLC stub is gone. Web chart zone dots therefore match the
`st-signals` strategy-path emission and the TradingView Pine artifact.

Task acceptance criteria under test:

- Marker path runs `detectZoneUptickCandidates` +
  `detectZoneZeroCrossCandidates` + one merged `partitionByIbs` on real
  `OhlcBar[]` — no `{0,0,0,0}` fabrication
- `dotMarkers.zoneV*` shape is `{ emitted, suppressed }`; emitted set
  equals the strategy path's emitted set on the same bars
- `signals.zoneV*` is emitted-only and carries `ibs` on each marker
- FE reads `.emitted` — no runtime break on the new shape
- Post-filter suppression is emission-only (suppressed candidates never
  emit, never re-fire)

## Prerequisites

- Dev server already running (this change is live-computed per request;
  no persisted docs to migrate).
- Firebase auth account on the app (the `st_indicator_series` callable
  requires auth).
- Chrome DevTools (Network tab) for the payload-shape scenario.
- Terminal at the repo root for the automated leg.

## Getting to the feature

- Route: `/trading/chart-view` (nav: Savant Trader → chart view, or
  direct URL `http://localhost:4200/trading/chart-view`).
- Surface: the symbol chart page — zone V1/V2 dots render on the price
  pane via `dotMarkers` from the `st_indicator_series` callable
  response.
- The BE payload is observable verbatim in DevTools → Network → the
  `st_indicator_series` callable request → Response tab.

## Automated evidence

Executed before the manual leg (repo root):

- `cd functions && npx tsx scripts/verify/indicator-marker-path-ibs-1728.ts` —
  **28/28 checks** on real QQQ bars: marker-path emitted set equals
  strategy-path emitted set cell-for-cell (V1/V2 × D/W), suppression
  ~30% D / ~24–30% W (in line with the Pine artifact), suppressed
  markers carry `ibs`, emitted-only `signals.zoneV*`.
- `npx jest tests/functions/indicator-marker-path-ibs-1728.test.ts` —
  **17/17**: 4-cell parity vs strategy path, FIRED latch, availability,
  bar/interval misalignment throw, doc shape, suppression spec matrix
  incl. weekly.
- `npm run test:signal-detection` — 69/69.
- Full `npx jest --coverage=false` — 343/343 suites, 21,912 tests.
- `npx tsc --noEmit -p functions` — clean.

## Scenarios

### S1 — emitted dots render on the chart

- Feature: filtered zone markers reach the chart.
- Starting state: signed in, on `/trading/chart-view`.
- Steps: load symbol `QQQ`, interval `D` (daily). Wait for the chart to
  populate.
- Expected: zone dots appear on the price pane (long candidates below
  bars, short candidates above — same visual language as before this
  change). No console errors mentioning `dotMarkers`, `zoneV1`, or
  `emitted`.
- Evidence: screenshot / user observation.

### S2 — payload shape: `emitted` + `suppressed`

- Feature: the new `ZoneDotMarkers` doc shape reaches the client.
- Starting state: chart loaded for `QQQ` `D` (S1 done).
- Steps: DevTools → Network → find the `st_indicator_series` callable
  request → Response. Drill `intervalData.daily` (or the response JSON
  path the callable returns for the daily interval) → `dotMarkers`.
- Expected: `dotMarkers.zoneV1` and `dotMarkers.zoneV2` are objects
  shaped `{ emitted: [...], suppressed: [...] }` — **not** flat arrays.
  `suppressed` is non-empty (IBS suppression is active; ~25–30% of
  candidates on recent QQQ data per the automated run). Every
  `suppressed[]` entry carries an `ibs` field. `signals.zoneV1` /
  `zoneV2` are flat arrays whose lengths equal the matching
  `emitted.length`.
- Evidence: pasted JSON excerpt (redact nothing — no secrets in this
  payload).

### S3 — suppression is emission-only (spot check)

- Feature: a suppressed candidate never emits.
- Starting state: S2 response open.
- Steps: in the `suppressed[]` array, pick one entry and note its
  `timestamp`/`t` and `ibs` (should fail the filter, e.g. `ibs` < 0.5
  for a long). Search `emitted[]` and `signals.zoneV*` for the same
  timestamp.
- Expected: the suppressed timestamp is absent from `emitted` and from
  `signals.zoneV*` — suppression removes the dot entirely rather than
  deferring it.
- Evidence: the timestamp pair + "absent from emitted" confirmation.

### S4 — FE renders without the suppressed ghost layer

- Feature: FE reads `.emitted` only; suppressed markers are shipped but
  not rendered yet (deferred to #1680).
- Starting state: S1 chart.
- Steps: visually confirm the dot count corresponds to `emitted.length`
  from S2 (no extra faint/ghost dots where `suppressed` entries sit).
  Count is approximate — pick 3–4 `suppressed` timestamps and confirm
  no dot renders at those bars.
- Expected: dots only at emitted positions; suppressed bars are clean.
- Evidence: user observation vs S2 timestamps.

### S5 — negative: no regression on non-zone markers

- Feature: trendStrength + indicator series unaffected.
- Starting state: S1 chart for `QQQ` `W` (weekly).
- Steps: switch interval to weekly; confirm the chart renders, dots
  appear, and `dotMarkers.zoneV*` again shows `{emitted, suppressed}`
  in the response for the weekly interval.
- Expected: weekly payload has the same new shape; dots render; no
  console errors.
- Evidence: user observation + optional response excerpt.

## Manual UI/UX refinement pass

The change alters which dots appear, not how they render — the visual
language is unchanged (same dot styling, colors, positions). The
refinement pass reduces to: dots still render at plausible swing
positions on D and W; no obviously missing or doubled markers; no
layout or loading regressions on the chart page. Covered by S1/S4/S5
observations.

## Findings

- None — all five manual scenarios passed on user drive (2026-11-25).

## Traceability

| Task AC | Scenario |
|---|---|
| Real OHLC, no zero-stub; shared detectors + one partition | Automated (spec + 28-check verify) |
| Emitted == strategy-path emitted | Automated + S3 |
| `dotMarkers` shape `{emitted, suppressed}`; `ibs` on suppressed | S2 |
| FE reads `.emitted`, no runtime break | S1, S4 |
| Suppression is emission-only | S3 |
| Non-zone regression | S5 |

## Regression / smoke

- Chart loads for `QQQ` D and W without errors (S1, S5).
- `signals.zoneV*` emitted-only lengths match `emitted` (S2).
- Full jest + functions tsc + signal-detection suite green (Automated
  evidence).

## Verdict

**PASS** — automated leg (28/28 verify, 17/17 spec, 69/69 suite, 343/343 jest) plus all five manual scenarios confirmed on user drive.

## Results log

| Check | Result | Evidence |
|---|---|---|
| Automated: verify script 28/28 | PASS | QQQ real bars, emitted==strategy, suppression ~24–30% |
| Automated: new spec 17/17 | PASS | jest output |
| Automated: signal-detection 69/69 | PASS | node --test |
| Automated: full jest 343/343 | PASS | 21,912 tests |
| Automated: functions tsc | PASS | clean |
| S1 emitted dots render | PASS | user drive, QQQ D — dots render, no console errors |
| S2 payload shape | PASS | user drive — `{emitted, suppressed}` shape, `ibs` on suppressed, signals == emitted |
| S3 emission-only suppression | PASS | user drive — suppressed timestamp absent from emitted/signals |
| S4 no ghost layer rendered | PASS | user drive — dots only at emitted positions |
| S5 weekly + non-zone regression | PASS | user drive, QQQ W — same shape, dots render, no errors |
