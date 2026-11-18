**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Historical Signal Replay  
**Thread Slug:** historical-signal-replay  
**Issue:** #1606  
**Thread Parent:** #906  
**Topic Parent:** #553  
**Task:** #1575  
**Domain:** PAPER-TRADING  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-18  
**Last Updated:** 2026-11-18  

# UAT — #1575 BE: Backfill mint — backfillSignalTrade walk + generatePaperSignalTrades callable

## Scope

The historical mint that turns a picked `st-signals` occurrence into a
real `PaperTrade`: `backfillSignalTrade` (deterministic tradeId →
dedupe/resume gates → `st-signals` doc + identity/direction checks →
stored bars → `SDS_BARS` entry at the signal-bar close → pick ticket →
in-memory forward walk with the nightly evaluator + governing policy →
real `applyExitFill` → ONE `commitBackfilledTrade`), and the
`generatePaperSignalTrades` callable (auth → shape validation →
cap-50 → per-item `MintResult`s, per-symbol bars memo). Backend
machinery only — no UI surface; the FE review surface arrives with
the signal-mode review thread (#1117).

## Prerequisites

- Repo at `prod`, worktree contains the task diff (uncommitted at QA
  time — ships with the task).
- No credentials, emulator, dev server, or browser needed — every
  check is a `node:test` spec, a verify script, or a file inspection.
  The verify script mints a fixture trade through the **real** ledger
  against an in-memory txn store — no Firestore writes.
- Commands run from `functions/` unless noted.

## Getting to the feature

There is no UI surface — the feature is the callable + the mint pass.
To inspect the delivered behavior:

- `functions/src/paper-trading/passes/backfill-signal-trade.ts` — the
  mint: dedupe/provenance/marks-audit gates (lines ~148-218), entry
  fill, walk, close→annotate commit order, ticket lifecycle, catch.
- `functions/src/paper-trading/signal-trade-callables.ts` — the
  `onCall` boundary + prod dep wiring.
- `functions/src/paper-trading/repository.ts` —
  `commitBackfilledTrade` + `CommitBackfilledTradeUpdate`.
- `functions/src/paper-trading/ledger.ts` — `FillDimensions.governingPolicy`.
- Callable is registered in `functions/src/index.ts` as
  `generatePaperSignalTrades` — invocable post-deploy via the
  Firebase callable of the same name (items:
  `{symbol, signalBarDate, signalType}`).

## Automated evidence

- `npx tsx --test ../tests/functions/paper-trading/backfill-signal-trade.test.ts` — **29/29**
- `npx tsx scripts/verify/paper-trading-backfill-signal-trade-1575.ts` — **32/32**
- `npm run test:paper-trading` — **377/377**
- `npm run test:st-order-tickets` — **26/26** · `npm run test:st-signals` — **34/34**
- `npx tsc --noEmit -p tsconfig.json` + `npm run build` — clean

## Scenarios

### S1 — Focused spec suite

**Feature:** every mint + callable behavior the task added.

1. `cd functions && npx tsx --test
   ../tests/functions/paper-trading/backfill-signal-trade.test.ts`

**Expected:** `ℹ pass 29` `ℹ fail 0` — covering the SDS_BARS entry,
walk/close/shadow semantics, dedupe/resume gates, live-ingest
collision, ticket lifecycle, NaN/interim guards, callable
auth/validation/cap/cache, and the `replaySignalToRow` consistency
pin.

**Result:** PASS — 29/29 (2026-11-18, fresh run).

### S2 — Task verify script

1. `cd functions && npx tsx
   scripts/verify/paper-trading-backfill-signal-trade-1575.ts`

**Expected:** `All 32 checks passed.` — contract surface, fixture
mint through the real ledger (entry at signal-bar close, marks,
closing run EXITED, exitEvent, realizedPnl, SDS_BARS on both fills,
one commit), dedupe + error paths, callable auth/cap.

**Result:** PASS — 32/32.

### S3 — Dedupe/resume gates (the three review majors)

**Feature:** a re-mint always lands in the right bucket — never
hides a crashed mint, never hijacks a live position.

1. Read `backfill-signal-trade.ts` ~lines 148-218 — gate order:
   terminal-status dedupe → mint-seeded provenance (entry fill at
   `signalBarDate` + `SDS_BARS`) → marks audit (missing walk-owned
   marks → resume).
2. Spec `dedupes a live auto-ingested trade sharing the id — never
   resumes foreign docs` — seeds a live-style doc (dispatch-date
   fill, `RH_MCP`) → `deduped`, zero walk writes, no fabricated
   exit.
3. Spec `resumes a crashed mint even after the nightly mark-pass
   stamped it` — entry-only doc + `lastMarkedAt` + a nightly mark →
   `created` with the full mark set.
4. Spec `dedupes a mint that closed before its commit threw` —
   CLOSED-without-commit → `deduped` (nightly repair annotates).
5. Spec `resumes after an exit-fill failure` — OPEN seed walks to
   CLOSED on retry.

**Result:** PASS — all four specs green; gate order verified against
the file.

### S4 — Walk fidelity + consistency pin

**Feature:** the minted outcome is the nightly evaluator's outcome —
not a parallel analysis.

1. Spec `consistency pin: minted outcome equals replaySignalToRow
   for the closing variant` — the ledger mint and the analysis-only
   replay agree on the closing variant.
2. Spec `governing trailing-8 closes on breach day; same-day
   triggers shadow-record` — the close lands at the firing bar's
   mark; later same-day triggers record shadow `exitEvent`s.
3. Spec `short-side mirror` — a SHORT signal mints a SHORT trade.

**Result:** PASS — all green; the walk's decision order (pick →
flags across full run array → ACTIVE eval → shadow exits → latch)
mirrors `runExitEvalPass` (cross-read both files).

### S5 — Ticket lifecycle

**Feature:** the pick ticket reflects ledger truth, never the other
way.

1. Spec `emits the pick ticket auto:false + idSeed:tradeId and marks
   it filled` — emit terms (`mode:paper`, `auto:false`,
   `idSeed:tradeId`, `origin.type:'signal'`) + `markFilled` at the
   stored entry price.
2. Spec `marks the staged ticket failed when the mint dies after
   emit` — pre-entry failure → `markFailed`.
3. Spec `leaves the ticket filled when the mint dies AFTER the entry
   lands` — post-entry failure → no failed transition (`entryCommitted`
   gate).
4. Spec `still mints when the ticket emit fails` — fail-soft emit.

**Result:** PASS — all green.

### S6 — Callable boundary

**Feature:** `generatePaperSignalTrades` is a thin, safe boundary.

1. Specs: `requires auth`, `rejects a non-array items payload`,
   `rejects a batch over 50 items`, `rejects malformed item shapes`
   (incl. a missing `signalBarDate` → `invalid-argument`, not a
   TypeError), `normalizes symbol casing`, `collects per-item
   results without failing the call`, `caches bars per symbol`.
2. Read `signal-trade-callables.ts` — `onCall` export registered in
   `index.ts`; non-`HttpsError` escapes re-map to `internal`.

**Result:** PASS — all green.

### S7 — Regression smoke + build

1. `npm run test:paper-trading` — 377/377 incl. all pre-existing
   eval/ledger/ingest suites.
2. `npm run test:st-order-tickets` (26/26) + `npm run
   test:st-signals` (34/34) — contract boundaries the mint touches.
3. `npx tsc --noEmit -p tsconfig.json` + `npm run build` — clean.

**Result:** PASS — all green.

## Manual UI/UX refinement pass

Not applicable — backend callable + pass machinery only; no
user-facing surface in this task.

## Findings

None — the review's majors (commit ordering, mark-pass-masked
resume, live-ingest collision) were fixed in-gate and re-verified
here (S3). Deferred polish is tracked on the QA issue
(`evalTradeDay` extraction, `PaperMark` provenance), not blocking.

## Traceability

| Criterion | Scenario |
|---|---|
| Resolve `st-signals` doc; load bars via `getCachedBarsFromSymbolData` | S1, S2 |
| Entry fill = signal-bar close, `SDS_BARS` provenance | S1, S2 |
| Curated variant keys seeded; governing policy stamped | S1, S2 |
| Walk: marks per bar, governing pick per day, ACTIVE eval order, shadow exits | S1, S4 |
| Governing/independent close → exit fill closes trade; never-fired → OPEN | S1, S2, S4 |
| Marks + final run states in ONE transaction; exit fill after walk | S1, S2, S3 |
| SMA enrichment via `smaIndicatorsFor`; blind-skip guarded | S1 |
| Manual pick ticket `auto:false`, `idSeed:tradeId`, marked filled | S1, S5 |
| Auth + shape validation + cap 50 + per-item results + per-symbol bars cache | S1, S6 |
| Registered in `index.ts`; spec + test command registered | S1, S6, S7 |
| Consistency pin: minted outcome == `replaySignalToRow` | S4 |
| Idempotent re-mint / dedupe with `tradeId` | S2, S3 |
| Review remediation: finite marks, close→annotate, ticket lifecycle, resume gates | S3, S5 |

## Regression / smoke

- [x] `test:paper-trading` batch — 377/377
- [x] `test:st-order-tickets` — 26/26
- [x] `test:st-signals` — 34/34
- [x] functions tsc + build — clean
- [x] nightly eval-pass / ledger / ingest suites — green inside the batch

## Verdict

**PASS** — all acceptance criteria verified with fresh evidence.

## Results log

- 2026-11-18 — PASS. 29/29 focused · 32/32 verify · 377/377 batch ·
  26/26 tickets · 34/34 signals · tsc+build clean. No UI surface
  (refinement N/A).
