**Topic:** On-demand Screenshot Capture  
**Topic Slug:** screenshot-capture  
**Thread:** Auto-Capture  
**Thread Slug:** auto-capture  
**Issue:** #750  
**Thread Parent:** #747  
**Topic Parent:** #746  
**Domain:** SCREENSHOT  
**Type:** TEST  
**Area:** BE-SH  
**Status:** Draft  
**Created:** 2026-10-03  
**Last Updated:** 2026-10-03  

# Test Plan — BE-SH: Chart Screenshot Capture

## E2E User Journeys

- Journey 1: Dev page calls `captureChartSnapshot({symbol, event:'manual', positionType:'stock'})` → returns `{svg, paths}` → storage contains SVG+PNG for D and W at the conventional path.

## Integration Tests

- Callable handler with stubbed data assembly → storage writer called with expected paths/content-types; result contains inline SVG + paths.
- Data assembler with fixture bars → `computeSymbolIndicatorSeries` output maps into render model (all expected series present; zigzag absent).
- Storage path builder: symbol casing, event/positionType/interval segments, refId truncation, never-overwrite via HHmmss.

## Unit Tests

- **Pure functions:** spec validation (missing symbol, bad event, non-'stock' positionType, visibleBars bounds); bar-window slicing (last N per interval); series→layer mapping (bands→candle bodies, fills→rangeArea, dots→scatter, htfWindows→shaded rects); path builder; header text composition.
- **SVG renderer:** fixed render-model fixture → well-formed SVG containing candle rects, line paths, scatter circles, header text, marker element, and root `data-plot-x/data-bar-width/data-bar-count` attributes.
- **Rasterizer:** small SVG fixture → non-empty PNG buffer with expected dimensions (resvg smoke test).
- **std-dev-lines parity:** server computation vs expected band values from the FE indicator spec's fixtures.

## Test Seams

- Highest seam: callable handler invoked directly in Jest with data assembler + storage writer mocked — covers contract end to end without Firebase.
- Lower seams: pure render-model → SVG; spec validation.

## Existing Test Coverage

- `functions/src/indicators/*` spec style and `tests/functions/` suite patterns apply; storage-path precedent in trade-journal-manager tests.

## Edge Cases

- Symbol with < visibleBars bars → `failed-precondition`
- Empty indicator series (no zones/dots for symbol) → still renders candles + header
- Missing `refId` → path omits segment cleanly
- Same symbol/event/day re-capture → distinct paths via HHmmss (never overwrite)
- resvg missing font → graceful error, not silent blank text
- Width/height bounds: reject absurd dimensions (0, negative, > cap)
