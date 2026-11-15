# Code Review — Move + clean rb-st-trigger-bands.pine (#878)

**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** Implement ST Trigger Bands in ST Indicator Library  
**Thread Slug:** st-trigger-bands  
**Issue:** #874  
**Thread Parent:** #862  
**Topic Parent:** #261  
**Task:** #878  
**Domain:** INDICATOR-LIB  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-11-11  
**Last Updated:** 2026-11-11  

## Verdict: **PASS** (rounds 1–2 remediated in-loop)

Standards **PASS** · Spec **PASS** · Thermo-nuclear **PASS** — after two remediation rounds. Review sub-agents ran against the scoped diffs (`.devin/tmp/878-review.diff` r1, `878-r2-review.diff` r2; ~660 lines: the Pine rewrite, the new parity-audit script + guide, and the #878 registration rows in `verify/README.md`/`run-all.ts`). The working tree carries extensive unrelated uncommitted work from other threads (#1401/#1431/#1444 rows in the same registration files, option-chart, portfolio, AVWAP, MCP pagination), all excluded.

## Round 2 — the big one (re-verify + fresh eyes)

Round 2 (thermo fresh-eyes + standards/spec delta) found the round-1 "fix" was itself wrong — and uncovered a genuine compile blocker:

| Axis | Sev | Finding | Disposition |
|---|---|---|---|
| Thermo | **blocker** | **Pine v6 has no `nz()` bool overload** — official migration doc: "Boolean values can no longer be na, and na(), nz(), fixnan() no longer accept bool arguments." Every `nz(bool)` in the file (all flags, latches, state reads, both breakout conjunctions) would fail compilation — and the whole `nz` approach was v5 thinking anyway: in v6, comparisons and `ta.crossover/crossunder` on `na` history already yield `false`, which is *exactly* the engine's null-comparison semantics | **Fixed** — all `nz()` removed; expressions simplified to plain bools (semantically identical to the engine, and now they compile). Audit gained a forbidden `nz(` check |
| Thermo | minor | Lazy `and` short-circuits — `ta.crossover`/`ta.crossunder` behind a condition + `ta.highest`/`ta.lowest` behind the warm-up ternary get history-consistency warnings and can skip evaluation | **Fixed** — `crossUp`/`crossDn` hoisted to global scope; bands computed unconditionally into `upperRaw`/`lowerRaw`, ternary applies only the `na` mask |
| Thermo | minor | ATR comment off-by-one: first valid `ta.atr(14)` at index 13 (the 14th bar), not 14 | **Fixed** in file + guide |
| Thermo | minor | Comment stripper not escape/single-quote aware | **Fixed** — tracks the active quote delimiter and skips `\"`/`\'` |
| Std+Spec | minor | `force_overlay` claimed v6-only — actually exists in v5; v6 rationale is sibling consistency + bool-na semantics | **Fixed** — header + this doc corrected |
| Std+Spec | nit | "Wick variants removed" AC had no audit pin — raw `high`/`low` in bands would pass | **Fixed** — forbidden-check added (post-`bodyHigh`/`bodyLow` masking) |

Round-2 verified as still-correct: statement-order pin, `var bool` history semantics, reset-before-expansion ordering vs `st-trigger-bands.ts:88-95`, dot anchors, band colouring, `ta.atr(14)` ≡ engine Wilder ATR for index ≥13, 24→28-check audit all passing.

## Round 1 findings and dispositions

| Axis | Sev | Finding | Disposition |
|---|---|---|---|
| Thermo | major | `atrSeed` machinery was a semantic no-op: a `var` assigned at `bar_index >= 13` cannot retroactively fill `atr14` on bars 0–12 — Pine has no lookahead, so the "non-zero from bar 0" claim was false and bars <14 still got `na` | **Fixed** — reverted to plain `ta.atr(14) * 1.5` with an honest `KNOWN DIVERGENCE` comment (engine's retrospective seed is structural lookahead; pre-14 breakout dots can't match) |
| Standards | minor | Same ATR warm-up gap + overstated comment (converged with thermo) | Same fix — comment now states the bar-13 floor + `<14`-bar charts get no dots |
| Thermo | minor | `longBreakout`/`shortBreakout` could evaluate `na` (not `false`) when `ta.crossover` hits `na` history — benign today (all consumers treat `na` as false in ternaries) | **Fixed, then superseded** — r1 wrapped it in `nz()`; r2 removed all `nz()` as non-compiling in v6 (v6 bools can't be `na` anyway — the premise was v5 reasoning) |
| Spec | minor | Guide claimed `21 PASS` — actual check count was 23 | **Fixed** — guide now says 24 (post-remediation count) and documents remaining audit holes + Pine divergences |
| Standards/thermo | nit | Audit comment-stripping was whole-line only — a trailing `//` on a live line could false-fail | **Fixed** — quote-aware trailing-comment stripper |
| Standards | nit | Audit didn't pin `ta.tr(true)` as the TR source | Moot after remediation — dots now use `ta.atr(14)` (TR source internal to `ta.atr`) |
| Thermo | minor | Reset-before-expansion correctness depends on statement order (breakout → latch → state); regexes couldn't see it | **Fixed** — audit now pins order via per-line `indexOf` check |
| Thermo | nit | `length` input mutable; parity holds only at default 3 | **Fixed** — header/input comment notes the divergence condition |
| Thermo | nit | Realtime-bar repaint vs closed-bar engine | **Fixed** — one-line comment on the dot block |
| Spec | minor (advisory) | AC4 wording "pullback/breakout markers at the bar" is stale vs the #932 breakout-only-dots contract | Deferred by design — implementation follows the shipped contract (pullback = band colour, dots = breakout-only); flagged in case literal pullback dots are wanted for comparison |
| Spec | nit (advisory) | The scoped diff also contains a `#1431` registration row from another session's uncommitted work | Not #878 — only the `#878` rows get staged at commit |

## Non-findings verified by trace (all three axes)

- Bands = body Donchian-3 with `na` warm-up — identical to `computeStTriggerBands` (doji case included).
- Flag/state bools ↔ engine `cmp()` null→false (in v6, `na` comparisons yield `false` natively — no `nz()` needed or compilable); `ta.crossover(bodyHigh, upper[1])` expands exactly to the engine's `bh[t] > up1 && bh[t-1] <= up2`; `ta.crossover` precondition + expansion latch + reset-before-expansion ordering mirror `st-trigger-bands.ts` line-for-line; per-side independence preserved.
- Dots: breakout-only, `lower − 1.5·ATR` / `upper + 1.5·ATR` — matches `generateTriggerBandsDotMarkers` + `TRIGGER_DOT_ATR_MULT`.
- Band colouring preserves the original's convention (pullback paints the opposite side's colour; breakout paints its own).
- v6 decision correct: all sibling `rb-st-*` scripts are v6, and v6's bools-can't-be-na semantics match the engine's null→false comparisons exactly (v5's `na` bools were what made `nz()` necessary).
- Cleanup complete: zero residual `rbLib`, offsets, midpoint, retrace, wick variants, constant-value markers, `log.*`.
- `ta.atr(14)` ≡ engine Wilder recursion for `bar_index ≥ 13` (both seed `sma(tr,14)` then RMA); `ta.tr(true)` at bar 0 = `h−l` = engine `tr[0]`.

## Test results

- `indicator-lib-878-pine-parity.ts` — **28/28 PASS** (post-round-2; audit hardened: quote-aware comment stripping, statement-order check, `nz()`-forbidden and no-raw-wicks checks, hoisted-`ta.*` pins)
- `tests/functions/st-trigger-bands{,-series}.test.ts` — **38/38** green (engine unchanged by this task; regression floor)
- Full jest suite not re-run — this task changes no app/function code (a `.pine` file + a verify script + two registration rows); the prior 5,331/5,331 stands and other sessions' uncommitted WIP would confound a fresh run.
- Pine compile/runtime: **unverifiable locally** — the TradingView editor check is the pending manual UAT leg (AC5, deferred by design). The round-2 blocker was the one compile-risk item we *could* verify statically (v6 removed the `nz` bool overload — documented, confirmed); residual unknowns are `ta.crossover`/`crossunder` false-on-na behavior and plot rendering.

## AC accounting

1. File lives in `rb-ps/rb-ta/ind/` — **met** (already in-tree; cleaned in place)
2. Cruft removed — **met** (8 forbidden-pattern checks PASS)
3. Pine version decided + header note — **met** (v6 + rationale)
4. Bands/colour/markers per contract — **met** under the #932 breakout-only contract; stale AC wording flagged
5. Manual TV-vs-web UAT — **deferred** (user leg at QA)
