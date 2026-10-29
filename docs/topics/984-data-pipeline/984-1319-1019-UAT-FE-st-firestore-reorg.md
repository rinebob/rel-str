**Topic:** ST Firestore Reorg  
**Topic Slug:** st-firestore-reorg  
**Thread:** Data Plane Consolidation  
**Thread Slug:** data-plane-consolidation  
**Issue:** #1319  
**Thread Parent:** #985  
**Topic Parent:** #984  
**Task:** #1019  
**Domain:** FE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-28  
**Last Updated:** 2026-10-28  

# UAT — #1019 signal readers → st-signals

Task #1019 completed the signal-reader cutover left open by #1159: all
deployed readers (FE `signal.service`, `stGetSymbolsWithSignals`,
`stGetSymbolSignalHistory`, auto-paper `getSignals`) and the writer now
use canonical `st-signals` + `st-symbols` exclusively. Legacy
`savant-trader/data/symbols/{SYM}/run-ids` + `signal-history` survive
only as the evidence source for pre-delete parity relays. This UAT
verifies (a) read equivalence on live prod data, (b) the sole-write /
fail-hard writer contract, (c) the FE reader surface, and (d) the
documented post-deploy sequence ending in the legacy symbols-parent
delete.

## Scope

- Writer: `signal-date-writer` writes `st-signals` occurrences +
  `st-symbols` gate fields only; fail-soft → fail-hard.
- BE readers: `stGetSymbolsWithSignals` (`runIds array-contains`),
  `stGetSymbolSignalHistory` (flat `st-signals` by symbol),
  auto-paper `getSignals` (symbol + `runIds`, canonical direction →
  `StSignalDirection`, warn+skip on unmappable).
- FE readers: `getSymbolSignalsForRun` (symbol + `runIds
  array-contains`), `getSymbolSignalHistoryFromHistory` (symbol +
  `barDate desc`); strict canonical mapper; INTERIM coverage added.
- Infra: `Collection.ST_SYMBOLS` retired; `(symbol, runIds CONTAINS)`
  composite index declared; legacy rules blocks → deny-by-default.
- Verification: `data-pipeline-st-signals-readers-1019.ts` registered
  in all four places as a pre-delete gate; 916/918 relays repointed.

## Prerequisites

- Repo at `C:\aa\projects\rel-str`, branch `prod`, working tree
  contains the #1019 changeset (uncommitted — ship gate is separate).
- Application Default Credentials with Firestore access to `rel-str`
  (prod). Commands run from `functions/` unless noted.
- `$env:NODE_OPTIONS="--require C:\Users\bob\.config\node\ipv4-only.cjs"`
  if the terminal predates the user-level env var.

## Scenarios

### S1 — Reader-equivalence relay (read-only, executable now)

**Feature:** canonical reads return what the legacy reads did.

1. `cd functions; npx tsx scripts/verify/data-pipeline-st-signals-readers-1019.ts`
2. Expect `=== READER-EQUIVALENCE OK ===` with all three legs:
   - A: run-scoped symbol set — legacy `run-ids` collectionGroup vs
     canonical `runIds` identical.
   - B: per-symbol `{signalType}@{barDate}` entry sets identical for
     10 sampled symbols (entry-count floor — cannot pass vacuously).
   - C: every legacy `signal-history` key exists canonically (any
     status); INTERIM extras are the intended new coverage.

**Result:** PASS — `2026-10-28_wed_141843_nightly`: A 119 symbols
identical; B 10 symbols identical; C 10 symbols covered (64 legacy
entries), +80 INTERIM.

### S2 — Data-state gates: dual-write + backfill audit (read-only)

**Feature:** the canonical record the readers serve is complete.

1. `npx tsx scripts/verify/data-pipeline-st-signals-dual-write-1000.ts`
   → expect `=== DUAL-WRITE PARITY OK ===`, `missing=0 mismatched=0
   malformed=0` for today's marketDate.
2. `npx tsx scripts/verify/data-pipeline-st-signals-backfill-1001.ts
   --audit` → expect `=== BACKFILL PARITY OK ===` — all 926 symbols
   `missing=0, mismatched=0, extra=0` (provenance `sourceRunId`/
   `indicators` warnings are benign and counted OK).

**Result:** PASS — dual-write `ok=217 missing=0 mismatched=0
malformed=0` (marketDate 2026-10-28); #1001 audit `=== BACKFILL
PARITY OK ===` — all 926 symbols `missing=0, mismatched=0, extra=0`;
~150 benign provenance warnings (`sourceRunId` first-detection vs the
audit's expected-first-detection heuristic, `indicators` payload
diffs) — counted OK by design.

### S3 — Pin suite + compile (automated)

**Feature:** the cut boundary and infra pins.

1. `cd functions; npm run test:st-cutover-1159` → asserts zero
   legacy-path references in deployed code, sole-write boundary.
2. `npm run test:st-signals` → writer sole-write + fail-hard pins.
3. `npm run test:st-rules-indexes` → `(symbol, runIds CONTAINS)` index
   pinned; legacy rules deny-by-default.
4. `npx tsc --noEmit -p tsconfig.json` (functions) → clean; app tsc →
   clean except 3 pre-existing baseline errors in unmodified files
   (`bulk-swing-sweep.ts`, `indicator-config-dialog.component.ts`).

**Result:** PASS — cutover 7/7, st-signals 34/34, rules/indexes 14/14,
functions tsc clean, app tsc clean except the documented baseline.
Full-suite evidence (review round 2): 141 suites / 2,745 tests on the
touched surface; full app suite 275 suites / 4,746 tests.

### S4 — FE reader repoint (code-verified; live smoke requested)

**Feature:** FE reads canonical `st-signals`/`st-symbols` directly.

1. Evidence: `signal.service.ts` queries `ST_SIGNALS_ROOT` —
   `getSymbolSignalsForRun` (`symbol ==` + `runIds array-contains`),
   `getSymbolSignalHistoryFromHistory` (`symbol ==` + `barDate desc`);
   `Collection.ST_SYMBOLS` deleted (pin `st-path-cutover-1014.spec.ts`
   green).
2. **Live smoke (dev server, prod Firestore):** `npm start`; with an
   authed session confirm:
   - Gallery signal cards populate (run-scoped `st-signals` read).
   - Signal-review run view shows the active run's signals per symbol.
   - Chart-review / symbol-history view populates, **including INTERIM
     signals** (new coverage — INTERIM chips render where status is
     shown).
   - No `FAILED_PRECONDITION` in console. NOTE: the `(symbol, runIds
     CONTAINS)` composite is declared in `firestore.indexes.json` but
     not yet deployed; the Admin-SDK relay runs the identical query
     successfully via single-field index merge, so the web SDK should
     behave the same — the deploy will land the composite regardless
     (performance).
3. **Post-deploy repeat (ship step):** same checks against the
   deployed app/callables.

**Result:** PASS — local dev server (prod Firestore) smoke confirmed by
user 2026-10-28: gallery signal cards populate from `st-signals`, the
active run's signals show in signal review, symbol history populates
including INTERIM entries, no `FAILED_PRECONDITION` or permission
errors (the query merges single-field indexes — the declared
`(symbol, runIds CONTAINS)` composite lands at ship as a performance
index). The S4.3 post-deploy repeat is the same checks against the
deployed app/callables.

### S5 — Post-deploy ship sequence — runbook (executed at ship)

Ordered runbook — the task's operational contract:

1. `firebase deploy --only functions,firestore:indexes` — writers cut
   to sole `st-signals`/`st-symbols` writes; composite index lands.
   (Functions-only deploy leaves the index undeployed — include the
   indexes target or run `firebase deploy --only firestore:indexes`.)
2. Post-deploy write probe — after the next PDR/nightly run, confirm
   new signals land only on `st-signals` + `st-symbols`: probe a
   post-deploy run's symbols for **zero** new `run-ids`/
   `signal-history` docs.
3. Re-run S1 + S2 relays against post-deploy data — all green before
   any deletion (these are the pre-delete gates; they read legacy
   paths intentionally).
4. Callable smoke — `stGetSymbolsWithSignals` +
   `stGetSymbolSignalHistory` return canonical data (deployed code).
5. Auto-paper post-deploy — `paper-trading-auto-paper-918-ingest.ts`
   ALL CHECKS PASSED on a post-deploy run (canonical getSignals).
6. Archive + delete `savant-trader/data/symbols` (926 symbol docs +
   `run-ids`/`signal-history` subcollections) via the #1013 tooling —
   **destructive, needs explicit approval**.
7. Post-delete cleanup — remove the legacy `symbols` collectionGroup
   index entries from `firestore.indexes.json`; retire the
   legacy-reading relays (#1000/#1001/#1019) from `run-all.ts` — they
   fail by design once their evidence source is gone (same lifecycle
   as the #1159 relay).

**Result:** pending — executes at ship, requires approval for step 6.

## Regression / nearby-surface smoke

- Run enqueue still writes job docs + `runStartedAt`/`triggeredBy`
  provenance (unchanged — `SymbolJobPayload` carries them for the job
  doc; the `triggeredBy !== 'nightly'` bar-sync skip in `worker.ts`
  remains live).
- `rs-signal-history.callables` (RS feature, `SIGNALS_OPENS/CLOSES`)
  untouched — different collection, out of scope.
- `closePrice` still derived from local bars by `enrichClosePrices`
  (canonical `StSignal` has no close field — by design).
- Pre-existing baseline: `stGetSymbolSignalHistory` ignores its
  `timeframe` param (documented, no FE caller); `invoker:'public'`/
  `cors:true` on callables unchanged.

## Traceability

| Acceptance criterion | Scenario(s) |
|---|---|
| Gallery/review readers cut to st-signals after dual-write verify | S1, S2, S4 |
| INTERIM signals visible (new coverage) | S1-C, S4.2 |
| Writer sole-writes st-signals + st-symbols, fail-hard | S3, S5.2 |
| `stGetSymbolsWithSignals` / `stGetSymbolSignalHistory` → st-signals | S1, S5.4 |
| Auto-paper ingest → canonical occurrences, direction mapped | S5.5 |
| `Collection.ST_SYMBOLS` retired, zero legacy refs in deployed code | S3.1 |
| Composite index + rules deny-by-default | S3.3, S5.1 |
| Reader-equivalence relay registered as pre-delete gate | S1 |
| Archive + delete legacy symbols parent | S5.6 (approval) |

## Results log

| Scenario | Result | Evidence |
|---|---|---|
| S1 reader-equivalence | PASS | A 119 / B 10 / C 64 covered +80 INTERIM (run `…_141843_nightly`) |
| S2 dual-write | PASS | `ok=217 missing=0 mismatched=0 malformed=0` |
| S2 backfill audit | PASS | 926 symbols `missing=0 mismatched=0 extra=0` — PARITY OK |
| S3 pins + compile | PASS | 7/7, 34/34, 14/14, tsc clean |
| S4 FE smoke | PASS | user-confirmed dev-server smoke 2026-10-28 — all surfaces populate, INTERIM visible, no index/permission errors |
| S5 ship sequence | pending | ship-time runbook |
