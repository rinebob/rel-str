# Symbol Data Sync Nightly Pipeline Monitoring Guide

This document describes every stage of rel-str's PDR-driven nightly pipeline,
the logs emitted at each stage, and the Logs Explorer queries to detect and
diagnose failures.

The upstream Alpha Vantage/SA time-series pipeline is documented separately in:

```text
C:\aa\projects\av-proxy-api\docs\pipeline\time-series-post-pipeline-monitoring.md
```

This guide begins when rel-str receives the Partner Data Ready (PDR) message
and ends when the Savant Trader (ST) nightly run is created and completed.

## Table of Contents

- [Pipeline Overview](#pipeline-overview)
- [Run ID and Firestore IDs](#run-id-and-firestore-ids)
- [Cloud Run Services](#cloud-run-services)
- [Log Query Conventions](#log-query-conventions)
- [Stage 1: PDR Delivery and Receipt](#stage-1-pdr-delivery-and-receipt)
- [Intraday PRE Pipeline](#intraday-pre-pipeline)
- [Stage 2: Symbol Resolution and Task Enqueueing](#stage-2-symbol-resolution-and-task-enqueueing)
- [Stage 3: Per-Symbol Worker Execution](#stage-3-per-symbol-worker-execution)
- [Stage 4: Interval Completion and Sequence Fan-In](#stage-4-interval-completion-and-sequence-fan-in)
- [Stage 5: Downstream Consumer Enqueueing](#stage-5-downstream-consumer-enqueueing)
- [Stage 6: Consumer Dispatch](#stage-6-consumer-dispatch)
- [Stage 7: ST Nightly Run](#stage-7-st-nightly-run)
- [Fallback Timer](#fallback-timer)
- [Watchdog Status](#watchdog-status)
- [Firestore Verification](#firestore-verification)
- [End-to-End Verification](#end-to-end-verification)
- [Failure Mode Quick Reference](#failure-mode-quick-reference)
- [Appendix: Log Tag Reference](#appendix-log-tag-reference)

---

## Pipeline Overview

A POST sequence is delivered as three independent PDR messages: one for each
interval. The three interval runs share a sequence parent document.

```text
SA publishes PDR
  └─ partner-data-ready Pub/Sub topic
       └─ symbolDataSync
            ├─ Parse PDR attributes and JSON body
            ├─ Resolve tracked-symbol set
            ├─ Create symbol-data-sync-runs/{runId}
            ├─ Create/update symbol-data-sync-sequences/{sequenceRunId}
            └─ Enqueue symbolDataSyncWorker task per symbol
                 └─ symbolDataSyncWorker
                      ├─ Fetch bars from SA
                      ├─ Write symbol-data/{symbol} bars
                      ├─ Report completion
                      └─ Complete interval when all symbols report
                           └─ Complete sequence after DAILY/WEEKLY/MONTHLY
                                └─ Enqueue sdsConsumerDispatch tasks
                                     ├─ selection
                                     ├─ settlement
                                     └─ st-nightly
                                          └─ startStRun
```

### POST sequence semantics

| Sequence | Typical time (PT) | Symbol selection | Downstream consumers |
|---|---:|---|---|
| A | 1:35 PM | All tracked symbols minus `excludeSymbols` | Selection, settlement, ST nightly |
| B | 6:00 PM | `includeSymbols` only | Scoped settlement, scoped ST nightly |
| C | 4:00 AM next day | `includeSymbols` only | Scoped settlement, scoped ST nightly |

A/B/C are distinguished from the PDR `runType` by the sequence segment in the
runId. The PDR `runType` attribute is `ts-post-all-intervals` for all three.

Intraday PRE messages use a separate path: one bulk snapshot is fetched and
written directly by `symbolDataSync`; there are no per-symbol EOD tasks or
POST sequence fan-in.

---

## Run ID and Firestore IDs

### Production POST runId format

```text
{marketDate}-{dow}-{sequence}-{interval}-LIVE-POST-{clockPt}
```

Examples:

```text
2026-09-04-FRI-A-DAILY-LIVE-POST-1335
2026-09-04-FRI-A-WEEKLY-LIVE-POST-1335
2026-09-04-FRI-A-MONTHLY-LIVE-POST-1335
2026-09-04-FRI-B-DAILY-LIVE-POST-1800
2026-09-04-FRI-C-DAILY-LIVE-POST-0400
```

| Component | Meaning | Examples |
|---|---|---|
| `marketDate` | Trading date | `2026-09-04` |
| `dow` | Day of week | `FRI` |
| `sequence` | POST pass | `A`, `B`, `C` |
| `interval` | Data interval | `DAILY`, `WEEKLY`, `MONTHLY` |
| `LIVE` / `MANUAL` | Scheduled or manual execution | `LIVE` |
| `POST` | Trading phase | `POST` |
| `clockPt` | PT schedule label | `1335`, `1800`, `0400` |

### Sequence parent ID

```text
{marketDate}-POST-{sequence}
```

Example:

```text
2026-09-04-POST-A
```

### Intraday runId format

```text
{marketDate}-{dow}-LIVE-{clockPt}
```

Example:

```text
2026-09-04-FRI-LIVE-0800
```

---

## Cloud Run Services

These are Firebase Functions v2 services. In Logs Explorer, use
`resource.type="cloud_run_revision"` and the lowercase service name.

| Service name | Role | Function |
|---|---|---|
| `symboldatasync` | PDR subscriber, symbol resolution, task enqueueing, intraday processing | `symbolDataSync` |
| `symboldatasyncworker` | Per-symbol POST task worker and interval completion | `symbolDataSyncWorker` |
| `sdsconsumerdispatch` | Selection, settlement, and ST consumer task handler | `sdsConsumerDispatch` |
| `sdsfallback` | 3 PM PT missing-POST-A fallback | `sdsFallback` |
| `sdswatchdog` | Stale-run safety net; currently disabled in source export | `sdsWatchdog` |

The completion logic is called inside `symboldatasyncworker`; its logs are
therefore associated with the worker service, not a separate completion service.
Likewise, `startStRun` logs appear under `sdsconsumerdispatch` because the
consumer dispatcher invokes it.

---

## Log Query Conventions

### Base filter

```text
resource.type="cloud_run_revision"
resource.labels.project_id="rel-str"
resource.labels.location="us-central1"
```

### Exact log event query

For structured Firebase logger entries, the event name is in
`jsonPayload.message`:

```text
resource.type="cloud_run_revision"
resource.labels.service_name="symboldatasync"
jsonPayload.message="sds_pdr_received"
```

Use `jsonPayload.runId` or `jsonPayload.sequenceRunId` to narrow an event when
the event includes that field. Set the Logs Explorer time range explicitly;
queries in this document intentionally omit a fixed timestamp.

### All SDS errors

```text
resource.type="cloud_run_revision"
resource.labels.project_id="rel-str"
resource.labels.location="us-central1"
resource.labels.service_name=~"symboldatasync|symboldatasyncworker|sdsconsumerdispatch|sdsfallback|sdswatchdog"
severity>=ERROR
```

### All SDS lifecycle events

```text
resource.type="cloud_run_revision"
resource.labels.project_id="rel-str"
resource.labels.location="us-central1"
jsonPayload.message=~"sds_|st_trigger_"
```

---

## Stage 1: PDR Delivery and Receipt

**Service:** `symboldatasync`  
**Trigger:** `partner-data-ready` Pub/Sub topic  
**Primary event:** `sds_pdr_received`

### Query: Confirm SDS received a PDR

```text
resource.type="cloud_run_revision"
resource.labels.service_name="symboldatasync"
jsonPayload.message="sds_pdr_received"
```

### Fields

```text
jsonPayload.runId
jsonPayload.phase
jsonPayload.interval
jsonPayload.sequence
```

For a specific POST A DAILY run:

```text
resource.type="cloud_run_revision"
resource.labels.service_name="symboldatasync"
jsonPayload.message="sds_pdr_received"
jsonPayload.runId="2026-09-04-FRI-A-DAILY-LIVE-POST-1335"
```

### Expected result

For POST A, the event must show:

```text
phase="post"
interval="DAILY" | "WEEKLY" | "MONTHLY"
sequence="A"
```

Run the same query for the WEEKLY and MONTHLY runIds. A complete POST A
sequence requires all three PDR messages.

### Payload and message errors

```text
resource.type="cloud_run_revision"
resource.labels.service_name="symboldatasync"
jsonPayload.message="sds_payload_parse_failed"
```

```text
resource.type="cloud_run_revision"
resource.labels.service_name="symboldatasync"
jsonPayload.message="sds_no_message"
```

A parse error can remove `includeSymbols` or `excludeSymbols` from the effective
payload and must be investigated before looking at task processing.

### PDR handler completion

```text
resource.type="cloud_run_revision"
resource.labels.service_name="symboldatasync"
jsonPayload.message="sds_pdr_handled"
```

Fields:

```text
jsonPayload.runId
jsonPayload.skipped
jsonPayload.enqueued
jsonPayload.errors
```

If `sds_pdr_received` exists but `sds_pdr_handled` does not, the subscriber
failed between parsing and returning from the handler. Check service errors.

---

## Intraday PRE Pipeline

The intraday PRE path is independent of the POST A/B/C sequence path. It runs
once for each PDR clock tick, normally at 0800, 1000, and 1200 PT.

### PRE execution flow

```text
PRE PDR message
  └─ symbolDataSync
       ├─ Decode Pub/Sub message
       ├─ Resolve all tracked symbols
       ├─ Create symbol-data-sync-runs/{runId}
       ├─ Fetch one bulk intraday snapshot for all symbols
       ├─ Write symbol-data/{symbol}/intraday/latest
       ├─ Write symbol-data/{symbol}.currentPrice
       ├─ Mark all symbols processed
       ├─ Mark the run completed
       └─ Enqueue one sdsConsumerDispatch task: st-intraday
            └─ sdsConsumerDispatch
                 └─ startStRun(marketDate, 'pdr')
                      └─ Create and enqueue the ST intraday run
```

There are no `symbolDataSyncWorker` tasks for PRE runs, no DAILY/WEEKLY/MONTHLY
interval fan-in, and no sequence parent document.

### PRE Stage 1: PDR received and decoded

**Service:** `symboldatasync`  
**Events:** `sds_pdr_received`, `sds_pdr_handled`

```text
resource.type="cloud_run_revision"
resource.labels.service_name="symboldatasync"
jsonPayload.message="sds_pdr_received"
jsonPayload.phase="pre"
```

Fields on `sds_pdr_received`:

```text
jsonPayload.runId
jsonPayload.phase
jsonPayload.interval
jsonPayload.sequence
```

Expected values:

```text
phase="pre"
interval="intraday"
sequence is absent
```

The PDR clock is normally represented in the runId and Pub/Sub attributes. SDS
uses `phase="pre"` to select the intraday path; it does not require a POST
sequence.

Query the handler's return:

```text
resource.type="cloud_run_revision"
resource.labels.service_name="symboldatasync"
jsonPayload.message="sds_pdr_handled"
jsonPayload.runId="2026-09-04-FRI-LIVE-0800"
```

Fields:

```text
jsonPayload.runId
jsonPayload.skipped
jsonPayload.enqueued
jsonPayload.errors
```

A successful PRE run has `skipped=false`, `enqueued` equal to the number of
successful snapshot writes, and `errors` equal to the number of symbols that
failed or were absent from the snapshot response.

Decode errors:

```text
resource.type="cloud_run_revision"
resource.labels.service_name="symboldatasync"
jsonPayload.message="sds_payload_parse_failed"
```

```text
resource.type="cloud_run_revision"
resource.labels.service_name="symboldatasync"
jsonPayload.message="sds_no_message"
```

If `sds_pdr_received` exists but `sds_pdr_handled` does not, inspect all
`symboldatasync` errors for the same time window.

### PRE Stage 2: Resolve the tracked-symbol universe

For PRE, `resolveSymbolSet` returns all symbols from the tracked-symbol source.
There is no `includeSymbols` or `excludeSymbols` filtering.

The resolution itself has no dedicated success log. Use the PDR lifecycle and
then inspect the run document:

```text
symbol-data-sync-runs/{runId}
```

Expected:

```text
phase="pre"
interval="intraday"
symbols contains the tracked-symbol universe
sequenceRunId is null
```

If the resulting run has `symbols: []`, query:

```text
resource.type="cloud_run_revision"
resource.labels.service_name="symboldatasync"
jsonPayload.message=~"sds_intraday_empty_symbols|sds_intraday_fetch_failed|sds_pdr_handled"
```

An empty PRE symbol set is not a normal successful run when tracked symbols are
configured.

### PRE Stage 3: Bulk intraday snapshot fetch

SDS calls the partner bulk intraday endpoint once with the full symbol set. It
does not call the per-symbol EOD worker.

There is no dedicated fetch-start or fetch-success log. The result is visible
in `sds_intraday_complete`; fetch failures have their own error event.

```text
resource.type="cloud_run_revision"
resource.labels.service_name="symboldatasync"
jsonPayload.message="sds_intraday_fetch_failed"
```

Fields:

```text
jsonPayload.runId
jsonPayload.error
```

If this event occurs, SDS marks the run failed and records all selected symbols
as processed. No intraday documents are written from that failed fetch.

### PRE Stage 4: Write intraday documents and currentPrice

For each returned snapshot, SDS writes:

```text
symbol-data/{SYMBOL}/intraday/latest
symbol-data/{SYMBOL}.currentPrice
```

The write operation has no separate success log. A batch write failure is
reported here:

```text
resource.type="cloud_run_revision"
resource.labels.service_name="symboldatasync"
jsonPayload.message="sds_intraday_batch_commit_failed"
```

Fields:

```text
jsonPayload.runId
jsonPayload.error
```

A batch commit failure causes `success=0` in the completion summary. Inspect
Firestore directly if you need to determine whether a partial external write
occurred before the batch failure was reported.

### PRE Stage 5: Intraday completion summary

```text
resource.type="cloud_run_revision"
resource.labels.service_name="symboldatasync"
jsonPayload.message="sds_intraday_complete"
```

Fields:

```text
jsonPayload.runId
jsonPayload.success
jsonPayload.failed
jsonPayload.failedSymbols
```

`failedSymbols` is the exact list of requested symbols that were absent from
the bulk snapshot response. It is also persisted on the corresponding
`symbol-data-sync-runs/{runId}` document, so it can be compared across PRE
runs without relying on log sampling.

Expected:

```text
success + failed = selected symbol count
failed = 0 for a fully successful snapshot
```

A missing symbol from the partner's bulk response increments `failed` even if
the bulk request itself succeeds. The exact symbols are available in
`failedSymbols`; for example:

```text
jsonPayload.failedSymbols=["AAA","BBB"]
```

To compare a symbol across recent PRE runs, query the run documents in
Firestore and count occurrences of each `failedSymbols` entry. A symbol should
only be removed from `tracked_symbols` after confirming that it is consistently
absent across multiple PRE runs and that the absence is not caused by a
provider outage, symbol rename, delisting, or an invalid symbol mapping.

The run's `processedSymbols` array is then updated. Confirm the run document's
`status`, counters, and `failedSymbols` in Firestore.

### PRE Stage 6: Direct intraday consumer enqueue

PRE has no sequence fan-in. Once all selected symbols are accounted for, the
completion logic marks the run complete and enqueues one consumer task:

```text
consumer="st-intraday"
```

Success:

```text
resource.type="cloud_run_revision"
resource.labels.service_name="symboldatasync"
jsonPayload.message="sds_intraday_consumer_enqueued"
```

Fields:

```text
jsonPayload.runId
```

Failure:

```text
resource.type="cloud_run_revision"
resource.labels.service_name="symboldatasync"
jsonPayload.message="sds_intraday_consumer_enqueue_failed"
```

Fields:

```text
jsonPayload.runId
jsonPayload.error
```

On enqueue failure, the run is set to:

```text
status="completed_but_not_dispatched"
completionEnqueued=false
```

The watchdog is currently disabled, so this state is not automatically retried.

An empty PRE run produces:

```text
resource.type="cloud_run_revision"
resource.labels.service_name="symboldatasync"
jsonPayload.message="sds_intraday_empty_symbols"
```

The run is marked completed but ST intraday dispatch is skipped.

### PRE Stage 7: Consumer dispatch

The task is handled by `sdsConsumerDispatch`.

Start:

```text
resource.type="cloud_run_revision"
resource.labels.service_name="sdsconsumerdispatch"
jsonPayload.message="sds_consumer_dispatch_start"
jsonPayload.consumer="st-intraday"
```

Fields:

```text
jsonPayload.consumer
jsonPayload.marketDate
```

Completion:

```text
resource.type="cloud_run_revision"
resource.labels.service_name="sdsconsumerdispatch"
jsonPayload.message="sds_consumer_dispatch_st_intraday_done"
```

Fields:

```text
jsonPayload.marketDate
```

If the start event exists without the completion event, inspect:

```text
resource.type="cloud_run_revision"
resource.labels.service_name="sdsconsumerdispatch"
severity>=ERROR
```

### PRE Stage 8: ST intraday run creation

The dispatcher calls:

```text
startStRun(marketDate, 'pdr')
```

Symbols loaded:

```text
resource.type="cloud_run_revision"
resource.labels.service_name="sdsconsumerdispatch"
jsonPayload.message="st_trigger_symbols_loaded"
jsonPayload.triggeredBy="pdr"
```

Run created:

```text
resource.type="cloud_run_revision"
resource.labels.service_name="sdsconsumerdispatch"
jsonPayload.message="st_trigger_run_created"
jsonPayload.triggeredBy="pdr"
```

Fields:

```text
jsonPayload.runId
jsonPayload.marketDate
jsonPayload.triggeredBy
jsonPayload.symbolCount
```

Run enqueue completed:

```text
resource.type="cloud_run_revision"
resource.labels.service_name="sdsconsumerdispatch"
jsonPayload.message="st_trigger_complete"
jsonPayload.triggeredBy="pdr"
```

Fields:

```text
jsonPayload.runId
jsonPayload.marketDate
jsonPayload.triggeredBy
jsonPayload.symbolCount
jsonPayload.enqueued
jsonPayload.failed
jsonPayload.duration
```

Expected:

```text
triggeredBy="pdr"
symbolCount > 0
enqueued > 0
failed = 0 or a known investigated count
```

A PRE run must not be evaluated using `triggeredBy="nightly"`; that value
belongs to the POST A nightly consumer.

### PRE end-to-end query

```text
resource.type="cloud_run_revision"
resource.labels.project_id="rel-str"
resource.labels.location="us-central1"
jsonPayload.message=~"sds_pdr_received|sds_pdr_handled|sds_intraday_fetch_failed|sds_intraday_batch_commit_failed|sds_intraday_complete|sds_intraday_empty_symbols|sds_intraday_consumer_enqueued|sds_intraday_consumer_enqueue_failed|sds_consumer_dispatch_start|sds_consumer_dispatch_st_intraday_done|st_trigger_symbols_loaded|st_trigger_run_created|st_trigger_complete"
```

For a specific PRE run, narrow each applicable event using:

```text
jsonPayload.runId="2026-09-04-FRI-LIVE-0800"
```

Note that the consumer-dispatch events do not carry the original runId; use
`jsonPayload.marketDate` and `jsonPayload.consumer` for those events.

---

## Stage 2: Symbol Resolution and Task Enqueueing

**Service:** `symboldatasync`  
**Purpose:** Resolve the symbol set and enqueue one worker task per selected
symbol.

### Query: Enqueue summary

```text
resource.type="cloud_run_revision"
resource.labels.service_name="symboldatasync"
jsonPayload.message="sds_enqueue_complete"
```

### Fields

```text
jsonPayload.runId
jsonPayload.total
jsonPayload.enqueued
jsonPayload.errors
```

### Expected counts

For POST A:

```text
total = tracked-symbol count - excludeSymbols count
enqueued = total, unless task creation failed
errors = 0
```

For POST B/C:

```text
total = includeSymbols count
enqueued = total, unless task creation failed
errors = 0
```

### Query: Individual enqueue failures

```text
resource.type="cloud_run_revision"
resource.labels.service_name="symboldatasync"
jsonPayload.message="sds_enqueue_failed"
```

Fields:

```text
jsonPayload.symbol
jsonPayload.runId
jsonPayload.error
```

### Query: Duplicate/terminal PDR

```text
resource.type="cloud_run_revision"
resource.labels.service_name="symboldatasync"
jsonPayload.message="sds_skip_terminal_run"
```

This is expected for a duplicate PDR only when the existing run document is
already terminal. It is not evidence that a new run was processed.

### Critical interpretation

A POST A result of `total=0` is abnormal unless the tracked-symbol source itself
was empty. It indicates one of:

1. The PDR was parsed with the wrong sequence.
2. The tracked-symbol lookup returned no symbols.
3. The PDR payload or attributes were malformed.

A POST B/C result of `total=0` can be normal when no symbols became fresh in
that retry pass. Verify `includeSymbols` in the original PDR body before
classifying it as a failure.

The production POST runId places the sequence before the interval:

```text
...-A-DAILY-LIVE-POST-1335
```

---

## Stage 3: Per-Symbol Worker Execution

**Service:** `symboldatasyncworker`  
**Task queue:** `symbolDataSyncWorker`  
**Purpose:** Fetch bars from SA and write the local `symbol-data` store.

### Worker success

```text
resource.type="cloud_run_revision"
resource.labels.service_name="symboldatasyncworker"
jsonPayload.message="sds_worker_done"
```

Fields:

```text
jsonPayload.symbol
jsonPayload.interval
jsonPayload.barCount
jsonPayload.runId
```

Specific run query:

```text
resource.type="cloud_run_revision"
resource.labels.service_name="symboldatasyncworker"
jsonPayload.message="sds_worker_done"
jsonPayload.runId="2026-09-04-FRI-A-DAILY-LIVE-POST-1335"
```

### Worker no-bars result

```text
resource.type="cloud_run_revision"
resource.labels.service_name="symboldatasyncworker"
jsonPayload.message="sds_worker_no_bars"
```

Fields:

```text
jsonPayload.symbol
jsonPayload.interval
jsonPayload.runId
```

This means the task ran but the partner returned no bars. It is different from
a task that was never created or delivered.

### Worker error

```text
resource.type="cloud_run_revision"
resource.labels.service_name="symboldatasyncworker"
jsonPayload.message="sds_worker_error"
```

Fields:

```text
jsonPayload.symbol
jsonPayload.interval
jsonPayload.runId
jsonPayload.error
```

### Task-handler completion

```text
resource.type="cloud_run_revision"
resource.labels.service_name="symboldatasyncworker"
jsonPayload.message="sds_worker_complete"
```

This is the outer task-handler lifecycle event. `sds_worker_done` is emitted by
the per-symbol processing logic; both may appear for one successful task.

### What to compare

For each interval run:

```text
number of selected symbols
≈ number of sds_worker_done + sds_worker_no_bars + sds_worker_error
```

A large gap indicates Cloud Tasks delivery, worker deployment, or task
creation trouble rather than a partner-data failure.

---

## Stage 4: Interval Completion and Sequence Fan-In

The completion logic records each interval run and updates the sequence parent.
A sequence is complete only after DAILY, WEEKLY, and MONTHLY have completed.

### Query: Interval completion waiting

```text
resource.type="cloud_run_revision"
resource.labels.service_name="symboldatasyncworker"
jsonPayload.message="sds_seq_not_all_intervals_complete"
```

Fields:

```text
jsonPayload.sequenceRunId
jsonPayload.completedIntervals
```

This is informational. It shows that one interval completed while one or more
other intervals are still outstanding.

### Query: Sequence completed

```text
resource.type="cloud_run_revision"
resource.labels.service_name="symboldatasyncworker"
jsonPayload.message="sds_seq_completed"
```

Fields:

```text
jsonPayload.sequenceRunId
jsonPayload.consumerCount
```

Expected consumer counts:

| Sequence | Expected count |
|---|---:|
| A | 3 |
| B/C | 2 |

### Empty run warning

```text
resource.type="cloud_run_revision"
resource.labels.service_name="symboldatasyncworker"
jsonPayload.message="sds_completion_empty_symbols"
```

This is normal only for a genuinely empty retry run. It is not normal for POST A
when the tracked-symbol universe is populated.

### Missing completion documents

```text
resource.type="cloud_run_revision"
jsonPayload.message=~"sds_completion_run_not_found|sds_completion_seq_not_found|sds_seq_completion_not_found"
```

These indicate an inconsistent `runId`/`sequenceRunId`, a missing Firestore
document, or a completion race that must be investigated.

---

## Stage 5: Downstream Consumer Enqueueing

When the sequence fan-in completes, completion logic enqueues separate tasks to
`sdsConsumerDispatch`.

### Consumer task enqueue

```text
resource.type="cloud_run_revision"
resource.labels.service_name="symboldatasyncworker"
jsonPayload.message="sds_consumer_enqueued"
```

Fields:

```text
jsonPayload.sequenceRunId
jsonPayload.consumer
```

For POST A, expect one event for each:

```text
selection
settlement
st-nightly
```

For POST B/C, expect:

```text
settlement-scoped
st-nightly-scoped
```

### Consumer enqueue error

```text
resource.type="cloud_run_revision"
resource.labels.service_name="symboldatasyncworker"
jsonPayload.message="sds_consumer_enqueue_failed"
```

Fields:

```text
jsonPayload.sequenceRunId
jsonPayload.consumer
jsonPayload.error
```

### Completed but not dispatched

```text
resource.type="cloud_run_revision"
resource.labels.service_name="symboldatasyncworker"
jsonPayload.message="sds_seq_completed_but_not_dispatched"
```

This means all interval work completed but one or more downstream tasks could
not be created. The sequence is not equivalent to a successful nightly run.

The watchdog is currently disabled, so this state is not automatically retried.
Check the Cloud Tasks error and the sequence Firestore document.

---

## Stage 6: Consumer Dispatch

**Service:** `sdsconsumerdispatch`  
**Task queue:** `sdsConsumerDispatch`

Each consumer is dispatched independently.

### Dispatch started

```text
resource.type="cloud_run_revision"
resource.labels.service_name="sdsconsumerdispatch"
jsonPayload.message="sds_consumer_dispatch_start"
```

Fields:

```text
jsonPayload.consumer
jsonPayload.marketDate
```

Specific nightly dispatch query:

```text
resource.type="cloud_run_revision"
resource.labels.service_name="sdsconsumerdispatch"
jsonPayload.message="sds_consumer_dispatch_start"
jsonPayload.consumer="st-nightly"
```

### Missing market date

```text
resource.type="cloud_run_revision"
resource.labels.service_name="sdsconsumerdispatch"
jsonPayload.message="sds_consumer_dispatch_no_market_date"
```

This is a malformed task payload.

### Consumer completion events

Selection:

```text
resource.type="cloud_run_revision"
resource.labels.service_name="sdsconsumerdispatch"
jsonPayload.message="sds_consumer_dispatch_selection_done"
```

Settlement:

```text
resource.type="cloud_run_revision"
resource.labels.service_name="sdsconsumerdispatch"
jsonPayload.message="sds_consumer_dispatch_settlement_done"
```

ST nightly:

```text
resource.type="cloud_run_revision"
resource.labels.service_name="sdsconsumerdispatch"
jsonPayload.message="sds_consumer_dispatch_st_nightly_done"
```

The ST nightly completion event is the handoff point from SDS to ST
orchestration. If the start event exists but this completion event does not,
query dispatcher errors:

```text
resource.type="cloud_run_revision"
resource.labels.service_name="sdsconsumerdispatch"
severity>=ERROR
```

---

## Stage 7: ST Nightly Run

`startStRun(marketDate, 'nightly')` is called by the `st-nightly` consumer.
Its logs are emitted by the `sdsconsumerdispatch` service because that service
executes the call.

### ST symbols loaded

```text
resource.type="cloud_run_revision"
resource.labels.service_name="sdsconsumerdispatch"
jsonPayload.message="st_trigger_symbols_loaded"
```

Fields:

```text
jsonPayload.marketDate
jsonPayload.triggeredBy
jsonPayload.count
jsonPayload.firstFew
```

### ST run created

```text
resource.type="cloud_run_revision"
resource.labels.service_name="sdsconsumerdispatch"
jsonPayload.message="st_trigger_run_created"
```

Fields:

```text
jsonPayload.runId
jsonPayload.marketDate
jsonPayload.triggeredBy
jsonPayload.symbolCount
```

For this pipeline, `triggeredBy` should be `nightly`.

### ST run enqueue completed

```text
resource.type="cloud_run_revision"
resource.labels.service_name="sdsconsumerdispatch"
jsonPayload.message="st_trigger_complete"
```

Fields:

```text
jsonPayload.runId
jsonPayload.marketDate
jsonPayload.triggeredBy
jsonPayload.symbolCount
jsonPayload.enqueued
jsonPayload.failed
jsonPayload.duration
```

### ST has no symbols

```text
resource.type="cloud_run_revision"
resource.labels.service_name="sdsconsumerdispatch"
jsonPayload.message="st_trigger_no_symbols"
```

This is a downstream ST symbol-source problem. It is separate from SDS's PDR
symbol resolution.

---

## Fallback Timer

**Service:** `sdsfallback`  
**Schedule:** 3:00 PM PT, Monday-Friday  
**Purpose:** Create a full POST A sync if no active/completed POST A sequence
exists for the market date.

### Fallback lifecycle events

```text
resource.type="cloud_run_revision"
resource.labels.service_name="sdsfallback"
jsonPayload.message=~"sds_fallback_start|sds_fallback_skip|sds_fallback_creating|sds_fallback_interval_created|sds_fallback_complete|sds_fallback_error"
```

Individual queries:

```text
resource.type="cloud_run_revision"
resource.labels.service_name="sdsfallback"
jsonPayload.message="sds_fallback_start"
```

```text
resource.type="cloud_run_revision"
resource.labels.service_name="sdsfallback"
jsonPayload.message="sds_fallback_complete"
```

```text
resource.type="cloud_run_revision"
resource.labels.service_name="sdsfallback"
jsonPayload.message="sds_fallback_error"
```

Fields vary by event. Common fields are:

```text
jsonPayload.marketDate
jsonPayload.interval
jsonPayload.runId
jsonPayload.enqueued
jsonPayload.errors
```

A `sds_fallback_skip` event is normal when a POST A sequence already exists.

---

## Watchdog Status

The watchdog was added as a scheduled safety net for stale interval runs,
stale sequences, and failed downstream dispatches. Its source export is
currently disabled because the deployed function was logging:

```text
channel_1.ChannelImplementation is not a constructor
```

It is therefore not part of the normal success path and must not be used as a
required monitoring stage.

### Historical watchdog queries

These are useful only if the function is re-enabled or when examining historical
logs:

```text
resource.type="cloud_run_revision"
resource.labels.service_name="sdswatchdog"
jsonPayload.message="sds_watchdog_start"
```

```text
resource.type="cloud_run_revision"
resource.labels.service_name="sdswatchdog"
jsonPayload.message=~"sds_watchdog_stale_run|sds_watchdog_stale_sequence"
```

```text
resource.type="cloud_run_revision"
resource.labels.service_name="sdswatchdog"
jsonPayload.message="sds_watchdog_error"
```

With the watchdog disabled, a run in `processing` or a sequence in
`completed_but_not_dispatched` requires manual investigation.

---

## Firestore Verification

Logs are the operational trail. Firestore is the authoritative state.

### Per-interval run document

Collection:

```text
symbol-data-sync-runs
```

Document ID: exact PDR `runId`.

For example:

```text
symbol-data-sync-runs/2026-09-04-FRI-A-DAILY-LIVE-POST-1335
```

Check:

```text
runId
marketDate
phase
interval
sequence
sequenceRunId
symbols
processedSymbols
status
completionEnqueued
startedAt
completedAt
```

### Sequence parent document

Collection:

```text
symbol-data-sync-sequences
```

Document ID:

```text
2026-09-04-POST-A
```

Check:

```text
intervalRunIds.DAILY
intervalRunIds.WEEKLY
intervalRunIds.MONTHLY
completedIntervals
status
completionEnqueued
startedAt
completedAt
```

A normally completed POST A sequence should have all three required intervals,
a terminal status, and `completionEnqueued=true`.

### ST run document

The ST orchestration writes its run document under the current ST runs
collection. Confirm the `runId` from `st_trigger_run_created` exists and that
its symbol/job counters match the `symbolCount` logged by ST orchestration.

---

## End-to-End Verification

Use the exact runIds from the PDR receipt logs. For a POST A sequence, verify
these stages in order.

### 1. All three PDR messages received

```text
resource.type="cloud_run_revision"
resource.labels.service_name="symboldatasync"
jsonPayload.message="sds_pdr_received"
jsonPayload.sequence="A"
```

Expected: one event each for `DAILY`, `WEEKLY`, and `MONTHLY`.

### 2. All three interval enqueue summaries

```text
resource.type="cloud_run_revision"
resource.labels.service_name="symboldatasync"
jsonPayload.message="sds_enqueue_complete"
jsonPayload.runId=~"-A-(DAILY|WEEKLY|MONTHLY)-LIVE-POST-"
```

Expected: three events with nonzero `total` and `enqueued` counts, unless the
tracked-symbol source is intentionally empty.

### 3. Worker processing

```text
resource.type="cloud_run_revision"
resource.labels.service_name="symboldatasyncworker"
jsonPayload.message=~"sds_worker_done|sds_worker_no_bars|sds_worker_error"
jsonPayload.runId=~"-A-(DAILY|WEEKLY|MONTHLY)-LIVE-POST-"
```

Compare per-interval event counts with the corresponding enqueue totals.

### 4. Sequence completion

```text
resource.type="cloud_run_revision"
resource.labels.service_name="symboldatasyncworker"
jsonPayload.message="sds_seq_completed"
jsonPayload.sequenceRunId="2026-09-04-POST-A"
```

Expected: one event with `consumerCount=3`.

### 5. Consumer tasks enqueued

```text
resource.type="cloud_run_revision"
resource.labels.service_name="symboldatasyncworker"
jsonPayload.message="sds_consumer_enqueued"
jsonPayload.sequenceRunId="2026-09-04-POST-A"
```

Expected consumers:

```text
selection
settlement
st-nightly
```

### 6. ST consumer dispatched

```text
resource.type="cloud_run_revision"
resource.labels.service_name="sdsconsumerdispatch"
jsonPayload.message=~"sds_consumer_dispatch_start|sds_consumer_dispatch_st_nightly_done"
jsonPayload.consumer="st-nightly"
```

Expected: both a start and completion event.

### 7. ST run created and completed

```text
resource.type="cloud_run_revision"
resource.labels.service_name="sdsconsumerdispatch"
jsonPayload.message=~"st_trigger_run_created|st_trigger_complete"
jsonPayload.triggeredBy="nightly"
```

Expected: both events, with a positive `symbolCount` and an appropriate
`enqueued`/`failed` result.

---

## Failure Mode Quick Reference

| Last observed event | Meaning | Next check |
|---|---|---|
| No `sds_pdr_received` | PDR did not reach SDS | SA PDR publish logs, Pub/Sub subscription, service deployment |
| PDR received, no `sds_pdr_handled` | Subscriber failed after receipt | `symboldatasync` errors |
| POST A `total=0` | Wrong sequence parsing or empty tracked-symbol response | RunId, PDR body, tracked-symbol lookup |
| `sds_enqueue_failed` | Some worker tasks were not created | Error field, Cloud Tasks, worker counts |
| Tasks enqueued, no worker events | Worker task delivery/deployment issue | `symboldatasyncworker` errors and Cloud Tasks |
| `sds_worker_no_bars` | Partner returned no bars for a task | Symbol, interval, SA response |
| `sds_worker_error` | Fetch or Firestore write failed | Symbol, interval, error field |
| Workers run, no sequence completion | Interval completion or missing interval | Run documents and `completedIntervals` |
| `sds_seq_not_all_intervals_complete` | Sequence is waiting | Identify missing DAILY/WEEKLY/MONTHLY interval |
| `sds_seq_completed_but_not_dispatched` | Data completed, consumer task enqueue failed | `sds_consumer_enqueue_failed`, Cloud Tasks |
| Consumer enqueue exists, no dispatch start | Consumer task not delivered | `sdsconsumerdispatch`, Cloud Tasks |
| Dispatch start, no ST completion | ST orchestration failed | `st_trigger_*`, dispatcher errors |
| `st_trigger_no_symbols` | ST symbol source is empty | ST symbol collection/configuration |
| ST complete, dashboard empty | Dashboard read/query/path issue | ST run document and frontend query |
| Watchdog error | Safety net unavailable | Manually inspect stuck Firestore documents |

---

## Appendix: Log Tag Reference

rel-str SDS uses Firebase structured logging. The event identifier is stored in
`jsonPayload.message`; the additional values in each logger call appear as
sibling fields under `jsonPayload`.

| Function/service | Source area | Primary event families |
|---|---|---|
| `symboldatasync` | `sds.ts`, `sds-core.ts` | `sds_pdr_*`, `sds_enqueue_*`, `sds_intraday_*` |
| `symboldatasyncworker` | `sds-worker.ts`, `sds-worker-core.ts` | `sds_worker_*`, `sds_completion_*`, `sds_seq_*`, `sds_consumer_*` |
| `sdsconsumerdispatch` | `sds-consumer-dispatch.ts`, `st-orchestration.ts` | `sds_consumer_dispatch_*`, `st_trigger_*` |
| `sdsfallback` | `sds-fallback.ts` | `sds_fallback_*` |
| `sdswatchdog` | `sds-watchdog.ts`, historical | `sds_watchdog_*` |

### Complete SDS event list

```text
sds_no_message
sds_payload_parse_failed
sds_pdr_received
sds_pdr_handled
sds_skip_terminal_run
sds_enqueue_failed
sds_enqueue_complete
sds_intraday_fetch_failed
sds_intraday_batch_commit_failed
sds_intraday_complete
sds_intraday_empty_symbols
sds_intraday_consumer_enqueued
sds_intraday_consumer_enqueue_failed
sds_worker_complete
sds_worker_done
sds_worker_no_bars
sds_worker_error
sds_completion_run_not_found
sds_completion_empty_symbols
sds_completion_seq_not_found
sds_seq_completion_not_found
sds_seq_not_all_intervals_complete
sds_seq_completed_but_not_dispatched
sds_seq_completed
sds_consumer_enqueued
sds_consumer_enqueue_failed
sds_consumer_dispatch_start
sds_consumer_dispatch_no_market_date
sds_consumer_dispatch_selection_done
sds_consumer_dispatch_settlement_done
sds_consumer_dispatch_st_nightly_done
sds_consumer_dispatch_st_intraday_done
sds_consumer_dispatch_unknown_consumer
sds_watchdog_start
sds_watchdog_complete
sds_watchdog_error
sds_watchdog_stale_run
sds_watchdog_stale_sequence
sds_watchdog_retry_dispatch_seq
sds_watchdog_retry_dispatch_run
sds_fallback_start
sds_fallback_skip
sds_fallback_creating
sds_fallback_skip_interval
sds_fallback_interval_created
sds_fallback_complete
sds_fallback_error
st_trigger_no_symbols
st_trigger_symbols_loaded
st_trigger_run_created
st_trigger_complete
```
