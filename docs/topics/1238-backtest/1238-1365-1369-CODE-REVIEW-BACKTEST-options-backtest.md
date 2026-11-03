**Topic:** Options Backtest  
**Topic Slug:** options-backtest  
**Thread:** Backtest Analytics  
**Thread Slug:** backtest-analytics  
**Issue:** #1365  
**Thread Parent:** #1266  
**Topic Parent:** #1238  
**Task:** #1369  
**Domain:** BACKTEST  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-02  
**Last Updated:** 2026-11-02  

# Code Review — #1369 optionsReplayRetry callable

**Verdict:** **PASS** (fail-as-submitted → remediated in-cycle; all findings closed)  
**Test gate:** jest full suite **287 suites / 4,963 tests PASS**; `tsx --test` retry+permutation specs **28/28**; functions `tsc --noEmit` + esbuild clean.

Three axes run in parallel per review protocol. Findings are consolidated here.

---

## Thermo-Nuclear (deep structural review)

Round 1 found **1 critical + 3 majors** — all real, all remediated in-cycle.

| # | Finding | Disposition |
|---|---|---|
| TN-C1 | **Non-transactional check-then-act on `listOutcomes`** — two concurrent retries both decrement `failedLists` → counters go negative → `completed+failed >= total` never holds → run hangs `'running'` with no recovery through this API | **FIXED** — `resetRunForRetry` is now a transaction that re-reads the run doc, deletes only entries still `=== 'failed'`, and decrements by the count actually removed; it returns the symbols actually reset, and the core returns `{retriedSymbols:[]}` + enqueues nothing when the set is empty (concurrent claim collapses to a no-op). |
| TN-M1 | **Partial-enqueue failure orphans un-enqueued symbols** — outcomes already deleted, no task → `pending` docs invisible to any later retry | **FIXED** — enqueues run via `Promise.allSettled`; `failRun` now restores `listOutcomes.{symbol}:'failed'` + re-increments `failedLists` for the rejected set (transactional, skips symbols that already re-resolved). |
| TN-M2 | **No `timeoutSeconds`** — sequential fanout could die mid-enqueue before `failRun` → same hung-run end-state | **FIXED** — `timeoutSeconds: 300` on the callable + parallel fanout (`Promise.all` list resets, `allSettled` enqueues). |
| TN-M3 | **Dotted tickers (`BRK.B`)** — `listOutcomes.${symbol}` dot-path writes nested maps while the idempotence guard reads literal keys → double-count on redelivery (pre-existing worker defect retry inherits); dotted symbols also invisible to retry | **FIXED** — whole-map writes inside both transactions (`closeOutList` in `permutation.ts` and `resetRunForRetry`/`failRun` in `retry.ts`) — literal keys preserved end-to-end; no field-path writes remain. |
| TN-m1 | Stale in-flight delivery can resolve a retried symbol before the new task — convergent but `retriedSymbols` over-reports | **ACCEPTED + documented** in the file header. |
| TN-m2 | `start.ts`-fanout-failed runs (no outcomes recorded) are unrecoverable via retry | **ACCEPTED** — out of scope ("failed list docs"); noted for a possible follow-on. |
| TN-m3/m4/nits | Corrupt-doc `templateId`/`startDate` → worker `failPermanently` (graceful); doc-success/outcome-failed drift → wasteful re-run; `.update()` raw throw; unvalidated status cast | **ACCEPTED** — convergent/edge; consistent with sibling posture. |

## Standards

**Verdict: PASS** — sibling-consistent seams, error codes, and test conventions.

| # | Finding | Disposition |
|---|---|---|
| S-1 | `Math.max(single-arg)` + overclaiming ordering comment in spec | **FIXED** — max over all `reset*` entries; assertion wording corrected. |
| S-2 | Header omitted the `generatedAt` delete + run-reset clears | **FIXED** — header now describes full reset surface. |
| S-3 | `ReplayRetryRunView` hand-rolled vs `Pick<>` convention | **FIXED** — now `Pick<OptionsReplayRun, …>`. |

## Spec

**Verdict: PASS — spec-conformant.** All 4 ACs verified; reset ordering confirmed load-bearing; response contract deterministic (sorted).

| # | Finding | Disposition |
|---|---|---|
| SP-1 | Partial-fanout orphan state (same as TN-M1) | **FIXED** |
| SP-2 | Concurrent-retry counter race (same as TN-C1) | **FIXED** |
| SP-3 | Prod-wiring payloads untested (increment/dot-path/FieldValue.delete()) | **ACCEPTED** — deps-seam posture matches `start.test.ts`; prod wiring is thin and now partially de-risked by the whole-map rewrite. |
| SP-N | `'cancelled'` no-op beyond IMPL; `Math.max` single-arg; dotted-field-path note | Accepted / fixed per above. |

## In-cycle remediation summary

| Change | Files |
|---|---|
| Transactional `resetRunForRetry` returning actually-reset symbols (C1) | `functions/src/options-replay/retry.ts` |
| `failRun` restores outcomes for un-enqueued symbols (M1) | same |
| `timeoutSeconds: 300` + parallel fanout (M2) | same |
| Whole-map `listOutcomes` writes in both transactions (M3) | `retry.ts` + `functions/src/options-replay/permutation.ts` |
| `Pick<>` run view, header/comment fixes, spec ordering fix | `retry.ts`, `retry.test.ts` |
| New specs: concurrent-claim no-op, partial-reset enqueue, restored-outcomes on enqueue failure | `tests/functions/options-replay/retry.test.ts` (now 15 tests) |

## Re-verified after remediation

- `tsx --test` retry + permutation → **28/28**
- Functions `tsc --noEmit` + esbuild → clean
- jest full suite 287/4,963 (pre-remediation run; jest does not cover the node:test files — the touched specs were re-run after: green)

## Carried forward to downstream tasks

- **#1375 Rerun button wiring (FE):** retry is a no-op on `pending`/`running`/`cancelled` runs — the FE should disable/hide the button for those statuses rather than rely on the no-op.
- **Runs failed during initial fanout** (no outcomes recorded) can't be retried via this API — possible follow-on if users hit it.
- **Dotted-ticker legacy docs:** runs written before this fix may hold nested `listOutcomes` maps (`{BRK:{B:'failed'}}`) — invisible to retry; acceptable until a cleanup is needed.
- `runReplayRetry` no-ops return `{retriedSymbols:[]}` — indistinguishable from "nothing to retry" by design.

---

## Review — Round 2 (post-remediation re-review)

All three axes re-ran on the remediated files. **Verdict: PASS — no Critical, no Major.**

| Axis | Result |
|---|---|
| Thermo-Nuclear | Essentially clean — all round-1 dispositions verified as genuinely fixed (transaction claim provably cannot over/under-decrement; ~10 stale-task interleavings traced, all converge; no dot-path `listOutcomes` access remains repo-wide). 2 Minors fixed in-cycle, 1 Minor accepted + documented, 1 latent guard added. |
| Standards | PASS — all 7 round-1 remediations verified landed and correctly implemented. Nits only. |
| Spec | PASS — all ACs conformant post-remediation; ordering, payload, queue, error mapping, sorted response, and TEST-doc coverage matrix all verified. |

### Round-2 in-cycle remediation

| # | Finding | Fix |
|---|---|---|
| TN-M1 | `failRun` stamps `status:'failed'` unconditionally — regresses a `'completed'` run when all un-enqueued symbols already re-resolved via stale tasks (`restored` empty) | Terminal guard inside the tx: skip the write when `restored.length === 0` and status is already `'completed'`/`'failed'` (retry.ts failRun) |
| TN-M2 (latent) | No status re-check inside `resetRunForRetry` — a `'cancelled'` write landing in the getRun→tx window would be stomped back to `'running'` (no writer today; vocabulary-only) | One-line `RETRY_NOOP_STATUSES` re-check inside the transaction |
| ST-N1 | `run.listOutcomes![s]` — only non-null assertion in options-replay/; trips `no-non-null-assertion` warn | `?? {}` local, no `!` |
| ST-N2 | `order.indexOf('enqueue:IWM')` hardcodes a fixture symbol | `findIndex(o => o.startsWith('enqueue:'))` |

### Accepted (documented, not blocking)

- **Residual kill-window:** a process killed between `resetRunForRetry` commit and an enqueue RPC leaving the process orphans that symbol (outcome deleted, doc pending, retry no-ops on `running`). Same accepted class as `start.ts`'s partial-fanout residual; needs a stale-`running` sweeper, out of scope — **now documented in the retry.ts header**.
- **`optionsReplayStart` still lacks `timeoutSeconds`** (60s default) + sequential fanout — pre-existing #1281 posture, carry-forward hardening candidate.
- No dotted-symbol test — deps seam can't express map-key semantics; prod wiring untested per accepted SP-3 posture.
- Non-HttpsError dep rejections propagate raw → framework wraps as `internal`; sibling-consistent.

### Re-verified

- `tsx --test` retry + permutation + start → **36/36**
- Functions `tsc --noEmit` + `eslint retry.ts` → clean (zero warnings)
- Full jest suite → **287/4,970** green
