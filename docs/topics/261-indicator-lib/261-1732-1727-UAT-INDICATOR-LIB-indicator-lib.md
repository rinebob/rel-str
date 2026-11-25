**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** Intraday Bar Strength (IBS)  
**Thread Slug:** intraday-bar-strength  
**Issue:** #1732  
**Thread Parent:** #1665  
**Topic Parent:** #261  
**Task:** #1727  
**Domain:** INDICATOR-LIB  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-24  
**Last Updated:** 2026-11-25  

# UAT — #1727 SHARED: hoist ST signal engines + IBS filter stage into `shared/`

This is a **refactor task** — the acceptance claim is parity: same rendered
dots, same emitted/suppressed sets, same signal records, one canonical
engine body where there were three. Nothing new should appear on any
surface; nothing old should change.

## Scope

Task acceptance criteria (issue #1727):
1. One body each for zone math, uptick state machine, zero-cross detection — in `shared/`, imported by `functions/` and `src/app`.
2. No detector takes an IBS/filter param; `partitionByIbs` is the only emit path.
3. `detectZoneUptickDots` deleted as a reimplementation; FE emits from shared candidates (suppressed partition + ATR placement preserved).
4. Strategy path + sandbox produce identical emitted/suppressed sets on the same bars (spec-pinned).
5. gate→filter rename complete across code + docs.
6. All moved specs travel and pass; functions build + jest green.

Review-round fixes also covered: `ibs` type-enforced off candidates,
`emitZoneSignals` composition, `detectLastBarSignals` param-order
alignment, new `shared/st-signal-detect.spec.ts` edge pins.

Deferred (tracked, not this UAT): **#1731** — FE band-overlay/band-width
indicators still carry a private copy of the band engine (incl. a NaN
carry-forward drift); **#1724** — Pine "gate" comment + zero-cross filter;
**#1728** — the BE marker path still feeds a zero-OHLC stub to the
partition (filtering there is physically impossible until it lands — D/W
doc dots are unchanged by design).

## Prerequisites

- The dev server is already running — do NOT start a server or open a browser for the tester. Write every step against the already-running app.
- Signed-in session (the sandbox route is auth-guarded).
- For the real-data scenarios: symbol **SPY** (has full stored daily bars — the #1678 baseline: ~39% V2 suppression at T=0.5).

## Getting to the feature

- **Route:** `/dev/flex-chart` (dev sandbox — the only surface that runs client-side detection; prod surfaces render backend `dotMarkers` verbatim)
- **Entry point:** sign in → navigate directly to `http://localhost:4200/dev/flex-chart`
- **Surface:** FlexChart Sandbox page — Real data mode, **2D interval**
- **Controls:** `ST indicators` picker (header right) → enable `ST Trend Rider V1` (and/or `V2`) → params strip `ST Trend Rider V1 dots (2D only)` appears with **Show Suppressed Signals** + **IBS Threshold**.

## Automated evidence (executed this session)

- `npx jest --coverage=false` — **339 suites / 6,491 tests, all green**
- `npx jest shared/st-signal-detect.spec.ts shared/st-signal-filter.spec.ts .../st-trend-rider-dots.indicator.spec.ts .../st-zone.indicator.spec.ts .../st-zone-v2.indicator.spec.ts .../flex-chart-sandbox` — **147/147** incl. the cross-surface parity describe (emitted `[2]`, suppressed `[4,7]` identical on both emit compositions)
- `cd functions && npm run test:signal-detection` — **52/52**; `test:st-cloud-function` — **17/17**; `test:sds` — **81/81**; `test:st-signals` — **34/34**
- `cd functions && npm run build` — clean (esbuild, no errors)
- `npx tsc --noEmit -p tsconfig.json` — 15 pre-existing errors in foreign files only (`scripts/bulk-swing-sweep.ts`, `portfolio-dashboard.store.spec.ts`); zero in touched files
- `cd functions && npx tsx scripts/verify/indicator-lib-shared-engine-1727.ts` — **41/41 checks** on real SPY `symbol-data` bars: BE emit wrappers ≡ raw shared detectors + `partitionByIbs` across V1/V2 × D/W × uptick/zero-cross; partition completeness; detectors carry no `ibs`; record `indicators.ibs` == partition `ibs`

## Scenarios

| # | Scenario | Steps | Expected | Result |
|---|---|---|---|---|
| S1 | Sandbox dots — V1, 2D | Real mode, symbol **SPY**, click **2D**, enable `ST Trend Rider V1` | Colored uptick dots at the same bars as pre-hoist (zone upticks under a positive window), placed low−ATR·2.5 (long) / high+ATR·2.5 (short) | ✅ PASS — user-confirmed (2026-11-25) |
| S2 | Ghost partition intact | Check **Show Suppressed Signals** | Dimmed ghosts appear at IBS-rejected candidates — same placement math, ~35% alpha same hue family. Roughly ~1/3 of candidates ghost at V2/T=0.5 | ✅ PASS — user-confirmed (2026-11-25) |
| S3 | Threshold live repartition | Set **IBS Threshold** to `0.7` | Ghost set grows on next render; set `0.3` → shrinks. No reload needed | ✅ PASS — user-confirmed (2026-11-25) |
| S4 | V2 parity | Enable `ST Trend Rider V2` | Independent dots + ghost series (V2's wider zone range — more dots, more ghosts) | ✅ PASS — user-confirmed (2026-11-25) |
| S5 | Zone rendering unchanged | Enable `ST Zone V1`/`V2` + bands if available | Zone-colored bars + bands render identically to before — the FE indicators now delegate to the shared engines (strict up/dn flags adopted; a doji-difference requires exact float equality after two EMAs — unreachable in practice) | ✅ PASS — user-confirmed (2026-11-25) |
| S6 | D/W surfaces unchanged | Switch to **D** or **W** on the same symbol | Backend `dotMarkers` render exactly as before — the marker path was deliberately not touched (#1728 supplies real OHLC + partition) | ✅ PASS — user-confirmed (2026-11-25) |
| S7 | Synthetic mode unaffected | Switch to synthetic bars mode, re-enable dots | Synthetic series renders; dots machinery handles the synthetic bars the same way (same emitter, synthetic OHLC) | ✅ PASS — user-confirmed (2026-11-25) |
| S8 | BE parity vs records (automated) | — | The verify script's 41/41 proves the BE emit path ≡ the shared-engine path the FE uses — emitted/suppressed sets identical by construction | ✅ 41/41 on SPY (2026-11-24) |
| S9 | Param persistence | Set threshold `0.6` + ghosts on, reload | Both restore from `paramOverrides`; Reset returns defaults | ✅ PASS — user-confirmed (2026-11-25) |

## Negative / boundary checks (automated — spec-pinned)

- Developing-bar pass-through: a signal on today's bar pre-noon ET emits (undefined IBS) — `st-signal-filter.spec.ts`
- Inclusive bounds: `ibs == 0.5` emits BOTH directions at T=0.5; EPSILON ulp guard at T=0.15 — `st-signal-filter.spec.ts`
- Latch-before-partition: a suppressed uptick still consumes READY→FIRED (no double-fire) — `st-trend-rider-dots.indicator.spec.ts` + `st-signal-detect.spec.ts`
- NaN-window reset; leading-zeros skip; NaN-in-zone asymmetry (uptick flat vs zero-cross break); zero-bar neutrality; cross-through-zero non-firing — `st-signal-detect.spec.ts`
- Detector is filter-agnostic *by type*: `ibs` enters only via `Partitioned<T>` — compile-time + verify-script check

## Manual UI/UX refinement pass

- Params strip unchanged in layout/copy; threshold field + ghosts toggle behave as before the refactor (S2–S4, S9 cover the interactive pass).
- **Result:** ✅ PASS — user-confirmed sandbox pass (2026-11-25)

## Findings

None observed in automated acceptance. The review's only "critical" was a false positive (foreign-session hunks in the shared working tree — the ship commit must stage only this session's declared file scope, noted on the QA issue).

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| AC1 one body each (shared/, both importers) | S5, S8 + automated (tsc both sides, barrel re-export) |
| AC2 detectors filter-agnostic; partition only emit path | S8 + negative pins (spec + verify "carry no ibs") |
| AC3 detectZoneUptickDots = emitter (partition + ATR preserved) | S1–S4 + spec suite |
| AC4 strategy ≡ sandbox emitted/suppressed sets | S8 (parity spec + 41/41 real-data) |
| AC5 gate→filter rename | grep-verified: zero `IbsGate`/`"IBS gate"` in live code/docs (Pine comment deferred to #1724) |
| AC6 specs travel + builds green | Automated evidence block |

## Regression / smoke

- Zone/bands overlay on sandbox (S5) — the delegation touched the same code path that colors every zone bar.
- D/W doc-rendered surfaces (S6) — untouched path, confirms no accidental doc-shape change.
- Strategy `st-signals` emission — verify script proves emit-set identity; next nightly run's records carry `indicators.ibs` as before.

## Verdict

**PASS** — all automated acceptance green; S1–S7 + S9 user-confirmed identical rendered behavior on the sandbox (2026-11-25).
