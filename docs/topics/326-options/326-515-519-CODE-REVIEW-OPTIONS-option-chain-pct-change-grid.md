**Topic:** Option chain percent change grid  
**Topic Slug:** option-chain-pct-change-grid<br>
**Thread:** Corpus-backed chain data
**Thread Slug:** corpus-chain-data<br>
**Issue:** #515  
**Task:** #519  
**Topic Parent:** #326  
**Domain:** OPTIONS  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-09-22  
**Last Updated:** 2026-09-22  

---

# Code Review — Map SA options-not-enabled error to callable code (Task #519)

## Standards

- `PartnerHttpError.partnerCode` is an optional third arg — all existing
  throw sites (spread-proxy, partner-proxy, other options proxies) compile
  unchanged; the code is extracted only where ST needs the signal
  (`callPartnerHistoricalOptions`).
- `extractPartnerCode` is pure + defensive (non-JSON, non-string code →
  undefined). `partnerHttpErrorToCallableCode` returns a typed literal
  union matching `HttpsError` codes.
- Partner code preserved in the HttpsError message as `code=<NAME>` —
  the FE detects it via either that suffix or the embedded body JSON.
- Test conventions: `tests/functions/options-error-mapping.test.ts` uses
  the project's `tsx --test` + node:test pattern; wired into
  `functions/package.json` as `test:options-error-mapping` (was missing —
  added during review).

## Spec (vs. task #519 acceptance criteria)

- [x] `OPTIONS_NOT_ENABLED` → `failed-precondition`, partner code in message.
- [x] 404 without code → `not-found` (unchanged).
- [x] 429 → `resource-exhausted`, 5xx → `unavailable`, other 4xx →
  `invalid-argument` — pinned by tests.
- [x] Partner `code` extracted at the `callPartnerHistoricalOptions` throw
  site and surfaced on `PartnerHttpError`.

## Thermo-nuclear

- Correct precedence: a recognized partner `code` wins over status-derived
  mapping even when status isn't 404 — code is more specific than status.
- `extractPartnerCode` failing silently is right — it's best-effort
  enrichment, never a failure source.
- Tests are pure-function unit tests with real assertions; no type erasure.

## Test results

- `test:options-error-mapping` — 6/6 green.
- `functions npm run build` — clean.
- Full FE suite unaffected (no FE code in this task).

## Findings

- **minor** — test script wasn't registered in package.json; fixed.

## Verdict: PASS
