**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Core Infra  
**Thread Slug:** core-infra  
**Issue:** #559  
**Task:** #567  
**Topic Parent:** #553  
**Domain:** PAPER-TRADING  
**Type:** CODE-REVIEW  
**Status:** Final  
**Created:** 2026-09-26  
**Last Updated:** 2026-09-26  

# Code Review — #567 Signal-order page: accept-as-paper

**Verdict: PASS** (4 rounds — ran until clean; round 4 CONFIRMED CLEAN)

## Summary

Staged signal tickets gain an **Accept as Paper** action:
`OrderTicketStatus.PAPER` (persisted, no `result.orderId` so RH
merge/reconcile skip it naturally), `paperSignalOrder` via the new
`PaperTradingService`, a `Paper` queue group + teal `PAPER` badge, and
the confirm dialog reused in `paper: true` mode (distinct title, icon,
"no order is placed at the broker" note).

## Spec compliance — all criteria met

- Paper action gated to staged signal tickets (`canAcceptAsPaper` —
  STAGED + SIGNAL_PIPELINE + non-OPTION + `decisionId`).
- Callable → PAPER transition; PAPER badge; no RH-order polling (no
  `orderId` → `mergeWithRhOrder`/`reconcileTerminalStatuses` skip).
- Error → snackbar, ticket stays STAGED.
- Specs: ticket (gating, mapping, merged-preview confirm, re-entry,
  error, cancel, missing context), queue (Paper group + badge), page
  (PAPER pre-RH-load visibility, no-merge, remove-skip).

## Round 1 — findings → resolution

- **[MED] Confirm dialog showed stale ticket** — raw `i` passed while
  edits were applied after confirm → dialog now gets
  `{...i, ...preview()}` (same as `onSubmit`); spec asserts edited qty
  appears in dialog + callable.
- **[MED] PAPER tickets batch-deletable** — removing the ticket would
  orphan the server-side cohort → `onRemoveTickets` skips PAPER with an
  explanatory snackbar.
- **[LOW] Dead OPTION branch / silent LONG default** — direction now
  derives from `ticket.side` (can't disagree with the backend's
  side/direction cross-check); OPTION early-return keeps `i.symbol`
  narrow-safe.
- **[LOW] Re-entry** — `acceptingPaper` guard, and the flag is now held
  from dialog open through the callable (closes the double-dialog race).
- **[LOW] Spec gap** — PAPER pre-`rhLoaded` visibility covered.
- **[NIT] `.group-paper` dot collided with resting purple** — paper is
  now teal `#00838f` everywhere.

## Round 2 — CONFIRMED CLEAN

All remediations verified in place; the post-review double-dialog race
was found + fixed (flag held across the dialog await).

## Round 3 — finding → resolution

- **[LOW] `acceptingPaper` could stick true if the dialog await
  rejected** — the dialog `firstValueFrom` sat outside the try/finally.
  → the whole dialog-await + guard + callable is now inside `try`, with
  the flag released only in `finally`. Bonus: a dialog-stream rejection
  now shows the failure snackbar instead of an unhandled rejection.
- Spec gap closed: cancel path asserts `acceptingPaper` released.

## Round 4 — CONFIRMED CLEAN

Every exit path (early returns, cancel, dialog error, callable error,
success) verified to leave the flag correct; nothing new in the skim.

## Test results

- Targeted suites: **88/88** (order-ticket 19, order-queue 39,
  order.component 30).
- Full Jest **2004/2004**, `ng build` clean.

## Notes

- `saveEdits` persists pending edits before the dialog — same semantics
  as `onSubmit` (a cancelled confirm still saves edited terms).
- `order-ticket.component.ts` is ~930 lines — past the 400 smell
  threshold; decomposition is a real follow-up, not blocking.
- Backend `paperSignalOrder` is idempotent on `refId` — a retried accept
  returns the existing cohort rather than duplicating.
