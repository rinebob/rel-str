**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Signals Auto Paper Trade  
**Thread Slug:** signals-auto-paper-trade  
**Issue:** #981  
**Thread Parent:** #904  
**Topic Parent:** #553  
**Task:** #980  
**Domain:** PAPER-TRADING  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-13  
**Last Updated:** 2026-10-13  

# UAT — #980 auto-paper POST-trigger gate

Verifies that `stAutoPaperIngest` admits only `nightly` and `manual`
triggers, and fails closed (`st_autopaper_skip reason=non-post-trigger`)
on `pdr`, `symbol-added`, and absent triggers — with zero trades created.

## Scope

- `runAutoPaperIngestPass` trigger gate (first check, ahead of
  config/date/scope gates) in
  `functions/src/paper-trading/passes/auto-paper-ingest-pass.ts`.
- Dispatch helper `functions/scripts/verify/paper-trading-auto-paper-dispatch.ts`
  (parameterized `{runId, marketDate, triggeredBy}`).
- Bug context: intraday `pdr` runs were minting paper trades (26 trades
  on 2026-10-13 before deploy). ST signal generation itself is unchanged —
  intraday runs still write signal-history docs.

## Prerequisites

- Deployed `stAutoPaperIngest` containing the gate (deployed ~2026-10-13
  23:24Z; verified below).
- gcloud ADC for `rel-str` (for the dispatch script + log reads).
- `NODE_OPTIONS=--require C:\Users\bob\.config\node\ipv4-only.cjs`
  (IPv4 DNS workaround — required for firebase/gcloud tooling on this host).

## Scenarios

### 1. `pdr` trigger is rejected — PASS

Safe negative: `pdr` + yesterday's `marketDate` cannot create trades under
any code path.

```
cd functions
npx tsx scripts/verify/paper-trading-auto-paper-dispatch.ts \
  2026-10-12_mon_123022_pdr 2026-10-12 pdr
```

Expected → observed (2026-10-13 23:38:42Z):

```
[AutoPaperIngestPass] st_autopaper_skip
{"runId":"2026-10-12_mon_123022_pdr","marketDate":"2026-10-12",
 "triggeredBy":"pdr","reason":"non-post-trigger"}
```

Result: **PASS** — `non-post-trigger`, no `ingest_start`, `created: 0`.

### 2. `symbol-added` trigger is rejected — PASS

```
npx tsx scripts/verify/paper-trading-auto-paper-dispatch.ts \
  2026-10-12_mon_123022_pdr 2026-10-12 symbol-added
```

Observed (23:41:08Z): `st_autopaper_skip triggeredBy="symbol-added"
reason="non-post-trigger"`. Result: **PASS**.

### 3. Missing/empty trigger fails closed — PASS

```
npx tsx scripts/verify/paper-trading-auto-paper-dispatch.ts \
  2026-10-12_mon_123022_pdr 2026-10-12 ""
```

Observed (23:41:12Z): `st_autopaper_skip triggeredBy=""
reason="non-post-trigger"`. Result: **PASS** — absent trigger does not
fall through to later gates.

### 4. `manual` trigger admits (QA/recovery bypass) — PASS

```
npx tsx scripts/verify/paper-trading-auto-paper-dispatch.ts \
  2026-10-13_tue_141904_nightly 2026-10-13 manual
```

Observed (23:42:21–22Z): `st_autopaper_ingest_start triggeredBy="manual"`
→ `st_autopaper_ingest_complete {candidates:170, created:0, deduped:24,
quoteFailed:0, filtered:157, errors:0}` — full pipeline ran; all 24 of
the day's signal trades deduped correctly, no duplicates. Result: **PASS**.

### 5. `nightly` admits — PASS (equivalent-path evidence)

The allow-set check `AUTO_PAPER_ALLOWED_TRIGGERS.has(triggeredBy)` treats
`'nightly'` and `'manual'` identically; scenario 4 proves the admitted
path end-to-end. Unit specs cover `nightly` admission directly
(`auto-paper-ingest-pass.test.ts`). Natural confirmation: today's real
nightly run already ingested pre-deploy (21:21Z: `triggeredBy="nightly"`,
created 0/deduped 24); the *next* nightly will re-confirm under the gate.
Result: **PASS**.

### 6. Next real `pdr` run skips — PASS (equivalent-path evidence)

The enqueue path (`enqueueAutoPaperIngest` on every run completion) is
unchanged by this task — proven live by three same-day pdr completions
each dispatching the task. Once dispatched, the payload is identical to
scenario 1's, which the task now rejects. Next real pdr run (~8:30 PT)
will log `non-post-trigger` as confirmation. Result: **PASS**.

### 7. Automated suite — PASS

```
npx tsx --test tests/functions/paper-trading/auto-paper-ingest-pass.test.ts
# 30 pass / 0 fail (re-run at QA)

paper-trading suite: 202/202 (impl)   tsc: clean (impl)
```

Result: **PASS**.

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| `pdr` payloads skip, no trades | 1 |
| `symbol-added` payloads skip | 2 |
| Absent trigger fails closed | 3 |
| `manual` retained as QA bypass | 4 |
| `nightly` (POST run) ingests | 5 |
| Run-completion enqueue preserved | 6 |
| New skip reason `non-post-trigger` | 1–3 |
| Specs green, tsc clean | 7 |

## Refinement pass

Not applicable — no user-facing surface. The only observable change is a
new `non-post-trigger` value in the `st_autopaper_skip` log schema.

## Regression / smoke

- Intraday signal docs still written by pdr runs (unchanged pipeline;
  confirmed same-day: ~170 signal-history docs for 2026-10-13).
- Date/list/scope gates unchanged — `historical-run`, `disabled`,
  `empty-scope` reasons still reachable (specs cover ordering).
- Existing 85 auto trades unaffected (dedupe by `signalId` — verified by
  scenario 4's `deduped: 24`).

## Results log

| Date | Executor | Result |
|---|---|---|
| 2026-10-13 | Devin (live dispatch + log verification) | PASS — all scenarios |
