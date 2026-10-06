**Topic:** On-demand Screenshot Capture  
**Topic Slug:** screenshot-capture  
**Thread:** Auto-Capture  
**Thread Slug:** auto-capture  
**Issue:** #764  
**Thread Parent:** #747  
**Topic Parent:** #746  
**Task:** #771  
**Domain:** SCREENSHOT  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-06  
**Last Updated:** 2026-10-06  

# Code Review — #771: Layout playground variants + zoom + renderOnly

**Note on scope:** #771's code shipped to prod inside the #770 commits
(`2d5ed9a6`, `49e5ec7c`) — it was built in-place on the #770 files and was
inseparable. This review examines the committed state; remediation below
was applied on top of prod afterward.

## Verdict: PASS (1 remediation round)

## Axes

### Standards
Clean: small single-purpose files, `@if`/`@for` throughout, constants
single-sourced in `shared/`, tests follow repo patterns. `renderOnly`
coherent end-to-end and fully spec'd. Findings: dead enum template
exposures (fixed), no clip-id regression test (fixed), stray `as any`
(fixed), `as const` flag was a false positive — it narrows
`ChartInterval` → `CaptureInterval` and is load-bearing (restored; tsc
proved it). Nits: stale task refs in headers (fixed), service docstring
(fixed).

### Spec
All three ACs **met** with line-level evidence: 4 variants (Full/480/320/
~1.9in), zoom re-render at `visibleBars:15` with restore, per-artifact
interval isolation. All accumulated user-directed requirements verified:
native bar-width preservation, full-height variants, `renderOnly` gating,
captureSeq stale-response guard, empty-interval block. Doc drift fixed
(IMPL/TEST docs still described the abandoned viewBox-crop zoom).

### Thermo-nuclear
`captureSeq` proven correct across all traced interleavings; `renderOnly`
cannot be bypassed; `svg-slice.util` confirmed load-bearing (placeholder,
error fallback, zoomed-narrow producer); clip ids deterministic and
collision-safe. One MAJOR found → fixed:

- **MAJOR — single `visibleBars` for all intervals.** `loadVariants`
  calibrated once from `artifacts[0]` and issued one call covering all
  intervals; `assertSufficientBars` then failed thin intervals (always
  for `visibleBars:'all'` + weekly) → error banner + permanent
  placeholders. **Fix:** per-interval variant calls — each artifact's
  `data-bar-width` calibrates its own `visibleBars`, `intervals:[i]` per
  call (2×3=6 render-only calls for D+W). Variant `failed-precondition`
  now keeps the slice placeholder instead of stomping the primary
  banner; other error codes still surface.

Also remediated: `takeUntilDestroyed` on all three subscribe sites;
`defer()` in `ScreenshotService` so sync throws reach `error:`;
`MIN_CAPTURE_WIDTH/HEIGHT` (96/64) floor in spec validation; clip-id
regression test; stale-zoom regression test; stray `as any` removed.

Rejected: deleting `zoomPending` keys on seq-mismatch (suggested hardening
could unblock a live pending slot on the newer capture — the wholesale
reset on submit is the correct coupling); per-CD `SafeHtml` churn and
`internal` message echo (accepted, dev page).

## Test results

- Full suite (pre-remediation): 191 suites / 2851 tests — green.
- Post-remediation targeted: 9 suites / 153 tests — green
  (dev-screenshot 28 incl. per-interval variant calls, failed-
  precondition placeholder, stale-zoom drop).
- `tsc -p tsconfig.app.json` clean; `functions` `tsc --noEmit` clean.

## Accepted residuals (nits, dev-surface scope)

- `sliceSvgRight` SIZE_RE first-pair hazard (producer always emits root
  dims); invalid numeric overrides silently dropped; `internal` echoes
  `err.message`; variant errors other than failed-precondition share the
  primary banner; spec-file length 409 lines.
