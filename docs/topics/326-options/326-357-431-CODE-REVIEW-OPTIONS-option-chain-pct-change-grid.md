**Topic:** Option chain percent change grid  
**Topic Slug:** option-chain-pct-change-grid  
**Thread:** Misc fixes for option pct change grid  
**Thread Slug:** misc-fixes-pct-change  
**Issue:** #357  
**Thread Parent:** #357  
**Topic Parent:** #326  
**Task:** #431  
**Domain:** OPTIONS  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-09-18  
**Last Updated:** 2026-09-18  

---

# Code Review — Task #431: Misc grid UI fixes: layout, contrast, highlights, selector refactor (FE)

## Verdict: PASS (after fixes)

Two review passes ran. Pass 1 produced findings across all three axes; every
critical/major finding was remediated in-tree and re-verified in pass 2. The
one pass-2 blocker — dead swing-data plumbing from in-progress Thread #418
work — was deleted after confirming it belonged to a different thread's WIP
(snapshot preserved at `.devin/tmp/pre-swing-delete/` for #418 re-implementation).

## Scope reviewed

- `option-chain-pct-change.component.ts` (~554 lines) — expansion-panel
  state signals, resolveNonce effect, shared CONTRACT_CHART_PANE_CLASS,
  `highlightedContract` → `linkedKey` derivation, config-select collapse
- `pct-change-grid.component.ts` (~614) — delegated pointer handlers, single
  shared CDK overlay, precomputed ViewCell, top-5-per-column rings,
  template-evaluated linked highlight, dual box-shadow overlap
- `target-type-selector.component.ts` (~513, was ~767) — store-injecting
  refactor; deleted 10 @Input mirrors, 7 @Outputs, ngOnChanges echo
  suppression, 3 payload interfaces, swing-extremes scaffolding
- `option-chain-pct-change.store.ts` (~640) — highlightedContract,
  resolveNonce, setTargetDates invalidation contract, sameSelectedCell,
  reset() preserves savedConfigs, dead setters deleted
- `color-mapping.utils.ts` — pctChangeToCellColors + CellTextMode +
  DEFAULT_CELL_TEXT_MODE; dead pctChangeToColor deleted
- `pct-change-config-contracts.ts` — ResolvePctChangeRequest single-sourced
- Specs for all of the above; selector spec rewritten against a mock store
  whose methods patch its signals

## Standards

**Pass 1** — 4 hard violations + judgement calls; all addressed:
stale `isTop` docs fixed; dead `setPctValues`/`setPctGradation` and
`pctChangeToColor` deleted; `contract-chart-pane` and DOW arrays
single-sourced; `ResolvePctChangeRequest` imported instead of redeclared.

**Pass 2** — 4 hard violations found; all fixed this session:

1. `as unknown as Event` in page spec → real dispatched change event.
2. `setTimeout(50)` + `done` ceremony in 11 store-spec tests → synchronous
   assertions (`of()`/Subject mocks emit synchronously).
3. `DAY_NAMES_SHORT` was a fourth copy of `['Sun'…'Sat']` → reused canonical
   `DAYS` from `features/shared/utils/date.util.ts`.
4. Dead `savedAnalyses`/`signals`/`loadSwingData` plumbing (two Firestore
   fetches per `setSymbol`, zero consumers) → deleted from store + spec.

Judgement calls noted: files still exceed the 400-line smell bar (page 554,
store ~640, grid 614, selector 513) — the bulk is inline template/CSS with
no clean extractable-logic cut left; flagged, not blocking. Minor:
two near-identically-named expansion signals (`targetDatesExpanded` on the
page, `datesExpanded` in the selector) at different layers.

## Spec

All 14 user requirements verified implemented end-to-end against the final
code (saved-config overflow, one-row symbol/date, Clear All, both expansion
panels, shorter Calls/Puts row, resolve reopens collapsed outer panel via
resolveNonce, collapse rail, bright default contrast, DOW headers,
top-5-per-column rings, click-to-highlight incl. source grid + icon clicks +
replace-on-reclick + outside-click clear, no empty-cell tooltips,
config-select auto-collapse, delegated-listener perf fix).

One partial: req 13's "all config panels" — `onConfigSelect` collapses the
outer Target Dates + Filters panels but not the selector's inner "Dates (n)"
panel (page has no API into it; harmless — hidden inside the collapsed
outer, and the sync effect reopens it on new dates anyway).

Scope creep resolved: the swing-data plumbing (deleted above) was
in-progress Thread #418 work sharing the working tree, not part of this
batch. `reset()` preserving `savedConfigs` is a benign correctness fix.
Inset box-shadow vs literal `border` for the rings is intentional (no
layout shift).

## Thermo-Nuclear

**Pass 1** — headline finding: the selector's 10-input/7-output mirror +
ngOnChanges echo-suppression layer was the deepest deformity → replaced by
direct store injection (~250 net lines deleted). Also: rows() recomputed on
every highlight click (linkedKey removed from the computed, evaluated in
template); add/remove/set target-date mutations had inconsistent
invalidation → all three now share the snapshot-clearing contract;
resolveNonce added so only resolves reopen the panel.

**Pass 2** — verified the remediation is real and correct (untracked
effects have no feedback loop; icon-click highlight ordering before the pin
guard is deliberate; delegated handlers handle icon→cell→pane transitions).
One blocker: the swing-data plumbing (described above) → deleted. The
`runSub`/`resolveSub` → `rxMethod` suggestion was correctly rejected —
imperative cancels, not stream-driven. Non-blocking: clearing a date field
then adding/removing another row drops the mid-edit row (narrow edge,
pre-existing behavior, documented).

## Test results

- Feature suite: **9/9 suites, 272/272 tests pass**
  (`src/app/features/savant-trader/pages/option-chain-pct-change`).
- `ngc --noEmit -p tsconfig.app.json`: clean.
- Full repo suite: **43 suites / 107 tests fail — all pre-existing and
  unrelated** to this change (signal-review, dashboard, portfolio, auth,
  functions tests). Verified the one in-scope file with a failing spec
  (`savant-trader/utils/utils.spec.ts`) is byte-identical to HEAD — its
  failure predates this batch. These should be triaged separately.

## Remaining advisory items (not blocking)

- Mid-edit empty date row dropped when add/remove fires before commit
  (selector `_targetDates` resync edge).
- `overlayCell` + `activeOrigin` remain separate signals (justified —
  imperative anchor capture).
- Optional decomposition: extract the Filters expansion panel into a child
  component to shave the page below ~500 lines.
