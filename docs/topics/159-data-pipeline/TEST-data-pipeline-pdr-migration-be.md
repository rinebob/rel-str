**Topic:** Refactor data pipeline to PDR-driven triggers, consolidate local bar store writers, and migrate charts to local reads  
**Issue:** #161  
**Topic Parent:** #159  
**Domain:** DATA-PIPELINE  
**Type:** Test Plan  
**Status:** Draft  
**Created:** 2026-08-23  
**Last Updated:** 2026-08-23  

---

# Test Plan: BE — Data Pipeline PDR Migration

## E2E User Journeys

- **Journey 1:** SA publishes POST A DAILY PDR → SDS fetches DAILY, writes daily shards + currentPrice. SA publishes POST A WEEKLY → SDS fetches WEEKLY, writes weekly doc. SA publishes POST A MONTHLY → SDS fetches MONTHLY, writes monthly doc. All 3 interval runs complete → sequence fan-in fires → selection, settlement, RH Agent nightly tasks enqueue.
- **Journey 2:** SA publishes intraday PRE PDR → SDS bulk fetches via callPartnerIntradaySnapshotV2, writes intraday docs + currentPrice for all symbols → completion fires → RH Agent intraday task enqueues.
- **Journey 3:** SA publishes POST B DAILY/WEEKLY/MONTHLY PDRs with includeSymbols → SDS syncs only those symbols per interval → all 3 complete → sequence fan-in fires → settlement + RH Agent scoped retries enqueue.
- **Journey 4:** No POST A arrives by 3 PM PT → fallback timer creates 3 interval runs + sequence doc → all 3 complete → sequence completion fires.
- **Journey 5:** Open pass timer fires every 5 min from 6:30 AM to 1 PM PT. At the 09:30 tick, queries instances with openTimePT="09:30" → runs open pass for matching instances only. Other ticks with no matching instances are no-ops.

## Integration Tests

- **SDS subscriber + PDR message parsing:** verify correct symbol set resolution for POST A (all minus excludeSymbols, per-interval), POST B/C (includeSymbols only, skip if empty), intraday (all tracked)
- **Per-interval processing:** verify DAILY message fetches DAILY and writes daily shard + currentPrice; WEEKLY fetches WEEKLY and writes weekly doc only (no currentPrice); MONTHLY fetches MONTHLY and writes monthly doc only (no currentPrice)
- **A vs B/C distinction:** verify SDS correctly identifies A runs (excludeSymbols present) vs B/C runs (includeSymbols present) despite all having `runType=ts-post-all-intervals`
- **SDS worker + SA fetch + Firestore write:** verify POST DAILY writes daily shard with `set({ merge: true })` and `currentPrice`; verify intraday PRE bulk fetches via callPartnerIntradaySnapshotV2 and writes intraday doc + currentPrice
- **Sequence fan-in:** verify 3 interval runs for a POST sequence trigger sequence completion only when all 3 report; verify failed symbols are merged across intervals
- **Completion + downstream enqueue:** verify sequence completion callback enqueues separate Cloud Tasks for each consumer; verify `completionEnqueued` flag set only after all enqueues succeed
- **Watchdog + stale run forcing:** verify watchdog forces per-interval completion for runs older than 15 min; verify watchdog forces sequence completion for sequences older than 20 min; verify watchdog retries enqueue for `completed_but_not_dispatched` runs/sequences
- **Fallback timer + race prevention:** verify fallback skips if any POST A sequence (processing or completed) exists for today's marketDate; verify fallback creates 3 interval runs + sequence doc
- **Open pass timer + instance query:** verify 5-minute slot computation (09:32 → "09:30"); verify Firestore query returns only matching instances
- **PDRv2 isolation:** verify PDRv2 continues to fetch from SA and write to pairs-data independently; verify currentPrice side-effect is removed

## Unit Tests

- **Pure functions:**
  - Symbol set resolution (POST A/B/C/intraday) from PDR attributes
  - 5-minute slot truncation (09:32 → "09:30", 09:35 → "09:35", 09:59 → "09:55")
  - Idempotency check logic (existing terminal run → skip)
  - Fallback race condition check (existing processing/completed run → skip)

- **Services:**
  - SDS task worker: mock SA fetch, verify Firestore writes (POST vs intraday paths)
  - Intraday writer: verify doc shape and field values
  - Completion callback: mock Cloud Task enqueue, verify per-consumer task creation
  - Watchdog: mock stale run docs, verify forced completion and enqueue retry

- **Utils:**
  - `checkSyncRunCompletion` transaction logic
  - Run doc field tracking (processedCount, successCount, failedCount, failedSymbols)

## Test Seams

- **Highest seam:** SDS subscriber function — test with mock Pub/Sub message and mock Firestore
- **Medium seam:** SDS task worker — test with mock SA API and real Firestore emulator
- **Lower seam:** completion callback — test with mock Cloud Task enqueue
- **Lowest seam:** pure functions (slot computation, symbol set resolution) — no mocks needed

## Existing Test Coverage

- `tests/functions/options-strategy-engine/` — pass orchestration patterns (selection, settlement, open pass)
- `tests/functions/` — scheduled function behavior patterns
- `tests/functions/options-strategy-engine/held-shares-pass.test.ts` — settlement pass test structure
- `tests/functions/options-strategy-engine/open-pass.test.ts` — open pass test structure
- Gaps: no existing tests for SDS, completion signal, watchdog, or fallback timer

## Edge Cases

- **Duplicate PDR message:** SDS receives same runId twice → idempotency check skips second
- **Per-interval symbol divergence:** a symbol is in excludeSymbols for DAILY but not for WEEKLY → DAILY run skips it, WEEKLY run syncs it. Sequence completion merges failed symbols across intervals.
- **Empty includeSymbols on POST B/C:** B/C message with no includeSymbols → SDS records the run but enqueues 0 tasks, interval completion fires immediately
- **POST C with permanentFailures:** C message with `runStatus=completed_with_errors` and `permanentFailures > 0` → SDS syncs includeSymbols, failed symbols are not in includeSymbols and won't be synced
- **All tasks fail for one interval:** DAILY run has 0 success, 863 failed → interval completion still fires, sequence fan-in proceeds when other intervals complete
- **Only 2 of 3 intervals arrive:** WEEKLY and MONTHLY messages arrive but DAILY is lost → watchdog forces sequence completion after 20 min with 2/3 intervals
- **Hung task:** worker crashes after fetch, before incrementing → watchdog forces per-interval completion after 15 min
- **Completion enqueue failure:** GCP quota exceeded → sequence stays `completed_but_not_dispatched` → watchdog retries
- **Fallback + PDR race:** POST A DAILY arrives at 2:59 PM, fallback fires at 3:00 PM → fallback sees processing sequence, skips
- **Year boundary:** 30-day window spans Dec→Jan → SDS writes to both year shards (DAILY POST run)
- **Intraday doc missing on POST run:** no intraday run happened today → POST run writes year shards, intraday doc doesn't exist (RH Agent reads stale intraday doc from previous day or handles missing)
- **Open pass with no matching instances:** no instances have openTimePT matching current slot → timer tick is a no-op
