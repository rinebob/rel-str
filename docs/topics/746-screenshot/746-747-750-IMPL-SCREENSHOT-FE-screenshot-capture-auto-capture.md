**Topic:** On-demand Screenshot Capture  
**Topic Slug:** screenshot-capture  
**Thread:** Auto-Capture  
**Thread Slug:** auto-capture  
**Issue:** #750  
**Thread Parent:** #747  
**Topic Parent:** #746  
**Domain:** SCREENSHOT  
**Type:** IMPL  
**Area:** FE  
**Status:** Draft  
**Created:** 2026-10-03  
**Last Updated:** 2026-10-03  

# Implementation Plan — FE: /dev/screenshot Page

## Scope

A dev-only exploration page at `dev/screenshot` that invokes `captureChartSnapshot` and renders the results — plus the layout playground for iterating on how captures will look inside a future card/gallery element.

## Route

- `AppRoutes.SCREENSHOT_DEV = 'dev/screenshot'` in `core-routes.ts`, `loadComponent` lazy, `authGuard` — same pattern as `FLEX_CHART_SANDBOX = 'dev/flex-chart'`.

## Component structure

```
src/app/features/dev-screenshot/
  dev-screenshot.component.ts / .html / .scss   — page shell + spec form
  screenshot.service.ts                          — httpsCallable wrapper (types from shared/)
  svg-slice.util.ts / .spec.ts                    — right-anchored viewBox slices (variant placeholders + narrow variants of a zoomed render)
```

## Page behavior

- **Spec form:** symbol input, event select (`manual` default), interval checkboxes (D/W default on), width/height/visibleBars overrides. Submit → `httpsCallable` → result.
- **Result display:** the returned SVG injected inline (DomSanitizer/`[innerHTML]` or element injection — SVG string is trusted, we own the function), PNG shown via `<img>` from returned path/URL, storage paths listed.
- **Layout playground:** per-width callable re-renders (renderOnly) stacked vertically — narrower cards show fewer bars off the right end at the same bar scale (native bar width via per-interval data-bar-width calibration), incl. the narrow ~1–2in target.
- **Quick zoom:** re-render via a second callable call with `intervals:[i]`, `visibleBars:15`, `renderOnly:true` — bars and y-axis rescale to the window (the viewBox-crop design was tried and rejected during #771; re-render is the shipped approach). Toggle back restores the full render.
- **Errors:** structured callable errors shown inline (invalid-argument vs failed-precondition vs internal).

## Dependencies

- Shared contract types from `shared/screenshot-capture-contracts.ts` (BE-SH blueprint task — **blocked by it**).
- `@angular/fire/functions` `httpsCallable` — existing app pattern.

## Risks / notes

- SVG injection is safe only because the producer is our own function — note the boundary in code, don't generalize the pattern.
- Multiple interval results (D + W) display side by side; playground applies to both.
- Dev page is throwaway-adjacent but not throwaway: it remains the preview surface once pipeline wiring lands in a follow-on Thread.
