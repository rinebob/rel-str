# UAT — #918 BE: auto-paper ingest fill (QA #946)

**Topic:** Paper Trading Infra  
**Topic Slug:** 553-paper-trading  
**Thread:** Signals Auto Paper Trade  
**Thread Slug:** signals-auto-paper-trade  
**Issue:** #946  
**Thread Parent:** #904  
**Topic Parent:** #553  
**Task:** #918  
**Domain:** BE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-11  
**Last Updated:** 2026-10-11  

## Result: PASS

Executed 2026-10-11 against the working tree (#918 diff on top of shipped
#917). Review doc:
`553-914-918-CODE-REVIEW-PAPER-TRADING-paper-trading-infra.md`.

## Scenarios

| # | Scenario | Command / Evidence | Result |
|---|---|---|---|
| 1 | Run-completion enqueue regression | `npm run test:st-run-completion` | **PASS** — 7/7 |
| 2 | Fill pipeline + paper-trading regression | `npm run test:paper-trading` | **PASS** — 197/197 (incl. 28 `runAutoPaperIngestFill` + `includeAutoPaper` specs) |
| 3 | Typecheck, touched files | `npx tsc --noEmit` filtered to touched paths | **PASS** — 0 errors (pre-existing `indicator-series-filter.ts` failures are another thread's work) |
| 4 | #917 gates regression vs prod | `npx tsx scripts/verify/paper-trading-auto-paper-917-gates.ts` (ADC) | **PASS** — ALL CHECKS PASSED; prod `autoPaper` doc still absent → `missing-config` skip verified live |
| 5 | Ingest dry-run vs real prod run | `npx tsx scripts/verify/paper-trading-auto-paper-918-ingest.ts` (ADC, read-only) | **PASS** — run `2026-10-09_fri_123229_pdr`: 156 candidates → 46 PRIMARY members → 5 sampled work items resolve to correct barDate-keyed `tradeId`/`signalId`, sector stamps present, 0 already exist |
| 6 | AC: OPEN 1-share trade, MARKET at live quote, trailing-8 ACTIVE governing | spec `creates one OPEN 1-share trade…` asserts fill role/price, dims `{SIGNAL, EQ, trailing-8, signalId}`, `underlyingClose`, `rawQuoteRef` | **PASS** |
| 7 | AC: all stamp fields persisted | same spec asserts `signalType/Timeframe/BarDate/Status/RunId/indicators/sector/industry/marketCapTier/captureList` via `tradeOverrides` whitelist | **PASS** |
| 8 | AC: V1+V2 → two trades; LONG+SHORT → both; new barDate → new trade | specs `same symbol V1+V2`, `tradeId is keyed on barDate` | **PASS** |
| 9 | AC: rerun → zero new trades **and zero quote calls**; concurrent-create → deduped | specs `dedupes on existing tradeId… burns no quote call`, `concurrent-create throw` | **PASS** |
| 10 | AC: per-symbol quote failure isolated, symbol named in log | spec `quote failure skips the symbol, others proceed` + `st_autopaper_quote_failed` event | **PASS** |
| 11 | AC: no RH order placement | structural — only `get_equity_quotes` is invoked through `callTool`; verified by contract review | **PASS** |
| 12 | Verify guide | `scripts/verify/paper-trading-auto-paper-918.md` + run-all.ts/README registered | **PASS** |

## Notes for ops

- Auto-paper remains **inert** until `savant-trader/data/trading-config/autoPaper`
  is written — intended shape `{ enabled: true, lists: ['PRIMARY'],
  ownerUid: '<uid>' }` (PRIMARY-list scope is the operating decision;
  `'*'` is a config-only escape hatch).
- Auto-paper trades (`userId: 'auto-paper'`) are excluded from
  `listPaperTrades` unless `includeAutoPaper: true` — the #921 surface
  opts in via that flag.
- Known deferrals to #919: stats-pass userId filtering so forensics
  trades don't roll into `stats-all`/`stats-var-*` (see review TN-2).
- Prod verify scripts need `NODE_OPTIONS=--require ipv4-only.cjs` (AT&T
  IPv6 ADC issue).
