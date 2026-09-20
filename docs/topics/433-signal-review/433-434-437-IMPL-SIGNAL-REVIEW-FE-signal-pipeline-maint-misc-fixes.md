**Topic:** Signal Pipeline Maintenance  
**Topic Slug:** signal-pipeline-maint  
**Thread:** Misc fixes  
**Thread Slug:** misc-fixes  
**Issue:** #437  
**Thread Parent:** #434  
**Topic Parent:** #433  
**Domain:** SIGNAL-REVIEW  
**Type:** IMPL  
**Status:** Complete  
**Created:** 2026-09-19  
**Last Updated:** 2026-09-20  

# Implementation Plan â€” FE: Misc fixes lane

## Lane structure (skeleton blueprint)

This Thread is an open-ended maintenance lane, not a bounded feature. Blueprint output is intentionally thin:

- One area Blueprint: **FE** (both seed items are frontend; no BE or SHARED work identified â€” decision writes go through existing stores/services, no function or contract changes).
- No phases â€” seed items are independent, unordered, and small. Phases can be introduced per-item later if a promoted item warrants them.
- **Task template** â€” each promoted inventory item gets a task issue under the FE Blueprint: labels `FE,IMPL,MAINT,SIGNAL-REVIEW,4_BACKLOG`, Status `NOT STARTED`, body = problem statement + acceptance-criteria checkboxes + links to this IMPL/TEST doc and the PRD item section.

## Item 1 â€” Unlock ACR actions on prior runs

### Current mechanism

- `group.store.ts` computes `isActionableRun` = `activeRunId() === latestCompletedRun()?.id` (viewed run is the latest completed run).
- `symbol-row.component.html` binds `[disabled]="!isActionableRun()"` on `<app-symbol-acr-actions>`.
- `signal-review.facade.ts` wraps every mutation (`markForReview`, `acceptSymbol`, `considerSymbol`, `watchSymbol`, `rejectSymbol`, `resetSymbol`, `clearSymbolHistory`, `clearReviewFlags`) in `runIfActionable`, which returns early when `isActionableRun` is false.
- Mutation bodies already use `activeRunId()` / `activeRunMarketDate()` â€” i.e., the *viewed* run's context â€” so once the gate is relaxed, decisions and staged tickets naturally write against the viewed run.

### Approach

1. Replace the "latest only" gate with a "completed run" gate: a run is actionable when the viewed run exists and is a completed run (any vintage), not necessarily the latest. Concretely this means redefining the gate around `viewedRun()` status rather than comparing to `latestCompletedRun()` â€” exact signal naming/location decided at task time (e.g., `isViewedRunCompleted`).
2. Rebind `symbol-row.component.html` `[disabled]` to the new gate.
3. Update `runIfActionable` in the facade to use the new gate.
4. Verify each mutation path writes against the viewed run (accept â†’ `occurrenceStore.acceptSignals` + `stageTicketForSymbol` with viewed `runId`/`marketDate`; reject/reset similarly).
5. Confirm staged ticket `signalContext.decisionId` embeds the viewed runId (it does â€” built in `buildSignalOrderTickets` from the passed `runId`).

### Risks / watch-items

- `group.store.ts` `onInit` effect clears *ephemeral* screening state on new-run transitions â€” durable decisions are per-run and unaffected. Verify prior-run triage statuses display correctly against the viewed run (durable counts come from `occurrenceStore`).
- `decisionStale` display already exists for decisions from a different run â€” keep it.
- Reject on a prior run writes a durable reject against that run's marketDate â€” user confirmed prior-run signals are still actionable and does not use Reject; accepted risk.

## Item 2 â€” Order queue header aggregates + real row data

### Current mechanism (`order-queue.component.*`)

- Header shows only `totalCount()`.
- `groups()` computed already buckets tickets into 8 status groups (Staged, Submitting, Submitted, Queued, Resting, Open Positions, Failed, Cancelled), filtering out empties.
- Row renders: date (`signalContext.barDate` else `createdAt` else `â€”`), source badge (`SIG`/`MAN`/`POS` else `???`), symbol, price (if loaded), side, order type, quantity-or-dollar (`quantity` else `dollarAmount` else `$defaultDollarAmount`), PROTECTED badge, Requeue (cancelled only).

### Approach

1. **Header aggregates:** render per-group chips in `.queue-header` â€” label + count for every group (decide at task time whether empty groups show `0` or are omitted). Add a **Staged dollar total**: sum `parseFloat(ticket.dollarAmount)` over Staged equity tickets, falling back to `defaultDollarAmount` when absent; option tickets' `quantity` are contracts â€” exclude from the dollar sum (mixed units) and note the caveat in the task.
2. **Row field audit / placeholder replacement:** replace the three fallback-looking values with honest data:
   - `???` badge â†’ render the raw `ticket.source` (or omit the badge) rather than a placeholder.
   - `â€”` date â†’ omit the date span when neither barDate nor createdAt exists rather than showing a dash.
   - `$100` default-dollar fallback â†’ distinguish an estimated/default amount visually (e.g., `~$X` or a tooltip "default amount") so it doesn't read as a real value.
   - Anything else identified as placeholder during implementation gets the same treatment â€” show real data or clearly-marked estimates.

### Risks / watch-items

- `dollarAmount` is a string field â€” parse and guard NaN.
- Option tickets (multi-leg) have no dollar amount; keep them out of the staged-$ total rather than fabricating a number.
