**Topic:** ST Firestore Reorg  
**Topic Slug:** st-firestore-reorg  
**Thread:** Data Plane Consolidation  
**Thread Slug:** data-plane-consolidation  
**Issue:** #988  
**Thread Parent:** #985  
**Topic Parent:** #984  
**Domain:** DATA-PIPELINE  
**Type:** IMPL  
**Area:** FE  
**Status:** Draft  
**Created:** 2026-10-14  
**Last Updated:** 2026-10-14  

# IMPL — Data Plane Consolidation: FE (Angular)

## Overview

FE work is narrower than BE but has a hard requirement: **no dead UI**. Every surface reading a renamed/removed collection must be rewired or deleted in the same release as the BE cutover.

## Components

### 1. Path constants + service re-points

- `src/app/features/savant-trader/common/constants.ts` + service-local collection paths → new `st-` paths (mirrors SHARED constants).
- `order-ticket.service.ts` → `st-order-tickets` — CRUD + hydration reads, new fields (`mode`, `origin`, `brokerOrderId`, `fillSummary`, `cancel_pending` state).
- Symbol-list services → `st-symbol-lists`.
- Paper-trading services (trades/stats views) → `st-paper-trading/*` paths.
- Portfolio/allocation services → `st-portfolio/*` paths.
- Backtest viewers → `st-backtest-*`.
- Signal readers (gallery, review pages) → `st-signals` once dual-write verified (interim coverage is a *feature gain* — gallery sees intraday signals it couldn't before).

### 2. review-list removal

- Inventory every FE reader/writer of `savant-trader/data/review-list` (marker service, "needs review" badges/indicators, facades, filters).
- Remove the writes, reads, and the UI affordances they feed — verified no dead UX.

### 3. occurrence-decisions removal

- Gallery/order flow stops writing decision docs (ticket existence = decision).
- Remove decision-related services/state (accept/reject triage already superseded by direct-order flow).

### 4. Ticket UX updates

- `cancel_pending` state surfaced in order UI (cancel submitted ≠ cancelled — show pending state until terminal).
- `fillSummary`/`lastError` displayed on ticket detail (fill price/qty, error category).

## Dependencies

- SHARED contracts (types/paths) first.
- FE cutovers pair with BE phases — each area swaps reads only after the BE dual-write is verified.

## Risks

- Stale readers on renamed paths — mitigate with a grep inventory per collection before cutover (every `collection(`/`doc(` call site).
- The `status:'paper'` legacy intent docs mapped to `mode:'paper'` — FE hydration must not treat old `paper` status values as a *state* when reading migrated docs.
