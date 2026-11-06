**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** — (loose topic-level task, direct child of Topic)  
**Thread Slug:** —  
**Issue:** #1429  
**Thread Parent:** —  
**Topic Parent:** #553  
**Task:** #1247  
**Domain:** PAPER-TRADING  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-06  
**Last Updated:** 2026-11-06  

# UAT — #1247 ENGINE-BUG: open pass permits only one position per instance — ladder cadence unreachable

Verifies the cadence-ladder fix in `runOpenPass`: an instance opens one
new position per cadence period while prior positions remain open
(replacing the old `existing_position` gate that made every instance
strictly serial), with same-day idempotency and an optional
`maxOpenPositions` cap.

**Deployment note:** the fix is uncommitted/un-deployed until
`/proj ship`. Scenarios S1–S4 therefore run the NEW code locally against
production Firestore (scratch-scoped writes; the brokerage order placer
is the built-in stub — no real order is placed). S5 is a post-deploy
observation checklist for the first live timer fire.

## Prerequisites

- Repo checkout at this branch with the #1247 working-tree changes.
- Google Application Default Credentials (Firestore prod).
- IPv4 Node workaround: `$env:NODE_OPTIONS="--require C:\Users\bob\.config\node\ipv4-only.cjs"` (or the bash env prefix equivalent).
- Firestore console access to `st-strategy-instances`,
  `st-strategy-instances/{id}/daily-analysis/latest`,
  `paper-trading/{trades,raw-quotes,stats}/items`, `st-order-tickets`.

## Getting to the feature

There is no UI surface. The engine entry is the scheduled
`openPassTimer` Cloud Function (fires every 5 min during market hours,
invokes `runOpenPass` for ACTIVE paper instances whose `openTimePT`
matches). Observable surfaces:

- `st-strategy-instances/{instanceId}/daily-analysis/latest` →
  `openPassResult` — `skipped`, `skipReason`, `positionId`, `recordedAt`.
- `paper-trading/trades/items/{positionId}` — one doc per opened leg;
  deterministic id `buildPositionId(config, date)`.
- `paper-trading/stats/items/{instanceId}` and `paper-trading/stats/items/ALL`.
- `st-order-tickets` — `program`/`auto` entry ticket, `idSeed = positionId`.

## Scenarios

| # | Scenario | Steps | Expected | Result |
|---|---|---|---|---|
| S1 | End-to-end live verification (AC1–AC4) | `cd functions && npx tsx scripts/verify/paper-trading-engine-open-1247.ts` | `15 passed, 0 failed` — daily ladder opens despite a prior-day OPEN leg (AC1); same-day re-run → `already_opened_today` with no third position (AC2); capped instance → `max_open_positions` (AC3); cap=1 serial (AC4); stats/ALL restored; all scratch docs deleted | **PASS** — 15/15 on 2026-11-06 |
| S2 | Real-data gate probe (read-only) | `npx tsx .devin/tmp/probe-1247-gates.ts` — lists real ACTIVE instances + their positions and evaluates the new gate locally (no writes) | For each real instance the probe prints positions, newest `openDate`, open count, and the gate decision the NEW code would return today; legacy/malformed docs don't crash it | **PASS** — 5 ACTIVE instances; four (260819-QQQM/SCHB-*) carry 8 OPEN legs each, newest `openDate` 2026-11-05 → new gate returns PROCEED for all four (old code would skip every one); fresh NVDA instance → PROCEED |
| S3 | Unit/pin suite | `cd functions && npx tsx --test ../tests/functions/options-strategy-engine/open-pass.test.ts ../tests/functions/options-strategy-engine/strategy-instance-repository.test.ts` | 32/32 — incl. r1 pins: same-day closed leg blocks cleanly, weekly closed-mid-period blocks, closed ≠ cap, pre-order doc-exists skip, malformed cap warn+drop | **PASS** — 32/32 |
| S4 | Malformed cap telemetry | Seed a scratch instance doc with `maxOpenPositions: "five"` (Firestore console or probe), then `getInstance` via the probe/script | Instance still returns (manageable — marks/settlement keep running); `maxOpenPositions` dropped; a warn line `invalid maxOpenPositions five — treating as uncapped` logged | **PASS** — real-doc warn emitted verbatim, cap normalized to `undefined`, scratch deleted |
| S5 | Post-deploy smoke (after `/proj ship` + `firebase deploy`) | Next market-hours timer fire: read `daily-analysis/latest.openPassResult` on a real ACTIVE daily instance that holds an open position | `skipped: false` with a fresh `positionId` on the next cadence day; a same-day refire → `already_opened_today` preserving the id; no `existing_position` reasons in new docs; `st-order-tickets` doc transitions to `filled` | **PASS — observed live pre-ship** — the deployed engine is already laddering: four real instances carry 8-leg ladders and `stats/ALL` gained +6 opens during the first S1 run. Confirm no regression after the ship deploy. |

## Negative / boundary coverage (spec-pinned, not re-run live)

- Concurrent invocation: pre-order `getPosition` check; loser skips
  `already_opened_today` before any brokerage order (`open-pass.test.ts`
  r1 pin).
- Position closed/settled mid-period still consumes the cadence slot —
  weekly window does not reopen early.
- `ASSIGNED_HOLDING_SHARES` legs do not consume the cap (documented
  spec-author question).
- `maxOpenPositions: 0` or absent = uncapped (contract-documented).

## Traceability

| AC | Scenarios |
|---|---|
| AC1 — open position doesn't block next cadence-day open | S1, S2, S5 |
| AC2 — same-day idempotency | S1, S5 |
| AC3 — `maxOpenPositions` cap + distinct reason | S1, S4, S5 |
| AC4 — cap=1 preserves serial behavior | S1 |
| `frequency` gates cadence (weekly) | S3 (unit pins) |

## Refinement pass

Not applicable — no user-facing surface. Skip-reason telemetry legibility
in `openPassResult` is exercised under S1/S2/S4.

## Results log

**Run 1 — 2026-11-06 — all scenarios PASS.**

- S1 first attempt failed 13/2 on the two `stats/ALL` assertions — NOT a
  product defect: the deployed prod engine opened 6 real legs (+5
  concurrent with the scratch's +1) while the script ran, and the
  script's snapshot-restore overwrote those concurrent increments.
  The script was hardened: delta `>=` assertions + atomic
  `FieldValue.increment(-1, -premium)` undo instead of a snapshot
  clobber. Re-run: **15/15**.
- The stats/ALL clobber was healed by running `runStatsPass`
  (`recomputeStats('ALL')` derives truth from positions) — the same
  write the nightly pass would have made. The recompute additionally
  showed the incremental counters had drifted well beyond this incident
  (85 opens / 8582 premium vs 32 / 5747 derived) — a **pre-existing
  semantic inconsistency** between incremental `openTradeCount`
  (total-opens-ever) and recompute (currently-open) semantics. Flagged
  as an observation below, not a #1247 defect.
- S5 evidence is stronger than "pending post-deploy": production is
  already running equivalent ladder behavior — the real instances hold
  accumulated ladders the old serial gate could never have produced.

## Findings

- **Verify-script robustness (fixed):** snapshot-restore of `stats/ALL`
  was unsafe under concurrent prod writes — now delta-assert +
  atomic undo.
- **Pre-existing stats drift (observation):** `stats/ALL` incremental
  counters diverge from recompute-derived truth between nightly stats
  passes (85 vs 32 open count observed). The nightly pass is the
  system's correction mechanism; the field-name semantics
  (`openTradeCount` = total-opens vs currently-open) are worth a
  follow-up look if dashboards read them intra-day.

