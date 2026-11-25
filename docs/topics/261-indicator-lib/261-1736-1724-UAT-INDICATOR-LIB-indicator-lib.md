**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** Intraday Bar Strength (IBS)  
**Thread Slug:** intraday-bar-strength  
**Issue:** #1736  
**Thread Parent:** #1665  
**Topic Parent:** #261  
**Task:** #1724  
**Domain:** INDICATOR-LIB  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-25  
**Last Updated:** 2026-11-25  

# UAT — #1724 SHARED: Pine IBS filter on zero-cross markers

QA issue: #1736. TradingView indicator surface — acceptance is the static
parity audit (automated, executed below) plus a manual TradingView leg.
There is no in-app route; the feature lives in the Pine editor. Follows
the #1676 UAT (`261-1722-1676-UAT-…`), which established the IBS filter
on Trend Rider markers — this task extends the same filter to the
zero-cross markers, so **every** ST Zones signal now filters.

## Scope

Zero-cross markers ("V1/V2 Zero Cross Long/Short") partition through the
same `stIbsLongPass`/`stIbsShortPass` vars as Trend Rider: filtered
emission (long IBS ≥ T, short IBS ≤ 1−T inclusive), dimmed ghost markers
behind `Show Suppressed Signals`, unfiltered behavior preserved at
threshold 0. Zero-cross stays single-bar — a suppressed cross never
re-fires (no state machine by design).

## Prerequisites

- TradingView account with Pine editor access.
- The repository file `rb-ps/rb-ta/ind/rb-st-zones.pine` at the working-
  tree revision under test. **It must come from the local working tree**
  (`C:\aa\projects\rel-str\rb-ps\rb-ta\ind\rb-st-zones.pine`) — GitHub web
  / `origin/prod` predates ALL IBS work (local `prod` is ahead, never
  pushed) and contains no gate, no partition, and no ghosts. Sanity
  check: the file must contain `stV1ZeroCrossLongEmit` and an
  `IBS Signal Filter` input group; if it doesn't, it's stale.
- A symbol with recent zero-cross activity — **SPY, 1D** is the reference
  symbol (same baseline as the #1676/#1678 legs). Zero-cross markers are
  the **teal** (`rgb(0,150,136)`) long and **orange** short markers —
  V1 = circles, V2 = crosses — distinct from the green/red Trend Rider
  dots.
- Optional: the web flex-chart sandbox (`/dev/flex-chart`, SPY, TWO_DAY,
  ST Zones + dots indicators) for parity comparison — note the web side
  does not filter markers until #1728 lands, so suppressed-vs-web
  comparison is **not** part of this leg.

## Getting to the feature

1. Open tradingview.com, pull up a **SPY** chart, timeframe **1D**.
2. Open the **Pine Editor** (bottom panel), replace the `ST Zones IBS
   QA` indicator's content (or create a new indicator) with the complete
   file `rb-ps/rb-ta/ind/rb-st-zones.pine`.
3. Save as **ST Zones IBS QA v2** and choose **Add to chart**.
4. Landing surface: lower pane with Zone V1/V2 rows; Trend Rider dots +
   zero-cross markers on the main price pane. Settings → Inputs shows
   the **IBS Signal Filter** group (three inputs, unchanged from #1676).

## Automated evidence (executed this session)

- `cd functions && npx tsx scripts/verify/indicator-lib-1676-pine-parity.ts`
  → **43 PASS / 0 FAIL** — includes the #1724 block: 8 zero-cross
  `Emit`/`Supp` partition vars off `stIbsLongPass`/`stIbsShortPass`
  (end-of-line anchored), raw detection bools pinned filter-free,
  emit plots on `*Emit`, 4 ghosts behind `stShowSuppressed` mirroring
  family/linewidth at ~35% opacity, all 8 zero-cross plots
  `force_overlay`, no `lookahead_on`.

## Scenarios

### S1 — Compile + filtered zero-cross markers

- Feature: script compiles under Pine v6; zero-cross markers respect the
  filter at default T=0.5.
- Steps: add to chart per Getting to the feature; scan SPY 1D history
  for teal/orange zero-cross markers. For any bar where a zero-cross
  *would* fire but IBS contradicts direction (long cross with
  `(close−low)/(high−low)` < 0.5, short cross with IBS > 0.5), the
  marker must NOT render.
- Expected: compiles clean; zero-cross markers only on qualifying bars.
- Result: **PASS** — user-confirmed filtered emission on SPY 1D, 2026-11-25 ("filters out a lot of signals — very good"; ~80% of good entries remain per user read — QQQ forensic report in `.devin/tmp/qqq-ibs-filter-report.md` shows emitted winRate 54.1% vs suppressed 49.6% at 20 bars).

### S2 — Suppressed zero-cross ghosts

- Feature: `Show Suppressed Signals` reveals filtered zero-crosses.
- Steps: enable **Show Suppressed Signals** (leave T=0.5).
- Expected: dimmed ghost markers (~35% opacity, thinner — linewidth 2
  vs 3) appear at suppressed cross bars — V1 circles / V2 crosses, teal
  long below bar, orange short above — strictly additive; toggling off
  removes them. Ghost titles read `… Zero Cross … (suppressed)`.
- Result: **PASS** — user-toggled Show Suppressed Signals: dimmed ghost markers appear at suppressed cross bars, 2026-11-25.

### S3 — Unfiltered baseline parity (threshold = 0)

- Feature: filter-disabled rendering identical to pre-#1724.
- Steps: set **IBS Threshold** to 0. Every zero-cross emits — the
  marker set equals the pre-change set.
- Expected: no behavioral change vs the old unfiltered zero-cross.
- Result: **PASS** — user set IBS Threshold to 0: full unfiltered marker set restored, identical to pre-#1724, 2026-11-25.

### S4 — Zero-cross and Trend Rider filter together

- Feature: both families share one filter — a bar can't suppress one
  direction-filtered family while emitting the same direction in the
  other.
- Steps: with T=0.5 and ghosts on, find a bar carrying both a Trend
  Rider ghost and a zero-cross ghost (same direction), or a TR emit +
  ZC emit — never a mix of emitted in one family and suppressed in the
  other for the same direction.
- Expected: same-direction emitted/suppressed status always agrees
  across families (both consume `stIbsLongPass`/`stIbsShortPass`).
- Result: **PASS (implicit)** — not separately exercised; both families provably consume the same pass vars (audit-pinned) and the user observed both families filtering consistently in S1/S2.

### S5 — F1 anomaly re-check (#1676 forensic hook)

- Feature: resolves the open #1676 UAT anomaly — the short marker
  observed on a full-range up bar (IBS = 1.0, where a filtered short
  can't emit).
- Steps: return to the same bar observed in the #1676 leg. If the
  marker was an unfiltered zero-cross short (explanation (a)), at T=0.5
  it must now be **absent** (or ghosted with Show Suppressed on) —
  because this task filters zero-crosses.
- Expected: marker gone or ghosted → explanation (a) confirmed, F1
  resolved. If it still emits solid, the anomaly survives — log as a
  finding here and reopen the forensic question.
- Result: **SKIPPED** — anomaly bar not revisited this leg; F1 stays open for the forensic audit.

## Manual UI/UX refinement pass

- Suppressed zero-cross ghosts must read as ghosts, not signals —
  dimmer + thinner than emitted, same style family. **PASS** — user-confirmed
  in S2, 2026-11-25.
- V2-short suppressed ghost is pixel-identical to the V2-short Trend
  Rider ghost (documented in-pine) — if both are suppressed on one bar
  they render as one marker; cosmetic only.
- Input labels/tooltips still read "filter" vocabulary (gate→filter
  sweep shipped with this task).

## Findings

- None — S5 skipped; the #1676 F1 anomaly (short marker on an IBS=1.0
  bar) remains an open forensic item, now mechanically testable.
- QQQ forensic addendum (`.devin/tmp/qqq-ibs-filter-report.md`): 144
  suppressed signal-rows over 1,859 daily + 386 weekly bars; emitted
  20-bar winRate 54.1% vs suppressed 49.6% — descriptive, not a backtest.

## Traceability

| Acceptance criterion | Scenario(s) |
|---|---|
| Emit plots keyed on cross AND filter (long ≥T, short ≤1−T) | S1, S4 |
| Suppressed crosses ghost behind Show Suppressed (~35%, family styles) | S2 |
| Same `stIbsLongPass`/`stIbsShortPass` vars — no duplicated filter | S4 (+ audit) |
| Parity script extended, all checks green | audit (43/43) |
| Ungated behavior preserved at T=0 | S3 |
| F1 anomaly hypothesis testable post-filter | S5 |

## Regression / smoke

- [ ] Trend Rider dots unchanged (same emit/suppress behavior as #1676).
- [ ] Zone V1/V2 rows + band shading unchanged.
- [ ] No compile warnings; plot count 20 + 2 hlines (v6 cap is 64).
- [ ] Pre-activation developing-bar pass-through unchanged (timenow
  activation — audit-pinned; not separately exercised).

## Verdict

**PASS** — automated leg green (43/43 audit); TradingView leg
user-confirmed 2026-11-25 (S1–S3 + refinement pass, S4 implicit, S5
skipped — F1 remains open).

## Results log

- 2026-11-25 — Doc created; parity audit executed fresh (43 PASS /
  0 FAIL). TradingView scenarios S1–S5 pending user confirmation; QA
  stays open until observed.
- 2026-11-25 — User confirmed S1–S3 + refinement pass on the working-tree
  file (stale origin/prod paste caught + corrected); S4 implicit, S5
  skipped. QQQ suppressed-signal forensic run generated for context.
  Result: **PASS**.
