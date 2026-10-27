**Topic:** Manual Order Entry  
**Topic Slug:** manual-order  
**Thread:** Header Order Ticket  
**Thread Slug:** header-order-ticket  
**Issue:** #1184  
**Thread Parent:** #1178  
**Topic Parent:** #1177  
**Task:** #1191  
**Domain:** ORDER  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-10-23  
**Last Updated:** 2026-10-23  

# CODE-REVIEW — #1191 Header New Order button + STAGED-only re-resolve

## Verdict

**PASS** — three rounds, converged. Round 1 (Standards + Spec, parallel):
a same-symbol re-resolve defect that destroyed a configured option leg,
plus minor items (dead CSS class, release-tracking gap on failed delete).
Round 2 (Thermo-nuclear): one MAJOR — a stale option `staged` emit could
bind a wrong-underlying ticket after a mid-flight symbol swap — plus two
spec-fidelity items. Round 3 (convergence re-review, Standards + Spec on
the post-remediation state): both axes PASS — every criterion MET, all
remediation verified; two MINORs found and fixed inline (normalized the
emit guard's symbol comparison; dual-key probe extended to `ticket()`/
`optionTicket()` so a mid-dialog `loadTickets()` rehydrate can't strand
the binding) plus one NIT (pre-existing dead log comment removed).

Verified: tsc clean, focused suites 104/104, full suite 259/259
(4467 tests).

## Scope

Working-tree diff (uncommitted at review time; the same files carry
in-flight #1017/#1207/scanner hunks — out of scope, covered by their own
reviews):

- `core/comps/header/header.component.{ts,html,spec.ts}` — `newOrder`
  output + authenticated-only stroked button
- `core/core.component.{ts,html,spec.ts}` — `(newOrder)` →
  `ManualOrderService.open()`
- `components/gallery-ticket-dialog/gallery-ticket-dialog.component.{ts,html,spec.ts}`
  — `resolveLocked`, swap/release logic, stale-emit guard
- `services/manual-order.service.{ts,spec.ts}` — `releaseTicket` seed
  impl + tracking semantics

## Round 1 findings → dispositions

### Standards

- **Dead `new-order-btn` class on the header button — fixed.** No SCSS
  rule existed for it; removed from `header.component.html`
  (`data-testid` remains the spec hook).
- **`gallery-ticket-dialog.component.ts` ~408 lines — accepted.** Crosses
  the repo's 400-line smell threshold marginally; the component is one
  cohesive surface (two modes, one effect graph). Splitting now would
  scatter the binding-state logic this task relies on. Soft call, logged.
- **Mid-flight race during async stage/release — verified safe.**
  `pendingDiscards` in `order-ticket.store.ts:560-574` already handles a
  ticket transitioning to SUBMITTING while a release is in flight; the
  drain removes it only if the submit reverts to STAGED.

### Spec

- **Same-symbol re-resolve destroyed the bound option leg — fixed
  (real defect).** `resolveSymbol` skipped the equity release when
  `prev === staged.id` but still released `prevOpt` — pressing Enter on
  the same ticker discarded a configured option ticket. Now the whole
  release block is gated on `prev !== staged.id`; a `prev === null`
  rebind still clears stale option state.
  `gallery-ticket-dialog.component.ts:299-315`; regression spec
  `same-symbol re-resolve keeps the bound option leg` in the dialog spec.
- **Failed Firestore delete orphaned the tracked ticket — fixed.**
  `releaseTicket` used `createdTicketIds.delete(id)` before the discard
  call, so a failed delete dropped the id from close-cleanup tracking.
  Now `.has()` guards the attempt and `.delete()` runs only on the
  removal path — a failed delete stays tracked and the `afterClosed`
  pass retries. `manual-order.service.ts:255-275`.
- Acceptance criteria otherwise met: authenticated-only button,
  output-only header (no service import), core wiring, STAGED-unlock /
  SUBMITTING+-lock semantics, same-symbol adoption, failed-resolve
  binding preservation, created-vs-adopted release — all spec'd and
  passing.

## Thermo-Nuclear

- **MAJOR — stale option `staged` emit can bind a wrong-underlying
  ticket post-swap — fixed.** `OptionOrderTicketComponent` emits
  `staged` *before* its stale-seq bail; a stage in flight while the user
  re-resolves to a different symbol lands its emit on a dialog already
  bound to the new underlying. Pre-#1191 the symbol couldn't change so
  the stale emit was always same-underlying; this task's unlock made it
  cross-underlying. `onOptionStaged` now binds `optionTicketId` only
  when the emitted ticket's `symbol` matches `displaySymbol()` (both id
  spellings probed — the map is mixed-keyed); the emit still reaches
  `onStaged` so the ghost is tracked and discarded at close.
  `gallery-ticket-dialog.component.ts:408-423`; regression spec added.
- **MINOR — mid-resolve submit loses a failed order's error — accepted
  bound.** A submit racing the swap's `releaseTicket` lands in
  `pendingDiscards`; on submit failure the drain deletes the ticket and
  its error never surfaces in the dialog (now bound to the new symbol).
  Defensible "user moved on" semantics; the error still lives in
  Firestore on the drained doc path. Flagged, not gated.
- **MINOR — spec mocks hid real store behavior — fixed.** Dialog spec's
  `manualRelease` now actually removes STAGED entries from the tickets
  map (post-release states are exercised, including the ghost path);
  service spec's `discardIfStaged` mirrors the SUBMITTING→`pendingDiscards`
  branch.
- **Ordering fragility guarded by comment.** An `await` inserted between
  the swap's release calls and the signal writes would expose a
  transiently-unbound `optionTicketId` to the close effect — flagged at
  `gallery-ticket-dialog.component.ts:306-309` so future edits don't
  introduce the interleave.
- Verified clean: `resolveLocked` covers FAILED/SUBMITTING/PAPER/done and
  the option-only in-flight case; `releaseTicket` created/adopted/retry
  semantics match `discardIfStaged`; same-id adoption skip; mixed-key
  `liv_` rehydration can't strand `manualTicketId`; header placement is
  authenticated-only and `open()` single-flights double-clicks.

## Round 3 — convergence re-review (post-remediation)

Both axes re-ran on the final state. All five acceptance criteria MET
(statically verified with file:line evidence); all round-1/2 fixes
confirmed holding. Two MINORs fixed:

- **Case-sensitive emit guard.** `t.symbol === expected` could reject a
  *legitimate* emit on the gallery card path — `data.option.symbol`
  comes through as raw `card.symbol` (unnormalized) while tickets store
  uppercase. Now compares `.toUpperCase()` on both sides.
  `gallery-ticket-dialog.component.ts:419`.
- **Bare-key-only binding lookups.** `ticket()`/`optionTicket()` probed
  only `tickets()[id]` — a mid-dialog `loadTickets()` rehydrate (fired
  by page-entry/header-refresh paths, now reachable from any route via
  the header launch) would rekey session tickets under `liv_` and
  strand the binding. Both computeds now go through a `ticketById`
  helper probing both spellings — same convention as `discardIfStaged`
  and the emit guard. `gallery-ticket-dialog.component.ts:165-175,225-232`.
- **NIT:** pre-existing dead `console.log` comment removed from
  `handleMenuOpen` (`header.component.ts:41-43`).
- Noted, deliberate: New Order button is not `[disabled]` during auth
  `loading()` — the sibling buttons disable because they trigger auth
  transitions; opening the dialog doesn't. Left as-is.

## Test evidence

- `npx tsc --noEmit -p tsconfig.app.json` — clean.
- Focused (post-remediation): `header.component`, `core.component`,
  `gallery-ticket-dialog`, `manual-order.service` — **104/104**.
- Full suite: **259 suites / 4467 tests — all green.** (An earlier run
  raced the remediation edits and showed 4 stale failures; re-run clean.)
