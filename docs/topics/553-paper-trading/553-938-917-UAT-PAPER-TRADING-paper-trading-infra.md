**Topic:** Paper Trading Infra  
**Topic Slug:** 553-paper-trading  
**Thread:** Signals Auto Paper Trade  
**Thread Slug:** signals-auto-paper-trade  
**Issue:** #938  
**Thread Parent:** #904  
**Topic Parent:** #553  
**Blueprint:** #914  
**Task:** #917  
**Domain:** BE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-09  
**Last Updated:** 2026-10-09  

# UAT — #917: enqueue + task skeleton + gates

QA issue #938 against the #917 acceptance criteria. Executed 2026-10-09 on
the working tree (uncommitted). **Result: PASS.**

## Results log

| # | Scenario | Evidence | Result |
|---|---|---|---|
| 1 | Enqueue exactly-once on finalStatus only | `npm run test:st-run-completion` — 7/7: missing run / in-flight jobs / `completionProcessed` already claimed all return `undefined` (no writes, no enqueue); SUCCESS and PARTIAL both produce a completion result | PASS |
| 2 | Payload carries `runId`, `marketDate`, `triggeredBy` | Same suite — completion result carries `marketDate`/`triggeredBy`; `runId` from the tracker; `enqueueAutoPaperIngest` types the literal as `AutoPaperIngestPayload` | PASS |
| 3 | Missing/disabled config → clean exit, no candidate reads | `auto-paper-ingest-pass.test.ts` — `missing-config` / `disabled` skips; no selection code exists past the gates. Prod verify: real `autoPaper` doc absent → `skipped/missing-config` end-to-end | PASS |
| 4 | Historical `marketDate` → skip, no quotes/trades | Tests cover stale date + absent `marketDate`; prod verify confirms `st_autopaper_skip` with `reason` logged | PASS |
| 5 | `lists: ['*']` admits all (config-only) | Scope tests + verify script — `global: true`, empty list set | PASS |
| 6 | Task exported and registered | `index.ts` exports `stAutoPaperIngest`; verify script asserts the `onTaskDispatched` function object exists | PASS |
| 7 | Typecheck | `npx tsc --noEmit` clean on all touched files (pre-existing unrelated errors in `indicator-series-filter.ts` — another thread's `TRIGGER_BANDS` work) | PASS |
| 8 | Regression — paper-trading suite | `npm run test:paper-trading` — 179/179 | PASS |

Extra gate coverage landed during review: `empty-scope` skip for an
enabled config with no capture lists (incl. malformed non-array `lists`),
and `st_autopaper_enqueue_failed` logging at error in prod / warn in
emulator.

## Ops note

Auto-paper is **inert until** `savant-trader/data/trading-config/autoPaper`
is written — verified live: prod has no doc → `missing-config` skip. The
Firebase emulator does not run Task queues; first-live-dispatch
observability is `st_autopaper_task_received` / `st_autopaper_skip` logs.

## Known carry-overs (not blockers)

- Worker retry can double-count `successCount`/`failureCount` →
  premature completion → early enqueue with a partial signal set.
  Pre-existing (#917 review T5); flagged on the BE IMPL for #918.
- A prod enqueue failure leaves `st_autopaper_enqueue_failed` as the only
  trail (no durable retry marker) — accepted trade-off documented in the
  CODE-REVIEW.
