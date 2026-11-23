**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** Intraday Bar Strength (IBS)  
**Thread Slug:** intraday-bar-strength  
**Issue:** #1686 — QA: SHARED: computeIbs + availability  
**Thread Parent:** #1665  
**Topic Parent:** #261  
**Task:** #1675 — SHARED: computeIbs + availability  
**Domain:** INDICATOR-LIB  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-23  
**Last Updated:** 2026-11-23  

# UAT — SHARED: computeIbs + availability (#1675)

## Scope

This task delivered the canonical IBS function only — no consumers, no
UI. `shared/st-ibs.ts` exports `computeIbs(bar, timeframe, ctx?)` where
`timeframe` is narrowed to `'D' | 'W'`. IBS = `(C-L)/(H-L)` on a bar;
availability returns `undefined` while the bar is the current developing
ET period and `now` precedes activation (default `activateAtEtMin` = 720
→ 12:00 ET for daily; `activateAtWeekday` = 3 → Wednesday for weekly,
with Sunday treated as the trading-week tail). `undefined` is the
"filter not applicable" contract future gates (#1677/#1679) rely on.

Task acceptance criteria:

1. `computeIbs` returns `(C-L)/(H-L)` ∈ [0,1]; `high - low <= 0` → 0.5.
2. Returns `undefined` only while the bar is the current developing ET
   period AND `now` precedes activation; completed/past bars always
   return a number.
3. Defaults 720 / 3 overridable via `ctx`.
4. `@st/ibs` alias resolves from both runtimes (app jest mapper +
   functions tsconfig path).
5. Shared spec bed passes; no FE/BE call-site edits (contract-only task).
6. Review-round pins: Sunday monotonic weekly gate; `weekKey` rejects
   out-of-range components; availability precedes the zero-range guard.

## Prerequisites

- Repo at `C:\aa\projects\rel-str`, dependencies installed.
- No credentials, Firestore, dev server, or browser needed — the
  function is pure and every check is command-line.

## Getting to the feature

No route — this task has no user-facing surface. The "feature" is the
exported contract; the tester reaches it through two entry points:

- **App-side:** `npx jest shared/st-ibs.spec.ts --coverage=false` — the
  spec imports `computeIbs` via `@st/ibs` through the jest
  moduleNameMapper (proves the FE wiring).
- **BE-side:** `cd functions && npx tsx scripts/verify/indicator-lib-ibs-1675.ts`
  — imports via `@st/ibs` through functions/tsconfig paths (proves the
  BE wiring) and checks behavior at the real wall clock.

## Automated evidence (executed this session)

- `npx jest shared/st-ibs.spec.ts --coverage=false` — **26/26 green**
- `cd functions && npx tsx scripts/verify/indicator-lib-ibs-1675.ts` —
  **20/20 checks green**, incl. real wall-clock agreement
- `npx jest shared/ --coverage=false` — **55 suites / 1155 tests green**
- `npx jest --coverage=false` (full suite, review stage) — **329 suites
  / 6267 tests green**
- `npx tsc --noEmit -p tsconfig.spec.json` — clean

## Scenarios

### S1 — Value semantics on completed bars

- **Confirms:** AC 1.
- **Steps:** `npx jest shared/st-ibs.spec.ts --coverage=false` — the
  `value semantics` block pins 0.8 interior, 1.0 at high, 0.0 at low,
  0.5 midpoint, 0.5 zero-range, 0.5 inverted range.
- **Expected:** all 26 specs pass.
- **Result:** ☒ PASS — 26/26 (2026-11-23).

### S2 — Daily availability gate (injected clock)

- **Confirms:** AC 2 + AC 3, daily half.
- **Steps:** same spec run — `daily availability` block pins
  `undefined` at 11:59/08:00 ET on a today-dated bar, defined at the
  12:00 ET boundary and post-close, defined for yesterday/future-dated
  and date-less bars, and the `activateAtEtMin` override.
- **Expected:** all pass.
- **Result:** ☒ PASS — 26/26 (2026-11-23).

### S3 — Weekly availability gate (injected clock)

- **Confirms:** AC 2 + AC 3, weekly half + Sunday monotonicity (AC 6).
- **Steps:** same spec run — `weekly availability` block pins
  `undefined` Mon/Tue, defined Wed (default activation) onward,
  prior-week always defined, Monday-dated same-week bar treated as
  developing, `activateAtWeekday` override, malformed + rolled-over
  dates → defined, **Sunday of the current week → defined**
  (trading-week tail; gate stays monotonic across Sat→Sun).
- **Expected:** all pass.
- **Result:** ☒ PASS — 26/26 (2026-11-23).

### S4 — Real wall-clock agreement

- **Confirms:** AC 2 under the real clock, not an injected `now`.
- **Steps:** `cd functions && npx tsx scripts/verify/indicator-lib-ibs-1675.ts`
  — invokes `computeIbs` with no `ctx`; the script derives the
  expectation from its own independent `America/New_York` Intl read and
  asserts agreement for a today-dated D bar and a this-week W bar.
- **Expected:** `20 passed, 0 failed`; the printed ET time tells you
  which availability state the run legitimately observed.
- **Result:** ☒ PASS — 20/20 (2026-11-23, observed at ~01:11 ET Monday
  → D and W both correctly `undefined`).

### S5 — Alias resolution from both runtimes

- **Confirms:** AC 4.
- **Steps:** S1's spec file imports `computeIbs` from `'@st/ibs'`
  (jest moduleNameMapper → `shared/st-ibs.ts`); S4's script imports
  from `'@st/ibs'` (functions/tsconfig paths → `../shared/st-ibs.ts`).
  Both runs only pass if the alias resolves in each runtime.
- **Expected:** both green.
- **Result:** ☒ PASS — see S1/S4 evidence.

### S6 — Regression sweep

- **Confirms:** AC 5 — no regressions in the shared library.
- **Steps:** `npx jest shared/ --coverage=false`.
- **Expected:** all shared suites green.
- **Result:** ☒ PASS — 55 suites / 1155 tests (2026-11-23). Full suite
  (6267/6267) green at review stage.

## Manual UI/UX refinement pass

- Not applicable — no user-facing surface (pure contract function; no
  route, component, or indicator registration shipped in this task).

## Findings

None. All review-stage findings were remediated before this gate
(Sunday monotonicity, `'D'|'W'` narrowing, `weekKey` rollover guard,
weekday fallback `-1`, alias-import pin — each now covered by a spec).

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| AC 1 — formula ∈[0,1], degenerate range → 0.5 | S1 |
| AC 2 — availability `undefined` only for current developing period pre-activation | S2, S3, S4 |
| AC 3 — defaults 720/3 overridable | S2, S3 |
| AC 4 — `@st/ibs` alias both runtimes | S5 |
| AC 5 — spec bed green, no call-site edits | S6 |
| AC 6 — review pins (Sunday, rollover, ordering) | S3 |

## Regression / smoke

- `npx jest shared/ --coverage=false` — 55/55 suites, 1155/1155.
- Only config files outside `shared/` touched (three one-line alias
  entries + verify registration) — no FE/BE call-site edits by design.

## Verdict

**PASS** — all six scenarios green; contract surface verified end to
end (formula, both availability gates, real clock, both aliases).

## Results log

| Date | Task | Executor | Result | Notes |
|---|---|---|---|---|
| 2026-11-23 | #1675 | Devin (sess-20261122-0e5b) | PASS | S1–S6 green; verify script observed real 01:11 ET Monday state |
