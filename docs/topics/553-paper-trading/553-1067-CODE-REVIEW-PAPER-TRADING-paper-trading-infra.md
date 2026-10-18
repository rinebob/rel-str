**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** — (one-off task, direct child of Topic)  
**Thread Slug:** —  
**Issue:** #1067  
**Thread Parent:** —  
**Topic Parent:** #553  
**Task:** #1067  
**Domain:** PAPER-TRADING  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-17  
**Last Updated:** 2026-10-17  

# CODE-REVIEW — #1067 paper trades table (sticky header, sortable, no curve)

## Scope

`src/app/features/savant-trader/pages/paper-trading/paper-trading.component.{ts,html,scss,spec.ts}`
and `src/app/features/savant-trader/stores/paper-trading.store.{ts,spec.ts}`
(uncommitted working-tree diff vs `prod`). Spec source: issue #1067 body,
plus post-implementation user feedback (ungrouped table must fill viewport,
grouped mode needs an outer scrollbar, cohort expandos must collapse).

## Round 1 — three axes, all remediated

### Standards

- **Major — divergent sortable-header convention.** Hand-rolled `'▲'/'▼'`
  glyphs vs the codebase's `sortIcon()` → `<mat-icon>arrow_upward/downward`
  (swing-table). **Fixed** — `sortIcon()` + `aria-sort` adopted; the eight
  duplicated `<th>` blocks collapsed into a `COLUMNS` array the thead
  iterates.
- Dead code after removals: `MatTooltipModule` import, `.scope-select`
  misnomer (renamed `.group-select`), `.empty-table-message` (unused),
  `.manage-strategies-btn` (no styles), `?? ''` fallbacks on contract-required
  `expression`/`governingVariant`, per-call `Intl.NumberFormat` `currency()`
  (replaced with the canonical `| currency:'USD'` pipe + `@let account`).
  **All fixed.**
- Header annotations: html/scss still `#569`-only — now `#569, #1067`.

### Spec

- **Major — ungrouped fill-height was inert.** `.table-section:only-child
  { flex: 1 }` sat inside a non-flex `.trades-panel`; the inner `.table-scroll`
  never became the scrollport. **Fixed** — `.trades-panel` is now
  `display:flex; flex-direction:column` and the flexed `.table-scroll` gets
  `min-height: 0`.
- All three #1067 requirements verified present and tested: sticky `th` +
  rows-only scroll (`.table-scroll`), all 8 columns sortable asc/desc
  within-group, equity curve removed (pinned by a removal test).

### Thermo-nuclear

- **Major — `loadAll()` still called `loadStats()`** — a wasted
  enumerate-all Firestore read on every page view; `statsByScope`,
  `statsList`, `allScopeStats`, `isLoadingStats` had zero consumers.
  **Fixed** — the entire stats slice retired from the store (state,
  computeds, method, sub) and its spec block removed. The thin
  `getPaperStats$` service wrapper remains as API surface; stats docs can
  be re-introduced by the #1059 analysis work if needed.
- Dead spec surface pruned: `makeStats`, `statsByScope`/`statsList`/
  `exitVariants`/unused `isLoading*` signals, unused `load*` jest fns,
  verbose `variantRuns` fixture detail, impossible `tradesBySector`
  two-bucket fixture.
- Tests previously drove internals only — added a real `th.click()` test
  asserting `aria-sort` + row order.
- `border-collapse: collapse` + sticky header border-drop — switched to
  `separate; border-spacing: 0`.
- `@empty` added to the group loop; `'all'` group title renders
  "All trades".

### Test results

- Focused: `paper-trading.component.spec` 21/21, `paper-trading.store.spec`
  green (37 total across both).
- Full suite: 3786 pass / 43 fail — **all failures unrelated and
  pre-existing**: `screenshot-capture-contracts` (PositionType enum grew
  under the user's parallel #1004 work — the spec predates it) and
  `order.component` (NG0201 missing `Functions` provider — neither file
  is in this change set).
- `tsc --noEmit`: only the two known pre-existing errors
  (`bulk-swing-sweep.ts` FirebaseFirestore namespace,
  `indicator-config-dialog.component.ts` type narrowing).

## Round 2 — re-review after remediation

### Standards

- **minor** — `getPaperStats$` was orphaned (only its own spec called it).
  **Fixed** — removed from `PaperTradingService` and its spec;
  `CallableName.GET_PAPER_STATS` kept as the deployed-callable registry.
- Stale comments referencing the removed stats pipeline — **fixed**
  (component header, `NO_STAMP` rationale, store spec `dir-*` comment).
- **minor** — sortable `<th>`s advertised `aria-sort` but weren't
  keyboard-operable. **Fixed** — `tabindex` + Enter/Space handlers.

### Spec

- **Major — grouped sections could flex-shrink into strips.** As flex
  items of `.trades-panel`, several sections with `min-height:0` would
  compress instead of overflowing — the outer scrollbar would never
  appear. **Fixed** — `flex-shrink: 0` on `.table-section`
  (`:only-child`'s `flex: 1` still governs the ungrouped case).
- **Fixture dishonesty** — `tradesByDirection` mock bucketed an unstamped
  trade under `'short'`; the real grouper uses `'—'` for non-signal
  trades. **Fixed** — TRADES[0]/TRADES[2] now carry real `signalType`
  stamps and matching order sides.

### Thermo-nuclear

- **major — status sets diverged from the canonical contract.**
  `toTradeGroup`/`capitalRequired` used literal `'OPEN'`/`'PENDING'`
  (ASSIGNED would vanish). **Fixed** — `LIFECYCLE_OPEN_TRADE_STATUSES`
  from `@paper-trading/contracts` drives `capitalRequired`; group
  `openCount` uses `OPEN|ASSIGNED` enum members. `openTrades` stays
  OPEN-only (name-honest; the spec suite pins it).
- `@let icon` binds `sortIcon` once per header (was invoked twice).

### Deferred (recorded, not fixed — out of this task's scope)

- Pre-existing orphaned store surface: `setTradeFilters`/`tradeFilters`,
  `tradesBySource`, `available*` computeds, `closedTrades`/`pendingTrades`
  — part of the #565 filterable-ledger design; filter UI lands in the
  #1059 workbench and will re-consume them.
- `storeMock: any` type erasure in the component spec — endemic mock
  pattern; a typed mock is worth doing under #1059 test work.

### Test results (round 2)

- Focused: 41/41 (component + store + service specs).
- `tsc --noEmit`: clean on touched files (two known unrelated
  pre-existing errors elsewhere).



- Sortable `<th>`s aren't keyboard-operable — endemic (no MatSort anywhere
  in the codebase).
- Cohort expando is single-open accordion; multi-open would need a
  `Set<string>` — current behavior satisfies the spec.
- Nested 40vh inner scrolls in grouped mode — user-deemed acceptable,
  revisit in the #1059 workbench if it annoys.

## Verdict

**PASS** — both majors found by the axes were remediated and re-verified
before this doc; remaining findings are minors/nits.
