# Code Review — FE: Chart cell — @defer (on viewport) + eager prefetch (#756)

**Topic:** Gallery Order Ticket View  
**Topic Slug:** gallery-view  
**Thread:** Gallery View Page  
**Thread Slug:** gallery-view-page  
**Issue:** #753  
**Thread Parent:** #744  
**Topic Parent:** #743  
**Task:** #756  
**Domain:** FE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-05  
**Last Updated:** 2026-10-05  

## Review — 2026-10-05 (round 1 — GATE PASS)

Scope: `GalleryCardChartStore` (per-symbol daily-bars + symbol-data-version cache; indicator warm via shared `IndicatorSeriesStore` key), `GalleryCardChartComponent` (quick-charts daily stack + card-occurrence price-pane dots), `@defer (on viewport; prefetch on idle)` chart cell in `gallery-card`, idle `prefetch` effect in `gallery-view`, `LocalBarReadService.getSymbolDataVersion$`, `--fc-min-height` seam in flex-chart, `IntersectionObserver` jsdom stub. Plus remediation round: error-dedupe guard, version-mismatch warn, `clearCache`, `ohlcToPriceBar` hoist, `getSymbolDataVersion$` specs, dead-API/cast/stale-doc cleanup.

**Verdict: PASS.** Standards: PASS after remediation — four hard violations fixed (untested service method, dead `loadingFor` API, `as unknown as` cast, stale headers). Spec: PASS — all four acceptance criteria verified met with test coverage. Thermo-nuclear: PASS after remediation — one major (error-path infinite retry loop via the mount effect re-firing on `loading` record flips) fixed by including `error[sym]` in the `ensureBars` dedupe guard, with regression coverage.

### Findings — fixed in remediation

- **Major (thermo)** — `ensureBars` deduped on `bars`/`loading` but not `error`; the card mount effect tracks `state.loading()`, so an error patch refires the effect → refetch → error → loop. Fixed: `|| state.error()[sym]` added to the guard (`gallery-card-chart.store.ts:79`) + spec (`does not retry a failed symbol`).
- **Hard (standards)** — `getSymbolDataVersion$` shipped without coverage. Fixed: six specs in `local-bar-read.service.spec.ts` (path, casing, missing doc/field, empty symbol, error → `''`).
- **Hard (standards)** — `loadingFor` exported with zero production consumers (component intentionally derives pending from `bars`/`error`). Fixed: computed deleted; the `loading` record stays for dedupe.
- **Hard (standards)** — `(setTimeout(cb,0) as unknown as number)` in `gallery-view.component.ts`. Fixed: `window.setTimeout` returns `number` under DOM lib.
- **Hard (standards)** — stale headers claiming charts attach "in a later task" / "popup stub" / "~16:9 cell". Fixed in `gallery-view.component.ts`, `gallery-card.component.ts`, `gallery-card-chart.component.scss`, IMPL doc (340→440, `#756`→`#761` for the popup stub).
- **Minor (thermo)** — `toPriceBar` duplicated `chart.service`'s `toPrice`. Fixed: hoisted to `ohlcToPriceBar` in `utils/utils.ts`; both call sites consume it (heatmap `PriceBar` and flex-chart `PriceBar` are structurally identical).
- **Minor (thermo)** — no cache invalidation; session-permanent entries could go stale across trading days. Fixed: `clearCache(symbol?)` mirroring `IndicatorSeriesStore`, with specs.
- **Minor (thermo)** — root-version vs last-bar drift undetectable from parallel reads. Fixed: `console.warn` parity with `chart.service`'s mismatch check.
- **Nit** — `as GalleryCard` fixture hid required `actionedAt`. Fixed.

### Findings — carried to QA (deferred judgement calls)

- `addChartExtras` could gain an `overlayDots` key to replace the component's clone-and-re-id branch — deferred: expanding a shared helper's API for one consumer is speculative generality; revisit if a second consumer appears.
- Version fallback uses `||` not `??` (empty-string root field falls back to last bar date vs canonical `??` which yields `''`) — deliberate: it warms the cache under a reasonable key instead of skipping; worst case is a duplicate cache entry, not wrong data.
- Idle prefetch warms all filtered cards including collapsed groups — spec-consistent ("eagerly"), ~3 doc reads + one callable per unique symbol.
- `getRecentDailyBars$` pulls a full year shard (~250 bars) to keep ~63 — acceptable read volume for the lookback headroom; revisit if card counts grow.
- `IntersectionObserver` jsdom stub is a no-op — a callback-capturing stub could drive real viewport triggers later; `DeferBlockBehavior.Manual` suffices today.
- Accepted deviations from the written ACs (user-directed mid-implementation): `visibleBars` 40 not ~30; cell fixed 440px not ~240px; full quick-charts daily stack, not a slim config.

### Test results

Full suite **191 suites / 2,840 tests — green** (pre-remediation); 385 targeted tests green post-remediation; `tsc --noEmit` clean on app + spec configs. New coverage: version fetch + fallback + skip-warm, error-dedupe no-retry, `clearCache`, quick-charts daily stack shape, `-card` overlay dots, defer-block placeholder→complete, idle prefetch wiring.
