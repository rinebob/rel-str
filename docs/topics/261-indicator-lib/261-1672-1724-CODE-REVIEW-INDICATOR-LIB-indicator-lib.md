**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** Intraday Bar Strength (IBS)  
**Thread Slug:** intraday-bar-strength  
**Issue:** #1672  
**Thread Parent:** #1665  
**Topic Parent:** #261  
**Task:** #1724  
**Domain:** INDICATOR-LIB  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-24  
**Last Updated:** 2026-11-24  

# CODE REVIEW — #1724: Pine zero-cross IBS filter (rb-st-zones.pine)

**Verdict: PASS** — after in-gate remediation of 1 major and 6 minors/nits.

## Pass sequence

- **First pass** — three axes ran in parallel (Standards, Spec, Thermo-nuclear) over the scoped diff (`.devin/tmp/1724-review.diff`, 270 lines: `rb-st-zones.pine` + `indicator-lib-1676-pine-parity.{ts,md}`). Surfaced 1 major (unanchored partition pins), ~6 minors/nits, zero criticals.
- **Second pass** — remediated all actionable findings in-gate; re-ran the parity audit (**43/43**).
- **Convergence: PASS** — no unresolved critical/major findings; residuals are recorded nits or explicitly deferred items (#1728 BE marker path).

## Scope reviewed

- `rb-ps/rb-ta/ind/rb-st-zones.pine` — 8 new `stV*ZeroCross*{Emit,Supp}` partition bools off the same `stIbsLongPass`/`stIbsShortPass` vars; 4 emit plots re-keyed to `*Emit`; 4 new ghost plots behind `stShowSuppressed` (~35% opacity, linewidth 2, V1 circles / V2 cross); gate→filter vocabulary sweep.
- `functions/scripts/verify/indicator-lib-1676-pine-parity.ts` — extended to 43 checks; the pre-#1724 "zero-cross stays unfiltered" pin inverted into partition + detection + plot pins.
- `functions/scripts/verify/indicator-lib-1676-pine-parity.md` — guide updated to the 43-check contract.

## Axes summary

### Standards
Clean — no critical/major. Pine conventions preserved: partition vars sit adjacent to the Trend Rider block, ghost family mirrors emitted styles, `force_overlay` on all marker plots, no `lookahead_on`. Plot budget: 20 `plot()` + 2 `hline()` — well under Pine v6's 64 cap.

### Spec (per-AC)
- **AC1 MET** — emit plots keyed on `*ZeroCross*Emit = cross AND pass`; long requires `ibs ≥ T`, short `ibs ≤ 1−T`.
- **AC2 MET** — 4 ghosts behind `stShowSuppressed` + `*Supp`, `color.new(…, 65)`, V1 circles / V2 cross, linewidth 2, same placement offsets as emitted.
- **AC3 MET** — zero-cross partitions off the identical `stIbsLongPass`/`stIbsShortPass` vars; zero new filter logic.
- **AC4 MET** — parity script +14→43 checks, all green; unfiltered pin inverted.
- **AC5 MET** — at T=0 both pass vars go true unconditionally (`ibs ≥ 0` / `ibs ≤ 1+margin`) — structural, not convention.
- **MEDIUM (deferred, not blocking)** — BE production marker path (`indicator-computation.ts`) still calls detectors unfiltered on fabricated zero-OHLC bars, so TradingView and the web chart diverge on suppressed zero-crosses until **#1728** lands (real-OHLC + filter wiring). Deliberately scoped out of this task.
- **LOW → remediated** — the removed negative pin on raw ZC vars left a silent partition-regression hole; restored as the detection pin (below).

### Thermo-nuclear
20/64 plots fine; partition composition mirrors the TR block exactly — no semantic drift path. **1 major:** unanchored substring pins — `…and stIbsLongPass` regexes matched `stIbsLongPassDaily` or a trailing `and stFoo` (applied to both new ZC checks and the pre-existing TR checks). Remediated with `\s*$` + `m` anchoring. Minors remediated: raw detection expressions unpinned (coverage regression — old unfiltered check pinned `stZoneV1[1] < 0 and stZoneV1 > 0`; nothing re-pinned it); count-free `.every()` on the ZC `force_overlay` check; `1e-15` mislabeled "Number.EPSILON parity" (~4.5× wider — pre-existing wording, now honest); "crosses each direction boundary once" comment overstated the invariant; V2-short ZC ghost pixel-identical to V2-short TR ghost (noted in-pine; cosmetic overlap only — same-bar co-suppression renders as one marker); `'(suppressed)'` title-string coupling now flagged as load-bearing above the opacity check.

## Remediation log (in-gate)

1. Partition pins anchored — `\s*$` + `m` on all 16 emit/supp regexes (TR + ZC).
2. Detection pin restored — `stV{1,2}ZeroCross{Long,Short}` must equal the raw sign-flip expressions end-of-line, and a negative pin fails if any `Ibs` token reaches the raw bools (`(?!\w)` guards against Emit/Supp suffix false-positives). Folding the filter into the raw bools would silently kill every `*Supp` — now caught.
3. ZC `force_overlay` check now asserts `length === 8 && every(…)` (can't vacuously pass on zero matches).
4. `gateStart` → `filterStart` residual; "ghost plots filtered behind" → "ghost plots behind"; "EPSILON parity" wording → honest "permissive ulp margin (wider than TS EPSILON, same direction)" in both the check name and the pine comment.
5. Pine comments corrected: single-bar-event invariant stated precisely; V2-short ghost overlap noted without an unverified can't-co-fire claim.
6. `.md` guide updated: 43-check contract, anchored-pin + detection-pin documentation.

## Test results

- Pine parity audit: **43 PASS / 0 FAIL** (was 41 pre-remediation; +2 detection pins)
- jest full suite: **338 suites passed / 3 failed; 6,657 tests passed / 1 failed** — all three failures are **foreign**: `topic-viewer.store.spec.ts` + `topic-viewer-page.component.spec.ts` fail to compile (TS syntax errors + `groupOrder`/`group`/`topicSections` references — the concurrent session's in-flight #1667 grouping-removal edit) and `option-chart-dom.spec.ts` times out in `beforeEach`. None are reachable from this diff (Pine + verify script only; zero app TS changes). Flagged as a worktree-state caveat, not a gate blocker — same attribution pattern as the #1727 ship.
- TradingView-vs-web visual comparison remains the separate UAT leg (`261-1722-1676-UAT-INDICATOR-LIB-indicator-lib.md`) — Pine has no local compiler.

## Nits / deferred (recorded, not blocking)

- #1728 — BE marker path real-OHLC + filter wiring (the MEDIUM spec caveat; until it lands, web vs TV diverge on suppressed markers).
- `st-trend-rider.strategy.ts` generic "gated" phrasing — carried nit from #1727, unrelated to the IBS filter.
- The `(suppressed)` title-keyed opacity check is intentionally title-coupled (documented in-script); renaming ghost titles requires updating the check.
