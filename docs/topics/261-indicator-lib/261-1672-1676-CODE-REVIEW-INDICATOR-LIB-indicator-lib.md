**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** Intraday Bar Strength (IBS)  
**Thread Slug:** intraday-bar-strength  
**Issue:** #1672  
**Thread Parent:** #1665  
**Topic Parent:** #261  
**Task:** #1676  
**Domain:** INDICATOR-LIB  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-24  
**Last Updated:** 2026-11-24  

# Code Review — SHARED: Pine IBS gate in `rb-st-zones.pine`

**Verdict: PASS**

Diff reviewed: `rb-ps/rb-ta/ind/rb-st-zones.pine` (+~70/−4 after in-gate
remediation) — the only file in scope. Manual TradingView verification
remains the QA-stage acceptance path (no Pine compile harness exists).

## Pass sequence

- First pass — 3 axes in parallel: 0 critical, 0 major after remediation,
  5 minor → 1 fixed in-gate, 4 documented; 8 nits → 4 fixed, 4 accepted/noted.
- Second pass — re-read the remediated gate block + full-diff coverage
  sweep: all fixes landed coherently, no stray references, no unexamined
  hunk. No new findings.
- Convergence: PASS — converged after remediation + clean second pass.

## First pass complete — findings summary

### Standards axis

- **Verified Pine v6 APIs** (docs-confirmed): `hour(time, timezone)`,
  `dayofweek(time, timezone)` (returns 1=Sunday…7=Saturday), `timenow`,
  `barstate.isrealtime`, `timeframe.isweekly`, `color.new`, input/plot
  signatures. High-confidence compile.
- **Minor M1 — weekly Sunday divergence** (`:208`): `dayofweek >= 4`
  excluded Sunday, but `st-ibs.ts` maps Sunday→7 (developing week is
  defined on Sunday — spec'd at `st-ibs.spec.ts:148-153`). **Fixed in
  gate** — `stIbsEtDow` normalizes Sunday→7, compared against
  `dayofweek.wednesday`.
- **Minor M2 — missing `Number.EPSILON` ulp guard** on the short bound
  (TS guards both gates; T=0.15 → `1−T = 0.8499999999999999`). **Fixed
  in gate** — `+ 1e-15`.
- **Minor M3 — `isrealtime` ≠ "bar dated today"**: stale realtime bars
  (Friday's bar pre-open Monday) count as developing. Inherent to the
  `barstate` approximation — **documented in the header** rather than
  fixed (a date-equality guard would thicken the approximation for an
  already-disclaimed edge).
- **Minor M4 — no `ibsActivateWeekday` input**: BE `StrategyConfig`
  exposes the weekday; Pine hardcodes Wednesday. Accepted config-parity
  gap; noted in the IMPL as-built section.
- **Nits fixed in gate:** `*Input` suffix broke the file's `st*`
  convention → `stIbsThreshold`/`stIbsActivateHourEt`/`stShowSuppressed`;
  magic `4` + duplicated `"America/New_York"` → `ST_ET_TZ` +
  `dayofweek.wednesday`.
- **Nits noted (no action):** realtime pre-activation marker flicker
  (mirrors FE recompute — expected); `color.red`/`color.lime` base-hue
  drift vs FE hex (pre-existing, on emitted markers, not this change).

### Spec axis

- **AC accounting — (a) gated markers don't plot:** MET (`stIbsLongPass`
  /`stIbsShortPass` partition all four emits; inclusive bounds match TS).
- **(b) zero-range → 0.5, no NaN:** MET (`(high−low) <= 0 ? 0.5`; also
  covers inverted range, matching `st-ibs.ts:117`).
- **(c) inputs + defaults:** MET (0.5/12/false; step 0.05; min/max).
- **(d) suppressed render dimmed behind toggle:** MET (`color.new(c,65)`
  ≈35% opacity = FE `'59'` alpha; Pine has no hollow channel — "dimmed"
  satisfies the disjunction).
- **(e) ungated unchanged when disabled:** MET (threshold 0 → all pass;
  `na`/`!available` pass-through; state machines untouched).
- **(f) manual TradingView verification:** DEFERRED to QA — no
  `*1676*` UAT doc yet (expected; QA-stage artifact, same as #1675's
  flow).
- **`timenow` vs IMPL's literal `time`:** correction, not deviation —
  `time` is the bar-open timestamp and never reaches noon on a daily
  realtime bar. IMPL as-built note added.
- **`dayofweek >= 4` vs IMPL's `>= 3`:** correct Pine mapping of TS
  Wednesday (Pine Sun=1; `>=3` would be Tuesday).
- **Zero-cross dots ungated:** parity confirmed — BE
  `detectAllZoneZeroCrossSignals` takes no `ibs` param.
- **Nit noted:** `functions/scripts/verify/*-pine-parity.ts` convention
  exists for mechanically-checkable Pine contracts; an optional parity
  audit could follow — not a spec requirement (manual UAT is the
  prescribed test path).

### Thermo-nuclear axis

- **Emission-only suppression CONFIRMED correct:** `stV*State := 1`
  latches inside the event blocks before the gate partitions — a
  suppressed candidate can't re-fire (BE `FIRED` parity). Consequence for
  QA: a suppressed first uptick means *the whole swing* emits nothing —
  intended, not a bug.
- **Repaint characteristics documented:** historical bars deterministic
  (gate always applies); realtime bar's `stIbsAvailable` flips at the
  activation instant so an unfiltered pre-noon marker can disappear at
  12:00 — mirrors FE/BE undefined→pass semantics; flag in UAT.
- **Ghost design OK:** mutual exclusivity holds (`emit`/`supp` partition);
  65% transparency ≈ 35% opacity = FE treatment; 16 plots < 64 limit.
- **Nits noted:** replay reports `isrealtime` while `timenow` is real
  wall clock (header now names it); intraday hosts gate on the intraday
  bar's IBS with same-day reload inconsistency (header now says "only
  meaningful on D/W hosts").

## Second pass complete — findings summary

Re-read the remediated gate (`:201-224`), inputs (`:33-38`), header
(`:11-25`), emit/ghost plots (`:234-245`): Sunday→7 + `>=
dayofweek.wednesday` yields Wed–Sun available, Mon–Tue unavailable —
exact TS parity. `1e-15` guard placed on the short bound only (long bound
is exact in both impls). All renamed identifiers resolve; no orphaned
`showSuppressedInput`/`*Input` references; every changed hunk passed
through at least two axes. IMPL as-built section records all four
doc-vs-code corrections so the loose literals can't be "fixed back".

## Convergence

PASS — first pass surfaced one shared real gap (Sunday weekly parity)
plus minors, all remediated or documented in-gate; second pass found
nothing new. Pine has no automatable compile surface here, so
verification is the QA-stage TradingView manual check.

## Findings by severity

- **Critical / Major:** none.
- **Minor:** 5 — Sunday parity (fixed), EPSILON guard (fixed),
  stale-realtime-bar gap (documented), missing weekday input
  (accepted gap), bar-replay wall-clock divergence (documented).
- **Nit:** 8 — 4 fixed (naming, magic 4, tz hoist, IMPL doc drift),
  4 noted (hue drift pre-existing, emit/supp factoring, cross-family
  ghost overlap, optional pine-parity verify script).

## Test results

`npx jest shared/st-ibs.spec.ts` — 26/26 green (canonical function
unchanged; the Pine file has no jest surface). Manual TradingView
verification on SPY daily = QA scenario.
