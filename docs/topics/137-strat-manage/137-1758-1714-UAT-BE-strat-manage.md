**Topic:** Strategy Manager  
**Topic Slug:** strat-manage  
**Thread:** Live Position Lifecycle  
**Thread Slug:** live-position-lifecycle  
**Issue:** #1758  
**Thread Parent:** #1690  
**Topic Parent:** #137  
**Task:** #1714  
**Domain:** BE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-26  
**Last Updated:** 2026-11-26  

# UAT — BE position-grain settlement + held-shares (#1714)

## Scope

`runSettlementPass` and `runHeldSharesMarkPass` converted from
instance-grain to position-grain sweeps (mirroring #1712's unified mark
pass). The orchestrator's per-instance loop is retired — one sweep call
each per date via `Promise.allSettled`, so legacy zombie docs and trades
on STOPPED instances settle on the same nightly run.

Acceptance criteria under test:

- Settlement selection = every OPEN option-leg trade minus
  `source=SIGNAL` (disjoint from `signalSettlementPass`); zombies without
  `strategyInstanceId`/`source` sweep in
- Last-leg rule: settles iff `max(optionLegs[].expiration) <= date`
  (preserves the #724 missed-night retry)
- Per-leg outcomes at each leg's own expiration close (7-day walk-back
  floored at open); PUT `close<strike` / CALL `close>strike` → ASSIGNED
- Net share delivery across assigned legs: >0 → ASSIGNED_HOLDING_SHARES
  at cash-weighted basis; =0 → EXPIRED with the strike-width cash
  differential booked (offsetting delivery is not cash-neutral); <0 →
  error (uncovered call = future synthetic-CC scope)
- Held-shares sweep marks every ASSIGNED non-signal trade at the run-date
  close for its own symbol
- Account bookkeeping honest: cash moves by real delivery totals,
  realized books premium net of flat-delivery cash, governing variant
  run exits at net order intrinsic

## Prerequisites

- Repo checkout at this branch; `functions/` deps installed.
- ADC configured (the verify script reads/writes REAL Firestore scratch
  docs — they self-clean and assert deletion).
- No dev server needed — BE sweep, exercised via command line.

## Getting to the feature

There is no UI surface. The feature is the nightly settlement chain,
reachable three ways:

- **Scheduled**: `checkSyncRunCompletion` (symbol-data-sync) fires
  `runNightlySettlementChain` after all closing bars land.
- **Manual callable**: `optionsSettlementPassManual` (exported in
  `functions/src/index.ts`) runs the same chain for a date.
- **Verification entry point**: the verify script drives the real passes
  against real Firestore scratch docs — run from `functions/`:

  ```
  npx tsx scripts/verify/strat-manage-settlement-1714.ts
  ```

## Automated evidence

- `cd functions && npx tsx scripts/verify/strat-manage-settlement-1714.ts`
  — real-Firestore scratch-doc run (S1).
- `cd functions && npm run test:paper-trading` — full domain suite (S2).
- `cd functions && npm run test:sds` — the chain is invoked from the SDS
  completion path (S3).
- `cd functions && npx tsc --noEmit -p tsconfig.json` — compile gate (S4).

## Scenarios

### S1 — verify script end-to-end (real Firestore)

- Feature: the real passes settle scratch docs honestly on the real
  corpus — zombie reachability, signal disjointness, per-leg outcomes,
  share delivery, flat-spread cash truth, held-shares marking.
- Starting state: ADC configured; no leftover `verify-1714-*` docs
  (the script cleans any).
- Steps: `cd functions && npx tsx scripts/verify/strat-manage-settlement-1714.ts`
- Expected: every line `OK`, `25 passed, 0 failed`, including:
  `zombie trade (no instanceId) settled EXPIRED` · `signal-source trade
  left OPEN` · `spread shares record at the SHORT strike basis` ·
  `flat spread realizedPnl = premium − width×100` · `flat spread
  governing run exits at net intrinsic` · `account cash debited by real
  delivery totals` · `held-shares unrealizedPnl` · `cleanup removed all
  scratch docs`. The reachability line reports the corpus count.
- Cleanup: automatic — script deletes its six scratch trades + instance
  + account and asserts none survive.
- Evidence: full script output.

### S2 — spec gate

- Feature: all settlement/held-shares/orchestrator behavior is pinned.
- Steps: `cd functions && npm run test:paper-trading`
- Expected: all suites pass (550 at review time) — settlement 27 specs
  incl. flat-spread `deliveryCash`/`orderExitPrice`, qty>1, weighted
  multi-strike basis, adapter-throw isolation, net-short error;
  held-shares 6; orchestrator sweep + sibling-failure specs;
  signal-eod-close ordering spec.
- Evidence: `ℹ pass 550 ℹ fail 0` (or higher if specs were added).

### S3 — SDS invocation path

- Feature: the nightly chain entry from symbol-data-sync still works —
  `sds-completion-deps` and `sds-consumer-dispatch` route to
  `runNightlySettlementChain`.
- Steps: `cd functions && npm run test:sds`
- Expected: all pass (81 at review time).
- Evidence: `ℹ pass 81 ℹ fail 0`.

### S4 — compile gate

- Steps: `cd functions && npx tsc --noEmit -p tsconfig.json`
- Expected: exit 0, no output.

### S5 — wiring spot check (negative: no stale call sites)

- Feature: every entry point calls the new chain — no orphaned
  instance-loop references survive.
- Steps (repo root):
  ```
  grep -rn "runSettlementForAllInstances\|runPassForManageableInstances\|listHeldSharesPositions\|findPrimaryLeg" functions/src tests/
  ```
- Expected: zero hits in `functions/src` (the retired names are gone);
  the only legitimate historical mention is a spec name in
  `mark-pass.test.ts` ("no findPrimaryLeg" — a name, not a call).
- Evidence: grep output.

### S6 — post-deploy observation (record for after ship)

- Feature: the next real nightly run settles the accumulated expired
  corpus. Not executable pre-ship — the code isn't deployed. After
  `firebase deploy`, the next `checkSyncRunCompletion` run should log
  `Settlement pass … settled=N` covering legacy expired trades (the
  `260819-*` zombie population) and ASSIGNED marks.
- Evidence: functions log excerpt post-deploy (non-gating; recorded for
  the ship checklist).

## Manual UI/UX refinement pass

Not applicable — no user-facing surface. The only visible-adjacent item
(`shares.quantity` rendered in contracts on the dashboard) is a
pre-existing display convention documented in the review doc, unchanged
by this task.

## Findings

- None.

## Traceability

| Task AC | Scenario |
|---|---|
| Position-grain sweep, no instance enumeration; zombies included | S1 (zombie check, reachability), S2 |
| Last-leg rule + missed-night retry | S1, S2 (last-leg/missed-night specs) |
| Per-leg outcomes at own expiration close; CALL support | S1 (spread legs), S2 (per-leg/CALL specs) |
| Net delivery: shares / flat-with-cash / net-short error | S1 (spread + flat + account cash), S2 |
| Signal disjointness | S1 (signal doc untouched) |
| Held-shares per-position symbol mark | S1 (held mark vs run-date close), S2 |
| Honest account bookkeeping (cash, realized, variant exit) | S1 (account cash + exit-price checks) |
| Orchestrator sweep + sibling-failure honesty | S2 (failure spec), S3 |
| No stale call sites | S4, S5 |

## Regression / smoke

- `signalSettlementPass` unchanged (signal docs untouched — S1).
- `runNightlySettlementChain` ordering eod→eval→signal→settle+held→stats
  pinned by the signal-eod-close spec (S2).
- Foreign `#728` checker seam preserved — single-option-leg positions
  consult a wired checker (specs preserved; prod wires none).
- Nearby suites: `test:sds` green (S3); full jest unaffected (no FE
  changes).

## Verdict

**PASS** — all executable acceptance criteria verified on real Firestore and the spec gate. S6 is a post-deploy observation for the ship checklist, not a gate item.

## Results log

| Check | Result | Evidence |
|---|---|---|
| S1 verify script | PASS | 25/25 OK on real Firestore — zombie settles, signal untouched, spread→shares at short strike, flat spread realized −2800 (premium−width×100) + exit at net intrinsic, account cash debited real totals, held mark vs run-date close, cleanup verified |
| S2 test:paper-trading | PASS | 550/550 |
| S3 test:sds | PASS | 81/81 |
| S4 tsc | PASS | clean |
| S5 stale-call-site grep | PASS | zero call sites; only a spec NAME mentions findPrimaryLeg |
| S6 post-deploy observation | — | after ship |
| Refinement pass | N/A | no user-facing surface |
