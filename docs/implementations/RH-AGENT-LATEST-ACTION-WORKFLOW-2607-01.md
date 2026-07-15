# RH Agent Latest-Only Action Workflow

**Status:** Implementation in progress — Phase 1 and Phase 2 complete  
**Updated:** 2026-07-15

## Purpose

Define which RH Agent signals are actionable, which user choices are durable, and how the review, chart-review, and order pages share context.

This document supersedes older workflow and PACR-planning statements that describe persistent review queues, persistent rejection/consideration decisions, historical-run ACR activity, or automatic adoption of prior ACR decisions.

## Core Decision

Only the **latest completed actionable run** is eligible for active screening, review, acceptance, ordering, or execution.

- The latest run supplies the sole active `runId` and `marketDate`.
- The active `marketDate` is the date context for any durable acceptance record.
- When a newer completed run becomes latest, the prior run immediately becomes historical/read-only.
- Older runs and `signal-history` are for signal/chart research only. They are never an alternate source for active ACR or Order activity.

This is a workflow rule. It does not require signal documents to be physically moved when a new run arrives.

## Signal Storage and Workflow Are Separate

### Signal storage

- `run-ids/{runId}` records what the agent detected for a specific run.
- `signal-history/{barDate}` is canonical finalized per-symbol signal history.
- A new run does not promote or move an older run document into history. Finalized nightly signals are independently written to canonical history.

### Workflow eligibility

- The UI treats only the current latest run as actionable.
- Historical records remain fully inspectable through signal and chart review, but cannot create or modify active ACR, Order, or execution state.
- Users may always navigate to Order to continue the current Order process; historical inspection does not block navigation or hide the active accepted-occurrence workflow.

## Ephemeral Screening

Most signals are screened out quickly by list membership, chart quality, fundamentals, or user judgment. These outcomes are deliberately ephemeral.

The following are session/UI state only and are not durable records:

- Unreviewed signals.
- Symbols opened for chart inspection.
- Review queue membership.
- Passes, soft skips, and other screening outcomes that are not an explicit `ACCEPTED` or `REJECTED` decision.
- Any ACR state that does not create a source-specific durable decision record.

When the latest run changes, this transient state is discarded from active UI. No expiry job, historical triage queue, or cleanup write is required.

## Durable Decision and Trade Lifecycle

An explicit user `ACCEPTED` or `REJECTED` decision is durable immediately, including during intraday runs. Do not wait for nightly processing: the source run and signal state at the time of the decision are required context.

### Signal occurrence identity

A durable decision belongs to one specific signal occurrence, not to a symbol/day status.

- The initial occurrence identity is `runId + symbol + timeframe + signalType`.
- The durable record snapshots `marketDate`, `barDate`, direction, signal status, relevant indicators, decision timestamp, and future user identity/notes.
- Decisions from different runs on the same symbol/day are separate records and never overwrite one another.

### ACCEPTED

`ACCEPTED` means: **this is a good setup worth keeping and potentially trading.**

An accepted occurrence remains available to Order only while that same occurrence is still present in the latest completed run. If a newer latest run no longer contains it, the accepted record leaves active Order automatically but remains available for later analysis. An accepted occurrence that is executed remains durable as trade-management history.

### REJECTED

`REJECTED` means: **the user evaluated this specific signal occurrence and decided it was not a worthwhile setup.**

Rejected occurrences are historical decision data only. They do not create an active queue, do not carry forward as a rejection of a later occurrence, and are retained for future analysis, education, and possible workflow acceleration.

### Whipsaw reversals

A later opposite-direction occurrence for the same symbol and timeframe is a new signal occurrence. It must not overwrite the earlier occurrence or its decision.

When detected, link the later occurrence to the earlier occurrence with `relationship: WHIPSAW_REVERSAL` and a `previousOccurrenceId`. The user independently decides whether to accept or reject the new occurrence.

### EXECUTED

`EXECUTED` means: **a real trade was placed.**

Execution is distinct from acceptance. It will extend the accepted tracked-signal record, or a related trade record, with trade-management data such as entry, size, stop, exit, and outcome.

This separates:

1. What the agent detected.
2. What the user explicitly accepted or rejected about a particular occurrence.
3. What the user actually traded.

## Page Flow

1. **Run Dashboard** is the starting point. It shows recent runs, identifies the latest completed actionable run, and is the only entry point to active signal review.
2. **Signal Review** displays only that latest run's signals and supports fast, ephemeral screening.
3. **Chart Review** receives only symbols selected from that current run. It supports deeper inspection and acceptance.
4. **Order** remains reachable from all workflow views and contains eligible accepted occurrences from the current latest-run workflow. Moving to execution is explicit and separate from acceptance.
5. **Historical views** allow full prior-run signal and chart research, but their occurrences are read-only with respect to ACR, Order, and execution mutations.

The pages are separate navigation steps but share one latest-run context. They do not create independent date contexts.

## Non-Goals

- Persisting every review, consider, or skip action; only explicit per-occurrence `ACCEPTED` and `REJECTED` decisions are durable.
- Reopening an old run as an active ACR/order session.
- Automatically carrying prior-run screening decisions into the latest run.
- Treating raw signal storage as the user's trade-management record.

## Implementation Task List

No code change is authorized by this document until this task list is reviewed. Complete the work in order; do not combine the workflow rewrite with unrelated signal-storage changes.

### Phase 1 — Establish the latest-run action boundary

- [x] **Dashboard entry point:** make the Run Dashboard the active-workflow entry point and clearly identify the latest completed actionable run.
- [x] **Latest-only decision gate:** allow full signal/chart inspection and normal navigation for every run, but permit ACR decisions and changes to active Order/execution state only for occurrences in the latest completed run. Present historical occurrences as decision read-only, not page or route read-only.
- [x] **Viewed versus actionable context:** keep the user-selected/viewed run separate from the latest completed actionable `runId` and `marketDate`. The viewed run drives research display; the actionable context drives decision eligibility. Do not derive eligibility from arbitrary historical selection or from today's date alone.
- [x] **Active-run header:** display the current run information in the Signal Review page header using the same visual treatment and metadata shown by Run Dashboard. Display the same header in Chart Review when it is in Signals mode; omit it for non-signal/history browsing modes.
- [x] **New-run transition:** when a newer run becomes latest, discard in-memory screening state from the prior run and disable only its decision mutations. Preserve normal navigation, historical signal/chart research, and access to the active Order process.

### Phase 2 — Make screening ephemeral

- [x] **Remove durable screening behavior:** stop creating/loading/persisting dateless review flags and non-decision PACR screening state for the active workflow. Preserve immediate durable persistence only for source-specific `ACCEPTED` and `REJECTED` decisions.
- [x] **In-memory triage state:** retain only the latest run's current symbol selection, chart-review queue membership, and temporary screening choices across normal page navigation.
- [x] **Chart Review input:** populate Chart Review exclusively from the ephemeral selection made in Signal Review for the current latest run.
- [x] **Historical decision guardrails:** disable only ACR, queue-entry, Order-mutation, and execution-mutation controls for an older occurrence. Keep historical signal/chart inspection and normal navigation, including access to Order, available.
- [x] **Legacy data policy:** leave existing triage-decision and review-flag documents readable during transition, but do not use them to populate active queues. Define later whether they are retained, archived, or removed.

### Phase 3 — Persist source-specific ACR decisions

- [ ] **Decision schema:** define one durable occurrence-level record for each explicit `ACCEPTED` or `REJECTED` choice. It must snapshot/reference the source `runId`, `marketDate`, symbol, timeframe, direction, signal type, `barDate`, indicator payload, decision type, decision time, and user identity.
- [ ] **Occurrence identity:** key decisions by `runId + symbol + timeframe + signalType`, never by symbol/date alone, so multiple intraday occurrences do not overwrite one another.
- [ ] **Decision transitions:** make `Accept` and `Reject` persist immediately; do not persist skipped, merely reviewed, or `CONSIDER` state.
- [ ] **Whipsaw linkage:** detect a later opposite-direction occurrence for the same symbol/timeframe and link it to the prior occurrence as `WHIPSAW_REVERSAL` without changing either decision.
- [ ] **Order input:** make Order read accepted occurrences only while they remain present in the latest run; remove no-longer-current accepted occurrences from active Order without deleting their historical records.
- [ ] **Accepted-not-executed state:** retain accepted setups that are never traded for setup-quality review and statistics, outside the active Order workflow.
- [ ] **Firestore boundary:** add the collection constants, security rules, indexes, and service/store ownership for occurrence-level decisions in one focused change.

### Phase 4 — Add execution and trade management

- [ ] **Execution transition:** add explicit `EXECUTED` behavior distinct from `ACCEPTED`; it occurs only after a real trade is placed.
- [ ] **Trade data model:** decide whether execution details live on the tracked-signal record or in a related trade record, then persist entry, size, stop, exit, and outcome data there.
- [ ] **Trade-management views:** define active versus closed-trade views without reintroducing historical runs as actionable signal queues.

### Phase 5 — Validate and clean up

- [ ] **Route-flow coverage:** verify Dashboard → Signal Review → Chart Review → Order uses one latest-run context across navigation.
- [ ] **Eligibility coverage:** verify a prior run can be inspected but cannot feed active screening, acceptance, Order, or execution.
- [ ] **Transition coverage:** verify a newly completed run clears only ephemeral screening state, while accepted/executed records remain available.
- [ ] **Decision coverage:** verify accepting and rejecting each persist one complete source-specific occurrence record; verify an accepted-but-unexecuted setup leaves active Order when it no longer appears in the latest run while remaining available for analysis.
- [ ] **Documentation cleanup:** update/archive legacy PACR and dateless review-flag implementation notes after the replacement behavior ships.

## Deferred Enhancements

- [ ] **Comments/notes:** add comments only to durable tracked-signal or trade records, not to ephemeral screening state.
- [ ] **Statistics:** define accepted-setup and executed-trade metrics after the durable schema is in use.
- [ ] **Historical reporting:** add historical views for accepted and executed records separately from raw signal-history inspection.
