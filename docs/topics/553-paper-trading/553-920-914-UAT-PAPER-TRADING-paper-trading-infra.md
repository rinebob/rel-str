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
**Status:** Partial  
**Created:** 2026-10-11  
**Last Updated:** 2026-10-11  

## Result: PARTIAL — AC1 PASS, AC2–4 BLOCKED

Executed 2026-10-11. Umbrella QA over #917/#918/#919 (all shipped, per-task
QAs #938/#946/#956 all RESOLVED).

## Scenarios

| # | Scenario | Evidence | Result |
|---|---|---|---|
| AC1 | All BE task ACs verified against live firestore | `test:paper-trading` 200/200 · `test:st-run-completion` 7/7 · `paper-trading-auto-paper-917-gates.ts` ALL CHECKS PASSED (prod ADC) · `paper-trading-auto-paper-918-ingest.ts` ALL CHECKS PASSED (prod dry-run: 156 candidates → 46 PRIMARY → barDate-keyed ids) | **PASS** |
| AC2 | One real noon run produces stamped trades; dedupe holds on re-run | Live task path verified (below); trade creation awaits a live-date run | **PARTIAL** |
| AC3 | Mark pass picks up auto trades; nightly trailing-8 eval sees them | — | **BLOCKED** (no trades yet) |
| AC4 | Config flip to `lists:['*']` verified, then restored | — | **BLOCKED** (needs live-date run) |

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

## Remaining blockers

AC2's trade creation, AC3, and AC4 all require a run whose
`marketDate === todayPT`. Today is Sunday 2026-10-11 PT — the next
eligible completion is the next trading day's run (expected Monday
2026-10-12). Dispatching a payload with a faked same-day marketDate
would stamp trades with a wrong bar date; deliberately not done.

## Unblock path (next trading day)

1. The daily run completes → `enqueueAutoPaperIngest` fires with
   `marketDate === todayPT` → trades created with stamps.
2. Re-dispatch the same payload → verify `deduped`/already-exists path,
   no new docs.
3. Confirm mark pass values the OPEN auto trades + nightly `trailing-8`
   eval sees them.
4. Flip `lists: ['*']`, confirm global capture on the following run,
   restore `["PRIMARY"]`.
