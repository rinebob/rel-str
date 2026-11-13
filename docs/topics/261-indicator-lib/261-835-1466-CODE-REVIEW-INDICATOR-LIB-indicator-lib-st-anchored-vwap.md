# Code Review — SHARED: ST Anchored VWAP leg-semantics rework + persist mode

**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** ST Anchored VWAP  
**Thread Slug:** indicator-lib-st-anchored-vwap  
**Issue:** #835  
**Thread Parent:** #835  
**Topic Parent:** #261  
**Task:** #1466  
**Domain:** INDICATOR-LIB  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-12  
**Last Updated:** 2026-11-12  

Gate review for task #1466 (SHARED: ST Anchored VWAP — leg-semantics rework, shared trigger dots, persist mode). The diff under review shipped inside #1459's commits (`0b1f6a8b`) — the tasks interleave the same files and could not be hunk-split; #1459's review and QA covered the combined surface. This review examined the shipped state plus three parallel axes (spec verification, coding standards, thermo/architecture). Findings below were fixed in-gate before the verdict.

## Verdict: PASS

Both round-1 majors fixed in-gate; round-2 verification found no new majors (convergent findings were comment drift + one overclaiming spec, all fixed). Targeted suite green (192/192 after round-2 fixes), typecheck clean. Full suite has 12 unrelated failures in `core.component.spec.ts` (uncommitted sidenav WIP — `SidenavMenuComponent.isActive` seeing `currentUrl()` undefined); nothing in #1466's surface.

## Spec axis

All four code ACs verified MET:

- Legs draw from the surviving `computeZigZagPivots` chain — `legsForSet` no longer re-derives survival from `AnchorEvent`.
- One VWAP line per leg side; lines draw from the shared trigger bar, accumulate from the pivot bar.
- Confirmation dots are the same `computeTriggerPoints` output the standalone ZigZag draws — parity tested bar-for-bar, level-for-level.
- Gap-through triggers place the dot on the trigger bar's open.
- Per-set persist flag keeps every triggered line to the last bar.

## Major findings — fixed in-gate

1. **The two-mode history-slot machine was self-undermining.** The 4-slot
   first-fit model assumed non-overlapping runs per series, yet its own
   overflow path already packed overlapping null-separated runs into one
   series — and UAT verified that renders correctly (the fan worked with 23
   packed runs in one slot). If packed overlap is honest, it is honest
   unconditionally → **collapsed to one `history` series per side** (26 → 14
   fixed keys), deleting `historySlots`, the first-fit loop, and the
   provably-dead `slots[oldest]` argmin (slots were created in start order,
   so oldest ≡ index 0). Net −54 lines.
2. **Break points emitted `index = bars.length`.** Persist segments end at
   `lastBar`, so the interior `endBar + 1` break fell one past the last
   category — phantom-category risk on a Category axis. Fixed by clamping
   the break index to `lastBar` (the break only needs to sit between two
   segments; a trailing break is already skipped).

## Minor findings — fixed in-gate

- Removed dead `TriggerPoint.time` (zero consumers) and redundant
  `AnchoredVwapLeg.isHigh` (≡ `to.isHigh`).
- Three stale spec titles (3-slot/6-slot/superseded-anchor wording) and the
  TEST doc's stale "18 series" strings updated to the 14-key contract.
- Engine header no longer claims strict side alternation (same-bar
  collapse can produce consecutive same-side vertices).
- Dead `|| 0` guard in `applyHistoryWindow`; segment key simplified to
  `${set}-${side}-${pivotBar}` (one segment per vertex).
- UAT doc A3 + scope text re-synced to the 14-key contract.

## Deferred (recorded, not blocking)

- **Era-mode prune asymmetry** — `historyStart`-set takes the *oldest*
  `maxHistory` anchors; unset takes the *newest*. Deliberate windowing vs
  recency-cap semantics; revisit if a real use-case complains.
- `AnchorEvent` stream remains as a test oracle for the invariants spec
  after the surviving-pivot rework — acceptable.
- Size smells unchanged: `st-anchored-vwap.indicator.spec.ts` (~680),
  `chart-data-adapter.service.ts` (~1000).

## Round 2 — verification pass on the in-gate fixes

Re-ran all three axes against the post-collapse working tree (the 11-file
uncommitted fix set). **No new majors; all axes agree the contract holds.**

- **Spec axis: ALL ACs STILL MET**, no regressions — traced persist packing
  (clamped break at `lastBar` still separates runs in data order), the
  adjacent non-persist duplicate-index break, and confirmed no emitted
  index exceeds `lastBar` in any mode.
- **Thermo axis: all five probed assumptions SOUND** — category-axis
  packing correctness (x-value lookup + data-order connector, same
  mechanism as the trigger-bands hinge+level precedent), stable sort,
  same-category null breaks, the exact-14-series invariant, and no
  structural smells needing reopen.
- **Standards axis: all four round-1 fix claims verified** — zero residual
  references to `historySlots`/`history-[a-d]`/first-fit/`TriggerPoint.time`/
  leg-level `isHigh`.

Round-2 findings fixed (all minors/nits): four more stale "10" comment
sites the sed missed; the spec's monotonicity assertion overclaimed the
contract (packed order decreases by design — retitled to the real
invariant, uniqueness of real points per index); `HIST_KINDS`
single-element vestige inlined; `extractConfig` now clamps the declared
param maxima (retracement ≤50, depths ≤100, `maxHistory` ≤1000);
`lastBar` hoisted; UAT traceability row + TEST doc inverted weight claim +
`Last Updated` synced.

Left deliberately: `AnchoredVwapSegment.key` is test-oracle surface (same
category as the deferred `AnchorEvent` stream); the UAT `:135` Results-log
entry is append-only history.

## Test results

- Targeted: `st-anchored-vwap.*`, `st-zigzag.triggers`, `chart-data-adapter`,
  `indicator-registry` — **6/6 suites, 192/192 tests pass**.
- Typecheck: `tsc -p tsconfig.app.json` clean.
- Full suite: **308/309 suites, 5480/5492 tests pass**; the 12 failures
  are all in `core.component.spec.ts` from unrelated uncommitted sidenav
  WIP (`currentUrl()` undefined in `SidenavMenuComponent.isActive`).
