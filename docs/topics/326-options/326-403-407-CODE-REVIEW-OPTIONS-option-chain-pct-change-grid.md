**Topic:** Option chain percent change grid  
**Topic Slug:** option-chain-pct-change-grid  
**Thread:** Contract chart popup  
**Thread Slug:** contract-chart-popup  
**Issue:** #403  
**Thread Parent:** #400  
**Topic Parent:** #326  
**Task:** #407  
**Domain:** OPTIONS  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-09-18  
**Last Updated:** 2026-09-18  

---

# Code Review — Task #407: Add grid icon + overlay + page wiring

## Verdict: PASS (after fixes)

## Scope reviewed

- `pct-change-grid.component.ts` (+~140: store inject, icon per cell,
  cdkOverlayOrigin/cdkConnectedOverlay, grace-delay handlers)
- `option-chain-pct-change.component.ts` (+14: `document:click`
  HostListener)
- Both matching spec files (+17 tests)
- IMPL doc as-built sync

## Standards axis

- Grid file now ~440 lines — crosses the 400-line "strong smell"
  threshold; the doc sanctions the store injection but the overlay
  block is cohesive. Noted, not blocking.
- Store injection into the grid sanctioned by the plan ("event
  emission, not data assembly"); boundary stays honest — only
  selection methods + two selection reads.
- `isSelected(cell)` per-cell template call consistent with existing
  `cellColor`/`cellTooltip` pattern; trivially cheap.
- `useValue: {}` leaf-service mocks honest — commented, real store
  exercised; never invoked by the wiring under test.

## Spec axis

- Icon on populated cells only, subtle (opacity 0.3→1), absolute
  positioning — matches §4 and PRD discoverability intent.
- Overlay gated on contractID+strike+expiration+targetDate — wider
  than the plan's contractID+targetDate; already doc-synced.
- Pin/hover/outside-click state machine matches PRD ACs.
- **Major — PRD grace delay missing (FIXED):** `relatedTarget`-only
  check snapped shut crossing the icon→pane gap; now a 200ms
  `scheduleClear` cancelled by pane/icon enter.
- Minor: no re-pin while pinned (spec-compliant), no Escape dismissal
  (not required).

## Thermo-nuclear axis

- **M1 — pointer-intent race (FIXED):** pane attaches next CD pass;
  a fast pointer left before it existed → `relatedTarget` non-pane →
  preview died before the overlay ever opened. The 200ms grace delay
  covers attach + gap transit; cancel-on-enter also fixes the
  icon-A→icon-B sweep race (A's timer wiping B's preview).
- **M2 — `.cdk-overlay-pane` too broad (FIXED):** any CDK pane
  (dialog/select/tooltip) kept the preview alive. Pane now tagged
  `contract-chart-pane`; both leave guard and page dismissal scope
  to it — foreign-pane clicks/leaves now correctly dismiss.
- m3–m6 minors: toggle-unpin not needed (outside-click per spec);
  foreign-overlay clicks now dismiss (was M2); Escape not required;
  test gaps addressed (grace-delay, pane-cancel, sweep-race,
  foreign-pane dismissal tests added).

## Test results

- Grid spec: **28/28** (+6 during review)
- Page spec: **28/28** (+1 foreign-pane test)
- Pct-change suite: **258/258**; `tsc --noEmit` clean

## Findings summary

| Severity | Count | Status |
|---|---|---|
| Major | 2 | Both fixed (grace delay M1, pane scoping M2) |
| Minor | 4 | 2 fixed (test gaps), 2 noted (re-pin, Escape) |
| Nit | 3 | Noted (file size, isSelected pattern, dormant overlays — all acceptable) |
