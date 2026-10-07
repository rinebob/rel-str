**Topic:** On-demand Screenshot Capture  
**Topic Slug:** screenshot-capture  
**Thread:** Screenshot Auto-capture with Orders  
**Thread Slug:** order-lifecycle-capture  
**Issue:** #842  
**Thread Parent:** #826  
**Topic Parent:** #746  
**Task:** #844  
**Domain:** SCREENSHOT (BE-SH)  
**Type:** CODE-REVIEW  
**Status:** Approved  
**Created:** 2026-10-07  
**Last Updated:** 2026-10-07  

# Code Review — #844 Contracts: groupId + PositionType tags + grouped path

## Summary

Additive contract extension for the order-lifecycle capture thread: `groupId`
on `CaptureChartSpec` + `{symbol}/{groupId}/` storage directory level, and
strategy `PositionType` tags (`vertical-debit-spread`, `calendar`,
`option-single`). Diff confined to `shared/screenshot-capture-contracts.ts`,
`shared/screenshot-capture-utils.ts` (+spec),
`functions/src/screenshot-capture/capture-chart.ts` (+spec), and the
`functions/scripts/verify/` additions (`screenshot-capture-844-contracts.ts`,
guide, README/run-all wiring).

## Pass 1 — findings

### Standards
- `POSITION_TYPES` set mirrors the `CAPTURE_EVENTS` membership pattern;
  `sanitizeGroupSegment` correctly diverges from `sanitizeSegment` (hyphens
  retained — position/cohort ids are hyphenated — and 64-char cap vs 6).
  Consistent with repo conventions.
- **M1 (minor):** `groupId` sanitizing to a pure dots/hyphens segment
  (`'..'`, `'-'`) would emit a traversal-looking directory level that
  defeats prefix listing. Unlike `refId` (a mid-filename segment), `groupId`
  is a path level — needs a stronger invariant.

### Spec
- Task ACs met: `groupId` field on spec (parsed, string-validated, threaded
  to path spec), PositionType strategy tags, group directory level in the
  storage path, no change to callers that omit `groupId` (flat path
  preserved — regression-covered by the untouched base tests).

### Thermo-nuclear
- Pure additive enum + optional field — no state-shape or concurrency
  concerns. Sanitization keeps the write surface path-safe.

## Pass 2 — M1 remediation

`sanitizeGroupSegment` now requires at least one alphanumeric (`[a-z0-9]`) —
`'..'`, `'-'`, `'.'` groupIds omit the directory instead of emitting a
degenerate level. Covered by an `it.each` over `///`, `..`, `-.-`, `''`.

**No new findings on the remediation diff.**

## Test results

- `shared/screenshot-capture-utils.spec.ts` + `tests/functions/screenshot-capture/` + `src/app/features/dev-screenshot/` — 178/178 green.
- `functions` build (`npm run build`) clean; FE `tsc --noEmit` clean.
- Real-bucket verify `screenshot-capture-844-contracts.ts` — 12/12: grouped
  capture lands under `st-trade-screenshots/GOOG/verify-cohort-844/`, object
  exists + round-trips, all four `positionType` values parse, non-string
  `groupId` → `invalid-argument`.

## Findings for QA

- [ ] None — additive contract surface; runtime behavior verified via the
  844 script's real-bucket write.

## Verdict

**PASS**
