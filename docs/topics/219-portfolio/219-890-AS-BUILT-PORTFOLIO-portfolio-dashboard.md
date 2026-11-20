**Topic:** Portfolio Dashboard  
**Topic Slug:** portfolio  
**Thread:** Update Stop Loss  
**Thread Slug:** update-stop-loss  
**Issue:** #890  
**Thread Parent:** #829  
**Topic Parent:** #219  
**Domain:** PORTFOLIO  
**Type:** AS-BUILT  
**Status:** Complete  
**Created:** 2026-11-19  
**Last Updated:** 2026-11-19  

# AS-BUILT — #890 Audit Stops (peak-exposure batch tighten)

## Overview

The Equities-tab **Audit Stops** toolbar button opens a three-step
dialog that audits every updatable protective stop on the selected
account against its position's lifetime peak and tightens the stops
whose giveback exceeds a user-entered maximum. This supersedes the
original "Update All Stops" trail-percentage repricer design — the
shipped semantics are audit-first, tighten-only.

The thread's IMPL doc (`219-829-861-IMPL-…`) describes the pre-pivot
trail-% model; this document is the shipped contract.

## Semantics

- **Eligibility** — same set as per-row Update Stop:
  `updatableStopsBySymbol` (resting stop-market sells; stop-limits are
  shown but not updatable).
- **Anchor** — `PositionPeak.lifetime.price`: the position's highest
  day-bar high since entry.
- **Exposure** — `(peak − stop) / peak × 100`, rounded to one decimal.
- **Proposed floor** — `peak × (1 − giveback/100)`, rounded to cents.
- **Tighten-only** — a row updates only when the proposed price is
  strictly greater than the current stop.
- **Dispositions** — `update` | `within-policy` | `skip-no-peak` |
  `skip-no-price` | `skip-above-market` (proposed floor at/above the
  current mark would trigger immediately — skipped for a manual
  decision).
- **Giveback input** — finite, positive, ≤ 90; default 8.
- **peaksPending** — while any covered symbol's peak is still deriving,
  Audit is disabled with a "still deriving" note rather than producing
  a vacuous all-no-peak audit.

## Execution

`UpdateAllStopsService` runs exposed rows **sequentially** through
`updateEquityStopOrder` (non-reentrant broker primitive). Any failure
aborts remaining rows → `not-run`. `retryOne` is phase-aware:

- Cancel-phase failure → rerun the full primitive.
- Place-phase failure with `unprotected: true` → re-place the retained
  ticket without re-cancelling (`PLACEMENT_DEAD_CODE` gets a fresh
  refId).
- Place-phase failure without `unprotected` → not retried (replacement
  may already exist).

Replacement tickets: `timeInForce: 'gtc'`, `marketHours:
'regular_hours'`, **the order's own whole-share quantity** (ladder-safe
— not the full position quantity), `sourceRef: 'stop_loss_update'`.

The dialog closes `true` when any broker attempt ran; the dashboard
then performs an orders-only background reconcile (no full reload).

## Files

- `utils/portfolio-pnl.util.ts` — `computeStopUpdateCandidates`
- `services/update-all-stops.service.ts` — signal-based run state
- `components/update-all-stops-dialog/` — input → preview → results
- `portfolio-dashboard.component.*` — toolbar button, `peaksPending`
  derivation, dialog open + reconcile
- Table scroll fixes shipped in the same work stream: `.pd-section`
  `box-sizing: border-box`, `.pd-table-wrap` `scrollbar-gutter: stable`,
  equity cell padding 10→6px (4 tables)
- `ds-dialog.ts` — `block()` retained + global
  `html.cdk-global-scrollblock` override; `panelClass` string spread fix

## Deferrals

- Per-position stop policy persistence (giveback entered per run) —
  unfiled thread "Per-Position Stop Policy".
- Single-stop dialog uses full-position quantity for replacements
  (ladder oversell risk) — separate follow-up; batch deliberately uses
  per-order quantity.
- refId idempotency — inherited from #887's reviewed contract.
