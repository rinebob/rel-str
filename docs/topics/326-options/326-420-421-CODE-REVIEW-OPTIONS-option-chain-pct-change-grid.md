# Code Review: Load saved swing sets + signals into the store

**Topic:** Option Chain Pct Change Grid
**Topic Slug:** option-chain-pct-change-grid
**Issue:** #420 (FE Blueprint)
**Task:** #421
**Topic Parent:** #326
**Domain:** OPTIONS
**Area:** FE
**Status:** Final
**Last Updated:** 2026-09-19

## Reviewed change

Checkpoint commit `86bb305` plus post-review fixes (uncommitted at review time):

- `option-chain-pct-change.store.ts` — `savedAnalyses` state, `signals` computed, `loadSwingData()`, `setSymbol`/`selectConfig`/`reset` lifecycle
- `option-chain-pct-change.store.spec.ts` — fixtures + 9 `loadSwingData` tests
- `pct-change-grid.component.spec.ts`, `option-chain-pct-change.component.spec.ts` — service/store mocks
- `option-chain-pct-change.component.ts` — `ngOnInit` calls `loadSwingData()` for the initial symbol

## Standards

- **Fixed:** two near-identical subscribe blocks — the signal half deleted entirely (signals now derive from `SymbolHistoryStore` cache; see Spec).
- **Noted (pre-existing, not introduced):** `signal.service.spec.ts` does not exist — the mocked `getSymbolSignalHistoryFromHistory` contract is untested at the service level. `SwingAnalysisService.loadSavedAnalyses` IS covered by `swing-analysis.service.spec.ts`. Recommend a follow-up service spec.
- **Noted (pre-existing):** `as never` casts on save/delete spies in store.spec (~lines 764-855) predate this commit.
- **Noted (pre-existing sprawl):** store now ~780 lines — over the 400-line guideline. Not worsened materially by this diff; the state/methods for #422-#426 should land in `swing-compare` state as planned, or be extracted.
- **Fixed:** `as StSignalItem` / `as SwingAnalysisDoc['stats']` type-erased fixtures replaced with real `SwingStats`/`StSignalItem` fixtures (real enums, real stats shape).

## Spec

Task #421 acceptance criteria:

- `loadSwingData()` fetches `swing-sets` for the symbol + signal history — **met**
- `savedAnalyses` + `signals` populated — **met** (`signals` computed from shared cache)
- Cleared on symbol change — **met** (synchronous clear in `setSymbol`; `signals` auto-follows `symbol` via cache key)
- Empty arrays on error; no crash — **met** (analyses error → `[]` + log, never `error` state; history store swallows signal errors to `[]`)
- Reuse `SwingAnalysisService.loadSavedAnalyses` + `SymbolHistoryStore.loadSignalHistory` — **met** after review fix (see below)
- Independent large/small set selection preserved — **met** (flat list by symbol, no pairing)

**Findings during review (all fixed before verdict):**

1. **Stale-symbol race (critical):** `loadSwingDataImpl` fired bare `take(1)` subscriptions — a symbol change mid-fetch could overwrite the new symbol's data. Fixed: `swingSub` tracked + unsubscribed on reload/reset (same pattern as `runSub`/`resolveSub`); signals moved to the symbol-keyed `SymbolHistoryStore` cache where a late write lands in the right slot.
2. **Duplicate fetch path (major):** initial diff called `SignalService` directly, duplicating `SymbolHistoryStore`'s cache. Fixed: `signals` is now a computed over `signalHistoryCache[symbol]`; `loadSwingData` calls `historyStore.loadSignalHistory(symbol)` (deduped, cached).
3. **`selectConfig` staleness (major):** patched `symbol` without reloading swing data. Fixed: clears + reloads when `cfg.symbol` differs.
4. **`reset` left swing fetch in flight (major):** late result could repopulate after reset. Fixed: `reset()` unsubscribes `swingSub`.
5. **Missing same-symbol guard (minor):** `setSymbol('QQQ')` twice refetched. Fixed: swing-data load only fires when the normalized symbol changes; `ngOnInit` calls `loadSwingData()` so the initial symbol still loads.
6. **Tautological clear test (test quality):** re-mocked services made the assertion pass regardless. Replaced with pending-`Subject` tests that prove synchronous clearing + stale-result discard.
7. **No-assert error test:** `expect(() => ...).not.toThrow()` couldn't observe subscribe errors. Replaced with `savedAnalyses() == []` + `error() == null` + `console.error` spy assertions.

## Thermo-nuclear

- Abstraction: `signals`-as-computed deletes state, a subscription, and a race in one stroke — the code-judo outcome the axis pushed for.
- No structural regressions; `loadSwingDataImpl` closure indirection is justified (sibling methods aren't visible on `store` inside `withMethods`).
- Remaining nit: no `takeUntilDestroyed` on `swingSub` — consistent with the file's existing `runSub`/`resolveSub` pattern; store is root-provided.

## Test results

- `option-chain-pct-change` suite: **281/281 green** (9 suites).
- Full repo suite: 43 suites / 107 tests failing — **all pre-existing and outside this task's scope** (auth, dashboard, portfolio, order-ticket, `utils.spec` `showAll`, plus a stale `.devin/tmp/pre-swing-delete/` spec copy that should be deleted). No pct-change suite fails.

## Verdict

**PASS** — all critical/major findings were fixed and re-verified before this verdict; remaining items are pre-existing or nits.
