**Topic:** Portfolio Dashboard  
**Topic Slug:** portfolio-dashboard  
**Thread:** Extend Gallery UI to Portfolio Page  
**Thread Slug:** portfolio-gallery-view  
**Issue:** #949  
**Thread Parent:** #926  
**Topic Parent:** #219  
**Task:** #950  
**Domain:** PORTFOLIO  
**Type:** CODE REVIEW  
**Status:** Complete  
**Created:** 2026-10-11  
**Last Updated:** 2026-10-11  

# Code Review — portfolio-v2 page shell + facade + UI store (#950)

Three-axis gate review of task #950's change set: the new
`features/portfolio-dashboard/pages/portfolio-gallery/` directory (view,
header, facade, UI store, position-cards util + specs), the `portfolio-v2`
lazy route registration in `core-routes.ts`/`interfaces.ts`/`constants.ts`,
and two shared extractions made during remediation (`shared/utils/
schedule-idle.util.ts`, `savant-trader/common/symbol-list-filter-options.ts`
— the signal gallery's copies of both were deleted in favour of the shared
files).

All findings below were **fixed in this session** and re-verified before
the verdict; severities are as filed by the reviewing axes.

## Standards

### Findings (remediated)

- **Major — `summary.dayPnl` wrong sign for shorts** (`facade.ts`). Fixed:
  `dayChange * Math.abs(quantity)` → `dayChange * quantity` (signed qty);
  pinned by a signed-contribution spec.
- **Major — `loadSymbolLists()` never invoked.** The List dropdown's
  catalog comes from `listCatalog`, which only `loadSymbolLists` opens —
  the facet was dead on a cold load. Fixed in `enterPage` (guarded, retry
  on stream error, per the store's contract).
- **Judgement — dead facets staged for #951** (`setGroupExpanded`,
  `setAllGroupsExpanded`, `chartTimeframeSeq`, `agenticAccounts`). Left in
  place — task-2 scaffolding, noted.
- **Judgement — card-identity churn.** `flatCards` rebuilds fresh objects
  per recompute; the prior art added `linkedSignal`+retention for chart
  mounts. Deferred to #951/#952 where the card component lands — DOM
  tracking is by `card.key` so the stub grid is unaffected.
- **Duplicated helpers** — `scheduleIdle`/`cancelIdle` and the `'All'`
  sentinel options were verbatim copies. Fixed: extracted to
  `shared/utils/schedule-idle.util.ts` and
  `savant-trader/common/symbol-list-filter-options.ts`; the signal gallery
  now consumes both.

## Spec

### Findings (remediated)

- **`partialError` not surfaced** (IMPL §3, TEST: "one failure degrades,
  doesn't blank the page"). Fixed: `partialErrors` computed labels each
  failed per-slice section; the template renders a non-blocking warn
  banner. Pinned by spec.
- **Zero-account dead state.** `accounts = []` after a completed load fell
  through to a silent empty grid. Fixed: `noAgenticAccount` now fires on
  `!globalLoading && !loadError && agenticAccountIndex < 0`.
- **Route spec missing** (TEST: "`portfolio-v2` lazy-loads the page behind
  the same auth guard"). Fixed: `core-routes.spec.ts` now registers
  `portfolio-v2` in the auth-gated table and pins
  `PORTFOLIO_GALLERY_V2 = 'portfolio-v2'` in the canonical-tree map.

### Accepted deviations (documented, not changed)

- **Summary shape.** IMPL listed 5 fields; the impl carries 7
  (`equityValue`, `unrealizedPnl` added). Accepted — matches the account
  summary users already read on v1.
- **`summary` reads `acct.portfolio.data`, not `aggregateSummary`.**
  `aggregateSummary` sums across *all* accounts and carries no day-P&L —
  the per-account read is the correct semantic; IMPL wording was loose.
- **Facade/UI store `providedIn: 'root'`** vs IMPL "page level". Every
  composed store in the codebase is root (`PortfolioDashboardStore`,
  `AllocationStore`, `GalleryFacade`); `resetForPage` handles facet
  staleness. Accepted.
- **Daily-bar prefetch lives in the view's idle effect**, not
  `enterPage`, and covers the filtered card set — scheduling needs
  component context; semantics equivalent.
- **`refresh()`/enterPage clear the chart bar cache** — unasked but
  correct (session-permanent cache would hide a new day's bars).

## Thermo-nuclear

### Findings (remediated)

- **Major — `dayPnl` sign bug** (same as Standards; fixed).
- **Major — attribution/bucket watchers resubscribed per account patch.**
  `toObservable(account)` emitted a fresh `AccountState` on every store
  patch (~4 listener tear-downs per refresh). Fixed: watchers key on the
  primitive `accountNumber` computed — signals dedupe primitives, so one
  listener pair per account. Pinned by spec.
- **Major — agentic pinning mutates shared global state + transient
  manual-account window.** Fixed: `account()` gates `selectedAccount` on
  `agenticAllowed`, so no computed ever evaluates over a manual account;
  the convergence effect still repins (deliberate — the dashboard's other
  surfaces sort primary-agentic first anyway). Pinned by spec.
- **Major — shorts could read `protected: true`.**
  `isStopLossProtecting` is sell-side/long-only; a sell stop on a shorted
  symbol falsely protected the card. Fixed: `quantity > 0` guard in
  `buildPositionCards`. Pinned by spec.
- **Minor — `equityPositions` slice error → silent empty grid.** Covered
  by the new `partialErrors` banner.
- **Minor — live Group dropdown inert until #951.** Accepted — the header
  chrome is task-1 scope; the grid task wires it.
- **Nit — type-erased fixtures** (`as AllocationBucket`,
  `as PositionAttribution`). Fixed: full typed factories (`makeBucket`,
  `makeAttribution`); `dataSectionFor` moved below the import block.

## Test results

- **Focused (change set):** 57 portfolio-gallery specs + 70
  `core-routes.spec` — **127 green**. `tsc --noEmit`: clean for all files
  in the change set.
- **Full suite:** 3413 passed, **43 failed in 2 suites — both outside
  this change set**: `shared/screenshot-capture-contracts.spec.ts`
  (`PositionType` gained option values) and `signal-order/
  order.component.spec.ts` (missing `Functions` provider for the new
  `ScreenshotService`). Both are the user's in-flight options/screenshot
  work (`git status` shows uncommitted edits in those files; +551 LOC in
  `order-execution.service.ts`). No #950-scope failure.

## Verdict

**PASS** — all critical/major findings remediated and re-tested; the two
full-suite failures are pre-existing WIP outside the change set (flagged
to the user separately).
