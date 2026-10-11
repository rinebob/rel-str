# Verification — #918 BE: auto-paper ingest fill (selection → quote → fill)

**Topic:** #553 Paper Trading Infra
**Thread:** #904 Signals Auto Paper Trade
**Task:** #918 — ingest selection, batched quote, ledger fills

## What this verifies

The fill pipeline that runs after #917's gates pass
(`runAutoPaperIngestFill` in `passes/auto-paper-ingest-pass.ts`):

1. **Candidates** — job docs under the run where
   `createdOpportunity == true` → candidate symbols.
2. **List gate** — named `lists` intersect candidates; `lists:['*']`
   admits all and stamps `captureList: '*'`.
3. **Signals** — `symbols/{sym}/run-ids/{runId}` read in BOTH shapes
   (prod stores literal flattened `signals.{type}` keys; backfills may
   carry a nested `signals` map), filtered to `scope.signalTypes`.
4. **Quote** — one batched `mcp__robinhood-trading__get_equity_quotes`
   call for all admitted symbols; a missing per-symbol price skips that
   symbol only.
5. **Fill** — `applyEntryFill` (with `ledgerDepsWithCapture`) writes an
   OPEN 1-share MARKET trade, `dims.signalId =
   {SYM}_{SIGNALTYPE}_{BARDATE}`, all signal/symbol stamps, then an
   `rq-…` raw-quote audit doc.
6. **Dedupe** — tradeId is keyed on the signal's `barDate`
   (`YYMMDD-sig-{SYM}-EQV{n}{L|S}`), so a re-dispatch — even next-day —
   hits the same doc id; the ledger's `already exists` throw counts as
   dedupe, never an error.
7. **Isolation** — per-signal failures log `st_autopaper_fill_failed`
   and continue; a batch quote failure marks all work `quoteFailed` and
   exits cleanly.

## Coverage split

| Behavior | Covered by |
|---|---|
| All of the above, per-signal | `tests/functions/paper-trading/auto-paper-ingest-pass.test.ts` → `describe('runAutoPaperIngestFill')` (fake deps) |
| Pipeline maps onto real prod run data | `functions/scripts/verify/paper-trading-auto-paper-918-ingest.ts` — read-only dry-run: real run → candidates → signals → meta → computed tradeIds + dedupe check (no writes, no RH session) |
| Real quote + real write | First live run after enabling `trading-config/autoPaper` — observe `st_autopaper_ingest_complete` counts |

## Commands

```powershell
# unit tests
cd functions; npm run test:paper-trading

# prod dry-run (ADC required; read-only)
cd functions; npx tsx scripts/verify/paper-trading-auto-paper-918-ingest.ts [--runId <id>]
```

## Expected results

- `test:paper-trading`: all pass (includes the `runAutoPaperIngestFill`
  specs).
- Dry-run script: `=== ALL CHECKS PASSED ===` — prints the latest
  completed run's candidates and the would-be trades
  (`tradeId`, `signalId`, direction, sector). `new` vs `DEDUPED(exists)`
  reflects whether the trade doc already exists in `paper-trading/trades/items`.
