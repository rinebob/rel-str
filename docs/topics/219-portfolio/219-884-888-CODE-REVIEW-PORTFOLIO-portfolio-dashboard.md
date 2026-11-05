**Topic:** Portfolio Dashboard  
**Topic Slug:** portfolio-dashboard  
**Thread:** Portfolio Dashboard — Update Stop Loss  
**Thread Slug:** portfolio-dashboard-update-stop-loss  
**Issue:** #884  
**Thread Parent:** #829  
**Topic Parent:** #219  
**Task:** #888  
**Domain:** PORTFOLIO  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-28  
**Last Updated:** 2026-10-28  

# Code Review — Task #888: Update mode in stop-loss dialog + positions-table Update Stop

Reviewed the uncommitted #888 change set (worktree vs HEAD): dialog update mode,
`updatableStops` derivation, positions-table Update Stop action, dashboard wiring,
`submitLabel` on the shared form. Three axes run in parallel sub-agents, followed
by remediation and a full-suite re-verification.

## Standards

Two hard findings (both remediated) plus judgement calls:

- **F1 — `isUpdatableStopOrder` missed the real stop-limit shape**
  (`portfolio-pnl.util.ts`). Literal `stop_limit` was excluded but
  `type: 'limit'` + `stopPrice` — the shape Robinhood actually returns for
  stop-limits — classified as updatable and would have been silently downgraded
  to stop-market on update. **Fixed:** limit-typed orders carrying a
  `stopPrice` are excluded; regression spec added.
- **F2 — retry diverged from the `updateEquityStopOrder` caller contract**
  (`stop-loss-dialog.component.ts`). `onRetry` re-placed on any non-cancel
  failure; the service doc requires reconcile-not-re-place for
  `phase:'place'` + `unprotected !== true`. **Fixed** (see Thermo F1).
- **F3** — stale component header doc (omitted update mode). **Fixed.**
- **F4** — `submitTicket`/`submitUpdate` were identical modulo one awaited
  call; the marketHours-pin comment was verbatim twice. **Fixed:** shared
  `runSubmission` + one `params` object.
- **F5** — `update.target` has no producer yet. **Kept:** it is the data
  contract for #889 (Open Orders preselected target); documented in the field
  comment. Judgement call.
- **F6** — `portfolio-dashboard.component.spec.ts` at 820 lines. Pre-existing
  growth, not this change set; not blocking.
- **F7** — TIF/market-hours literal unions repeat in `stop-loss-form`. #886
  surface, minor; deferred.

## Spec (issue #888 acceptance criteria)

All five criteria implemented; two test-coverage gaps found and closed:

- AC2 (single candidate skips picker) was implemented but untested — spec added.
- AC3 (prefill defaults `gtc`/`regular_hours` when absent) untested — spec added;
  marketHours prefill now asserted alongside TIF.
- An `update: { candidates: [] }` payload could have rendered a dead-end picker.
  Guarded: `onSubmit` returns early in update mode with no target (the
  dashboard already refuses to open it).
- Noted, accepted: an `extended_hours` target prefills the model while the
  pills are disabled — AC requires the original-hours prefill and submit pins
  `regular_hours` regardless.
- IMPL/TEST docs not yet synced — handled at ship per workflow.

## Thermo-Nuclear

Initial verdict REQUEST CHANGES on one blocking finding; all remediated:

- **T1 — PLACEMENT_DEAD retry path was unreachable (contract bug).**
  `submitEquityOrder`/`replaceEquityOrder` emit `PLACEMENT_DEAD` with
  `retryable: false`; gating on `error.retryable` hid Retry, amputating the
  designed fresh-ticket recovery. **Fixed:** `canRetry` keys on the phase
  contract — cancel-phase honors `error.retryable`, place-phase retries
  whenever `unprotected === true` (minting a fresh refId for PLACEMENT_DEAD in
  `onRetry`), and `unprotected !== true` offers no retry (reconcile). Spec now
  uses the real `retryable: false` shape.
- **T2 — `updatableStops` lived in the component while its sibling
  `stopLossProtectedSymbols` lives in the store.** **Fixed:** moved to
  `withComputed` — also serves the #889 Open Orders action and #890 batch
  ratchet without re-derivation.
- **T3 — six `computed()` wrappers over static `MAT_DIALOG_DATA`.** **Fixed:**
  plain readonly fields; template bindings updated.
- T4 — TIF/hours seeding duplicated between field init and `selectCandidate`.
  **Fixed:** `seedOrderParams`.
- T5 — `onClosePosition` still inlined the subscribe-refresh block after
  `openStopLossDialog` was extracted. **Fixed:** single `openThenRefresh`.
- T6 — dead `[disabled]="state() !== 'editing'"` binding inside the `editing`
  case. **Removed.**

## Test results

Full suite green: **271 suites / 4721 tests** (`npx jest --coverage=false`).
Feature-scoped re-run after remediation: 34 suites / 612 tests.

## Pass 2 — re-review of the remediated diff

A second spec + thermo-nuclear pass over the post-remediation state found two
new defects (one introduced *by* the pass-1 remediation) plus minor items:

- **R1 — `canRetry`/`onRetry` fell through on phase-less re-place failures**
  (spec + TN axes, convergent). `submitTicket` re-place failures arrive as a
  plain `ExecutionResult` (no `phase`/`unprotected`), so `canRetry` returned
  `true` unconditionally — a 409 "Reference ID must be unique" retry would
  stay armed forever even though the conflict proves the replacement exists
  and the designed recovery is reconcile-via-close. **Fixed:** `submitTicket`
  stamps `phase:'place'` + `unprotected: !(refIdConflict || PLACEMENT_
  UNCONFIRMED)` onto failed results — mirroring the primitive's own
  derivation via the newly exported `isRefIdConflictError`. Thrown errors are
  stamped too (`'place'` for bare re-places, `'cancel'` for the primitive —
  re-running cancel-first can never create a duplicate). The `canRetry`
  fallthrough now honors `error.retryable` defensively. Covered by three new
  specs (conflict disarm, retryable re-place cycle, thrown-primitive
  re-dispatch).
- **R2 — the fractional-quantity spec went vacuous** (TN). Pass 1 converted
  `quantity` from a lazy `computed()` to an eager plain field; the spec still
  mutated `MAT_DIALOG_DATA` after `createComponent`, so it asserted the
  unmutated value — `Math.trunc` could be deleted and the test would pass.
  **Fixed:** the fractional position is now injected before construction via
  a reset TestBed, so truncation is genuinely exercised.
- Minor: store comment updated to reflect that #889/#890 consumers are
  future; `selectCandidate` TIF reseed gained spec coverage.
- Noted, not changed: the replacement ticket always uses the *position's*
  whole quantity, not the target order's quantity — flagged for product
  confirmation (a partial-coverage stop widens on update). Deferred: a
  store-level spec for the `updatableStops` computed (thin wrapper over the
  spec'd pure function).

The delayed standards axis then reviewed the post-R1/R2 state and found:

- **S1 — `stampPlaceFailure` duplicated the service's classification in a
  component.** **Fixed:** the normalization moved into
  `order-execution.service.ts` as exported `asUpdatePlaceFailure()` — a
  single implementation of the place-phase contract, consumed by the dialog.
- **S2 — `'PLACEMENT_DEAD'` literal in `onRetry`.** **Fixed:** compares
  against the exported `PLACEMENT_DEAD_CODE`.
- **S3 — two comments misdescribed current contracts.** **Fixed:** the
  header now notes the PLACEMENT_DEAD fresh-refId exception to same-ticket
  retry; the `isUpdatableStopOrder` doc no longer implies `price` is part
  of the limit-typed discriminator.
- **S4 (deferred, judgement call) — file sizes.** The dialog component
  (≈260 lines) and its spec (≈570 lines) exceed the repo's size guidelines.
  The update orchestration genuinely belongs to this dialog and extracting
  a picker/flow abstraction now would be speculative — re-evaluate when
  #889 lands a third update-mode consumer.

Post-pass-2 verification: focused suites **34 / 616 tests** green;
post-standards-fix re-run 159/159 across the three touched suites.

## Verdict

**PASS** — every critical and major finding was remediated and is covered by a
spec. Remaining items are documented judgement calls or pre-existing debt
outside this change set.
