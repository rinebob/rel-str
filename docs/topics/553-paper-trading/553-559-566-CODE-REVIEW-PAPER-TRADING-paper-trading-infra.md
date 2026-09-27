**Topic:** Paper Trading Infra
**Topic Slug:** paper-trading-infra
**Thread:** Core Infra
**Thread Slug:** core-infra
**Issue:** #559
**Task:** #566
**Topic Parent:** #553
**Domain:** PAPER-TRADING
**Type:** CODE-REVIEW
**Status:** Final
**Created:** 2026-09-26
**Last Updated:** 2026-09-26

# Code Review — #566 PaperTradingService + PaperTradingStore

**Verdict: PASS** (3 axes × 3 rounds — ran until clean; final pass CONFIRMED CLEAN)

## Summary

FE data layer for the paper trade dashboard: `PaperTradingService`
wraps all five deployed callables; `PaperTradingStore` (NgRx
SignalStore) holds account, trades (+ server-side filter request),
stats-by-scope, exit variants, and loading/error state.

## Spec compliance — all criteria met

- Service wraps `paperSignalOrder`/`listPaperTrades`/`getPaperStats`/
  `getPaperAccount`/`listExitVariants` with shared-contract types;
  `CallableName` values match deployed exports.
- Filtered selectors cover every listed dim: `tradesBySource` /
  `tradesByInstance` / `tradesByCohort` / `tradesByVariant` /
  `tradesByExpression` / `tradesBySymbol`, status splits, `available*`
  option lists, server-side `tradeFilters` + `setTradeFilters`.
- Loading (`isLoading*` per section + composed) and error (`error`
  field + snackbar + `unauthenticated` message) modeled.
- Store specs + service spec cover selectors and error paths.

## Findings → resolution

### Standards

- **[MED] No service spec** (guideline §10: mocked services need their
  own contract test) → `paper-trading.service.spec.ts` added — callable
  names, request pass-through, `res.data` unwrap, error propagation.
- **[LOW] Doc/behavior mismatch** — `acceptAsPaper` comment promised the
  response but returned `boolean` → now returns
  `PaperSignalOrderResponse | null`.
- **[LOW] `loadExitVariants` skipped `error` patch** → consistent with
  other methods.

### Spec

- Multi-dim selector coverage verified; server-side filter pass-through
  confirmed (cohort+expression AND exercised against prod in the #565
  verify script).

### Thermo-nuclear

- **[MED] `statsByScope` merge hid server-side deletes** → omitted-scope
  fetch now replaces the map wholesale; scoped fetches merge — tested.
- **[LOW] Six duplicated group-by maps** → shared `groupTradesBy`
  projection (multi-key for `variantKeys`); ~60 lines → ~20.
- **[LOW] `acceptAsPaper` subscribe+resolve** → `firstValueFrom` per
  repo idiom (trade-journal.service.ts precedent).
- Spec additions: in-flight cancellation, error-clearing on retry,
  merge-vs-replace semantics, `'none'` bucket for ungrouped fields,
  `loadExitVariants` error path.

## Round 2 — findings → resolution

- **[MED] Stats-map wipe on unscoped error** — `catchError`'s
  `{stats:[]}` flowed into `next` and wholesale-replaced the map →
  returns `EMPTY` so `next` never fires; regression test proves cached
  scopes survive a failed enumerate-all.
- **[MED] Vacuous cancellation test** — `complete` could never fire on a
  raw Subject → asserts `pending.observed` before/after refilter.
- **[LOW] `acceptAsPaper` re-entry** → `isSubmittingOrder` guard.
- **[LOW]** Stale test title → "resolves null"; service spec `as any`
  provider → `useValue: {}`; `pending.pipe()` no-op removed;
  `variantsSub` cancellation added to `loadExitVariants`.

## Round 3 — CONFIRMED CLEAN

All six round-2 fixes verified in place; no new findings. Two
informational notes: shared `error` field clears across sections
(documented design); `acceptAsPaper`'s snackbar can fire post-destroy
(inherent to the pattern, matches siblings).

## Test results

- `npx jest` full suite: **1993/1993**, 146 suites (18 new store + 5
  service specs).
- `ng build` (dev) clean.

## Notes

- Store file 308 lines — at the edge of the 300-line guideline; a
  consumer component can trim it if it grows further.
- `loadExitVariants` has no dedicated loading flag (registry is static
  per deploy; a flag adds noise for no user value).
- `toMessage` collapses non-auth callables errors to a generic fallback
  — matches the existing dashboard-store convention.
