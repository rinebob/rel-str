# RH Agent Latest-Only Action Workflow

**Status:** Signal workflow implemented through Phase 3; legacy execution transition superseded
**Updated:** 2026-07-17

## Purpose

Define which RH Agent signals are actionable, which user choices are durable, and how the review, chart-review, and order pages share context.

This document owns signal screening and the durable `ACCEPT`/`REJECT` lifecycle. Broker orders, fills, positions, stops, targets, and exits belong to `RH-AGENT-DIRECT-MCP-EXECUTION-WORKFLOW-2607-01.md`. The progression from human initiation to strategy automation belongs to `RH-AGENT-AUTOMATION-PROGRESSION-2607-01.md`.

This document supersedes older workflow and PACR-planning statements that describe persistent review queues, persistent rejection/consideration decisions, historical-run ACR activity, or automatic adoption of prior ACR decisions.

## Core Decision

Only the **latest completed actionable run** is eligible for active screening, review, `ACCEPT`/`REJECT` decisions, or creation of a signal-originated order draft.

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
- Historical records remain fully inspectable through signal and chart review, but cannot create or modify active ACR decisions or signal-originated order drafts.
- Users may always navigate to Order to continue the current Order process; historical inspection does not block navigation or hide the active accepted-occurrence workflow.
- Once an order intent exists, its broker order and resulting position remain visible and manageable across run transitions. Broker management is not latest-run scoped.

## Ephemeral Screening

Most signals are screened out quickly by list membership, chart quality, fundamentals, or user judgment. These outcomes are deliberately ephemeral.

The following are session/UI state only and are not durable records:

- Unreviewed signals.
- Symbols opened for chart inspection.
- Review queue membership.
- Passes, soft skips, and other screening outcomes that are not an explicit `ACCEPT` or `REJECT` decision.
- Any ACR state that does not create a source-specific durable decision record.

When the latest run changes, this transient state is discarded from active UI. No expiry job, historical triage queue, or cleanup write is required.

## Durable Signal Decision and Downstream Trading

An explicit user `ACCEPT` or `REJECT` decision is durable immediately, including during intraday runs. Do not wait for nightly processing: the source run and signal state at the time of the decision are required context.

### Signal occurrence identity

A durable decision belongs to one specific signal occurrence, not to a symbol/day status.

- The initial occurrence identity is `runId + symbol + timeframe + signalType`.
- The durable record snapshots `marketDate`, `barDate`, direction, signal status, relevant indicators, decision timestamp, and future user identity/notes.
- Decisions from different runs on the same symbol/day are separate records and never overwrite one another.

### ACCEPT

`ACCEPT` means: **this is a good setup worth keeping and potentially trading.**

An accepted occurrence remains available for creation of an Order draft only while that same occurrence is still present in the latest completed run. If a newer latest run no longer contains it, the accepted record leaves active Order automatically but remains available for later analysis. Any already-created order intent and broker activity remain durable under the separate execution workflow.

### REJECT

`REJECT` means: **the user evaluated this specific signal occurrence and decided it was not a worthwhile setup.**

Rejected occurrences are historical decision data only. They do not create an active queue, do not carry forward as a rejection of a later occurrence, and are retained for future analysis, education, and possible workflow acceleration.

### Whipsaw reversals

Whipsaw reversal handling is deferred. A later opposite-direction occurrence for the same symbol and timeframe is treated as a new, independent signal occurrence. It must not overwrite the earlier occurrence or its decision. A dedicated `WHIPSAW_REVERSAL` decision type and linkage field will only be introduced when whipsaw tracking becomes a priority.

### Broker execution is separate

`EXECUTED` is retired as a signal-decision status. Submission, fill, and position are distinct broker facts and cannot be represented by extending `ACCEPT`.

A signal occurrence retains only its `ACCEPT` or `REJECT` decision. Downstream order intents link back to an accepted occurrence without mutating that decision. The UI derives order and position activity from linked broker records.

This separates:

1. What the agent detected.
2. What the user explicitly accepted or rejected about a particular occurrence.
3. Which exact order the user authorized.
4. What Robinhood reported about orders, fills, and positions.

## Page Flow

1. **Run Dashboard** is the starting point. It shows recent runs, identifies the latest completed actionable run, and is the only entry point to active signal review.
2. **Signal Review** displays only that latest run's signals and supports fast, ephemeral screening.
3. **Chart Review** receives only symbols selected from that current run. It supports deeper inspection and acceptance.
4. **Order** remains reachable from all workflow views and contains eligible accepted occurrences from the current latest-run workflow. It creates editable order drafts; preflight and authorization are explicit and separate from acceptance.
5. **Trade Management** shows broker orders and positions across all runs and includes every position in the configured Agentic account regardless of origin.
6. **Historical views** allow full prior-run signal and chart research, but their occurrences are read-only with respect to ACR decisions and creation of new signal-originated order drafts.

The pages are separate navigation steps but share one latest-run context. They do not create independent date contexts.

## Non-Goals

- Persisting every review, consider, or skip action; only explicit per-occurrence `ACCEPT` and `REJECT` decisions are durable.
- Reopening an old run as an active ACR/order session.
- Automatically carrying prior-run screening decisions into the latest run.
- Treating raw signal storage as the user's trade-management record.
- Defining broker submission, fills, positions, protection, exits, or automated strategy authorization; those belong to the linked execution and automation documents.

## Implementation Task List

No code change is authorized by this document until this task list is reviewed. Complete the work in order; do not combine the workflow rewrite with unrelated signal-storage changes.

### Phase 1 — Establish the latest-run action boundary

- [x] **Dashboard entry point:** make the Run Dashboard the active-workflow entry point and clearly identify the latest completed actionable run.
- [x] **Latest-only decision gate:** allow full signal/chart inspection and normal navigation for every run, but permit ACR decisions and changes to active Order/execution state only for occurrences in the latest completed run. Present historical occurrences as decision read-only, not page or route read-only.
- [x] **Viewed versus actionable context:** keep the user-selected/viewed run separate from the latest completed actionable `runId` and `marketDate`. The viewed run drives research display; the actionable context drives decision eligibility. Do not derive eligibility from arbitrary historical selection or from today's date alone.
- [x] **Active-run header:** display the current run information in the Signal Review page header using the same visual treatment and metadata shown by Run Dashboard. Display the same header in Chart Review when it is in Signals mode; omit it for non-signal/history browsing modes.
- [x] **New-run transition:** when a newer run becomes latest, discard in-memory screening state from the prior run and disable only its decision mutations. Preserve normal navigation, historical signal/chart research, and access to the active Order process.

### Phase 2 — Make screening ephemeral

- [x] **Remove durable screening behavior:** stop creating/loading/persisting dateless review flags and non-decision PACR screening state for the active workflow. Preserve immediate durable persistence only for source-specific `ACCEPT` and `REJECT` decisions.
- [x] **In-memory triage state:** retain only the latest run's current symbol selection, chart-review queue membership, and temporary screening choices across normal page navigation.
- [x] **Chart Review input:** populate Chart Review exclusively from the ephemeral selection made in Signal Review for the current latest run.
- [x] **Historical decision guardrails:** disable only ACR, queue-entry, Order-mutation, and execution-mutation controls for an older occurrence. Keep historical signal/chart inspection and normal navigation, including access to Order, available.
- [x] **Legacy data policy:** leave existing triage-decision and review-flag documents readable during transition, but do not use them to populate active queues. Define later whether they are retained, archived, or removed.

### Phase 3 — Persist source-specific ACR decisions

- [x] **Decision schema:** define one durable occurrence-level record for each explicit `ACCEPT` or `REJECT` choice. It must snapshot/reference the source `runId`, `marketDate`, symbol, timeframe, direction, signal type, `barDate`, indicator payload, decision type, decision time, and user identity.
- [x] **Occurrence identity:** key decisions by `runId + symbol + timeframe + signalType`, never by symbol/date alone, so multiple intraday occurrences do not overwrite one another.
- [x] **Decision transitions:** make `Accept` and `Reject` persist immediately; do not persist skipped, merely reviewed, or `CONSIDER` state.
- [ ] **Whipsaw linkage (deferred):** detect a later opposite-direction occurrence for the same symbol/timeframe and link it to the prior occurrence only when whipsaw tracking becomes a priority.
- [x] **Order input:** make Order read accepted occurrences only while they remain present in the latest run; remove no-longer-current accepted occurrences from active Order without deleting their historical records.
- [x] **Accepted-not-executed state:** retain accepted setups that are never traded for setup-quality review and statistics, outside the active Order workflow.
- [x] **Firestore boundary:** add the collection constants, security rules, indexes, and service/store ownership for occurrence-level decisions in one focused change.

### Phase 4 — Replace the superseded execution transition

The prior `executedAt`/`EXECUTED` implementation and locally inferred `OPEN` trade model predate direct Robinhood MCP discovery. They are legacy behavior to remove, not the target architecture.

- [x] **Retire signal execution status:** remove `EXECUTED` and `executedAt` from occurrence-decision behavior while preserving `ACCEPT`/`REJECT` history.
- [x] **Remove legacy execution UI:** remove Mark Executed, Claude/bridge execution controls, and locally inferred trade persistence. Linked broker order/position activity remains part of the direct-MCP implementation.
- [ ] **Preserve source linkage:** link new order intents to accepted occurrences without changing the occurrence decision.
- [ ] **Move execution ownership:** implement order, capacity, broker synchronization, stop, target, and exit behavior only under `RH-AGENT-DIRECT-MCP-EXECUTION-WORKFLOW-2607-01.md`.
- [ ] **Keep management cross-run:** broker orders and positions remain manageable after their source run becomes historical.

### Phase 5 — Validate and clean up

- [ ] **Route-flow coverage:** verify Dashboard → Signal Review → Chart Review → Order uses one latest-run context across navigation.
- [ ] **Eligibility coverage:** verify a prior run can be inspected but cannot feed active screening, acceptance, Order, or execution.
- [ ] **Transition coverage:** verify a newly completed run clears only ephemeral screening state, while accepted decisions and linked broker records remain available.
- [ ] **Decision coverage:** verify accepting and rejecting each persist one complete source-specific occurrence record; verify an accepted setup with no order intent leaves active Order when it no longer appears in the latest run while remaining available for analysis.
- [ ] **Documentation cleanup:** update/archive legacy PACR and dateless review-flag implementation notes after the replacement behavior ships.

## Deferred Enhancements

- [ ] **Comments/notes:** add comments only to durable tracked-signal or trade records, not to ephemeral screening state.
- [ ] **Statistics:** define accepted-setup and broker-confirmed trade metrics after the durable schemas are in use.
- [ ] **Historical reporting:** add historical views for accepted decisions and broker-confirmed activity separately from raw signal-history inspection.
