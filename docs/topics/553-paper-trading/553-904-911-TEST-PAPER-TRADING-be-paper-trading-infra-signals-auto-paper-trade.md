# BE TEST — Signals Auto Paper Trade

**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Signals Auto Paper Trade  
**Thread Slug:** signals-auto-paper-trade  
**Issue:** #911  
**Thread Parent:** #904  
**Topic Parent:** #553  
**Domain:** PAPER-TRADING  
**Type:** Test Plan  
**Status:** Draft  
**Created:** 2026-10-08  
**Last Updated:** 2026-10-08  

Backend tests — deps-injected pass means fakes over Firestore/RH, matching
the `paper-stats-pass`/`signal-mark-pass` spec style. Command:
`cd functions && npx jest --coverage=false` (colocate under
`functions/src/paper-trading/` or wherever the existing pass specs live).

## Pass core (`runAutoPaperIngestPass`)

### Gates

- [ ] Config doc missing or `enabled: false` → zero reads past config,
      exit logged, no trades
- [ ] `lists: ['*']` admits every signaled symbol; `lists: ['PRIMARY']`
      excludes a non-member; symbol in SECONDARY-only is skipped
- [ ] `marketDate` ≠ today (PT) → historical-run skip, no trades, no
      quotes
- [ ] Custom `signalTypes` config overrides the default V1/V2 four

### Selection + filtering

- [ ] Only jobs with `createdOpportunity == true` are read
- [ ] Signal types outside the allowlist in the same run-ids doc are
      ignored; non-daily entries ignored
- [ ] PARTIAL run → still processes succeeded signals

### Trade creation

- [ ] Writes `paper-trading/trades/items/{id}` with: `source=SIGNAL`,
      `expression='EQ'`, `userId=auto-paper`, `order.side` matching signal
      direction, `quantity=1`, entry fill at the returned quote,
      `governingVariant='trailing-8'`, `variantKeys=['trailing-8']`,
      exactly one ACTIVE governing VariantRun
- [ ] Stamps present: `signalType`, `signalTimeframe='D'`,
      `signalBarDate`, `signalStatus`, `signalRunId`,
      `signalIndicators` (verbatim), `sector`, `industry`,
      `marketCapTier`, `captureList`
- [ ] `signalId` = `SYM_SIGNALTYPE_BARDATE`; tradeId desc = `EQ{V}{D}`
- [ ] Raw-quote audit doc written (`rq-` id pattern)

### Isolation semantics (the atomic-trade model)

- [ ] Two signals same symbol same day (V1_LONG + V2_LONG) → two trades,
      distinct tradeIds
- [ ] Same symbol LONG + SHORT signals → both trades created, no
      suppression
- [ ] Prior-day open position + today's same-type signal → new trade
      (different `barDate` ⇒ different tradeId/signalId)

### Dedupe + retry

- [ ] Re-running the pass with the same runId creates zero new trades
      (doc-existence dedupe)
- [ ] Partial failure mid-run → retry creates only the missing trades
      (idempotent)
- [ ] A manual same-day run with a different runId whose signal entry has
      the same `barDate`+`signalType` → deduped via identical
      signalId/tradeId (same day ⇒ same tradeId date component — verify:
      runId differs but tradeId doesn't depend on runId, so same-day
      re-run dedupes; document if a same-day *re-run firing the same
      signal* should instead open a second trade — PRD says one signal
      entry per day per type, so dedupe is correct)

### Quote failure

- [ ] Quote call throws for one symbol → that signal skipped, logged
      `st_autopaper_quote_failed`, other symbols still processed
- [ ] All quotes fail → zero trades, summary reflects it, no throw that
      would poison retries (or deliberate retry — match impl decision)

### Enqueue wiring

- [ ] `checkRunCompletion` enqueues `stAutoPaperIngest` once, only when
      `finalStatus` was set in the transaction (not on the no-op path,
      not on already-`completionProcessed`)
- [ ] Payload carries `runId`, `marketDate`, `triggeredBy`

## Stats pass

- [ ] `tradeScopes` on a fully-stamped auto trade → contains
      `sigtype-*`, `dir-*`, `sector-*`, `ind-*`, `captier-*`,
      `sigstatus-*` plus existing scopes
- [ ] Manual trade (no stamps) → scopes unchanged from today
- [ ] `runPaperStatsPass` end-to-end: mixed trades roll up under the new
      scopes with correct counts

## Boundary verification (no new code)

- [ ] Auto-papered trade doc satisfies `listOpenSignalTrades`'s filter
      shape (status OPEN, source SIGNAL) — assert the written doc passes
      the same predicate the mark pass queries
