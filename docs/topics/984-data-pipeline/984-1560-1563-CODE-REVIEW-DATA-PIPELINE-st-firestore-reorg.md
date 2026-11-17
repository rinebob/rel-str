**Topic:** ST Firestore Reorg  
**Topic Slug:** st-firestore-reorg  
**Thread:** Pass Family Consolidation  
**Thread Slug:** pass-family-consolidation  
**Issue:** #1560  
**Thread Parent:** #987  
**Topic Parent:** #984  
**Task:** #1563  
**Domain:** DATA-PIPELINE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-16  
**Last Updated:** 2026-11-16  

# Code Review — #1563 BE-IMPL: ledger stats increment seam

Three-axis gate review (Standards / Spec / Thermo-nuclear sub-agents) of
the stats-increment seam: `engine/stats-increments.ts` (new), ledger hook
wiring, `markPositionSettled` settle deltas, `incrementStatsOnOpen`
retirement, and the new test suites.

## Findings & dispositions

| Finding | Severity | Disposition |
|---|---|---|
| **PENDING double-count vs recompute** — `paperToLegacyStatus(PENDING)`→OPEN and the stats pass skipped only CANCELLED, so a legacy PENDING doc crossing a nightly counted +1, then `applyPendingFill`'s increment counted +1 again | **major** | **Fixed in-gate** — `paper-stats-pass.ts` now skips PENDING alongside CANCELLED (contract keeps pendings on order tickets; the account convention doesn't count them). Increments are now unconditionally correct for every transition. Pin test added. |
| **No parity test against `computeStatsFromPositions`** — deltas asserted only against their own literals; the PENDING divergence survived review this way | **major** | **Fixed in-gate** — new `parity with computeStatsFromPositions` describe: 6 transitions assert `deltas == recompute(post) − recompute(pre)` on the increment-owned fields. Immediately caught a regression during implementation (broken `isShort` extraction). |
| Scope/delta derivation sat outside the `incrementStatsOnTransition` try — a throw in arg eval could propagate post-commit | minor | **Fixed in-gate** — input now accepts a thunk resolved *inside* the try; `fireStatsHook` takes a thunk so `statsInputFor`/`statsDeltas*` eval is inside the swallow too. Literal never-throws at all four sites. |
| Increment-minted docs carry only touched counters — `totalUnrealizedPnl`/`maxDrawdown`/`equityCurve`/`createdAt` absent until nightly heal | minor | **Fixed in-gate (partial)** — every counter now written as `FieldValue.increment(n ?? 0)`: `inc(0)` mints absent fields, no-ops present ones. `createdAt`/`equityCurve` can't be minted blindly (literal set would clobber) — documented in the module header; readers tolerate (`?? []`, `?? 0`). |
| The `{source, inst?, deltas}` input literal rebuilt at 4 call sites | minor | **Fixed in-gate** — `statsInputFor(trade, deltas)` helper in `stats-increments.ts`. |
| `premiumForStats` duplicated the adapter's `premiumCollected` formula — manual parity, silent-divergence risk | minor | **Fixed in-gate** — `premiumCollectedFor(trade)` extracted to `trade-adapter.ts`; adapter and increments share one formula. |
| `fireStatsHook`/`fireLifecycleHook` — two identical never-throw wrappers | minor | **Fixed in-gate** — shared `swallowPostCommit(label, run)` helper. |
| `statsDeltasOnSettle` param wider than `SettlementData.status`; `undefined` return unreachable | nit | **Fixed in-gate** — narrowed to `EXPIRED_WORTHLESS \| ASSIGNED_HOLDING_SHARES`; `undefined` return deleted. |
| `markPositionSettled` calls the impl directly, not via dep — untested fire site | minor | **Dispositioned** — consistent with that file's module-`db` architecture; the impl self-swallows; comment added. Seam asymmetry is honest, not a smell. |
| Blind txn double-count windows (lost-ack retry; nightly pass between commits) | minor | **Dispositioned** — can't be detected inside the stats txn (trade doc untouched by it); both self-heal nightly. Header now names doubles explicitly alongside misses. |
| Only 3 of ~12 scope families increment | minor | **Dispositioned** — the PRD's bounded-freshness tier, now documented in the header; `StatsIncrementInput` is deliberately narrow. |
| `updatedAt` written as ISO timestamp vs recompute's market-date `lastUpdated` | nit | **Dispositioned** — both mean "when this stat last moved"; documented in the write-path comment. |
| `status===CLOSED` post-commit gate is unreachable today | nit | **Dispositioned** — kept as criterion-3 documentation + guard for a future partial-exit path. |
| ASSIGNED→CLOSED `realizedPnl` loses assignment-banked premium | info | **Dispositioned** — pre-existing `#563` ledger semantic (doc note at `ledger.ts:660-668`); the increment counts the same doc value the recompute reads — parity holds. |
| `as unknown as Transaction` in the test fake | nit | **Dispositioned** — structural fake for a two-method surface is reasonable; the unreachable `{} as Transaction` cast was deleted. |
| Legacy `stats-ALL`/`stats-{instanceId}` docs lose intraday freshness | info | **Dispositioned** — the PRD's explicit retirement decision ("full transition, no shim, no legacy"). |

## Axes

- **Standards:** PASS — conventions hold (hook pattern matches
  `fireLifecycleHook` precedent, id builders verified, tsx/node:test style
  consistent, no dead code post-retirement). Findings were minor/nit.
- **Spec:** PASS — all 8 acceptance criteria met with evidence; every
  `PaperTradeStatus` write site enumerated and covered. Two low-severity
  test-plan gaps noted (settle-seam can't be unit-driven without a module
  `db` mock — verified by inspection; the CLOSED gate has no non-CLOSED
  case because the txn throws first).
- **Thermo-nuclear:** 2 major + 7 minor + nits — the majors were the
  PENDING divergence and the missing parity test, both fixed in-gate and
  re-verified. Not-findings recorded: double-swallow layering is correct
  (different boundaries), hoisted-status pattern correct under txn retry,
  crash-gap honestly bounded.

## Test results

- `stats-increments.test.ts`: **17/17** (scope fan-out, write shape incl.
  inc(0)-mint counters, never-throws incl. thunk, delta table, 6 recompute
  parity pins)
- `ledger.test.ts`: **30/30** (post-commit ordering, signal no-inst-scope,
  assigned hand-back, pending silence, throwing-dep resilience)
- `paper-stats-pass.test.ts`: **11/11** (incl. new PENDING-exclusion pin)
- Full `test:paper-trading` tsx suite: **291/291**
- Full jest suite: **5832/5832 (315 suites)**
- `tsc --noEmit`: clean

## Verdict: **PASS**

Both major findings were real (the PENDING drift was a genuine parity
violation), fixed in-gate, and covered by new pins — including the parity
describe that asserts the deltas against the recompute engine itself.

## Round 2 — re-review of the fix set (3 axes)

All three axes re-ran against the post-fix diff. Every Round-1 fix verified
correct — PENDING excluded pre-fan-out with a real pin test, parity spec
diffs against the genuine `computeStatsFromPositions` across all 6
transition shapes, inc(0)-mints no-op on present fields and complete the
counter shape on minted docs, all 4 fire sites sealed inside try
boundaries, `preCloseStatus`/`settledPremium` reassigned per txn attempt
(retry-safe), `premiumCollectedFor` genuinely shared.

| Finding | Severity | Disposition |
|---|---|---|
| `stats-increments.test.ts` absent from `test:paper-trading` script enumeration — the parity spec silently never ran in the standard suite | minor | **Fixed in-gate** — appended to `functions/package.json`; suite now runs it (292 → 309). |
| Verify script's canonical-shape check required `equityCurve` — an increment-minted scope doc legitimately lacks it before first nightly | minor | **Fixed in-gate** — check tolerates `equityCurve === undefined` with a comment. |
| `preSettleStatus` misnamed — it holds the target status, pre-settle is always OPEN | nit | **Fixed in-gate** — renamed `settleStatus`. |
| `onStatsTransition` log label carried no trade context (vs lifecycle's `{id} {event}`) | nit | **Fixed in-gate** — label now embeds the trade id. |
| Settle fire site has zero test coverage (module-`db` call, can't be unit-driven) | minor | **Dispositioned** — delta math fully pinned via parity describe; wiring verified by inspection; consistent with the file's architecture. |
| `as keyof StatsIncrementDeltas` cast — no compile-time link enforcing delta keys ⊆ COUNTER_FIELDS | nit | **Dispositioned** — intentional (COUNTER_FIELDS deliberately ⊃ delta keys so nightly-only fields mint at 0); the parity test guards counting drift. |
| `ledger.ts` now ~760 lines — continued creep past the 400-line guideline | nit | **Dispositioned** — pre-existing monolith; additions are cohesive; extraction is out of scope. |
| Legacy `runStatsPass` (no status filter) still maps PENDING→OPEN — hypothetical STRATEGY+PENDING doc would count, but none can be minted | info | **Dispositioned** — legacy namespace; prod can't produce the doc; retirement is #1565. |
| ASSIGNED→CLOSED `realizedPnl` miscompute | info | **Dispositioned** — pre-existing #563 ledger semantic; increment and recompute are wrong-*but-equal* (same doc value). |

**Round-2 test state:** tsx 309/309 (stats-increments now in `test:paper-trading`),
`tsc` clean on all task files (6 unrelated errors in
`shared/options-replay-templates.ts` — parallel #1238 session work).

**Verdict stands: PASS.**
