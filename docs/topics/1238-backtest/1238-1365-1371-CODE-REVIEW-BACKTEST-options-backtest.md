**Topic:** Options Backtest  
**Topic Slug:** options-backtest  
**Thread:** Backtest Analytics  
**Thread Slug:** backtest-analytics  
**Issue:** #1365  
**Thread Parent:** #1266  
**Topic Parent:** #1238  
**Task:** #1371  
**Domain:** BACKTEST  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-03  
**Last Updated:** 2026-11-03  

# Code Review — #1371 Exit evaluators (pure)

## Verdict: **PASS** (one round; all findings remediated or carried forward with notes)

Pure ~170-line evaluator module + 20 evaluator specs (33 total under the
shared `test:options-analysis` run). Three-axis review found
**one Major** at the trust boundary (unbounded scan window) plus a
cluster of Minor handoff/documentation gaps — all remediated in-cycle.
No Critical findings; no structural rework warranted (TN explicitly
validated the kind-switch shape — "not a judo move, don't do it").

## Gate results

| Axis | Result |
|---|---|
| Thermo-Nuclear | **1 Major (fixed)** + 3 Minor + nits — deep trace verified float math, tie-breaks, clip semantics; flagged the missing expiry clip |
| Standards | PASS — conventions verified line-by-line vs siblings; 2 Minor (canonical-helper duplication, sentinel handoff) + nits |
| Spec | PASS — all 4 ACs met; registry semantics exact; TEST-BE evaluator matrix fully covered; worker-scope rows correctly excluded |
| Tests | `test:options-analysis` **33/33** · `test:options-replay` **65/65** (flaky env-dependent pick-doc test passed on rerun) · full jest **287/287 suites, 4,978/4,978** · `tsc --noEmit` + eslint + esbuild clean |

## Findings remediated in-cycle

| # | Sev | Finding | Fix |
|---|---|---|---|
| F1 | **Major** | Scan window unbounded — post-expiry bars could produce `exit` records past the contract's life and leak dead-contract marks into MAE/MFE | `evaluateExit` clips at `expiration` (first bar `date > expiration` ends the window); exits can only occur `<= expiry`; 3 new specs pin clip behavior for mark rules, dte-time, and unaffected pre-expiry fires |
| F2/M1 | Minor | `daysUntil` was a third copy of the canonical `calendarDaysBetween` — and the weaker one (no 10-char slice; ISO timestamps → NaN → silent never-fire) | Swapped to `calendarDaysBetween` from `common/pt-date-utils` (already in this domain's import graph); local helper deleted |
| F3/M2 | Minor | Empty-series sentinel `{entryMark, date: ''}` diverges from the contract's `pickDate` placeholder convention — worker could pass `''` verbatim into a YYYY-MM-DD field | Substitution duty documented in header handoff block + IMPL-BE §4 |
| — | Minor | Precondition block incomplete (series[0]=pick-day, YYYY-MM-DD dates, entryMark finiteness, NaN mechanism wrong for dte-time) | Header rewritten: explicit input contract + #1372 handoff notes |
| — | Minor | `dayIndex` (bar index) vs `daysHeld` (calendar days) divergence risk for the worker | Documented in header + IMPL-BE §4; worker derives via `calendarDaysBetween` |
| F4 | Minor | Test gaps: no post-expiry clip specs, tie-break unpinned, no EPS over-tolerance guard, no absolute-price never-fires, positional destructure of `EXIT_STRATEGIES` | 6 new specs (33 total): clip ×3, tie-break, EPS guard, price never-fires; destructure now keyed by `exitId` |
| F5 | Nit | Comment claimed "threshold 0.20 exactly" — actually `0.1999…96`; the test passes *because of* EPS | Comment corrected to name the float-noise regression case |
| F7 | Nit | `Pick<ExitScanResult, 'mae'|'mfe'>` union-indirection | Replaced with explicit `{mae: ExcursionPoint; mfe: ExcursionPoint}` |
| — | Nit | TEST-BE row 49 (expiry outcome) sat inside the evaluator matrix though it's worker scope | Annotated "(worker #1372)" in TEST-BE |

## Verified correct by trace (no findings)

- EPS applied on the right side of both inclusive comparisons (`<=` → `+EPS`, `>=` → `-EPS`); 1e-9 on cent-granularity marks can only admit intended-equal values.
- `calendarDaysBetween` UTC-midnight math — calendar-day DTE by design; weekend/holiday gaps correct.
- First-occurrence tie-break (strict `>`/`<`) — now test-pinned.
- Entry-mark baseline seeds excursion dated to `series[0]` — sound under the (now header-level) pick-day precondition.
- Non-termination is structural — independent `findIndex` per rule, no shared cursor; PRD story 6.
- Result union maps cleanly to `AnalysisExitTrade`/`AnalysisExpiredTrade`+`AnalysisErrorTrade` for #1372.
- Real-seed fixtures via `getExitStrategy`; no type-erased fixtures, no casts; convention-consistent with `start.test.ts`/`retry.test.ts`.

## Carried forward (for #1372 worker)

- **daysHeld:** `dayIndex` ≠ calendar days — derive `calendarDaysBetween(pickDate, exitDate)`.
- **Sentinel:** substitute `pickDate` for `''` in empty-series excursion (or write error record — worker owns that choice).
- **Series slicing:** worker must still ensure `series[0]` = pick-day bar (no pre-entry bars); the evaluator now handles the tail bound.
- **MAE/MFE direction:** short-premium convention (adverse = mark up). A long-premium template (#1270+) needs `side` fed into excursion direction — noted in IMPL-BE §4.
- **NaN marks:** worker drops/handles non-numeric observations; a NaN mark silently never-fires mark rules and would emit `exitPrice: NaN` on dte-time.
- **'Expired' check:** must use clip semantics (expiry date present among live bars), not `series.at(-1)` — a post-expiry tail makes the raw last bar misleading (round-2 addition).

## Round 2 — post-remediation verification (2026-11-03)

Three fresh axes on the remediated code. **All round-1 fixes verified
correct by trace** — clip bounds firing AND excursion on both paths,
strict-`>` keeps the expiry bar in-window (twice spec-pinned), prefix
slice preserves `dayIndex`, canonical helper is a strict robustness win,
clip specs are genuine regression tests (fail against pre-clip impl).

### Round-2 findings (all remediated in-cycle)

| # | Sev | Finding | Fix |
|---|---|---|---|
| TN-N1 | Minor | Clip raw-compared `b.date > expiration` while `calendarDaysBetween` tolerates ISO timestamps — an ISO-timestamped expiry bar would clip itself | `b.date.slice(0, 10) > expiration` — same tolerance at the same boundary |
| TN-N2 | Minor | Clip invites unclipped input → worker's naive `series.at(-1)` expired-check would write `error` for a genuinely-expired contract with a tail | Clip-semantics expired-check added to header handoff + IMPL-BE §4 |
| Spec | Minor | TEST-BE evaluator matrix had no clip row | Row added |
| Spec | Info | Symmetry gaps: no mark-rule fire ON the expiry bar; post-expiry marks only below entry (mae-side unpinned); unaffected-fire spec lacked excursion asserts | 3 additions: expiry-bar mark-rule fire; tail mark raised to 9.9 pinning mae exclusion; mae/mfe asserts |
| Std | Nit | Section banner covered specs under the next banner | Banners renamed to match contents |
| Std | Nit | Gate doc "33-spec suite" ambiguity | Clarified (20 evaluator + 13 start) |

### Round-2 traces confirmed safe

Unsorted input adds no new failure class (sortedness already a stated
precondition) · malformed `expiration` degrades to no-fire + placeholder
(out-of-contract) · `end===0` ≡ empty-series path · empty-window clip →
correct sentinel · purity (slice never mutates) · `StTriggeredBy` import
in `pt-date-utils` is type-only — zero bundle weight.

**Verdict after round 2: PASS stands — diminishing returns reached;
remaining items are worker scope or out-of-contract inputs.**
