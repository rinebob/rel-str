**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Signals Auto Paper Trade  
**Thread Slug:** signals-auto-paper-trade  
**Issue:** #914  
**Thread Parent:** #904  
**Topic Parent:** #553  
**Task:** #980  
**Domain:** PAPER-TRADING  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-13  
**Last Updated:** 2026-10-13  

# CODE-REVIEW — #980 auto-paper POST-trigger gate

## Scope

`functions/src/paper-trading/passes/auto-paper-ingest-pass.ts` — new
trigger gate ahead of config/date gates. `tests/functions/paper-trading/
auto-paper-ingest-pass.test.ts` — 4 new gate specs + existing specs
carrying `triggeredBy: 'nightly'`. `functions/scripts/verify/
paper-trading-auto-paper-dispatch.ts` — parameterized argv dispatch
(reuse as the live verify tool).

## Verdict: PASS

## Standards

- Gate ordering correct: trigger check runs before the config read —
  cheapest skip and the most informative reason for the common intraday
  case.
- `AutoPaperSkipReason` union extended consistently; `st_autopaper_skip`
  keeps the same log shape (`runId`/`marketDate`/`triggeredBy` in
  `base`).
- Comment documents intent + issue link; fail-closed on absent
  `triggeredBy` is pinned by spec.

## Spec (#980 issue)

| Requirement | Status |
|---|---|
| Gate ingest to POST/nightly run | MET — `'nightly'` admitted; live-proven: today's `st_autopaper_ingest_start` logged `triggeredBy: "nightly"` at 21:21 UTC from the natural enqueue |
| Intraday `pdr` / `symbol-added` skip | MET — `non-post-trigger` |
| `manual` retained for QA dispatch | MET |
| Absent `triggeredBy` | MET — fails closed |

## Thermo-nuclear

- Set lookup + early return — proportional, readable, no abstraction
  creep.
- NIT — `ReadonlySet<string>` could be `ReadonlySet<StTriggeredBy>` so a
  future trigger value forces a gate-semantics re-review at compile
  time. Cosmetic; accepted.

## Tests

- `auto-paper-ingest-pass.test.ts`: 30/30 (4 new: pdr skip,
  symbol-added skip, missing-trigger fail-closed, nightly+manual admit).
- Paper-trading suite: 202/202. `tsc -p functions/tsconfig.json` clean.
- Deploy-pending leg deferred to QA: live `pdr` dispatch must log
  `st_autopaper_skip reason=non-post-trigger` with `created: 0`, and the
  next real nightly run must still ingest.
