# BE TEST — Trade Analysis & Forensics

**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Trade Analysis & Forensics  
**Thread Slug:** trade-analysis  
**Issue:** #1065  
**Thread Parent:** #1059  
**Topic Parent:** #553  
**Domain:** PAPER-TRADING  
**Type:** Test Plan  
**Status:** Draft  
**Created:** 2026-10-17  
**Last Updated:** 2026-10-17  

## Unit targets

- Trade→row mapper: signal-linked equity trade carries `ind.*`/`strength.*`; manual + option-expression rows get `analysisCohort: 'excluded'`; direction-aware `tradeRetPct` sign correctness (long gain = positive, short gain = positive).
- Replay walk: synthetic bars + injected signal → `trailing-8` exits on the right daily close; `time-Nd` max-hold; `initial-stop-N`; `daysHeld`/excursion fields computed from walked path.
- Index doc lifecycle: `generating` → `ready` on success, `generating` → `failed` on writer throw (never stuck).
- Dataset id uniqueness: two same-day runs → two entries, no overwrite.

## Integration boundaries

- `generateTradeDataset` callable enqueues task with validated params (bad exit grammar → 4xx, no index doc).
- Task handler fake-Firestore specs (precedent: `tests/functions/paper-trading/*`): trades enum → writer called with expected row shape; replay path: stubbed SDS bars → `detectAllStTrendRiderSignals` seam honored (spy proves we call the real detector, not a reimpl).
- GCS write via stubbed bucket (precedent: `storage-writer.ts` seam).

## Verify / E2E

- `paper-trading-analysis-dataset.ts` verify: dry-run live snapshot (row count sanity), AMAT replay vs validated prototype — 98 closed, ~32.7% profitable, payoff ~1.30 within stated tolerance; registered in `run-all.ts`.

## Edge cases

- Symbol with zero signals in range → no rows, still `ready`; symbol missing SDS bars → logged + skipped, not failed; partial run failure → `failed` status with `error`, partial CSV not uploaded.
