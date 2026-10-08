# Code Review — #592 FE Order ticket: optional bucket selector, warn-not-block, fill-time seeding

**Status:** Complete — PASS (1 round; all major findings fixed and re-verified)  
**Topic:** Portfolio Allocation (#576)  
**Blueprint:** #582 (FE)  
**Task:** #592  
**Date:** 2026-09-28  

## Scope

- `src/app/features/savant-trader/utils/order-guardrails.util.ts` (+spec) — `bucketTargetWarnings` (warn, never block)
- `src/app/features/savant-trader/services/order-ticket.types.ts` — `BaseOrderTicket.strategyName?`
- `src/app/features/savant-trader/stores/signal-review.facade.ts` (+spec) — signal tickets auto-stamp `strategyName = signalType`
- `src/app/features/savant-trader/components/order-ticket/order-ticket.component.ts` / `.html` / `.spec.ts` — bucket select, `matchedBucket`, over-target warning
- `src/app/features/savant-trader/stores/order-ticket.store.ts` (+spec) — FILLED-transition seeding via `seedFromTicket$`
- `src/app/features/portfolio-dashboard/allocation.store.ts` (+spec) — `ensureAccount` (load a non-selected account)
- `src/app/features/savant-trader/pages/signal-order/order.component.spec.ts` — AllocationStore stub provider
- `shared/portfolio-allocation-utils.ts` — NEW `matchBucketBySlug` canonical resolver (added in fix pass)
- `src/app/features/portfolio-dashboard/position-attribution.service.ts` — `seedFromTicket$` delegates to `matchBucketBySlug` (fix pass)

## Round 1 (3-axis)

### Standards

- No hard violations. `seedFromTicket$` call args match the real service
  signature; Angular conventions (standalone, signals, `@if`/`@for`,
  `inject`, untracked effect writes) all clean; no `as never`/`as any`.
- **Major (fixed)** — duplicated slug-resolution logic between component
  `matchedBucket` and `seedFromTicket$`, *with divergent semantics*
  (`.find()` first-match vs exactly-one). Extracted
  `matchBucketBySlug` into `@portfolio-allocation/utils`; both sides
  consume it.
- **Minor (fixed)** — partial `as BucketDetail['stats']` fixture cast →
  full `BucketStats` literal via `satisfies BucketDetail`.
- **Minor (noted)** — mixed jest/jasmine spy idioms in new spec blocks;
  consistent-with-file is defensible (AGENTS prefers jest.fn, new mocks
  comply; `jasmine.objectContaining`/`calls.mostRecent` remain in a few
  new assertions).
- **Nit (noted)** — `computeWarnings` lacks an explicit return type.

### Spec

- AC1 (no-bucket submits): MET — picker has explicit Unassigned option;
  `onSubmit` gates on account/quantity only.
- AC2 (over-target warns, not blocks): MET — `bucketTargetWarnings` names
  bucket, exposure, projected, target; severity `warning`.
- AC3 (strategy-driven auto-stamp): MET for the signal-pipeline path
  (`signalType` stamped). PARTIAL/acknowledged: "scheduled strategies"
  from the issue body have no FE ticket path today — nothing to stamp
  until they exist; when one is added it must stamp its strategy name.
- AC4 (fill seeds attribution): MET — FILLED transition calls
  `seedFromTicket$(account, symbol, strategyName, orderId)`.
- **Minor (noted)** — warning is best-effort: `ensureAccount` is async
  fire-and-forget; a submit before stats load skips the warning rather
  than blocking on it. Accepted — warn-not-block must never delay submit.

### Thermo-nuclear

- **MAJOR (fixed)** — divergent slug resolution (as Standards above):
  two ACTIVE buckets sharing a slug would preview as matched but seed
  as Unassigned. One canonical resolver now.
- **MAJOR (fixed)** — account-source divergence: picker scoped to
  `tradingConfig().accountNumber` while seeding uses
  `ticket.accountNumber`; a config change between stage and fill would
  silently Unassign. Picker now prefers `ticket.accountNumber` — the
  same value `submitEquityOrder` sends to RH.
- **Minor (fixed)** — sell-side fills could seed an attribution for a
  position being exited. Seeding now gated to `side === 'buy'`.
- **Minor (fixed)** — seeding ran before the persisted FILLED write;
  reordered so `batchUpdateTerminalStatus` goes first.
- **Minor (noted)** — cross-feature coupling: `OrderTicketStore`/
  component import `PositionAttributionService`/`AllocationStore` from
  portfolio-dashboard. The dependency direction is inherent to the
  feature (trading → allocation attribution); a facade indirection was
  judged speculative generality. Revisit if a second consumer appears.
- **Minor (noted)** — non-signal tickets can't reach the reconcile path
  today (`source !== SIGNAL_PIPELINE` skip), so a manual ticket's bucket
  pick can't seed. Moot while manual order creation is unbuilt; when it
  lands, seeding must lift the source restriction.
- Verified: `seedFromTicket$` txn semantics (existing-doc no-op,
  in-txn ACTIVE re-verify, `wrote` reset across txn retries) correctly
  handle fill races.

## Fixes applied post-review

1. `matchBucketBySlug` added to `shared/portfolio-allocation-utils.ts` —
   exactly-one-ACTIVE semantics, null on 0/ambiguous/un-slugifiable.
   `seedFromTicket$` and `matchedBucket` both consume it; spec added for
   the ambiguous-slug parity case.
2. `ticketAccount` prefers `ticket.accountNumber` over tradingConfig.
3. Fill-time seeding gated to `side === 'buy'`; sell-fill no-seed spec.
4. Seed loop reordered after `batchUpdateTerminalStatus` issue.
5. Spec fixture uses a complete `BucketStats` (no partial cast).

## Test results

- Full suite: **160 suites / 2172 tests — all green**
- Focused re-run post-fix: 121 suites / 2009 tests — all green.

## Verdict: PASS

No remaining major or critical findings. Minor findings are documented
above as deferred-by-design or cosmetic.

## Post-review simplification (2026-09-30, user-directed)

QA surfaced that the name→bucket resolution machinery was overkill.
Amended design: the ticket stores `bucketId` (the picker writes it);
`seedFromTicket$` takes the id verbatim — txn still re-verifies
exists+ACTIVE+same-account — no `strategyName` field, no auto-stamp,
no `matchBucketBySlug` (removed). Signal type remains visible via
`signalContext` (new read-only Signal row on the ticket). Spec docs
amended (PRD/IMPL), UAT + QA checklist updated. All touched spec files
updated; suite green.
