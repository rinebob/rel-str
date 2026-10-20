# UAT — #920 QA: BE auto-paper ingest (umbrella)

**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Signals Auto Paper Trade  
**Thread Slug:** signals-auto-paper-trade  
**Issue:** #920  
**Thread Parent:** #904  
**Topic Parent:** #553  
**Blueprint:** #914  
**Domain:** BE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-11  
**Last Updated:** 2026-10-16  

## Result: PASS — all ACs verified live

Executed 2026-10-11 (partial) + completed 2026-10-16. Umbrella QA over
#917/#918/#919 (all shipped, per-task QAs #938/#946/#956 all RESOLVED).
AC2's "noon run" phrasing is stale — #980 moved ingest to nightly-run
completion (manual dispatch also admitted).

## Scenarios

| # | Scenario | Evidence | Result |
|---|---|---|---|
| AC1 | All BE task ACs verified against live firestore | `test:paper-trading` 200/200 · `test:st-run-completion` 7/7 · `paper-trading-auto-paper-917-gates.ts` ALL CHECKS PASSED (prod ADC) · `paper-trading-auto-paper-918-ingest.ts` ALL CHECKS PASSED (prod dry-run: 156 candidates → 46 PRIMARY → barDate-keyed ids) | **PASS** |
| AC2 | One real nightly run produces stamped trades; dedupe holds on re-run | 2026-10-15: nightly `141834` `created=8`, second run `180423` `deduped=8` — zero dup docs. Trade `261015-sig-AMAT-EQV2S` verified: `signalId=AMAT_D_ST_TREND_RIDER_V2_SHORT_2026-10-15`, `captureList=PRIMARY`, sector/industry/capTier stamped, `governingVariant=trailing-8`, RH_MCP entry fill @430.38 + `rawQuoteRef`. 2026-10-16 nightly `141931` minted same-day | **PASS** |
| AC3 | Mark pass picks up auto trades; nightly trailing-8 eval sees them | `Signal mark pass: marked=155` every 30 min all day 10-15 · nightly `Signal EOD close pass stamped=155` → `Exit eval evaluated=162` (share+option), `stateUpdates=22` trailing ratchets | **PASS** |
| AC4 | Config flip to `lists:['*']` verified, then restored | Live 2026-10-16 21:31Z: `lists→['*']` → manual dispatch of `2026-10-16_fri_141931_nightly` → `ingest_start global:true lists:[]` → `created=54 deduped=10 quoteFailed=6` — all 54 new trades stamped `captureList='*'` → restored to `['PRIMARY','SECONDARY','MONITOR','NEW']` | **PASS** |

## Progress 2026-10-16 (AC2–4 closure)

1. **Trades minting live.** Nightly ingest runs fired 10-14/15/16 —
   `created=8` (14:18Z), `created=5` (18:04Z); `deduped=8` on the same-day
   second run proves the `{sym}_{type}_{barDate}` key.
2. **Downstream chain sees them.** Mark pass marks all signal trades
   (`marked=155`), the #983 EOD stamp writes official SDS closes, and the
   nightly eval pass evaluates all 162 signal-source trades under
   `trailing-8` (22 stop-state ratchets on 10-15; a real `closes=1` fired
   on an earlier eval).
3. **Global capture verified live.** Config flipped to `lists:['*']`, a
   manual dispatch minted 54 trades stamped `captureList='*'`
   (e.g. `261016-sig-COIN-EQV2S`, `261016-sig-WAB-EQV2S`), dedupe held
   (`deduped=10` — the 10 already-minted), config restored. The 54 are
   legitimate signal observations left in place, not test debris.

## Progress 2026-10-11 (deploy + config + live dispatch)

1. **Deploy landed** — `firebase functions:list` shows
   `stAutoPaperIngest` v2 taskQueue us-central1.
2. **Config seeded** — wrote
   `savant-trader/data/trading-config/autoPaper` =
   `{enabled: true, lists: ['PRIMARY'], ownerUid: 'wAFgZH9woJbZKFiYKUMVB9WWoNI3'}`
   (uid resolved from `wAFgZH9woJbZKFiYKUMVB9WWoNI3_PRIMARY`), read-back
   verified. Script: `scripts/verify/paper-trading-auto-paper-seed-config.ts`.
3. **Live dispatch verified** — enqueued Friday's payload
   (`{runId: 2026-10-09_fri_123229_pdr, marketDate: '2026-10-09',
   triggeredBy: 'manual'}`) via
   `scripts/verify/paper-trading-auto-paper-dispatch.ts`. Cloud logs show
   `st_autopaper_task_received` → `st_autopaper_skip
   reason=historical-run todayPT=2026-10-11` → `st_autopaper_task_done`.
   Proves: queue→function wiring, config read (passed the config gate),
   and the live-date gate — all on deployed infra.

## Remaining blockers — none (historical note)

On 2026-10-11 AC2–4 needed a live-date run; they were closed out on
2026-10-16 against real nightly runs + a manual dispatch (see Progress
2026-10-16). The restore note differed from this doc's original plan:
config is `['PRIMARY','SECONDARY','MONITOR','NEW']`, not `['PRIMARY']` —
the four-list scope is the intended production scope.
