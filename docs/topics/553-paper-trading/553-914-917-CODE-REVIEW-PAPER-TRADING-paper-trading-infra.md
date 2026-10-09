**Topic:** Paper Trading Infra  
**Topic Slug:** 553-paper-trading  
**Thread:** Signals Auto Paper Trade  
**Thread Slug:** signals-auto-paper-trade  
**Issue:** #917  
**Thread Parent:** #904  
**Topic Parent:** #553  
**Blueprint:** #914  
**Domain:** BE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-09  
**Last Updated:** 2026-10-09  

# Code Review — #917: enqueue + task skeleton + gates

Three axes (Standards / Spec / Thermo-Nuclear) over the #917 working-tree
diff. Verdict: **PASS after fixes** — no majors, all actionable findings
applied and re-verified.

## Result: PASS

## Findings and dispositions

### Thermo-Nuclear

| # | Severity | Finding | Disposition |
|---|---|---|---|
| T1 | MINOR | Enqueue failure silently absorbed: rethrow landed in `checkRunCompletion`'s outer catch → mislabeled `st_run_completion_error`, run stays `completionProcessed` with no ingest and no recovery | **Fixed** — removed the dead rethrow (rethrowing would retry the symbol task and double-count run counters); failure now logs `st_autopaper_enqueue_failed` at **error** in prod, **warn** in emulator (task queue routinely absent there) |
| T2 | MINOR | Commit-succeeded/response-lost edge — same blast radius as T1 | **Accepted** — documented; same log signal covers it |
| T3 | MINOR | `config.lists.includes` TypeError on malformed doc → burns all 3 retries | **Fixed** — `Array.isArray` guard + new `empty-scope` skip |
| T4 | MINOR | Midnight-straddle: post-PT-midnight dispatch skips a legitimate live run | **Documented in code** — correct by design: next-day ingest would price yesterday's signals off today's quotes |
| T5 | MINOR | Pre-existing worker double-count (`markComplete` on FAILED+rethrow retries) can flip completion early — ingest then sees a partial signal set | **Flagged for #918** — pre-existing, not introduced here; noted on the BE IMPL |
| T6 | NIT | `deps.todayPT()` invoked twice | **Fixed** — captured once |
| T7 | NIT | `lists: []` → silent no-op 'ready' | **Fixed** — `empty-scope` skip reason |
| T8 | NIT | Logger convention: pass used firebase logger; sibling passes use `createLogger` | **Fixed** — `createLogger('AutoPaperIngestPass')` + `logEvent` helper preserving structured fields |
| T9 | NIT | `RunCompletionTx` seam is sound; untyped refs acceptable | Accepted |

Verified correct: txn-retry closure semantics (last invocation's result
wins, commit is atomic to it), single-writer race intact, undefined
payload fields drop cleanly to the `historical-run` skip, emulator-swallow
parity.

### Standards

| Finding | Disposition |
|---|---|
| Dead rethrow (same as T1) | Fixed |
| `createLogger` convention broken | Fixed |
| Unguarded `lists` | Fixed |
| Untyped enqueue payload literal | **Fixed** — `const payload: AutoPaperIngestPayload` |
| Duplicate `st-collections` import statements | **Fixed** — merged |
| `test:st-run-completion` script placement | **Fixed** — grouped with test scripts |

Verified clean: queue name matches export; `onTaskDispatched` options
shape matches `worker.ts`; `AUTO_PAPER_CONFIG_DOC` reuses the anchored
`trading-config` collection (no new root); tests follow `node:test` +
`assert`; run-all.ts registration correct.

### Spec

| Finding | Disposition |
|---|---|
| Enqueue-lost-on-failure (same as T1) | Fixed |
| Malformed-config crash (same as T3) | Fixed |
| `AutoPaperConfig.ownerUid` only serves #918 | **Kept** — plan §3 prescribes it; harmless config surface |
| Task header claimed dedupe that lands in #918 | **Fixed** — comment reworded |
| Premature-completion via counter double-count (same as T5) | Flagged for #918 |

Verified against ACs: exactly-once on finalStatus only ✓; payload
`{runId, marketDate, triggeredBy}` ✓; missing/disabled config → skip, no
candidate reads ✓; historical marketDate → skip ✓; `lists:['*']` →
global capture, config-only ✓; task exported + registered ✓; PARTIAL
runs proceed ✓; signalTypes default = 4 daily trend-rider types ✓;
512MiB/300s mirrors `expression-fill-pass` sizing ✓. No #918 leakage
(no candidate reads, quotes, or ledger calls).

## Post-fix verification

- `test:paper-trading` — **179 pass / 0 fail** (incl. 2 new `empty-scope` tests)
- `test:st-run-completion` — **7/7**
- `tsc --noEmit` — clean on all touched files (pre-existing unrelated
  errors in `indicator-series-filter.ts` from another thread's
  `TRIGGER_BANDS` work)
- `paper-trading-auto-paper-917-gates.ts` (prod ADC) — **ALL CHECKS PASSED**

## Deferred / reported not fixed

- **Worker retry double-count** (T5): `worker.ts:152` marks FAILED then
  rethrows for task retry → `successCount+failureCount` can reach `total`
  while jobs are in flight → completion claims early → auto-paper would
  ingest an incomplete signal set. Pre-existing; #918's selection step
  should tolerate this or the counter should be fixed first.
- **Lost-ingest observability** (T1/T2): a prod enqueue failure leaves
  `st_autopaper_enqueue_failed` as the only trail. If loss matters, a
  durable retry marker could come later — accepted for now.
