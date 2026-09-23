**Topic:** Option chain percent change grid  
**Topic Slug:** option-chain-pct-change-grid<br>
**Thread:** Corpus-backed chain data
**Thread Slug:** corpus-chain-data<br>
**Issue:** #514  
**Task:** #520  
**Topic Parent:** #326  
**Domain:** OPTIONS  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-09-22  
**Last Updated:** 2026-09-22  

---

# Code Review — Unsupported-symbol error (Task #520)

## Standards

- `describeSnapshotError` extracted into `utils/snapshot-errors.utils.ts`
  and shared by both fetch paths — `runAnalysis` (symbol-level `error`)
  and `ensureSnapshots` (per-date `snapshotErrors`) now produce identical
  messages; no drift.
- The partner-code regex was widened from `"code":"X"` to also match the
  `code=X` suffix the callable emits (#519) — both detection paths covered.
- Error strings stay human-readable; callable `functions/` prefix stripped.

## Spec (vs. task #520 acceptance criteria)

- [x] Non-enabled symbol → "Options analysis is not available for {SYMBOL}"
  (triggered by `OPTIONS_NOT_ENABLED` or bare `failed-precondition`).
- [x] Message is distinct from missing-data errors (plain 404 →
  `not-found: …`, upstream gaps → `unavailable: …`).
- [x] Applies in both paths — manual run (top-level error) and swing-
  compare run sections (per-date error rows).
- [x] Spec coverage: util spec (5 cases incl. JSON + `code=` detection,
  truncation, non-Error input) + store spec for the runAnalysis path.

## Thermo-nuclear

- One accepted trade-off: ANY `failed-precondition` maps to the
  "not available" message. Today nothing else on this path emits that
  code; if a future callable uses it for validation errors the message
  would mislead — noted, not blocking.
- No type erasure in tests; error fixtures use a realistic
  `{code: 'functions/…'}` shape.

## Test results

Full suite green — 1690 tests, 123 suites (run earlier this session).

## Findings

- **nit** — `runAnalysis` prefixes the friendly message with
  "Failed to fetch chain snapshots:", so the top-level error reads
  "Failed to fetch chain snapshots: Options analysis is not available for
  XYZ". Slightly awkward but unambiguous; left as-is.

## Verdict: PASS
