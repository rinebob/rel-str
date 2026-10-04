**Topic:** On-demand Screenshot Capture  
**Topic Slug:** screenshot-capture  
**Thread:** Auto-Capture  
**Thread Slug:** auto-capture  
**Issue:** #748  
**Thread Parent:** #747  
**Topic Parent:** #746  
**Domain:** SCREENSHOT  
**Type:** PRD  
**Status:** Approved  
**Created:** 2026-10-03  
**Last Updated:** 2026-10-03  

# PRD: Auto-Capture — Server-Side Chart Screenshot Infrastructure

## Problem Statement

When positions open or close, there is no durable record of what the chart looked like at decision time. The trade journal supports screenshots only via manual file upload — nothing is captured programmatically, so entry/exit conditions go undocumented unless the trader remembers to screenshot by hand. A headless-browser approach was evaluated and rejected: too heavy, too slow (30–60s per capture), and too much infrastructure for the value delivered.

## Solution

A server-side chart renderer: a callable Cloud Function that accepts a capture spec, pulls the same indicator-series data the quick-charts panel consumes, renders the chart to SVG with purpose-built drawing primitives, rasterizes a PNG derivative, and writes both artifacts to the app's Firebase Storage bucket (GCS). A `/dev/screenshot` page provides an exploration surface for iterating on render quality before the function is wired into order/position lifecycle events.

The image depicts a **canonical conditions record** — semantically the same chart as quick-charts (same data pipeline, same visual language), not a pixel copy of the Syncfusion DOM.

## System Context

```mermaid
flowchart LR
    subgraph FE["Angular App"]
        DevPage["/dev/screenshot page"]
        QuickCharts["quick-charts (reference visual)"]
    end
    subgraph BE["Firebase Functions"]
        Capture["captureChartSnapshot (callable)"]
        Renderer["SVG chart renderer (primitives)"]
        IndSeries["indicator-series pipeline"]
    end
    Storage[("Firebase Storage / GCS<br/>st-trade-screenshots/{symbol}/...")]

    DevPage -->|capture spec| Capture
    Capture --> IndSeries
    IndSeries --> Renderer
    Renderer -->|SVG| Storage
    Renderer -->|PNG (resvg)| Storage
    Capture -->|storage paths| DevPage
    Future["Future: order/position lifecycle events"] -.->|capture spec| Capture
```

## User Stories

1. As the developer, I want a `captureChartSnapshot` callable that accepts `{ symbol, intervals, event, positionType, refId?, width?, height?, visibleBars? }` and returns the SVG inline plus storage paths, so that chart captures can be triggered programmatically and iterated on without round-trips.
   - *Verify:* invoke the callable with a valid spec → returns `{ svg, paths }` with one SVG and one PNG per requested interval in storage.
2. As the developer, I want the rendered chart to use the same indicator-series data as quick-charts — ZONE_V1/V2, TREND_STRENGTH, TREND_BANDS, strategy-derived signal/uptick dots, HTF zone windows — **plus ST Std Dev Lines**, and explicitly **without zigzag**, so that the capture faithfully represents the chart the system trades on.
   - *Verify:* capture for a symbol shows the quick-charts indicator set plus the Std Dev Lines overlays/fills; no zigzag series appears.
3. As the developer, I want the chart rendered as SVG primitives (candles, lines, scatter dots, bands, panes) in the flex-chart visual language/theme, so that captures are deterministic, fast (~1s), and browser-free.
   - *Verify:* returned SVG is well-formed markup containing candle, indicator, and marker elements; no headless browser or DOM serialization is involved.
4. As the developer, I want a PNG derivative of the SVG stored alongside it, so that the artifact is portable (journal entries, email, downstream consumers).
   - *Verify:* each capture writes both `{name}.svg` and `{name}.png` to storage; PNG opens correctly and resembles the SVG.
5. As the developer, I want daily and weekly interval captures in one call, defaulting to quick-charts' 30-bar windows, so that both timeframes documented in quick-charts are covered.
   - *Verify:* `intervals: ['daily','weekly']` produces two image pairs in a single invocation; each shows the last 30 bars unless `visibleBars` overrides. `visibleBars: 'all'` renders the full series — full-chart context for dev-cycle inspection.
6. As the developer, I want artifacts stored at `st-trade-screenshots/{SYMBOL}/{yyyy-MM-dd}-{HHmmss}-{event}-{positionType}[-{refId6}]-{interval}.{svg,png}` in the default Firebase Storage bucket, so that captures are organized, enumerable, never overwrite, and live in a bucket we already operate.
   - *Verify:* files appear at the conventional path; two captures for the same symbol/event/date produce distinct paths (time segment); `refId` appears truncated to 6 chars when provided.
7. As the developer, I want an event marker and metadata header (symbol, event, timestamp, positionType, refId) baked into the image, so that each artifact is self-describing without consulting the caller.
   - *Verify:* the rendered image visibly shows the marker on the latest bar and the header text.
8. As the developer, I want a `/dev/screenshot` page where I can enter a symbol, event, intervals, and render params, invoke the callable, and see the returned SVG/PNG plus storage paths — so that render quality can be iterated visually. The page is also the **layout playground**: it displays the same capture in 3–5 card layouts/gallery configs at different sizes (including very narrow ~1–2in cards), because these images are the input to a future FE card/gallery element.
   - *Verify:* `/dev/screenshot` shows the capture in multiple layout/size variants side by side; entering a symbol and triggering capture displays image + paths.
9. As the developer, I want a "quick zoom" on the dev page that crops the displayed image to the last ~15 bars by manipulating the SVG (viewBox/bar-range crop), so that a tighter view is available without storing or re-rendering another artifact.
   - *Verify:* zooming a 30-bar capture shows only the front ~15 bars; no new file appears in storage.
10. As the developer, I want `positionType` carried in the spec (value `'stock'` today), so that a future basket-orders Thread can pass option position types without breaking the contract.
   - *Verify:* spec validates `'stock'`; unknown values are rejected or pass through per the contract's stated rule.
11. As the developer, I want capture errors (bad symbol, missing data, renderer failure) surfaced as structured callable errors, so that callers and the dev page can distinguish failure modes.
    - *Verify:* an invalid symbol returns a typed error (not a silent empty artifact); the dev page displays it.

## Implementation Decisions

- **Execution model:** server-side render — no headless browser, no DOM serialization. Chosen over headless Playwright/Puppeteer (30–60s + heavy deploy artifact) and client-side capture (requires a live session; fills/closes fire unattended via webhooks).
- **Render pipeline:** hand-built SVG document from bars + computed indicator series; PNG via `@resvg/resvg-js` (prebuilt binary; needs a bundled font for text). SVG is the canonical artifact; PNG is the derivative.
- **Data source:** reuse the `indicator-series` callable pipeline (`functions/src/st-cloud-function/indicator-series.ts`) — the identical data quick-charts renders. Bars + indicator series for daily and weekly come from the same response shape.
- **Chart content:** current chart only — no as-of truncation. Captures will be invoked at event time inside the pipeline, so latest data *is* event-time data. Optional trailing-context support deferred.
- **Visual language:** replicate quick-charts/flex-chart semantics (candles, trend bands, zone/indicator panes, ST Std Dev Lines overlays + fills, signal + uptick dots, HTF window markers, dark theme palette from `chart-theme.ts`), not Syncfusion pixels. Zigzag is excluded from the capture chart even though flex-chart supports it.
- **Trigger:** the only trigger in this Thread is a manual invocation of the callable — from `/dev/screenshot` or any other caller. `event` is a label stamped into the image and path, not a wired lifecycle hook. Real triggers (order-placed / order-filled / position-closed confirmations in the pipeline) are the follow-on Thread that calls this same function.
- **Storage:** default Firebase Storage bucket via `admin.storage().bucket()` — it *is* GCS; same bucket the trade journal already uses, separated by the `st-trade-screenshots/` prefix.
- **Contract:** `captureChartSnapshot({ symbol, intervals?: CaptureInterval[], event: CaptureEvent, positionType: 'stock', refId?, width?, height?, visibleBars? })` → `{ svg, paths, artifacts }`. `CaptureInterval` = `ChartInterval.DAILY | WEEKLY` (monthly out of scope — type-enforced). `CaptureEvent` ∈ `order-placed | order-filled | position-closed | manual`. `refId` is an opaque caller key embedded in the path. The SVG is returned inline so callers (the dev page) can manipulate it without a storage round-trip; `width`/`height`/`visibleBars` make aspect-ratio variants a parameter, not a code change. `visibleBars` accepts a number or `'all'` (full series — whole-chart view for dev inspection). Defaults: 30 bars D / 30 W.
- **Crop-friendly SVG layout:** equal-width candles → linear x-axis; price-axis labels render on the **right** so a left-crop preserves axes and the latest-bar marker. The renderer emits bar-grid metadata on the SVG root (`data-plot-x`, `data-bar-width`, `data-bar-count`) so clients can crop to the last N bars precisely — the dev page's "quick zoom" uses this instead of storing a second artifact.
- **Dev surface:** `/dev/screenshot` route — symbol/event/interval/render-param inputs, invokes callable, renders returned SVG/PNG + paths. Doubles as the render-quality iteration loop **and** the card-layout playground: the same capture shown in 3–5 layout/gallery configs at different sizes, since the artifacts are the input to a future FE card element.
- **Marker:** event marker on the latest bar; thin metadata header strip (symbol, event, timestamp, positionType, refId).

## Testing Decisions

- External behavior is tested, not implementation: given a spec, assert returned paths exist in storage (emulator or test bucket) and files are non-empty/well-formed.
- **Renderer unit tests (Jest):** SVG generation from a fixed series fixture — candle geometry, marker placement, header text, pane layout; deterministic snapshot-style assertions on structure (not pixel-perfect).
- **Callable integration test:** stub `indicator-series` data → invoke handler → assert storage writes with expected paths/content types. Prior art: existing `tests/functions/` suite (`npm run test:sds`-adjacent) and trade-journal-manager tests for storage-path conventions.
- **Dev page spec (TestBed):** renders inputs, calls a mocked callable, displays paths/image — prior art: component specs under `src/app/features/`.

## Out of Scope

- Wiring captures into real order-placed/order-filled/position-closed pipeline events (follow-on Thread once render quality is proven).
- Options-position captures (basket orders: verticals, calendars, etc.) — follow-on Thread; `positionType` is reserved in the contract.
- Attaching screenshot paths to position/order/trade docs (linkage schema designed at wiring time).
- Monthly interval; paper-trading and backtest scope.
- Full Syncfusion pixel parity; DOM snapshots; any headless-browser approach.
- As-of/bar-truncation semantics (current chart only).

## Further Notes

- The dev page doubles as the regression surface: once the pipeline wires events in, `/dev/screenshot` remains the way to preview what an event capture will look like for any symbol.
- A `tail`/`postscript` option (marker at event bar plus a few trailing bars) may be added later if review wants "what happened next" context — deliberately deferred, not designed now.
