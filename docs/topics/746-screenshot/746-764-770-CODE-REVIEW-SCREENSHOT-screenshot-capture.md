**Topic:** On-demand Screenshot Capture  
**Topic Slug:** screenshot-capture  
**Thread:** Auto-Capture  
**Thread Slug:** auto-capture  
**Issue:** #764  
**Thread Parent:** #747  
**Topic Parent:** #746  
**Task:** #770  
**Domain:** SCREENSHOT  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-06  
**Last Updated:** 2026-10-06  

# Code Review — #770: Dev page /dev/screenshot MVP

## Scope

`/dev/screenshot` MVP — lazy `authGuard`ed route, spec form, `httpsCallable`
service, inline SVG result + storage paths, typed error display. The working
tree also carries follow-up task #771 changes (layout variants, zoom
re-render, `renderOnly`, geometry-encoded clip ids) in the same files;
findings are tagged by task.

## Standards axis

**Hard violations — remediated:**
- *ngIf/*ngFor structural directives in `dev-screenshot.component.html`
  deviated from the repo's `@if`/`@for` convention (549 uses; zero prior
  `*ng*` in `src/app/features`). → Converted; `CommonModule` import removed.
- `svgPath` made optional by #771's renderOnly contract broke
  `functions run typecheck` — verify scripts 768/769 dereferenced
  `string | undefined` (TS2345 ×2). → Explicit invariant assert added.
- Magic `64` (`PLOT_LEFT + AXIS_GUTTER_WIDTH`) duplicated the BE layout
  constant in the FE. → `CAPTURE_PLOT_LEFT`/`CAPTURE_AXIS_GUTTER_WIDTH` added
  to shared contracts; svg-layout re-exports canonical values.
- `interval as CaptureInterval` cast in `toggleZoom`. → Param retyped.

**Judgement calls (accepted):** `data-bar-width` scraped by regex (documented
contract, tested); bespoke signal-parameter `onInput` pattern; SafeHtml
recomputed per CD tick — all dev-tool scale.

**Contract baseline — clean:** callable name matches enum → `onCall` export;
service mirrors the established `httpsCallable` + `runInInjectionContext`
pattern; `renderOnly` semantics consistent end-to-end.

## Spec axis

Every #770 AC verified met: route registered lazy+authGuard (spec asserts
`CORE_ROUTES` entry), form fields → spec mapping (defaults + overrides
tested), inline SVG + paths rendered, all four typed error codes verified
against the installed `@firebase/functions` error prefixing and the backend
`HttpsError` codes.

**Spec gap (deferred):** IMPL/TEST docs say "PNG shown" — the contract
returns a GCS object path, not a URL, so no `<img>` is possible until signed
URLs exist → Screenshot Library thread #799 scope.

**Spec deviation (#771 scope):** zoom re-renders via the callable rather than
the spec'd viewBox crop ("no re-capture") — the crop approach was tried,
produced browser letterboxing, and was replaced deliberately; issue #771 was
updated to match.

## Thermo-nuclear axis

**Major — remediated:** stale playground writes across resubmits —
`zoomPending` wasn't cleared and in-flight variant/zoom subscriptions could
paint superseded SVGs under a new capture. → `captureSeq` generation guard
on every playground subscription + `zoomPending` reset; regression test
added (Subject-based superseded-response drop).

**Minors — remediated:** `v.widthPx!` non-null (destructured); explicit
`visibleBars: undefined` key on parse failure (now conditional); empty
`intervals: []` submitted straight to the backend (client guard + test).

**Minors — accepted/noted:** variant `visibleBars` calibration reads
`data-bar-width` from `artifacts[0]` only — wrong for weekly if bar counts
differ (e.g. `visibleBars:'all'`); variant/zoom errors overwrite the primary
error banner; variant-count spec asserts 3–5 range (matches AC wording).
Fixture `as unknown as ChartRenderModel` is contained but loose.

## Test results

Full suite: **191 suites / 2849 tests — all pass** (jest --coverage=false).
`functions run typecheck` clean; `tsc -p tsconfig.app.json --noEmit` clean.
Screenshot-specific: 26 FE + 122 BE tests. Manual verification on the live
page through each iteration (route, scroll, variants, zoom, renderOnly,
clip-id fix) confirmed by the user.

## Verdict

**PASS** — all critical/major findings remediated and re-verified;
remaining items are minor/nit and mostly #771-scope.
