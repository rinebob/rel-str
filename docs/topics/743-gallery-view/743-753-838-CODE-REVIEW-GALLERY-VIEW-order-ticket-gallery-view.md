# Code Review — FE: Gallery header affordances, decoupled chart interval, render-perf (#838)

**Topic:** Gallery Order Ticket View  
**Topic Slug:** gallery-view  
**Thread:** Gallery View Page  
**Thread Slug:** gallery-view-page  
**Issue:** #753  
**Thread Parent:** #744  
**Topic Parent:** #743  
**Task:** #838  
**Domain:** FE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-06  
**Last Updated:** 2026-10-06  

## Review — 2026-10-06 (round 1 — GATE PASS after remediation)

Scope: catch-up ticket for work shipped ahead of scope during #819/#820 —
header refresh button (promote-or-reload), market-date + PT completion
timestamp, decoupled header Chart D/W (`chartTimeframe`/`chartTimeframeSeq`),
card company-meta lines (sector/industry + exchange/tier/β/P-E),
`retainGalleryCards` identity retention, IntersectionObserver viewport
unmount, daily-bars lookback 90→220d, and the stale-write/cache fixes those
surfaces exposed.

**Verdict: PASS after remediation.** Standards: no critical/major; all
minors fixed. Spec: all seven acceptance criteria verified in production
code through the real pipeline. Thermo: four Majors found and fixed —
stale-write race in `loadSymbolsWithSignals`, refresh grid teardown via
`pageInitializing`, inert observer `rootMargin` (viewport root vs nested
scrollport), and missing card-chart cache eviction on run change.

### Majors — fixed

- **M1 (thermo) — stale async writes in `GroupStore.loadSymbolsWithSignals`.**
  A superseded run's `forkJoin` response could land after `setActiveRun` to a
  newer run (the refresh promote path made this easy to hit), clobbering the
  new run's `signalSymbols`, clearing its `symbolsLoading` flag, and fanning
  out history reads under the wrong runId — poisoning the `sym::runId`
  cache. Fixed: both `next` and `error` handlers bail when
  `state.activeRunId() !== runId` (the captured request run). Specs cover
  stale-response, stale-error, and normal error paths.
- **M2 (thermo) — refresh tore down the whole grid.** `pageInitializing`
  included `symbolsLoading` unconditionally, so every same-run refresh
  destroyed the card grid — scroll position, per-card D/W overrides, and
  every mounted chart — defeating the perf work it shipped alongside. Fixed:
  once `cards().length > 0` the loading branch is skipped; refresh patches
  state in place. Spec asserts grid persistence under `symbolsLoading`.
- **M3 (thermo) — inert `rootMargin` on the viewport-unmount observer.**
  The observer rooted on `null` (viewport) while the gallery scrolls inside
  `.gallery-groups` — the scrollport clips targets *before* the margin
  applies, so the 600px prefetch band did nothing. Fixed: root is
  `host.closest('.gallery-groups')` (viewport fallback preserved). Specs
  assert the root element, margin, unmount/remount, and disconnect.
- **M4 (thermo) — card-chart cache survived run changes.** Refresh promoted
  to a newer run but `GalleryCardChartStore` kept the old run's bars —
  session-permanent entries could hide a new trading day. Fixed:
  `refresh()` clears the chart cache on both promote and same-run paths.
  Spec asserts `clearCache` on both.

### Minors — fixed

- **Refresh ticket-load asymmetry** — the promote path skipped
  `loadTickets`, so tickets staged elsewhere stayed stale until next page
  entry. Fixed: `reloadRunData()` is the shared enter/refresh path
  (symbols+decisions+tickets) and the promote path calls `loadTickets`
  explicitly before `setActiveRun`. Spec added.
- **Meta-row leading separator** — the first field of each meta line
  rendered a leading `·`. Fixed: separators emit only between fields; dead
  `card-meta-sector` class removed; SCSS comment corrected to the two-row
  layout.
- **History cache poisoning** — both `SymbolHistoryStore` loaders cached
  `[]` on error; a transient failure marked the symbol signal-less for the
  session (cache-hit early return made refresh unable to recover). Fixed:
  error paths clear the loading flag only. Spec asserts retry re-fetches.
- **Observer callback read `entries[0]`** — the stalest entry of a batch.
  Fixed: last entry (freshest) decides `mounted`. Spec covers a batched
  out→in transition.
- **`@let` + honest refresh tooltip + market-date fallback** — header
  timestamp uses `@let` instead of a non-null assertion; tooltip changed
  from "Reload latest signals" to "Refresh — switch to the newest run or
  reload signals"; `facade.runMarketDate` falls back to the run date
  captured at `setActiveRun` when the run ages out of the realtime window.
- **Overstate comment** — the idle-prefetch effect claimed to re-schedule
  only on card-set changes; it re-runs on every `visibleCards` identity
  change (cheap — `prefetch()` dedupes per symbol). Comment corrected.

### Coverage added this round

- `group.store.spec` — first `loadSymbolsWithSignals` suite: W/D merge +
  fan-out, stale-response guard, stale-error guard, active-run error.
- `symbol-history.store.spec` — failed load leaves no cache entry; next
  call retries the fetch.
- `gallery.facade.spec` — promote-path `loadTickets`, `clearCache` on both
  refresh paths, `pageInitializing` stays false during refresh with cards.
- `gallery-card-chart.component.spec` — controllable `IntersectionObserver`
  suite: `.gallery-groups` root, viewport fallback, offscreen unmount +
  remount, last-entry freshness, destroy-disconnect.
- `gallery-header.component.spec` — refresh-button selector hardened off
  the tooltip string.

### Findings — carried to QA (deferred judgement calls)

- `CARD_CHART_LOOKBACK_DAYS = 220` (~150 trading bars) can leave StdDevLines
  warmup thin at maximum `+50` expansion — accepted; the indicator is
  locally computed so the cost of more lookback is the read, not render.
- `chartTimeframeSeq` stays a non-required card input — grouped and flat
  paths both bind it; keeping it optional preserves spec fixtures.
- `runMarketDate`/`completedAt` rely on `viewedRun()` / the stored
  `_activeRunMarketDate`; a run pruned from the stream mid-session still
  shows its captured market date.

## Verification

- Targeted: 86 specs across group.store, symbol-history.store,
  gallery.facade, gallery-card-chart.component, gallery-header.component —
  all green post-remediation.
- `tsc --noEmit` — clean in scope (3 pre-existing errors elsewhere:
  bulk-swing-sweep ×2, indicator-config-dialog ×1).
- Full suite: 191/193 suites pass, **2854 tests, zero test failures**.

## Results log

- 2026-10-06 — Review round 1: PASS after remediation (4 majors fixed,
  6 minors fixed, 13 new/updated specs).
- 2026-10-06 — Full suite: 2854 tests green, zero failures. Two suites fail
  to *compile* — `shared/screenshot-capture-utils.spec.ts` and
  `tests/functions/screenshot-capture/capture-chart.spec.ts` — expecting
  `groupId`/`PositionType` members added by the in-flight **#746
  screenshot-capture** stream (a separate working tree change half-applied:
  `screenshot-capture-contracts.ts` and specs updated, `ScreenshotPathSpec`
  and the functions-side enum not yet). Out of #838 scope; left for that
  thread to finish.

## Next

`/proj qa 743 838`
