**Topic:** Options Backtest  
**Topic Slug:** options-backtest  
**Thread:** Selection Replay  
**Thread Slug:** selection-replay  
**Issue:** #1242  
**Thread Parent:** #1240  
**Topic Parent:** #1238  
**Task:** #1279  
**Domain:** BACKTEST  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-26  
**Last Updated:** 2026-10-26  

# Code Review — Task #1279 (Pick-doc client)

## Verdict: PASS

Three axes against the converged working tree. One convergence finding
(error-semantics fix); no majors.

## Standards

- Module shape mirrors `options-contract-proxy.ts`: env-overridable
  URL/audience constants, ID-token transport, `PartnerHttpError` +
  `extractPartnerCode` on upstream failure, snake_case logger keys.
- `PickDocTransport` injectable seam matches TEST-BE seam 1 exactly;
  production default exported separately so the seam stays honest.
- eslint clean (double-quoted logger import fixed during implement);
  `import type` used for type-only imports.
- `test:options-replay` registered alongside the existing `tsx --test`
  scripts in `functions/package.json`.

## Spec (issue #1279 ACs)

| AC | Result |
|---|---|
| Request built per confirmed contract (#1278) | **PASS** — `(symbol, type, deltaPct, dte, year)` per year shard; `pickDocDeltaPct` derives the grid key from the signed coordinate |
| Transport injectable/mocked | **PASS** — `PickDocTransport` param, default `partnerPickDocTransport` |
| Endpoint-missing → named error carrying coordinate | **PASS** — all-404 → `PartnerHttpError(404)` whose message names `{SYM}-{type}-{deltaPct}-{dte}` |
| Tests assert request shape per TEST-BE | **PASS** — captured-request assertions: uppercase symbol, deltaPct, type, per-year fanout, merge semantics |

## Thermo-Nuclear

- **Convergence finding (fixed):** a malformed `startDate`/`endDate` produced
  `NaN` years → empty shard loop → 404 "no year shard" — a bad input
  masquerading as missing data (Journey 2's failed-list semantics would
  misattribute it). Now a 400 naming the cellId + window; pinned by a test.
- Provisional-seam honesty: endpoint name, `deltaPct` spelling, and
  response-envelope assumption each live at a single point, flagged in the
  module header — the right amount of hedging for an endpoint that doesn't
  exist yet.
- Deliberately not done: `Promise.all` fanout (≤3 sequential year calls —
  simpler retry/error story, negligible latency in a task worker), cellId
  request param (endpoint surface undecided — raw params per SA#225 body),
  validation beyond the NaN guard (the callable validates upstream).

## Convergence log

- Implement pass 2: logger import quote style.
- Review pass 1: NaN-date → misleading-404 semantic fix + test.
- IMPL-BE §3 updated to as-built (seam constants + transport seam).

## Test state at review

- `npm run test:options-replay` — 9/9
- `functions tsc --noEmit` — clean
- `npm run build` (esbuild bundle) — OK
