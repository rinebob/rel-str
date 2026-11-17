**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** ST Anchored VWAP  
**Thread Slug:** st-anchored-vwap  
**Issue:** #867  
**Thread Parent:** #835  
**Topic Parent:** #261  
**Task:** #873  
**Domain:** INDICATOR-LIB  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-15  
**Last Updated:** 2026-11-17  

# CODE-REVIEW — #873: Refine Pine Anchored VWAP to match web

**Scope:** the uncommitted rewrite of `rb-ps/rb-ta/ind/rb-st-anchored-vwap.pine`
(+286/−176 vs HEAD) — the Stage 1b refinement from the prototype's
hindsight backfill model to the web's causal trigger-bar model, plus the
in-gate fix-set described below.

## Round 1 — findings and in-gate fixes

Three axes (Standards, Spec, Thermo-nuclear) ran against the diff. The
causal core was confirmed sound by all three — no hindsight violation is
constructible: every drawing's span is bounded by bars ≤ its creation bar,
the trigger check reads monotonic intra-bar extremes, and Pine's per-tick
rollback keeps `var` state consistent. Findings concentrated in
**supersession handling** and **drawing-object lifecycle**.

### Majors fixed in-gate

| Finding | Root | Fix |
|---|---|---|
| Stale trigger dots on vertex supersession (thermo M2) | `fire()` pushed a dot at fire time; a later same-side refinement never removed/moved it — visible permanent wrong-position markers | `Seg.dot` field tracks the fired dot; supersession deletes it before rescan and re-pushes at the refined trigger; demote deletes it (re-push on re-fire) |
| Frozen predecessor endpoint + live-line gap (spec F1) | On supersession, predecessor was archived ending at the *ghost* trigger; demote left **no live line** — the web keeps the previous triggered vertex's segment running | Re-anchor: `hist.last()` re-ended at the refined trigger behind an `endBar == oldT` identity guard. Demote: vertex → `pend`; the previous triggered segment is popped from `hist`/`fan` and resurrected as `cur` |
| Orphaned polyline on persist+out-of-window drop (thermo M1 / standards) | `cur` dropped by era window without deleting its committed `pl` — permanent leaked drawing consuming the 100-polyline budget | `pl` deleted on every drop path; `cur.pl` cleared |
| `xloc.bar_index` ~9,999-bar reach-back ceiling (spec F3 / thermo M3) | Segments/dots anchored >~10k bars back would runtime-error | All drawings switched to `xloc.bar_time` + `chart.point.from_time`; `b.ts` was already buffered. The separate 10k-`chart.point`-per-polyline cap is documented as accepted truncation |
| Persist+era mode pruned the wrong end (spec F2 / thermo m1) | Fan kept the *most recent* cap; web era mode keeps the **first** cap in-window | `room` gate: era mode pushes only while `fan.size() < cap` |

### Minors fixed in-gate

- `archive` evicted before the push gate — a hidden/empty segment shed a
  keepable one (m2): eviction moved after the `pts.size() > 1 && shown`
  gate.
- `> 0` vs `> 1` guard asymmetry → phantom 1-point polylines (m3):
  unified at `> 1`.
- `na` `hlc3`/negative volume poisoned `cumPV`/`cumV` forever (m4):
  `okVol` gate matches web `cumulativeSums`.
- Depth inputs had no `maxval` (5000 → far-history offset errors):
  `minval 2, maxval 100` matching the web clamps.
- Header "alternating sides" overclaim → "normally alternating" (same-bar
  collapse can yield consecutive same-side vertices).
- Missing group-2 tooltips replicated.
- Epoch-vs-session-date `histStart` divergence documented at the compare
  site (Pine `input.time` has no date-only mode).
- Reach-back/point-cap/array-ceiling/rebuild-cost limits now documented
  in the header.

### Accepted / deferred

- **M4 — per-tick full polyline rebuild** (`drawSeg` rebuilds every fan +
  live segment each realtime tick): real compute-cost surface on long
  intraday charts with Persist; can't profile without the TradingView
  runtime → **deferred to QA manual check** (documented in header +
  verify guide). A point-cache fix is possible but risky to write blind.
- **M5 — all `plot()` outputs removed**: **intentional** — AC3 requires
  removing "confirmation-bar markers, thin step duplicate lines"; the
  removed `plot()` step lines were exactly those. Trade-off recorded:
  the indicator exports no data-window/alertable series.
- `Pivot.start` write-only + dead `rightDepth == 0` branch — kept for
  ZigZag-library fidelity.
- Parity gaps vs web (no leg overlays, 50-dot cap, same-bar-collapse dot
  handling) documented in the verify guide — none are AC scope.

### AC5 ruling — palette

AC/PRD text specified "magenta/cyan, line-2 thick" — **stale vs the live
web**, which #955/#1459 deliberately recolored/re-weighted (line 1:
`#FF8CFF`/`#FFFF00` w3; line 2: `#00C853`/`#FF0000` w1). The Pine matches
the live reference — correct; the SHARED test plan's stale palette and
"faded segments" wording was corrected in the same change set.

## Round 2 — re-review of the fix set (3 axes)

Re-ran all three axes against the post-fix file. The round-1 fixes held
up semantically but introduced new defects:

### Fixed in-gate

| Finding | Fix |
|---|---|
| **Compile blocker:** `hist` field retyped to `array<Seg>` but both `Scale.new` sites still built `array.new<polyline>()` (all 3 axes caught it) | `hist = array.new<Seg>()` ×2 |
| Same-bar collapse missed refine+push: a vertex refined to index X while an opposite pivot pushed at X left trackers holding the pre-refine index | `preLastIdx` snapshot + `sameIdx` gate via `pivots.get(k-1)` — collapse fires when the chain predecessor shares the pushed index, trackers match either index form |
| Collapse dropped `cur` leaking its dot and stranding the predecessor at a ghost trigger | `dropDot` + `popPred(deadT)` resurrects the predecessor (ends at the replacement's eventual trigger — web parity) |
| Resurrection popped `hist/fan.last()` unconditionally — wrong seg when the true predecessor was era-dropped / hidden / degenerate / cap-evicted | `lastFired` tracks the most-recent ended seg *before* window gates; `popPred` identifies by `endBar` and pops the container only on endBar+pivotBar identity |
| Hidden/degenerate segs didn't consume window slots (web counts them — side toggles are render-only) | `archive` admits every in-window seg, `pl = na` when hidden/degenerate |
| Dead dot handles inflated the 50-cap; collapse leaked dots | `dropDot` removes the handle from `dots` + deletes; `DOT_CAP` constant |
| Inverted-span / stale-handle hygiene | `buildPoints` `endIdx >= startIdx` guard; `s.pl := na` / `old.pl := na` after deletes |

### Also resolved

- Round-1's `varip` rollback premise was **refuted** — no `varip`
  anywhere, so every field rolls back per realtime tick and the whole
  update re-derives deterministically. No repaint hazard.

## Round 3 — focused check on the new machinery (1 spec axis)

One focused pass over only `lastFired`/`popPred`/`dropDot`, the collapse
rework, and admit-all archive. Verified clean: popPred chain-walk
(including consecutive demotes), collapse gates (refine+push and
double-push), admit-all cap accounting, `cont` array aliasing.

### Fixed in-gate

- **Re-anchor desync:** `cur.triggerBar := t` moved the trigger but a
  window-dropped predecessor's `endBar` stayed `oldT` — a later demote's
  `popPred(t)` missed → live line vanished (era-mode edge). Fixed by
  syncing `lastFired.endBar := t` independent of `hist` membership.
- **Dots were side-gated; web confirmations are not** — removed the
  `showHi/showLo` term from both dot sites.
- `.pl := na` on evicted segs (explicit dead-handle invariant).

### Accepted / documented

- Era kept-set ordering is push-order vs web's `startBar`-sort — can
  differ only when a re-anchor moves endpoints AND the era cap boundary
  lands exactly between two such segs (requires era + re-anchor +
  coincidence; documented).
- `array.indexof` on a label array — standard API but unverifiable
  statically; first TradingView paste confirms.

## Verification

Post-fix audit: `functions/scripts/verify/indicator-lib-873-pine-parity.ts`
— **60/60 PASS**, pinning the causal contract, supersession
reconciliation, collapse handling, predecessor bookkeeping, budgets,
input surface, and every fix-set item across all three rounds. The
script + guide + run-all/README registration are part of this change set
(the #878 audit precedent).

## Tests

- Targeted suites: **16/16 suites, 358/358 tests** (flex-chart — the web
  reference engine/adapter/indicator; the Pine file isn't jest-covered).
- Pine verification is inherently manual (no local toolchain): compile,
  side-by-side anchor/trigger/handoff compare, persist-fan rebuild cost,
  >10k-bar chart — all carried on the QA checklist.

## Verdict: **PASS**

Three review rounds (R1 full 3-axis, R2 full 3-axis re-review, R3
focused machinery check): every major and the compile blocker resolved
in-gate; remaining items are documented limitations or manual-by-nature
QA legs. The supersession/collapse/resurrection machinery mirrors the
web's batch recompute semantics and is pinned by the 60-check audit.

## Deferred to QA (manual checklist additions beyond the SHARED test plan)

- **Compile first** — the file has never been pasted into TradingView;
  watch `array.indexof` on the label array and the UDT method sites.
- Persist + `historyStart` combined: era fan keeps first cap.
- Supersession mid-trend: dot moves with the refined trigger; predecessor
  line extends to it; untriggered-supersession gap resolves on re-fire.
- **Era mode + re-anchor + demote** (round-3 fix): predecessor resumes
  live even when its line was window-dropped.
- Same-bar high+low collapse on a triggered vertex: its dot disappears,
  predecessor line keeps running.
- Trigger dots with one side hidden: hidden side's dots still draw
  (web parity — confirmations aren't side-gated).
- Persist ON + long intraday chart: per-tick rebuild cost (watch item).
- >10k-bar chart: bar_time anchors draw without the bar_index ceiling.
