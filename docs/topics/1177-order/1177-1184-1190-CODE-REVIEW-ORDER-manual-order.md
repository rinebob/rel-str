**Topic:** Manual Order Entry  
**Topic Slug:** manual-order  
**Thread:** Header Order Ticket  
**Thread Slug:** header-order-ticket  
**Issue:** #1184  
**Thread Parent:** #1178  
**Topic Parent:** #1177  
**Task:** #1190  
**Domain:** ORDER  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-10-23  
**Last Updated:** 2026-10-23  

# CODE-REVIEW — #1190 Option ticket manual mode + BTO/STO

## Verdict

**PASS** — three remediation rounds. Round 1 (Standards + Spec, parallel):
wrong collateral wire shape (number vs string, `equities` object vs
array, `infinite` ignored), 1k-line crossing, blocked side-flip leaving
a stale submittable ticket, ungated preview calls. Round 2
(Thermo-nuclear): a cross-source parallel-order hole (signal-sourced
live tickets didn't block manual staging) and the `manual ?`
branch-per-axis structure, reframed as staging lanes. Round 3
(re-review of the final state): a contract-retarget bypass of the
live-block guard, a stale bound-id edge, a misleading FILLED block
message, and a speculative collateral fallback — all fixed; a focused
convergence check confirmed the fixes hold. Remaining items are
documented accepted bounds.

## Scope

Working-tree diff (uncommitted at review time; the tree also carries
the user's in-flight #1017 refactor in the same files — out of scope,
covered by its own review):

- `components/option-order-ticket/option-order-ticket.component.{ts,html,spec.ts}`
- `components/option-order-ticket/option-collateral-preview.ts` (new)
- `components/gallery-ticket-dialog/gallery-ticket-dialog.component.spec.ts`
  (obs-service stubs + placeholder spec rewritten for the real form)
- `services/manual-order.service.ts` (dynamic-import cycle fix only)
- `services/order-execution.service.ts` (`buildOptionOrderArgs`
  delegates to the shared wire builder — behavior-identical)
- `utils/option-collateral.util.ts` (new)
- `utils/option-ticket-lookup.util.ts` (new)
- `utils/option-stage-lane.util.ts` (new)
- `utils/option-order-wire.util.ts` (new)

## Round 1 findings → dispositions

### Standards

- **Collateral parser contradicted the captured wire shape — fixed.**
  Live captures (`docs/topics/657-rh-mcp/captures/opt-rev-csp.json`,
  `opt-rev-naked.json`) show `cash.amount` as a **string** (`"4000.0000"`),
  `equities` as an **array** of `{symbol, uncovered_shares}` objects, and
  a `cash.infinite` flag. The first pass read a number and treated
  equities as an object — the line would have rendered nothing against
  the real API while specs passed on a wrong-shaped mock. Rewritten and
  extracted to `option-collateral.util.ts`; spec fixtures now mirror the
  captures.
- **`cash.infinite` ignored — fixed.** A naked-call review returns
  `amount:"0.0000", infinite:true`; the old parser rendered "Locks ~$0
  cash". Now surfaces "Unlimited risk — the broker may reject this
  order" (+ uncovered-shares line when reported), matching the tool's
  own guide ("warn on cash.infinite=true").
- **File crossed 1k lines (1075) — fixed.** Parser+text →
  `option-collateral.util.ts`; adopt/block probes + LIVE statuses →
  `option-ticket-lookup.util.ts`; preview lifecycle →
  `OptionCollateralPreview` (component-scoped injectable). Component now
  979 lines.
- Judgement calls: qty-keystroke refires one advisory call (accepted —
  collateral scales with qty); dynamic import is the repo's only
  production `await import(` (accepted — minimal NG0919 seam);
  `t.legs[0]?.side` chains (v1 single-leg, accepted).

### Spec

- **Blocked side-flip left a stale submittable ticket — fixed.** A flip
  to a live-blocked side kept the opposite-side ticket bound and
  `canSubmit` didn't consult `stageError`. Now the bound ticket is
  unbound before the guard, `canSubmit` gates on `stageError`, and the
  bound path clears stale errors (flip-back re-adopts cleanly). Spec'd
  end-to-end.
- **Preview fired on empty account / while blocked / on unrelated ticket
  patches — fixed.** Tracked deps are now exactly what RH's collateral
  math reads (contract, qty, side, account, blocked, resolving).
- Verified traces: `staged` emits `created:false` on adopt;
  mount does not double-stage; preview is manual+sell-only; manual
  tickets carry no provenance; `OPT-MAN-{BTO|STO}` ids; wire args match
  `buildOptionOrderArgs` (now literally shared).

## Round 2 findings → dispositions

### Thermo-nuclear

- **MAJOR: cross-source parallel-ticket hole — fixed.**
  `findManualOptionTickets` filtered `source === MANUAL`, so a
  signal-sourced *live* ticket on the same contract+side didn't block a
  manual stage — two live orders on one contract. Dropped the filter
  (`findMatchingOptionTickets`) to match the equity path's stated
  invariant: any STAGED adopts, any live blocks. Specs: signal-STAGED
  adopt (created:false) + signal-live block.
- **MAJOR: seven `manual ?` branches — reframed.** New
  `option-stage-lane.util.ts`: `signalOptionLane` / `manualOptionLane`
  return `{side, probe, blockMessage, canStage, build}`;
  `doEnsureStagedTicket` is now mode-free — the bound check is a uniform
  side test and the unbind unconditional (signal bound tickets are
  always 'buy').
- **MINOR: preview effect missing `resolving()` gate + refires on ticket
  patches — fixed.** `resolving()` added to the guard; the bound
  ticket's account is read untracked.
- **MINOR: second owner of the `review_option_order` wire shape —
  fixed.** `option-order-wire.util.ts` owns the snake_case contract;
  `OrderExecutionService.buildOptionOrderArgs` delegates (verified
  behavior-identical: its spec suite passes unchanged).
- **NIT:** `collateralText` identity wrapper deleted — template binds
  `collateral.text()` directly.

## Round 3 findings → dispositions

Re-review of the remediated final state (fresh axes, real-defects bar):

### Standards

- **MINOR: spec file crosses the 1k cap (1,487 lines) — accepted
  bound.** Seven spec files in the repo already exceed 1k (up to
  1,920); the cap has been enforced on source files only in practice.
  Recorded, no split.
- **MINOR: `LIVE_OPTION_TICKET_STATUSES` vs the new `isLiveOrderTicket`
  — merge-order note.** `isLiveOrderTicket` is uncommitted #1017 work
  in the same tree; depending on it would entangle the #1190 ship.
  The option set deliberately includes FILLED (blocks re-stage, not
  just live). Consolidation belongs to whoever lands #1017.
- **MINOR: `?? 100` magic literal — fixed.** Now
  `DEFAULT_DOLLAR_AMOUNT` from `signal-order-staging.util.ts`.

### Spec

- **MINOR: FILLED twin blocks with a false "live order" message —
  fixed.** The manual lane's `blockMessage` takes the blocker and
  words FILLED distinctly ("already filled — reload to place
  another"). Blocking semantics kept: the equity path's twin guard
  also blocks any non-STAGED twin, and the {contract, side} identity
  can't resurrect until the dead twin ages out of the map on reload.
- **Low-confidence: `uncovered_shares ?? quantity` fallback —
  fixed.** Dropped the `quantity` guess; a covered-call entry without
  `uncovered_shares` would have rendered a false "Requires ~N shares
  held". Advisory is now strictly honest.

### Thermo-nuclear (final state)

- **MAJOR: contract-retarget bypasses the live-block guard — fixed.**
  The bound-ticket re-leg early-return ran before the contract probe;
  retargeting a bound manual ticket onto a contract with a live/FILLED
  same-side ticket re-legged past the guard → submittable → parallel
  live order (and a FILLED twin's identity resurrected). New
  `OptionStageLane.isSameIdentity` gates the re-leg: signal lane is
  always same-identity (bound ticket IS the card's), manual requires
  contract match. A retarget now unbinds + runs the full guard —
  blocking on live, adopting a STAGED twin for the target contract.
  Spec: retarget onto a live same-side ticket blocks, T0 untouched.
- **Stale bound-id edge (surfaced during remediation) — fixed.** The
  unbind keyed on the resolved ticket, not the bound id: a bound
  ticket absent from the store map skipped the unbind and left a stale
  `ticketId`. Now keyed on `this.ticketId()`; the retry effect
  re-binds legitimately via probe+adopt.
- **MINOR: signal-lane FILLED block still says "live order" — accepted
  bound.** Signal-mode FILLED block is a corner case (card tickets
  reconcile terminal between sessions); the manual lane — where
  mid-session fills actually occur — is covered.

## Test results

- `tsc --noEmit -p tsconfig.app.json` — clean.
- Focused: 208/208 after round 3 (option-ticket 76 — incl. FILLED-
  message and contract-retarget specs, dialog 34, execution service,
  manual-order service); 206/206 after round 2.
- Full suite after round 2: 256/257 suites green; the one failing suite
  is `scanner.component.spec.ts` — 13 × `NG0201: No provider for
  ActivatedRoute` from the user's in-flight #1199 `?variant=` prototype
  (`scanner.component.ts` injects `ActivatedRoute`; its spec doesn't
  provide it yet). Unrelated to this diff — deferred to that work.
- Earlier full-suite run (mid-remediation): 257/257, 4421 tests green.

## Accepted bounds (recorded, no action)

- Advisory preview fires one review call per quantity change — qty is a
  discrete input and collateral scales with it; no debounce.
- `OptionCollateralPreview` is component-scoped (one instance per ticket
  mount) — correct for a per-form advisory.
- `findMatchingOptionTickets` uppercases the symbol defensively;
  component callers already pass uppercase.
- Dynamic `import()` for the dialog component is the repo's only
  production dynamic import — the minimal seam that breaks the NG0919
  cycle without changing dialog ownership.
- `option-order-ticket.component.spec.ts` at 1,487 lines — spec files
  over 1k are established convention (7 precedents up to 1,920); the
  cap is enforced on source files (component: 986).
- `LIVE_OPTION_TICKET_STATUSES` vs `isLiveOrderTicket` (#1017, in
  flight) — consolidate when that work lands; the option set's FILLED
  inclusion is deliberate re-stage blocking.
- Signal-lane FILLED block reads "live order" — corner case; the
  manual lane is covered.
- Signal lane's card-scoped probe never sees manual tickets — a card
  ticket retargeted onto a contract with a live manual order re-legs
  past that guard (the mirror of the round-3 fix). Pre-existing
  card-scoped semantics, the documented product decision; flagged for
  possible follow-up hardening, not changed in this task.
- Manual probe is not account-scoped — a STAGED twin minted under a
  different account is adopted and submits under the ticket's account.
  Pre-existing adopt semantics.
- An externally-removed bound ticket with no `stageError` leaves the
  form resolved-but-unbound with no retry trigger — a select wiggle
  re-stages. Recoverable; no submit-integrity impact.

## UAT note

Verified in-app by the user before review: manual dialog opens (post
cycle-fix), Option tab resolves contracts, BTO/STO toggle stages both
identities, collateral line renders on sell side.

**QA semantics change (#1226 UAT):** the live-order block was removed
from BOTH manual lanes — `ManualOrderService.stageEquityTicket` (both
the upfront and post-await probes) and the option lane's `isBlocking`
(now `() => false`). Rationale: manual intent governs — adding to a
position or running a parallel order is legitimate; each minted ticket
tracks its own broker order via its minute-keyed doc + refId. What
remains: STAGED adoption (dedup, source-agnostic) and the same-minute
id-collision guard on both paths (a non-STAGED same-id twin would be
clobbered by `.set()` — "try again in a moment"). The signal/card
lane's live-or-FILLED block is unchanged — a separate product decision
for card-driven staging.
