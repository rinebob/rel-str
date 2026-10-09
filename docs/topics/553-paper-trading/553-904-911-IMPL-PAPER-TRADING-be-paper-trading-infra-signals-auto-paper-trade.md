# BE IMPL — Signals Auto Paper Trade

**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Signals Auto Paper Trade  
**Thread Slug:** signals-auto-paper-trade  
**Issue:** #911  
**Thread Parent:** #904  
**Topic Parent:** #553  
**Domain:** PAPER-TRADING  
**Type:** Implementation Plan  
**Status:** Draft  
**Created:** 2026-10-08  
**Last Updated:** 2026-10-08  

The ingest: run-completion enqueues a dedicated Cloud Task; the task turns
each qualifying persisted signal into an isolated 1-share paper trade at a
live RH quote, stamped with signal + symbol metadata. Marks/exit/stats are
existing infrastructure — zero changes there beyond the stats scope fan-out.

## Files

- `functions/src/st-cloud-function/run-progress.ts` — enqueue site
  (post-transaction `st_run_complete` block, ~line 152)
- `functions/src/common/st-collections.ts` — `AutoPaperConfig` type +
  `AUTO_PAPER_CONFIG_DOC` id const next to `ST_TRADING_CONFIG_COLLECTION`
- `functions/src/paper-trading/passes/auto-paper-ingest-pass.ts` — NEW,
  deps-injected pass core (mirrors `paper-stats-pass.ts` structure)
- `functions/src/paper-trading/auto-paper-ingest-task.ts` — NEW,
  `onTaskDispatched` function + prod deps wiring
- `functions/src/paper-trading/passes/paper-stats-pass.ts` — `tradeScopes`
  extension only
- `functions/src/paper-trading/ledger.ts` — `PaperTradeOverrides` Pick
  extension + verify existing-trade guard in `applyEntryFill`
- `functions/src/index.ts` — task export

## 1. Enqueue at run completion

In `RunProgressTracker.checkRunCompletion`, inside `if (finalStatus)` —
post-transaction, so a failed transaction never enqueues:

```ts
await getFunctions().taskQueue('stAutoPaperIngest').enqueue({
  runId: this.runId,
  marketDate: runData?.marketDate,
  triggeredBy: runData?.triggeredBy,
});
```

(Verify `StDailyRun` field names for `marketDate`/`triggeredBy`.) Enqueue
unconditionally on completion — gating lives in the task, keeping the
worker thin. Swallow enqueue errors like `createJobAndEnqueue` does for
the emulator.

## 2. `stAutoPaperIngest` task function

`onTaskDispatched` on its own queue — real memory/timeout (the RH MCP
session + ~100–200 quote calls won't fit the 60s symbol-worker budget;
use the same sizing as other quote-heavy tasks — verify existing
`onTaskDispatched` configs for the pattern).

Delegates to `runAutoPaperIngestPass(payload, deps)`.

## 3. `runAutoPaperIngestPass` — the pass

Deps-injected like `runPaperStatsPass`. Steps:

1. **Config gate.** Read `savant-trader/data/trading-config/autoPaper`:
   `{ enabled: boolean; lists: string[]; signalTypes?: string[] }`.
   Missing/disabled → log + exit. Default `signalTypes` const:
   `['D_ST_TREND_RIDER_V1_LONG','D_ST_TREND_RIDER_V1_SHORT',
     'D_ST_TREND_RIDER_V2_LONG','D_ST_TREND_RIDER_V2_SHORT']`.
2. **Live-date gate.** `payload.marketDate === todayPT()` (PT calendar —
   `normalizeMarketDate`/`pt-date-utils` pattern). Historical/replay runs
   exit with a `st_autopaper_skip` log (`reason: 'historical-run'`).
   PARTIAL runs proceed — succeeded signals are still valid.
3. **Candidate symbols.** Query `runs/{runId}/jobs` where
   `createdOpportunity == true` — no fan-out scans.
4. **List membership.** Symbol lists are **user-scoped**: docs live at
   `savant-trader/data/symbol-lists/{uid}_{KEY}` with `{key, symbols:
   string[], userId}`. Query `where('key','==',list)` (verified in prod:
   PRIMARY = `{ownerUid}_PRIMARY`, ~206 members). Multiple users could
   carry a `PRIMARY` — prefer a `ownerUid` field on the config doc; else
   first match + warn log.
5. **Per symbol:** read `savant-trader/data/symbols/{sym}/run-ids/{runId}`.
   **Prod-verified caveat:** signal entries are stored as *literal
   flattened top-level fields* `signals.{signalType}` (the `set(merge)`
   spread stores dotted keys literally — `data.signals` is undefined).
   Enumerate `Object.keys(data).filter(k => k.startsWith('signals.'))`,
   keep entries whose type ∈ `signalTypes` (V1+V2, long+short only).
   Defensive: also merge `Object.values(data.signals ?? {})` — the
   FE `signal.service.ts` reader already tolerates both shapes, and
   backfill-produced docs (e.g. signal-history) store a nested map.
   **Discovery (review #916):** `stSignalHistory` callable
   (`dashboard-callables.ts:174`) reads `d.signals` only — likely
   returning empty against flattened prod docs. Pre-existing;
   needs its own fix (writer, interface, or reader) outside #916.
6. **Per qualifying signal:**
   a. `signalId = SYMBOL_SIGNALTYPE_BARDATE`; `tradeId =
      buildTradeId(now, 'sig', sym, signalTradeDesc(signalType))`.
      `getTrade(tradeId)` → exists ⇒ skip (dedupe).
   b. **RH quote** — `get_equity_quotes` via `executeObservationTool`
      inside `createRobinhoodMcpSessionManagerFromEnv` session (same seam
      `netExitBreakdown`/`signal-mark-pass` uses). Batch request per run
      if the tool accepts a symbol array — verify at impl; else loop.
   c. Read the `savant-trader/data/symbols/{sym}` doc → `sector`,
      `industry`, `marketCapTier` (prod-verified: overview fields live on
      the symbols doc — sector values are UPPERCASE, e.g. 'TECHNOLOGY';
      the `symbol-meta` path in `st-collections.ts`'s comment is stale).
   d. **`applyEntryFill`** — `userId: AUTO_PAPER_USER_ID`, order
      `{side, type: 'MARKET', quantity: 1}`, one share leg
      `{kind:'share', side, quantity:1, multiplier:1, entryMark:quote,
      lastMark:quote}`, fill `{role:'entry', price:quote, quantity:1,
      quoteSource: OptionQuoteSource.RH_MCP}`, dims `{source: SIGNAL,
      symbol, expression: 'EQ', governingVariant: 'trailing-8',
      variantKeys: ['trailing-8'], signalId}`, `tradeOverrides` = the
      stamp fields (SHARED IMPL §1). Write raw-quote audit doc
      (`rq-` builder) matching the mark-pass habit.
   e. **Quote failure** → log `st_autopaper_quote_failed` with
      `{symbol, signalType}`, skip. No trade ⇒ next same-day run retries
      naturally (self-healing, PRD decision).
7. **Existing-trade race.** Deterministic tradeId means a same-day
   concurrent completion could double-write. Verify `applyEntryFill`'s
   txn behavior on existing tradeId; if it blindly overwrites, add an
   early-return inside `deps.transact` (`getTrade` → exists ⇒ no-op).
   This is the one place ledger code may need a guard — keep it a small
   additive check, not a refactor.
8. Summary log `st_autopaper_ingest_complete` — `{runId, candidates,
   created, deduped, quoteFailed, filtered}`.

**Retry safety:** task-level retries hit step-6a dedupe — already-created
trades skip; only failed/remaining signals process. Idempotent.

## 4. Stats scope fan-out

`paper-stats-pass.ts` `tradeScopes`: after existing pushes, add

```ts
if (trade.signalType)      scopes.push(statsScopeSignalType(trade.signalType));
                           scopes.push(statsScopeDirection(trade.order.side));
if (trade.signalStatus)    scopes.push(statsScopeSignalStatus(trade.signalStatus));
if (trade.sector)          scopes.push(statsScopeSector(trade.sector));
if (trade.industry)        scopes.push(statsScopeIndustry(trade.industry));
if (trade.marketCapTier)   scopes.push(statsScopeCapTier(trade.marketCapTier));
```

Existing nightly `runPaperStatsPass` recomputes them — no scheduling work.

## 5. Daily-cycle integration (no new code)

- Intraday `runSignalMarkPass` marks all OPEN `source=SIGNAL` trades —
  auto-papered included.
- Nightly `runExitEvalPass` fires `trailing-8` on last available mark
  (~1 PM PT live quote — **last-mark semantics, not official close**;
  PRD-noted).
- `runSignalSettlementPass` skips share-only trades.
- `runPaperStatsPass` rolls up the new scopes.

## Operational notes

- Dedicated `acct-auto-paper` doc self-creates on first fill via
  `baseAccount` — account cash will go negative (ceremony; % return is
  the metric). Expected, not a bug.
- RH is quote-only — no order placement anywhere in this path.
- If the SDS nightly chain stalls, marks/eval/stats stall — same
  dependency the nightly debugging work is fixing. Note in UAT.
