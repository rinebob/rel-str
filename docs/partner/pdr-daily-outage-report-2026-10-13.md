# Problem Report: DAILY-interval PDR messages stopped publishing

**Date:** 2026-10-13
**Audience:** SA (av-proxy-api pipeline owners)
**Reporter:** rel-str team
**Severity:** High — downstream nightly runs have not executed since 2026-09-28

## Summary

Since approximately **2026-09-22**, the POST pipeline in `alpha-vantage-proxy-api`
has not published a single DAILY-interval Partner Data Ready (PDR) message.
WEEKLY and MONTHLY PDRs for sequences A/B/C still publish on schedule, and
intraday PRE PDRs are unaffected. The last completed DAILY PDRs are for market
date **2026-09-21** (A, B, and C sequences all present in `runs/`).

Downstream impact on rel-str: every `symbol-data-sync-sequences` doc since
~Sep 29 is stuck in `processing` waiting for the DAILY interval to complete,
so the `st-nightly` consumer is never dispatched and no nightly Savant Trader
runs are created.

## Evidence

### 1. No DAILY PDRs published since Sep 21

`runs/{runId}` scan (upstream project, persists indefinitely):

```
2026-09-21-MON  A:completed B:completed C:completed   <- last good day
2026-09-22-TUE  through 2026-10-13-TUE: no DAILY pdr docs
```

Log query confirms zero `runs.upsert.enqueued` entries with `-DAILY-` in the
runId across the window (WEEKLY/MONTHLY continue normally).

### 2. A-run orchestrator dies mid-WEEKLY job creation

`realtime-runs` docs for 2026-10-12 A-run (upstream project):

| runId | status | createdJobs | jobsCreationCompletedAt | PDR sent |
|---|---|---|---|---|
| `...-A-MONTHLY-LIVE-POST-1335` | COMPLETE | 925 | set | yes |
| `...-A-WEEKLY-LIVE-POST-1335` | COMPLETE | **161** | **null** | yes (partial coverage) |
| `...-A-DAILY-LIVE-POST-1335` | IN_PROGRESS | **0** | null | no |

The DAILY run doc exists (created at orchestrator start) but job creation
never ran for it.

Log signature for the same run (`refreshavtimeseriespostallintervals`, Oct 12,
single `execution_id=5po4v121jig8`):

```
20:35:11  TIMER START scheduler.endpoint int=monthly(M)
20:36:00  TIMER END   scheduler.endpoint durMs=48737 int=monthly(M)   (925 jobs)
20:36:01  TIMER START scheduler.endpoint int=weekly(W)
20:36-20:51  weekly job creation ongoing, EXTREMELY slow:
             realtime_job.tx      durMs = 34,000 - 46,000 per symbol
             realtime_job.enqueue durMs =  9,500 - 24,000 per symbol
20:51:01  last log line (realtime_job.tx sym=EFX int=weekly) — then silence.
          No error, no timeout message. ~15-16 min total runtime.
```

The documented healthy `realtime_job.tx` duration is <500 ms; 30,000+ ms is
flagged in the monitoring doc as Firestore transaction contention.

### 3. This is a regression beginning ~Sep 22

Same revision (00112, deployed 2026-09-16) behaved differently across the
boundary:

| Day | monthly endpoint END | weekly endpoint END | daily loop reached |
|---|---|---|---|
| Sep 21 | durMs=28,099 | durMs=24,154 | yes — all 3 DAILY PDRs sent |
| Sep 22 | durMs=32,576 | **never** | no |
| Oct 12 | durMs=48,737 | **never** (killed mid-loop) | no |

So this does not correlate with a deploy — it looks like a runtime threshold
crossing (contention or throughput) around Sep 21-22.

Secondary symptom: on several days (Sep 29, Sep 30, Oct 1, Oct 6-8) even the
WEEKLY interval never completed — only MONTHLY PDRs were published for the A
run.

### 4. B/C DAILY runs complete trivially with zero jobs

`realtime-runs` for 2026-10-12:

- `B-DAILY-LIVE-POST-1800`: COMPLETE, `createdJobs=0`, `pdrSent=false`
- `C-DAILY-LIVE-POST-0400`: COMPLETE, `createdJobs=0`, `pdrSent=false`

B/C are retry passes; since the A-run DAILY loop never created jobs, the daily
retry set is empty → the run completes with zero jobs and no PDR. Consistent
with the primary failure being in the A-run.

## Theories (ranked)

**T1 — Job-creation tx contention on the shared run doc.**
Commit `d851964` (Sep 12, "Move createdJobs increment back inside
transaction") puts ~925 job-creation transactions against the same
`realtime-runs/{runId}` document. Combined with ~925 monthly-interval workers
concurrently writing completion state while weekly creation is in-flight,
per-tx latency could degrade nonlinearly. Caveat: this revision was live since
Sep 16 and daily worked through Sep 21, so if this is the mechanism it needs a
second factor (volume, symbol count, or a co-tenant workload) that crossed a
threshold on Sep 22.

**T2 — Concurrent write contention from the monthly worker fleet.**
Weekly job creation overlaps the window in which ~925 monthly jobs are
executing and writing back status/aggregates. If the job-create tx touches
any document those workers also write, that is the contention point. Worth
confirming what exactly the tx reads/writes besides `jobRef` and the run
counter.

**T3 — A co-tenant workload or quota regression in the 13:35 PT window.**
A second scheduled workload hammering the same Firestore database during the
A-run window would produce this signature. Several new schedulers landed in
the OPTIONS-DATA work Sep 23-25 (`sweepSwingSets`, optionable probes,
corpus ingest), but these postdate the Sep 22 onset — please check whether
anything else (backfills, sweeps, index builds) began around Sep 21-22.

**T4 — Silent orchestrator termination ~15-16 min in.**
The execution simply stops logging mid-transaction with no error emitted.
`gcloud functions describe` reports `timeoutSeconds=60`, `256MiB`, `1 CPU` —
but the same `execution_id` logs continuously for ≥16 minutes, so we are not
certain what the effective timeout is or whether an instance kill / CPU
starvation is involved. Whatever the mechanism, the function exits without a
single error line, which makes this failure invisible to alerting — worth
fixing regardless.

## Suggested diagnostics for SA

1. `realtime-runs/{YYYY-MM-DD-DOW}-A-DAILY-LIVE-POST-1335` for any recent
   trading day (2-day TTL) — expect `status=IN_PROGRESS, createdJobs=0`.
2. Count `TIMER END label=scheduler.endpoint` per A-run — expect 3; currently
   getting 1-2.
3. `realtime_job.tx` `durMs` distribution for `int=weekly(W)` — currently
   34-46 s per symbol vs ~26 ms on Sep 21.
4. Cloud Run metrics for `refreshavtimeseriespostallintervals`: execution
   duration distribution, instance kills, CPU/memory utilization vs. the
   observed silent stop.
5. Check what the job-creation transaction touches besides the job doc
   (post-d851964) and whether it shares a document with worker writes.
6. Pub/Sub topic `partner-data-ready` metrics — confirm no DAILY publishes
   (we verified on the rel-str receive side; the publish side should agree).

## Suggested fix directions

- Move the `createdJobs` increment back outside the job-creation transaction
  (revert d851964 behavior) or batch it.
- Reorder interval processing so DAILY runs first (DAILY is the interval all
  downstream consumers actually wait on), or run each interval's creation in
  its own function invocation so a slow interval can't starve the others.
- Emit a terminal log on any exit path (timeout handler, process exit) so a
  dead orchestrator is detectable; add alerting on "POST-A sequence missing
  DAILY PDR by 15:00 PT".
- If contention is confirmed: reduce job-creation concurrency, or shard the
  shared counter doc.

## Workaround in place

rel-str has a synthetic-PDR path (`verify-sds.js --phase post --sequence A
--interval DAILY`) that can complete a stuck sequence manually. It is a
verified production publish path but is a manual workaround only.

## Timeline reference (all UTC)

```
Sep 16 06:32   revision 00112 deployed (includes d851964 tx change)
Sep 21         last good day — all 3 A/B/C DAILY PDRs published
Sep 22 ~20:35  first observed dead weekly loop; no DAILY PDRs since
Sep 28         upstream published no POST-A PDRs that day; rel-str fallback
               synthesized all 3 intervals and produced the last nightly run
Sep 29-Oct 13  every POST sequence stuck awaiting DAILY; zero nightly runs
```
