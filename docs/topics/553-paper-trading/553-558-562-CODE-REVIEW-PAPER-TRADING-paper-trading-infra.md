**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Core Infra  
**Issue:** #558 (BE Blueprint)  
**Task:** #562 — Engine migration: #108 passes + data onto paper-trading collections  
**Topic Parent:** #553  
**Domain:** PAPER-TRADING  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Reviewed:** 2026-09-25  
**Last Updated:** 2026-09-25  
**Verdict:** PASS (5th pass — all three axes report no blocking findings on final state)

## Summary

**Scope:** options-strategy-engine (~4,300 LOC) moved to
`functions/src/paper-trading/engine/` with the old tree reduced to
`export *` shims (33 files; `mcp/` stays as shared infra). Repositories are
Position-view adapters over `paper-trading/{anchor}/items` — passes' dep
seams unchanged, so all legacy tests run against the migrated code. New:
`engine/trade-adapter.ts`, `engine/position-ids.ts`,
`scripts/migrate-options-strategy-to-paper.ts` (dry-run/`--apply`/`--only`),
`functions/scripts/verify/paper-trading-engine-migration-562.ts`
(self-cleaning prod verify). FE: `StrategyBuilderService` →
`paper-trading/instances/items` + stamping `kind`/`paperAccountId`/
`governingVariant`. Rules + indexes updated. Shared contract additions all
additive-optional (`legacyStatus`, optional `PaperMark` fields, leg
lifecycle fields, `assignment`/`shares`/`lastMarkedAt`, stats parity
fields).

**Pass 1 verdict:** FAIL — 3 majors across the three axes.

**Pass 2 verdict:** PASS — all majors fixed; most minors fixed; deferred
items documented below.

**Pass 3 verdict:** PASS — second-pass remediation introduced one
critical runtime bug (read-after-write in the settlement txn, invisible to
unit tests because deps are faked) and one semantic inconsistency
(realized-P&L disagreement between trade/account/migration paths); both
fixed, plus migration account seeding.

**Pass 4 verdict:** PASS — all axes clean. One MEDIUM (migrated
`legs[].lastMark` stayed at entry price → seeded equity used premium, not
current liquidation) plus three hardening items fixed; two latent notes
carried to #563.

**Pass 5 verdict:** PASS — Standards (no hard violations; txn ordering +
path parity + security all verified), Spec (all 5 criteria met), TN
(coherent shape, no structural regressions). Residual minors fixed inline;
documented deferrals below stand.

## Pass 5 — final-state fixes + noted findings

| Finding | Resolution |
|---|---|
| `acct-${instUserId}` literal bypassed the id helper | `buildAccountId()` used |
| `lastTradeId` written to account docs but not in `PaperAccount` contract (dead field) | Removed from migration |
| Settlement warn only fired when instance read succeeded but account missing — orphaned trades skipped bookkeeping silently | Warn now fires for all missing-instance/userId/account paths |
| `realizedPnl += premium` ignored order side (would misbook a LONG expiry) | `signedCashDelta(entryFill, order.side, legs)` — side-signed, canonical helper |
| `markPosition` stamps order-level mark on all legs | Docstring caveat added (single-leg only, same limitation as `applyExitFill`) |
| Ledger NOTE wording: "when a second caller exists" — it exists now | Updated: extract shared `applySettlement` in #563 |

Noted-not-fixed (documented deferrals): stats doc-id convention
(`stats-{instanceId}`/`stats-ALL` engine scopes vs canonical
`inst-{id}`/`all` helpers — deliberate compat, flagged for future
consumers); `createPosition` raw-quote + `incrementStatsOnOpen` are
post-txn writes (nightly `recomputeStats` reconciles); `items` composite
index reserved for #563 orderBy queries; `repository.ts` generic CRUD
currently only consumed by tests (serves #563+); legacy rules/indexes
retained until the tree deletion pass.

## Pass 4 — final pass findings + resolutions

| Finding | Resolution |
|---|---|
| MEDIUM: `positionToTrade` left `legs[].lastMark` = entry price — migrated `positionValue`/`equity` used entry premium not current mark | Adapter now stamps the latest marks-map `mark` onto legs (latest date with a defined mark, falling back to entry mark). |
| Latent: `markPositionSettled` lacked a status precondition — direct re-invocation would re-book premium/decrement count | Guard added: txn throws unless trade is `OPEN`/`ASSIGNED` (mirrors `applyExitFill`). |
| LOW: migrate picked the chronologically-last mark entry even when it lacked `underlyingClose` | Filters to entries with a defined close before picking latest. |
| LOW: CLOSED positions' exit cash absent (no buyback fill in legacy data) — cash overstates by exit cost | Documented approximation comment in `accumulateAccount`; realizedPnl itself is exact. |
| Carried to #563: `applyExitFill` on ASSIGNED trades treats entry fill (option premium) as share cost basis — would miscompute share-sale P&L | Header note added to `applyExitFill` in `ledger.ts`. |

## Pass 3 — second remediation round

| Re-review finding | Resolution |
|---|---|
| CRITICAL: `txn.get(acctRef)` after `txn.update(ref)` in `markPositionSettled` — reads-after-writes throws at runtime; unit tests inject fakes so it was invisible | Restructured: all txn reads first (trade → instance → account), then all writes. Prod verify now exercises the real settlement txn end-to-end. |
| MAJOR: inconsistent realized-P&L semantics — trade doc credited premium only on expiry, account credited unconditionally, migration mapped assigned→premium | Unified: **premium is realized income whenever the option expires** (worthless or assigned). Trade doc and account both `+= premium` on both paths, matching the migration mapping. |
| MAJOR: migration never seeded `acct-{userId}` docs — all new account bookkeeping silently no-ops on migrated data | `migrateAccounts` reconstructs accounts from converted trades: cash = premiums − assignment debits, realizedPnl, openTradeCount, equity = cash + open liquidation value (option liability or delivered-share value). |
| `unrealizedPnl` stayed = premium on closed trade docs (ledger convention: 0 at exit; double-counts if summed raw) | `unrealizedPnl: 0` on expiry (assignment keeps share P&L unrealized — still an open position). |
| Account `equity` never updated at settle | Now mirrors `applyExitFill` math: `equity += cashDelta − markedValue + shareValue`. |
| Silent skip when account doc missing | `logger.warn` — trade write still commits; drift is observable. |
| `applyExitFill` left stale `legacyStatus` on ledger-closed engine trades | Field dropped in the rebuilt doc (full-overwrite write removes it). |
| Settlement txn path untested (fakes masked the critical bug) | Prod verify extended: seeds via migration, runs real `markPositionSettled`, asserts status/legacyStatus round-trip, leg outcomes, account decrement, realized premium, equity release. 24/24 checks. |

Deferred unchanged: closing `role:'exit'` fill (settlement books the ledger
effects inline rather than emitting a synthetic fill doc — noted for the
exit engine #563), stats recompute on settle (nightly pass), per-instance
accounts (PRD optional; single user account per userId), raw-quote
write outside the entry txn (audit doc, idempotent).

## Pass 1 → Pass 2 resolutions

| First-pass finding (axis, severity) | Resolution |
|---|---|
| Settlement bypassed the ledger — account `openTradeCount`/`realizedPnl`/cash drifted forever (TN, MAJOR) | `markPositionSettled` resolves the instance's userId, then in the same txn as the trade close updates the account: `realizedPnl += premium` both paths, `openTradeCount--` on expiry, `cash -= strike×100×qty` on assignment. |
| `COVERED_CALL_OPEN` silently collapsed to `OPEN`; strategy-query-service branch went dead (TN, MAJOR) | `PaperTrade.legacyStatus` added (optional, verbatim); adapter round-trips it with enum-membership guard. Regression test added. |
| Dead write paths `updatePosition`/`writeDailyUpdate` — zero callers (TN, MAJOR) | Deleted (~80 lines). |
| `position-repository.ts` = 411 lines > 400 threshold (Standards) | ID/leg helpers extracted to `engine/position-ids.ts` (re-exported for API parity); file now 372 lines. |
| FE magic strings `'instance'`/`acct-${uid}` re-derivations (Standards) | Service imports `PaperTradingKind.INSTANCE` + `buildAccountId` via `@paper-trading/*` aliases; spec asserts stamping. |
| `incrementStatsOnOpen` two sequential txns could diverge scopes (Standards) | Single transaction: both scope docs read, then both written. |
| Migrated closed positions lost realized P&L (`realizedPnl: 0` unconditionally) (Spec + TN) | `positionToTrade` maps realized P&L by terminal status (expired→premium, CLOSED→unrealized-at-close, assigned→premium). Regression tests added. |
| Equity-curve parity not actually verified (Spec) | Migration logs curve-truncation warnings; prod verify now seeds 2 curve points and asserts identical embedded points pre/post. |
| `markHeldSharesPosition` wrote `mark: undefined` unconditionally (Spec + TN) | Guarded like siblings. |
| Rules delete used `request.resource` (null on delete — latent) (Spec) | Split `create, update` (request.resource) from `delete` (resource). |
| `marks`/leg helpers duplicated `stratType` logic; `/100` literals (Standards) | Shared `stratType` exported from trade-adapter; `SHARES_PER_CONTRACT` used. |
| Migration `Invalid Date` on malformed raw-quote dates (TN) | NaN guard + skip log. |
| Unused `uid` vars in FE service (Standards) | Dropped (guard call kept). |

## Deferred / accepted

- Mark-pass `equity` refresh + `lastMark` on option legs is the documented
  deferred seam from #561 (equity updates on fills; share-leg marks exist).
  Settlement books cash/counts/realizedPnl but not equity — same seam.
- Stale legacy rules/indexes/seed files kept for the migration window
  (`options-strategy-*` rules at firestore.rules:321, indexes :253-267,
  `verify-open-pass-timer.js`, `seed-options-strategy-*.ts` now seeded to
  the new path). Deletion is the later cleanup pass.
- `createPosition` re-fetches the instance for `userId` (one extra read on
  a rare path; keeps the dep signature unchanged) — accepted trade-off.
- Batch flush can split a trade from its raw-quotes across commits —
  idempotent rerun covers it (documented).
- Broad authenticated read on `paper-trading/{anchor}/items` — deliberate
  single-user widening, commented in rules.
- `(collectionData as any).mockData` in strategy-builder spec — pre-existing
  fixture pattern, unchanged by this diff.
- `governingVariant: 'none'` literal in FE create — sentinel pending Phase-3
  variants; BE counterpart `LEGACY_GOVERNING_VARIANT`.
- `acct-system` fallback for userId-less migrated instances — one-off
  script, logged.
- Stats scope convention preserved verbatim (`{instId}`, `ALL`) rather than
  canonical `inst-*`/`all` — deliberate compat choice for existing readers.
- Shim-import drift risk: recommend a lint rule later preventing new
  imports from `options-strategy-engine/*` outside index wiring.

## Test results

- `npx tsx --test tests/functions/**` — **486/486 pass** (incl. all 143 legacy engine tests through shims + paper-trading adapter regression tests).
- `npx jest` — **1865/1865 pass** (137 suites) incl. strategy-builder spec.
- Prod verify `paper-trading-engine-migration-562.ts` — **24/24**, incl. equity-curve point identity, seeded account reconstruction, and a real `markPositionSettled` transaction (status/legacyStatus, leg outcomes, account decrement, premium realized, equity release).
- Dry-run migration parity on real data — OK on all 5 real scopes; `SPY-WHEEL-INT`/`inst-1` flagged = stale stats-only docs (pre-dates migration).
- `tsc --noEmit` clean for all touched files.

## Verdict

**PASS.** All pass-1 and pass-3 majors genuinely fixed; the settlement path
is now exercised by a real-transaction prod verify (the gap that hid the
critical bug is closed); contract additions remain additive/optional;
account bookkeeping mirrors the ledger's own entry/exit math.
