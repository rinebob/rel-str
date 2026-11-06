**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** — (loose topic-level task, direct child of Topic)  
**Thread Slug:** —  
**Issue:** #1247  
**Thread Parent:** —  
**Topic Parent:** #553  
**Task:** #1247  
**Domain:** PAPER-TRADING  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-06  
**Last Updated:** 2026-11-06  

# CODE-REVIEW — #1247 ENGINE-BUG: open pass permits only one position per instance — ladder cadence unreachable

## Verdict: PASS

Three review axes (Standards, Spec, Thermo-Nuclear) run in three rounds.
Round 1 found three MAJORs and a set of minors — all remediated and
re-verified. Round 2 converged on PASS on all three axes; its nits were
fixed and re-checked. Round 3 verified the final diff and found only
three trivial items — all fixed — before convergence.

## Scope

Working-tree diff (uncommitted) vs `prod`, scoped to:

- `functions/src/paper-trading/engine/passes/open-pass.ts` (395 lines)
- `functions/src/paper-trading/engine/passes/open-pass-gates.ts` (new, 77)
- `functions/src/paper-trading/engine/passes/open-pass-tickets.ts` (new, 67)
- `functions/src/paper-trading/engine/strategy-instance-repository.ts`
  (`normalizeInstance` cap validation)
- `functions/src/paper-trading/engine/position-repository.ts`
  (`listPositionsByInstance`, ~9 lines)
- `shared/options-strategy-engine-contracts.ts` (`maxOpenPositions?`)
- `tests/functions/options-strategy-engine/open-pass.test.ts`,
  `strategy-instance-repository.test.ts`,
  `hybrid-quote-provider-integration.test.ts`
- `functions/scripts/verify/paper-trading-engine-open-1247.ts` (new),
  `functions/scripts/verify/run-all.ts`, both verify READMEs,
  `scripts/verify/paper-trading-engine-open-1247.md` (new)

Spec source: issue #1247 body — cadence ladder (one new position per
period while prior positions stay open), per-day idempotency, optional
`maxOpenPositions` cap, `frequency` as the cadence driver, ACs 1–4.

`settlement-pass.ts` is dirty in the same tree but belongs to **#728**
(separate task at `5_IMPLEMENT`) and was OUT OF SCOPE for this review.

## Round 1 — findings and remediation

### MAJORs (all remediated)

1. **Cadence/idempotency counted only OPEN positions** — a leg closed or
   settled mid-period released its cadence slot early (weekly reopened
   inside the 7-day window), and a same-day closed leg turned a retry
   into a deterministic-ID collision at `createPosition` instead of a
   clean skip. **Fix:** dep renamed `listOpenPositions` →
   `listInstancePositions` (default `listPositionsByInstance`, all
   statuses); `evaluateOpenGates` anchors cadence to the newest
   `openDate ≤ date` across every status; only `OPEN` counts toward the
   cap. Pinned by three new specs.
2. **Deterministic-ID collision check fired AFTER the brokerage order** —
   concurrent invocations could both place real orders before one ledger
   write threw. **Fix:** new `getPosition` dep + doc-existence check
   placed before ticket emission and `placeBrokerageOrder`; the ledger's
   transactional `already exists` throw covers the residual window.
   Pinned: `skips cleanly when the position doc already exists before
   ordering`.
3. **`maxOpenPositions` passed through unvalidated** — `getInstance`'s
   permissive validator spread the field unchecked; strings/NaN/negatives
   silently behaved as uncapped (fail-open) or blocked everything.
   **Fix:** `normalizeInstance` keeps non-negative integers, warns and
   drops everything else (`0` stays — the contract documents it as
   explicit uncapped). Doc-reject deliberately avoided: it would remove
   the instance from `listManageableInstances`, killing marks and
   settlement for every leg. Pinned by `drops a malformed
   maxOpenPositions instead of rejecting the doc (#1247 r1)` covering
   `'five'` / `-2` / `1.5` / `0` / `3`.

### Minors (all remediated)

- `open-pass.ts` had grown to 426 lines (>400 documented threshold) —
  extracted pure gate logic to `open-pass-gates.ts` and ticket staging to
  `open-pass-tickets.ts`; now 395 lines.
- Local `daysBetween`/`DAY_MS` duplicated canonical `calendarDaysBetween`
  (`common/pt-date-utils.ts`) — deleted; canonical helper used.
- Dead branch: the `already_opened_in_period` path was unreachable for
  daily cadence — collapsed into a single `daysSinceOpen` predicate
  (0→`already_opened_today`, 1..<cadence→`already_opened_in_period`).
- Same-day retry overwrote `daily-analysis/latest.openPassResult` with
  `positionId: null`, erasing the opened leg's id — skip results now
  carry `blockingPositionId`.
- Verify script not registered in `functions/scripts/verify/run-all.ts` —
  registered after the 724 entry.
- Spec fixtures dropped `status` from partial `Position` casts — added.

## Round 2 — axes re-review

| Axis | Verdict |
|---|---|
| Standards | **PASS** — all five r1 findings resolved; no hard-rule violations; minor baseline smells only |
| Spec | **PASS / ship-ready** — all r1 hard findings resolved; weekly live-verify gap documented; ASSIGNED-vs-cap semantics flagged |
| Thermo-Nuclear | **PASS** — all 7 remediations verified against current code; contract matrix clean; boundary hunt clean (empty list, `openDate > date`, cap 0/undefined/negative, `openDate=''` → NaN-safe); shared ticket-id race resolves correctly via `ALLOWED_FROM` |

Nits raised in round 2 and fixed immediately: step-comment 4→6 gap
renumbered; anonymous `StrategyInstanceConfig & {mode?; paperAccountId?}`
hoisted to exported `OpenPassInstanceConfig`; `skipReason` union derived
from `OpenGateSkipReason`; `openCount` computed once; `lastOpened!`
assertion removed; missing fixture `status` added; verify guide gained an
explicit coverage note that weekly cadence is unit-covered only.

## Round 3 — convergence check on the final diff

| Axis | Verdict |
|---|---|
| Standards | **PASS-with-nits** — three trivial items, all fixed on the spot |
| Spec | **PASS** — all four ACs verified against final code; three-layer idempotency confirmed; no new mismatches |
| Thermo-Nuclear | **PASS** — no new issues in the r2→r3 edits; dependency direction, union coverage, and type relationships all verified |

Round-3 nits fixed: `OpenPassInstanceConfig` now derives its extra
fields from canonical `StStrategyInstance` via `Partial<Pick<…,'mode'|'paperAccountId'>>`
instead of redeclaring them; a verify-script comment that claimed a
raw-quote "prefix query" now describes the actual `tradeId` equality
query; the step-7 comment renamed to reflect record construction (the
`createPosition` write lives under step 8).

Loop stopped here: round 3 found nothing beyond cosmetic nits — all
remediated — on the task's own files.

## Non-blocking notes (documented, not fixed)

- **ASSIGNED_HOLDING_SHARES does not consume the cap** — a wheel instance
  holding assigned shares can exceed the concurrent-position bound.
  Correct per the spec's "open positions" wording; if "economic exposure"
  was meant, that's a spec-author call for a follow-up.
- **`runOptionsOpenPass` orchestrator can't wire `tickets`** — its `pass`
  seam drops the deps argument, so the nightly/manual path opens
  unticketed positions. Matches the dep's documented "not yet wired"
  intent; flag if that path ships live ordering.
- **Residual TOCTOU** between the pre-order `getPosition` read and
  `createPosition` — the ledger's transactional `already exists` throw is
  the backstop; the loser marks its ticket `failed` and propagates.
- **`position-repository.ts` is 457 lines** — pre-existing bulk; this
  task added ~9 lines. Flag only.
- **`...(config as unknown as StrategyInstanceConfig)`** in
  `normalizeInstance` predates #1247 — out of scope.
- **6 red tests in the full functions suite are pre-existing main
  breakage**, zero overlap with this task's files: `dataset-writer` spec
  predates the `writeChunks` dep (#1083, `8be72113`); `stats-repository`
  cumulative-PnL arithmetic mismatch. Owned by those tasks, not #1247.

## Verification

| Check | Result |
|---|---|
| `tsc --noEmit` | clean |
| `cd functions && npm run build` | clean bundle |
| `open-pass.test.ts` | 20/20 (incl. 4 r1 pins + 4 ticket cases) |
| `hybrid-quote-provider-integration.test.ts` + `options-strategy-passes.test.ts` + `settlement-pass.test.ts` + `strategy-instance-repository.test.ts` | 44/44 |
| Live prod verify `paper-trading-engine-open-1247.ts` | **15/15 PASS** — seeded scratch instances, real Firestore, stub order placer; AC1 ladder opens despite prior-day open leg, AC2 same-day `already_opened_today`, AC3 distinct `max_open_positions`, AC4 cap=1 serial; `stats/ALL` snapshot-restored; full cleanup |
| Weekly cadence live coverage | unit-only (documented in the verify guide) |
| Full `tests/functions` suite | 1395/1401 — 6 failures pre-existing at HEAD, out of scope (see notes) |
