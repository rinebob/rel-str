# Code Review — FE: Gallery card chart D/W toggle + action row above chart (#819)

**Topic:** Gallery Order Ticket View  
**Topic Slug:** gallery-view  
**Thread:** Gallery View Page  
**Thread Slug:** gallery-view-page  
**Issue:** #753  
**Thread Parent:** #744  
**Topic Parent:** #743  
**Task:** #819  
**Domain:** FE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-06  
**Last Updated:** 2026-10-06  

## Review — 2026-10-06 (round 1 — GATE PASS after remediation)

Scope: header **Chart D/W** toggle decoupled from the signal-timeframe filter
(`chartTimeframe` in `GalleryUiStore`, `CardChartTimeframe = DAILY|WEEKLY` type),
per-card D/W chip with header re-sync via `linkedSignal`, weekly bars lazy-load
(`ensureWeeklyBars` + `weekly/all` read), timeframe-filtered card occurrence
dots, ±50 visible-bar chips, ST StdDevLines overlay on both intervals, action
toolbar moved above the chart cell, 220-day bar lookback. Plus remediation
round: `allOccurrences` untrimmed occurrence set, `chartTimeframeSeq` reset
tick, `weeklyError` split, `untracked` ensure effect, card-identity retention
(`retainGalleryCards`), viewport-aware chart unmount.

**Verdict: PASS.** Standards: PASS after remediation — no critical/major
findings; minors fixed (enum narrowed to `CardChartTimeframe`, `timeframe`
input chain renamed `chartTimeframe`, `normalizeSymbol` extracted,
`CARD_CHART_BAR_STEP` in template, `type="button"`, `.cc-chip-group` rename,
merged spec imports). Spec: all five ACs verified met in code — header toggle
switches all card charts without touching the signal filter, per-card override
with header resync, dots filtered to chart interval, ±50 window control,
action row above chart. Thermo-nuclear: PASS after remediation — one major
(occurrence trimming destroyed the decoupled chart's card dots) fixed via
`allOccurrences`; two minors fixed (shared error slot, over-tracked effect).

### Findings — fixed in remediation

- **Major (thermo)** — `filterGalleryCards` trims `card.occurrences` to the
  *signal* timeframe before cards reach the grid, so under the default D
  filter a weekly chart render had zero card occurrences to dot — the
  decoupled Chart D/W toggle silently broke the card's distinguishing dots.
  Fixed: `GalleryCard.allOccurrences` carries the untrimmed set through the
  pipeline (`occurrences` still trims for the list render); the chart
  filters `allOccurrences` by *chart* interval. Regression spec drives the
  real `buildGalleryCards` → `filterGalleryCards` pipeline into the
  component and asserts the weekly dot survives a D signal filter.
- **Minor (thermo)** — shared `error[symbol]` slot for daily and weekly
  loads: a weekly failure marked a healthy daily chart unavailable and a
  daily failure blocked weekly retries. Fixed: separate `weeklyError`
  record; `ensureWeeklyBars` guards/loads/clears on it; the component reads
  the interval-scoped accessor. Specs cover both isolation directions and
  `clearCache` retry.
- **Minor (thermo)** — the ensure effect tracked store records read inside
  `ensureBars`/`ensureWeeklyBars`, so every bar/loading/error patch for
  *any* symbol re-ran the effect in every mounted card. Fixed: `untracked`
  around the store calls; the effect depends only on card symbol + interval.
- **Minor (standards)** — `chartTimeframe` reused `SignalTimeframe` (admits
  `ALL`, wrong domain). Fixed: `CardChartTimeframe = DAILY|WEEKLY` in
  `constants.ts`; store/facade/header/card/group/chart signatures narrowed.
- **Minor (standards)** — input chain still named `timeframe` though it now
  means chart interval. Fixed: renamed `chartTimeframe` through card →
  group → view bindings; stale "Page timeframe filter" comments corrected.
- **Minor (standards)** — literal `50` in the template vs the exported
  `CARD_CHART_BAR_STEP`; `normalizeSymbol` duplicated; missing
  `type="button"`; `.cc-tf-toggle` class name wrong for the ±50 group;
  duplicate `@angular/core` import in the chart spec. All fixed.

### Emergent fixes during remediation (folded into this diff)

- **`chartTimeframeSeq` reset tick** — with a strict two-value toggle, a
  header click on the *already-active* pill carries intent ("sync all cards
  to daily") but produces no signal change, so `linkedSignal` couldn't
  resync. `GalleryUiStore.chartTimeframeSeq` bumps on every
  `setChartTimeframe` call; the card's `linkedSignal` watches
  `[chartTimeframe, seq]`. Spec covers the same-value-click resync.
- **Gallery perf (user-reported slowdown)** — not subscriptions (all
  one-shot `takeUntilDestroyed` reads; runs listener idempotent). Two
  compounding causes fixed: (a) `visibleCards` minted fresh `GalleryCard`
  objects on every ticket/decision/history patch — every mounted chart
  re-rendered per action — fixed by `retainGalleryCards` element-wise
  identity retention in the facade; (b) `@defer` mounts were permanent —
  every scrolled-past chart stayed a live Syncfusion instance — fixed by an
  IntersectionObserver (600px margin) unmounting the inner flex-chart while
  component-level state survives remount. Facade spec asserts identity
  retention across an unrelated ticket patch.
- **Header Chart pills** — emit on every click including same-value (spec
  covers the triple-click sequence).

### Coverage added

- Pipeline regression: `buildGalleryCards` → `filterGalleryCards` (D filter)
  → chart at W still draws the weekly card dot.
- Store: weekly lazy fetch/dedupe/error-isolation/clearCache-retry (both
  error directions).
- Component: weekly interval on weekly bars, per-card chip override, seq-tick
  resync incl. same-value click, interval-scoped unavailability (weekly
  error doesn't poison daily chart and vice versa), StdDevLines presence on
  both intervals, ±50 floor/ceiling clamps.
- Card: action toolbar precedes the chart cell in DOM order.
- UI store: `setChartTimeframe` value + tick bump, same-value bump,
  `resetForPage` restores D.
- Facade: `setChartTimeframe` delegation; `visibleCards` identity retention.
- Header (new spec file): active pill state, per-click emit incl.
  same-value, market date + run-completion timestamp, refresh emit/disable.

### Findings — carried to QA (deferred judgement calls)

- StdDevLines enabled on both card intervals (signal-detail enables it on
  daily only) — deliberate so the D/W flip keeps the same context; flag for
  UAT if weekly StdDev reads noisy.
- 220-day daily lookback (~150 trading bars) keeps one shard read while
  covering the period-50 StdDev warmup and ±50 headroom — same trade-off as
  #756's year-shard read.
- Chart unmount resets nothing user-visible (interval/visibleBars live on
  the component; bars/indicator data are store-cached) but a *visible* DOM
  teardown+rebuild happens on re-entry — margin tuned to 600px to keep it
  off the fold.
- `retainGalleryCards` equivalence covers the rendered-relevant fields
  (element-wise on both occurrence arrays, ref-equality elsewhere); a new
  mutable field added to `GalleryCard` later must be added to
  `sameGalleryCard` or it silently won't propagate.

## Review — 2026-10-06 (round 2 — GATE PASS after remediation)

Re-review of the post-round-1 state — the #838 remediation had touched
shared surfaces (cache clear, observer, card identity) since round 1
converged. Three majors found, all fixed:

- **Major (thermo) — pass-through plumbing.** `chartTimeframe`/`chartTimeframeSeq`
  were threaded as inputs through view → group → card → chart; three of the
  four layers never consumed them. Fixed: the leaf `GalleryCardChartComponent`
  injects the root `GalleryUiStore` directly and sources its `linkedSignal`
  on `[chartTimeframe(), chartTimeframeSeq()]`; all four intermediate
  inputs/bindings deleted (~14 binding sites). The facade keeps only the
  `chartTimeframe` passthrough the header needs.
- **Major (thermo) — divergent full-occurrence readers.** `allOccurrences`
  existed for chart dots, but `findCardTickets`/`latestDecidedAt` still read
  the trimmed `occurrences`, and the actions service rebuilt a parallel
  unfiltered map via `cardOccurrences()`/`signalsBySymbol` (including a
  cloned card for `removeStagedTickets`). A ticket staged from a
  filter-hidden weekly leg would lose its statusing, and a hidden-leg
  decision wouldn't timestamp the card. Fixed: `allOccurrences` is now the
  canonical full-set field — `findCardTickets`, `latestDecidedAt`,
  `allRejected`, the filter's `inTimeframe` trim, group D/W counts, and all
  action-service readers use it; the parallel machinery (incl. the unused
  `SymbolHistoryStore` inject) is deleted.
- **Major (thermo) — non-atomic `clearCache`.** A request in flight at
  `refresh()` time could land post-clear and resurrect stale bars
  session-permanently; mounted charts could strand on the loading
  placeholder because the ensure effect's store reads were `untracked`.
  Fixed: `GalleryCardChartStore.epoch` bumps on `clearCache`; `ensureBars`/
  `ensureWeeklyBars` capture the epoch and drop landing writes (success and
  error) from a prior epoch; the component effect reads `epoch()` as a
  tracked dep so mounted cards re-ensure after clear. The unused
  per-symbol `clearCache` overload was removed (no callers).

### Round-2 minors — fixed

- `visibleCards` mutation-inside-computed → `linkedSignal`
  (`prev?.value` feeds `retainGalleryCards`), exposed `asReadonly()`.
- Seven-site `interval === WEEKLY` sweep in the card chart → one `lane`
  computed selects bars/error/intervalData/extras/barsInterval/timeframe.
- `gallery-cards.util.ts` (437 lines) split — action/status/ticket block
  moved to `gallery-card-actions.util.ts` (185); the base file (282) keeps
  aggregate/filter/group/retain. `findStagedCardTicket` (dead export) deleted.
- `DEFAULT_CARD_CHART_TIMEFRAME` single-sourced the repeated
  `SignalTimeframe.DAILY` chart default (constants/ui-store/header).
- `paperDisabled` is its own computed (was an alias of `tradeDisabled`).
- Idle schedule/cancel now share one `HAS_IDLE_CALLBACK` flag (a mixed-capability
  environment could schedule via setTimeout then call `cancelIdleCallback`).
- Group D/W counts read `allOccurrences` — a filter can't zero a count whose
  dots the chart still draws.
- `enterGallery()` now clears the chart bar cache — a run/day boundary can
  pass while the user is on another page (shared `GroupStore`), and nothing
  else bumped the epoch (thermo minor).
- Spec hygiene: chart spec drives the real root `GalleryUiStore` (real
  seq-bump semantics, incl. same-value click); facade spec asserts
  `setChartTimeframe` leaves the signal filter untouched; dead mock fields
  trimmed (`historyStoreMock` deleted from the actions spec — the service
  no longer reads history).

### Round-2 coverage added

- Store: epoch bump on `clearCache`; pre-clear daily write dropped;
  post-clear request still lands (guards aren't a blanket drop); in-flight
  weekly write dropped.
- Component: epoch bump re-ensures daily and weekly on mounted cards.
- Util: ticket staged from a filter-hidden occurrence still statuses the
  card; a decision on a hidden leg still feeds `actionedAt`.
- Facade: `enterGallery` clears the bar cache.

### Round-2 findings — flagged, not blocking

- `IndicatorSeriesStore.clearCache(symbol)` is dead code AND silently broken
  (`key.startsWith('${symbol}|')` never matches — keys are
  `callableName|symbol|…`). Foreign scope (shared store, no callers); fix or
  delete in a future pass.
- `visibleBars` isn't re-clamped on an interval flip — a 140-bar daily window
  persists onto weekly until the next manual adjust; flex-chart tolerates
  overshoot. Cosmetic.
- The `actionContext` computed shape is duplicated between facade and
  actions service — pre-existing residual (flagged in the #755 doc); the
  typed interface catches field drift.
- D/W pill SCSS duplicated between header and card-chart — each file
  cross-references the other; a shared partial would be the fix if a third
  instance appears.
- Rejected occurrences still dot the chart via `allOccurrences` (they're
  card context, just not actionable) — flagged for QA/UAT adjudication.
- `facade.refresh → clearCache → mounted-card re-ensure` is proven across
  two test seams (facade mocks clearCache; chart spec bumps a mock epoch) —
  the halves are each covered; an end-to-end seam test is a nice-to-have.

**Round-2 verdict: PASS** on all three axes. Targeted suites: 204 tests
green; `tsc` clean in scope (3 pre-existing errors elsewhere:
`bulk-swing-sweep.ts`, `indicator-config-dialog.component.ts`).
