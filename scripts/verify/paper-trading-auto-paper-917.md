# Verification — #917 BE: auto-paper enqueue + task skeleton + gates

**Topic:** #553 Paper Trading Infra
**Thread:** #904 Signals Auto Paper Trade
**Task:** #917 — Enqueue + task skeleton + gates

## What this verifies

The orchestration layer for auto-paper ingest — everything that decides
*whether* an ingest runs, before any quote/ledger work (#918):

1. **Enqueue seam** — `RunProgressTracker.checkRunCompletion` enqueues
   `stAutoPaperIngest` exactly once, post-transaction, only when
   `evalRunCompletion` claims the final-status write. Payload:
   `{ runId, marketDate, triggeredBy }`.
2. **Task registration** — `stAutoPaperIngest` defined via
   `onTaskDispatched` and exported from `functions/src/index.ts`.
3. **Config gate** — `savant-trader/data/trading-config/autoPaper`
   missing or `enabled:false` → `st_autopaper_skip`, no further work.
4. **Live-date gate** — `marketDate ≠ today PT` →
   `st_autopaper_skip { reason: 'historical-run' }`. PARTIAL runs proceed.
5. **Scope** — `lists:['*']` → global capture (config-only flip);
   `signalTypes` defaults to the four daily trend-rider types.

## Coverage split

| Behavior | Covered by |
|---|---|
| Enqueue exactly-once, payload fields, PARTIAL included | `tests/functions/st-run-completion.test.ts` (fake-transaction unit tests on `evalRunCompletion` — the enqueue call site is gated on its non-undefined return) |
| Config/date gates, `'*'` global, default allowlist | `tests/functions/paper-trading/auto-paper-ingest-pass.test.ts` |
| Task export, config doc id/path, gates vs. real prod config doc | `functions/scripts/verify/paper-trading-auto-paper-917-gates.ts` (needs ADC; read-only; run from `functions/`) |
| End-to-end enqueue → dispatch → skip | Emulator smoke after first deploy (Firebase emulator doesn't run Task queues — observe `st_autopaper_task_received`/`st_autopaper_skip` logs on the first real run) |

## Commands

```powershell
# unit tests
cd functions; npx tsx --test ../tests/functions/st-run-completion.test.ts
cd functions; npm run test:paper-trading   # includes auto-paper-ingest-pass.test.ts

# prod gate check (ADC required; read-only)
cd functions; npx tsx scripts/verify/paper-trading-auto-paper-917-gates.ts
```

## Expected results

- Both unit suites: all tests pass.
- Gates script: `=== ALL CHECKS PASSED ===`. While no `autoPaper` config
  doc exists in prod, the expected gate result is
  `skipped / missing-config` — that *is* the pass condition.
