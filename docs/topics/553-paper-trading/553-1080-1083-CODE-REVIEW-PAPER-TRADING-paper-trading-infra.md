# CODE-REVIEW — #1083 FE workbench table (manifest columns, sort chain, filters, quarantine)

**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Trade Analysis & Forensics  
**Thread Slug:** trade-analysis  
**Issue:** #1083  
**Thread Parent:** #1059  
**Topic Parent:** #553  
**Blueprint:** #1080  
**Domain:** FE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-20  
**Last Updated:** 2026-10-20  

## Result: PASS

Pass 1 — findings remediated in-diff (below). Pass 2 — two further
findings fixed (duplicated Params segment; row track-key crash class).
Pass 3 — no new findings (SCSS, emit paths, store chain re-verified).
Held-clean items recorded.

## Scope reviewed

- `components/analysis-table/` (new — ts/html/scss/spec): generic
  input-driven grid; `ANALYSIS_COLUMNS` ∩ CSV headers; kind-typed cells;
  column picker seeded from `defaultVisible`; #1067 sort chain
  (shift+click additive, asc→desc→removed, aria-sort, Enter/Space);
  per-kind filter row emitting `SliceFilter` chain edits
- `stores/analysis.store.ts`: `includeOpenRows` state; `viewRows →
  filteredRows → sortedRows` computed chain across three `withComputed`
  blocks (sibling computeds aren't visible within one block — the
  structure exists for the dependency chain, not style);
  `hiddenRowCount`; `filteredCompareRows` under the same quarantine;
  `setFilters`/`setIncludeOpenRows`; resets on open/close/delete
- `utils/analysis-rows.util.ts`: `isClosedCohortRow`,
  `distinctRowValues`
- `pages/analysis/`: workbench section mounts the table under the
  library; interim banner → "● Open in workbench" chip

## Findings fixed during review

1. **P&L literals drifted from the sibling surface** — `#81c784`/
   `#e57373` vs paper-trading's established `#2e7d32`/`#c62828`. Matched
   to the sibling table. (`--ds-up`/`--ds-down` exist in the DS package
   but no ST feature consumes them yet — literal parity is the current
   convention.)
2. **Quarantine predicate duplicated 4×** — refactored to chained
   `withComputed` blocks: `viewRows` → `filteredRows` → `sortedRows`
   (+compare through the same gate). NgRx does not expose same-block
   computeds on `state` — two compile failures confirmed the required
   structure.
3. **Sticky filter-row offset was implicit** — `top: 29px` assumed a
   label-row height nothing guaranteed; `height: 29px` + `box-sizing`
   on the label row makes the offset deterministic.
4. **Dead-end enum options** — pickers offered all manifest
   `enumValues`, so `status: OPEN` under the closed-cohort default
   produced an unexplained empty table. Options now intersect with
   values present in the universe (canonical enum order kept).
   Spec-pinned.
5. **AOT `keydown` `$event` typing** — template passes `Event`, not
   `KeyboardEvent`; adopted paper-trading's `MouseEvent | KeyboardEvent
   | Event` instanceof signature verbatim.
6. **(Pass 2) Duplicated Params segment on dataset cards** — the card's
   Params line rendered `entryConvention` twice
   (`signal-bar-close · signal-bar-close · dates`); first segment
   restored to `exitRule` — the full recipe line the label promises.
   Defect was committed in #1082's R2 refinement; fixed here since the
   review touched the same file.
7. **(Pass 2) `track row.tradeId` duplicate-key crash class** — a
   dataset whose CSV lacks the `tradeId` column would null-fill every
   row → Angular NG0955 duplicate-track error kills the grid. Switched
   to `track $index` — cells are stateless text, index tracking is the
   table convention.

## Held clean

- Same-column multi-filter collapse — a future slice carrying two
  predicates on one column shows only the first in the control and an
  edit replaces both. `SliceFilter` chains from UI edits are 1-per-column
  by construction; documented limitation, revisit with #1085 if real.
- String columns filter via distinct-value `in` picker — `SliceFilter`
  has no contains/substring op; recorded as a candidate contract
  addition for high-cardinality columns (tradeId).
- `optionsFor` recomputes distinct values per column per CD pass —
  O(46×n) on small-n datasets; not worth memoizing yet.
- `::ng-deep` on the in-filter select width — consistent with existing
  Material-coupled overrides in the codebase.
- Filter row renders an empty `th` for `filterable:false` columns —
  keeps grid alignment; no visual cost.

## AC traceability

| AC | Evidence |
|---|---|
| every manifest column renders, sorts, filters per kind | spec: header/order/defaultVisible picker; sort emit + aria-sort; per-kind emit specs (in/range/dateRange) |
| filtered count visible; reset restores | `.row-count` "N of M" spec'd; chips remove + Reset → `filtersChanged([])` spec'd |
| open rows displayable, never contaminate closed cohort by default | store specs: `viewRows`/`sortedRows`/`filteredCompareRows` closed-only by default; toggle lifts w/ banner + provisional row marking |

## Verification

- Focused suites: **75/75 green** (32 store incl. 4 quarantine + 1
  compare-quarantine pins; 16 table; 27 page+form)
- `tsc -p tsconfig.app.json` clean; `ng build` AOT clean
- Full suite: 3,996/3,998 — the same two pre-existing concurrent-work
  failures as #1081/#1082 reviews (PositionType expansion in
  screenshot-capture-contracts; DS Gallery nav item in sidenav-menu).
  Two analysis suites transiently failed mid-refactor; all green on
  re-run post-fix.

## Next

`/proj qa 553 1083` — click-through surface: open a dataset on the
running dev server; sort chain, per-kind filters, chips/reset, column
picker, include-open toggle + provisional banner, empty-filtered state.
