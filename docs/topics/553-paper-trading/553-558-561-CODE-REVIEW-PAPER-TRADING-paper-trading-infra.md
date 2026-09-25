**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Core Infra  
**Issue:** #558 (BE Blueprint)  
**Task:** #561 — Ledger core: repository + applyFill boundary  
**Topic Parent:** #553  
**Domain:** PAPER-TRADING  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Reviewed:** 2026-09-25  
**Last Updated:** 2026-09-25  
**Verdict:** PASS (2nd pass — all three axes approve)

## Summary

**Scope:** `functions/src/paper-trading/` — `collections.ts` (Firestore refs over shared paths), `repository.ts` (6-kind CRUD, `listTrades` filters, `appendMark`/`appendFill`/`updateVariantRun`, `resolveTradeId`, `ledgerDeps`), `ledger.ts` (`applyEntryFill`/`applyExitFill` → `LedgerWritePlan` inside `deps.transact`). Shared-contract addendum: `PaperTrade.variantKeys` for `array-contains` queries. Tests: `tests/functions/paper-trading/` (node:test, injected deps + fake Firestore). Real-prod verification: `functions/scripts/verify/paper-trading-ledger-561.ts` (20/20, self-cleaning).

**Pass 1 verdict:** FAIL — thermo-nuclear found two majors (Standards and Spec both passed).

**Pass 2 verdict:** PASS — both majors genuinely fixed; two minors also fixed.

## Pass 2 — verification of fixes (2026-09-25)

| First-pass finding | Resolution |
|---|---|
| MAJOR: non-atomic ledger — reads outside the atomic write; `batch.set` full-doc overwrite could clobber concurrent marks/fills | RESOLVED — `LedgerDeps.transact` wraps the entire apply in `db.runTransaction` (`repository.ts:259-290`); collision check + account/trade reads happen inside the txn; writes via `txn.set`. Reads-before-writes ordering verified in both entry and exit paths. |
| MAJOR: `equity = cash + liquidation value` invariant false between fills; exit math accidentally self-consistent | RESOLVED — docstring now documents the deferred mark-pass seam (`marks[]` is order-level; `lastMark` updates only at fills; equity refresh is Phase-2/3 scope). Exit stamps `lastMark` only for single-leg trades; `fill.role==='exit'` and full-quantity guards added. |
| `acct-${userId}` literal instead of `buildAccountId` | FIXED — `repository.ts` uses `buildAccountId`. |
| Dead `?? {}` in `appendFill` | FIXED. |
| `updateVariantRun` could drift `variantKeys` | FIXED — keys recomputed from the rewritten runs array. |
| No `getRawQuote` getter | FIXED — added for six-kind parity. |
| No `test:paper-trading` script | FIXED — `functions/package.json`. |
| `resolveTradeId` TOCTOU undocumented | FIXED — doc states serialized callers + in-txn re-check fails loudly. |
| Misleading `arrayUnion` test name | FIXED — renamed to transactional RMW. |
| No `variantKey` array-contains / `updateVariantRun` prod coverage | Accepted — covered by unit tests; the verify script covers the lifecycle seam. |

Second-pass minors also fixed: `applyEntryFill` now guards `fill.role==='entry'` and `fill.quantity===order.quantity`; stale `lastMark` precondition comment corrected.

## Pass 1 — findings (2026-09-25)

### Standards — PASS (with minor requests)

- Minor: `acct-${userId}` duplicated the `buildAccountId` scheme.
- Minor: `resolveTradeId` check-then-act non-atomic — needed txn or doc note.
- Minor: partial exits / per-leg `lastMark` on multi-leg exits undocumented.
- Minor: 6-kind repo surface ahead of callers — accepted (blueprint scope).
- Minor: `db as unknown as RepoDb` in the fake — accepted seam.
- Nits: dead `?? {}`, misleading test name, stale docstring.

### Spec — PASS (all 5 acceptance criteria met, two gaps noted)

1. Entry creates trade (fills, legs, seeded marks, variantRuns) + cash in one write set — MET (signature deviation: `applyEntryFill`/`applyExitFill` split, caller builds the `PaperFill` — cleaner than the planned `applyFill(order, quoteResult)`).
2. Exit closes + realized P&L + cash — MET.
3. Negative cash permitted/persisted — MET.
4. Repository reads for all six anchors — MET (no `getRawQuote` and untested non-trade anchors — both since addressed/accepted).
5. node:test + injected writers, no emulator — MET (missing `test:paper-trading` script — since added).

Deviations noted as improvements: `ids.ts` not copied into `functions/src/paper-trading/` — BE uses the shared module via `@paper-trading/ids` (single source of truth).

### Thermo-nuclear — FAIL (2 majors)

1. **MAJOR** — ledger was *atomic writes over non-atomic reads*: `getAccount`/`getTrade` outside concurrency control, then `batch.set` full-overwrite → concurrent mark pass clobbered silently. Weaker than the file's own `appendFill`/`updateVariantRun` transactions and the `createPosition` precedent.
2. **MAJOR** — documented `equity = cash + liquidation value` invariant only held at fill instants; `appendMark` never refreshed `legs[].lastMark`/`unrealizedPnl`, and the exit math depended on that never-happening update.
3. Minors: `resolveTradeId` TOCTOU; exit fill role/quantity unguarded; multi-leg `lastMark` overwrite; fake-Firestore fidelity limits; `variantKeys` maintenance path; IEEE-754 money; `acct-` duplication; getItem kind-mismatch indistinguishable from missing.

## Test results

- `npm run test:paper-trading` — **21/21 pass** (ledger entry/exit math, guards, collision throw; repository paths/filters/single-write mutations; transactional `transact` deps).
- `tsx scripts/verify/paper-trading-ledger-561.ts` (prod Firestore) — **20/20 pass**, docs cleaned up.
- Root jest suite — 135/135 suites pass on re-run of the only affected suite (`symbol-list.store.spec` 18/18); the earlier 1-test failure was an unrelated mid-edit transient in the user's watchlist refactor.
- `tsc --noEmit` (functions + tests projects) — clean for all paper-trading files.

## Verdict

**PASS** (2nd pass). The ledger is now transactional end-to-end and the mark/equity seam is honestly documented as deferred to the mark-pass phase.

## Accepted risks (documented, non-blocking)

- `Math.max` multiplier for mixed share/option legs — no current caller produces such trades.
- IEEE-754 money math — paper money only.
- Fake-Firestore cannot verify true transactionality — mitigated by the prod verify script.
- Repository surface for cohorts/instances/stats is ahead of callers — blueprint-scoped.
- `resolveTradeId` remains check-then-act — the in-transaction re-check is the real guard.
