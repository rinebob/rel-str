**Topic:** Savant Trader — decision pipeline simplification
**Issue:** #205
**Topic Parent:** #176
**Domain:** SAVANT-TRADER
**Type:** PRD
**Status:** Approved — Paused for UAT (#212)
**Created:** 2026-08-29
**Last Updated:** 2026-08-30

---

## Problem Statement

The signal-review decision pipeline has two Firestore collections (`occurrence-decisions` and `order-intents`) that are created together on accept but can diverge over time. Resets delete the decision but not the intent. TTL cleanup deletes decisions after 7 days but intents persist indefinitely. The result: the order page shows symbols that signal review doesn't mark as accepted, and vice versa. The user sees inconsistent state across pages.

The decision model is also over-complicated. Five decision states (PENDING, REVIEW, ACCEPT, CONSIDER, REJECT) plus three ephemeral screening statuses (WATCH, EXCLUDE, LOW_TRADABILITY) create cognitive load with no usage payoff — the user never uses CONSIDER, rarely uses REJECT, and WATCH is redundant with the Monitor list. The Hide list is redundant with Avoid. The chart-review page has duplicative ACR buttons with obsolete styling that don't match signal review.

## Solution

Collapse the two-collection model into one: **Order Tickets**. Accepting a signal creates a single document that is both the decision and the proposed order. Resetting deletes it. One collection, one lifecycle, one source of truth. 3-day TTL.

Simplify the decision model to two states: **PENDING** (no ticket) and **ACCEPT** (has ticket). Remove CONSIDER, REJECT, EXCLUDE, LOW_TRADABILITY, and WATCH. REVIEW remains as a dateless bookmark flag, independent of the accept/ticket lifecycle.

Merge the Hide list into Avoid. Remove Hide from the enum and all UI. The four exclusive lists (Primary, Secondary, Neutral, Avoid) plus the two non-exclusive flags (Review, Monitor) cover all categorization needs.

Unify the per-symbol action buttons into one shared component used by both signal review and chart review. Remove the duplicative ACR buttons from the review header. Consistent styling, consistent behavior.

## User Stories

### Decision model

1. As a trader, when I accept a signal, I want a single order ticket to be created — not a decision plus a separate intent — so that there is one source of truth that never diverges.

2. As a trader, when I toggle accept off, I want the order ticket to be deleted — so that the symbol returns to PENDING and disappears from the order page in one action.

3. As a trader, when I accepted a signal on a prior run day and a new run arrives, I want the stale ticket to persist and show dimmed — so that I can see I previously accepted it and decide whether to re-accept for the current run.

4. As a trader, when I click accept on a stale ticket, I want it to be replaced with a fresh ticket for the current run — so that re-accepting is one click, not two.

5. As a trader, I want order tickets to expire after 3 days — so that stale tickets I never acted on don't accumulate forever.

6. As a developer, I want one Firestore collection for accepted signals — so that the signal review status, the order page list, and the header count all read from the same data and can never diverge.

### Simplified button set

7. As a trader, I want the per-symbol buttons to be: Charts, Review, Accept, Monitor, Primary, Secondary, Neutral, Avoid — so that I have all actions in one row without obsolete buttons I never use.

8. As a trader, I want CONSIDER, REJECT, and RESET buttons removed — so that the decision path is binary: I either accept (create ticket) or do nothing (leave pending).

9. As a trader, I want the Hide list removed and its symbols merged into Avoid — so that I have one "don't trade these" list instead of two.

10. As a trader, I want the Monitor button to toggle PAST_SIGNALS list membership — so that monitoring is a list operation, not an ephemeral screening status.

### Shared component

11. As a trader, I want the same action buttons with the same styling in signal review and chart review — so that the UI is consistent and I don't have to learn two different button layouts.

12. As a trader on the chart-review page, I want Accept and Monitor buttons in the chart toolbar next to the list buttons — so that I can accept or monitor a symbol while reviewing its chart without going back to signal review.

13. As a developer, I want one shared component for per-symbol actions — so that I maintain one set of buttons, one set of outputs, and one set of styles.

## Scope

### In scope

- New `order-tickets` Firestore collection replacing both `occurrence-decisions` and `order-intents`
- `OrderTicketStore` replacing `OccurrenceDecisionStore` and `OrderStagingStore`
- `OrderTicketService` replacing `OccurrenceDecisionService` and `OrderIntentService`
- Accept toggle behavior: create / delete / replace-stale
- 3-day TTL scheduled cleanup (retargeted from the current 7-day occurrence-decision cleanup)
- Shared `SymbolActionsComponent` (extended from `SymbolListActionsComponent`) with configurable button visibility
- Remove CONSIDER, REJECT, EXCLUDE, LOW_TRADABILITY, WATCH from `ReviewDecision` enum
- Remove RESET button (accept is a toggle now)
- Remove HIDE from `SymbolListName` enum and all UI
- Merge existing HIDE list data into AVOID list
- Remove ACR buttons from `ReviewHeaderComponent`
- Add Accept + Monitor to chart toolbar via shared component
- Update `CONTEXT.md` glossary (done)
- Data migration script: delete `occurrence-decisions` and `order-intents` collections, create `order-tickets` from surviving accepted decisions

### Out of scope (future issues under #176)

- Order page UI changes (queue + ticket component) — backing collection changes only
- Order execution flow (preflight, authorization, broker submission)
- Batch accept / keyboard shortcuts
- Reason-for-rejection correlation analysis (dropped)

## Data Model

### Order Ticket document

Collection: `savant-trader/data/order-tickets`

```
{
  id: string,              // {userId}__{symbol} (one ticket per symbol per user)
  userId: string,
  symbol: string,          // uppercase
  runId: string,           // run that was active when ticket was created
  marketDate: string,      // market date of the run (ISO date, not timestamp)
  direction: SignalDirection,  // LONG | SHORT
  signalType: string,      // e.g. D_ZONE_V1_UPTICK
  timeframe: SignalTimeframe,
  barDate: string,         // signal bar date
  decidedAt: string,       // ISO timestamp — used for TTL and staleness
  // Proposed order terms (defaults from signal, editable on order page)
  side: 'BUY' | 'SELL',
  orderType: 'MARKET' | 'LIMIT',
  quantity: number | null,  // null until user configures on order page
  limitPrice: number | null,
}
```

One ticket per symbol per user. Accepting a symbol that already has a ticket replaces the existing document (upsert by id). This naturally handles the stale-replace case: the new ticket overwrites the old one with the current run's context.

### Staleness

A ticket is stale when `ticket.runId !== activeRunId` (or equivalently `ticket.marketDate !== activeRunMarketDate`). The UI shows stale tickets dimmed. The staleness comparison uses the runId, which is the canonical identifier.

### TTL

Scheduled Cloud Function deletes tickets where `decidedAt < now - 3 days`. Same pattern as the current `cleanupStOccurrenceDecisions` function, retargeted to the new collection and shorter window.

## Component Design

### SymbolActionsComponent (renamed from SymbolListActionsComponent)

One component, used in both signal review and chart review.

**Inputs:**
- `symbol: string` — the symbol
- `symbolLists: Record<string, string[]>` — list membership
- `activeListFilter: SymbolListName | 'ALL'`
- `hasTicket: boolean` — whether this symbol has an order ticket
- `ticketStale: boolean` — whether the ticket is from a prior run
- `showCharts: boolean` — show the quick-charts toggle button (signal review only)
- `showReview: boolean` — show the review bookmark button (signal review only)
- `disabled: boolean` — disable mutation buttons (non-actionable run)

**Outputs:**
- `toggleCharts: string` — quick charts toggle
- `toggleReview: string` — review flag toggle
- `toggleAccept: string` — accept toggle (create / delete / replace-stale)
- `toggleMonitor: string` — PAST_SIGNALS list toggle
- `toggleList: { symbol: string; listName: SymbolListName }` — exclusive list toggle

**Button order:** Charts | Review | Accept | Monitor | Primary | Secondary | Neutral | Avoid

Buttons hidden via `showCharts` / `showReview` inputs. Chart review sets both to false. Signal review sets both to true.

### Signal review usage

The `SymbolAcrActionsComponent` is removed. The shared `SymbolActionsComponent` is rendered in the symbol row, replacing both the old ACR actions and the old list actions.

### Chart review usage

The `ReviewHeaderComponent` ACR buttons (Accept, Watch, Reject) are removed. The shared `SymbolActionsComponent` is rendered in the chart toolbar (via `signal-detail` → `chart-toolbar`), replacing the current `SymbolListActionsComponent`.

## Migration

1. **Merge HIDE → AVOID:** For each user, read `symbol-lists/{userId}__HIDE`, append its symbols to `symbol-lists/{userId}__AVOID`, then delete the HIDE doc.

2. **Create order-tickets from surviving accepts:** Read all docs from `occurrence-decisions` where `decisionType === ACCEPT`. For each, create a doc in `order-tickets` with id `{userId}__{symbol}`, copying signal context and `decidedAt`. If an `order-intents` doc exists for the same symbol+user, merge in any configured order terms (quantity, limitPrice).

3. **Delete old collections:** Delete all docs in `occurrence-decisions` and `order-intents`.

4. **Delete old list doc:** Delete `symbol-lists/{userId}__HIDE` for all users.

Migration runs as a one-time script (`functions/scripts/migrate-to-order-tickets.ts`) after code is deployed and verified.

## Files Affected

### New
- `services/order-ticket.service.ts` — replaces occurrence-decision.service + order-intent.service
- `stores/order-ticket.store.ts` — replaces occurrence-decision.store + order-staging.store
- `components/symbol-actions/symbol-actions.component.{ts,html,scss}` — shared per-symbol actions (renamed from symbol-list-actions)
- `functions/scripts/migrate-to-order-tickets.ts` — one-time migration
- `functions/src/scheduled/cleanup-st-order-tickets.ts` — 3-day TTL cleanup (replaces cleanup-st-occurrence-decisions)

### Modified
- `common/constants.ts` — remove CONSIDER/REJECT/EXCLUDE/LOW_TRADABILITY/WATCH from ReviewDecision; remove HIDE from SymbolListName; add ST_ORDER_TICKETS collection path; change TTL to 3 days
- `stores/signal-review.facade.ts` — wire to OrderTicketStore; simplify accept/reset to toggle
- `stores/group.store.ts` — read ticket status from OrderTicketStore; SymbolRow gains hasTicket/ticketStale
- `components/symbol-row/symbol-row.component.{ts,html}` — use SymbolActionsComponent
- `components/signal-detail/signal-detail.component.{ts,html}` — use SymbolActionsComponent with showCharts=false, showReview=false
- `components/review-header/review-header.component.{ts,html}` — remove ACR buttons, accept/watch/reject outputs
- `pages/signal-review/signal-review.component.{ts,html}` — wire to new component outputs
- `pages/chart-review/chart-review.component.{ts,html}` — wire to new component outputs; remove onWatchReview/onRejectReview
- `utils/utils.ts` — buildSymbolGroups reads from ticket store; remove stale decision logic
- `functions/src/index.ts` — export new cleanup function, remove old one

### Deleted
- `services/occurrence-decision.service.ts`
- `stores/occurrence-decision.store.ts`
- `stores/order-staging.store.ts` (if it exists separately)
- `components/symbol-acr-actions/` — entire directory
- `components/symbol-list-actions/` — renamed to symbol-actions
- `functions/src/scheduled/cleanup-st-occurrence-decisions.ts`
- `services/order-intent.service.ts`

## Risks

- **Data loss during migration:** If the migration script runs before code is deployed, users lose their accepted state. Mitigation: deploy code first, run migration second, verify in console.
- **3-day TTL too aggressive:** If a user doesn't log in for 3 days, their tickets are gone. Mitigation: this is acceptable per user requirements ("typically not >3"). The TTL is a constant, easily changed.
- **One ticket per symbol loses multi-occurrence granularity:** If a symbol has both a LONG and SHORT signal in the same run, only one ticket survives (last write wins). Mitigation: the user reviews one signal at a time and the most recent accept is the one they meant. Multi-occurrence tickets can be revisited if needed.

## Open Questions

- Should the order page queue show stale tickets with a visual indicator, or filter them to current-run only? (Deferred to order page issue)
- Should the migration script be idempotent? (Yes — it should be safe to re-run)

## Relationship to UAT (#212)

This PRD is **paused** while UAT continues on the current codebase. The signal review and chart review UAT sections reference the current button set (Accept / Consider / Reject / Reset / Watch). UAT scenarios that test removed buttons (2.19-2.22, 4.10-4.11) will be invalidated by #205 and should be skipped or marked N/A. UAT scenarios that test retained functionality (navigation, grouping, filtering, quick charts, list toggles, run context) remain valid and should be completed first.

New issues generated from UAT findings will be implemented before #205. After #205 is implemented, the UAT doc will be updated with the new button set and the changed scenarios will be re-tested.
