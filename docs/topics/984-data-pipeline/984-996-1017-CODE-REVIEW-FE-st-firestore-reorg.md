**Topic:** ST Firestore Reorg  
**Topic Slug:** st-firestore-reorg  
**Thread:** Data Plane Consolidation  
**Thread Slug:** data-plane-consolidation  
**Issue:** #996  
**Thread Parent:** #985  
**Topic Parent:** #984  
**Task:** #1017  
**Domain:** FE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-22  
**Last Updated:** 2026-10-23  

# CODE REVIEW — #1017 occurrence-decisions write removal in gallery flow

## Verdict

**PASS** — three review rounds, converged. Round 1 found four convergent
majors (thermo axis, one shared with Standards) plus ~12 minors/nits;
Round 2 (full-axis re-review) found seven lifecycle/probe majors plus
minors; Round 3 (targeted delta review of the r2 fixes) found one
residual race class plus two lows. Everything remediated and
re-verified — the delta review's verdict on the final code is clean.
No remaining critical/major findings.

## Round 2 — re-review findings and remediation

Re-run of all three axes against the post-r1 state (requested as a
repeated review until no new findings).

### Major (all remediated)

- **M1 — config cache bypass on direct entry**
  (`signal-review.facade.ts`). `stageTicketsForSymbol` read config via
  `firstValueFrom(loadConfig())`, which returns config but does NOT
  populate `TradingConfigService._config` — the ticket dialog bound
  `tradingConfig: null`, disabling account gating and Place Order on a
  direct signal-review/chart-review Trade. Fixed: `ensureConfig()`.
- **M2 — blind ticket store on direct entry**. `loadTickets()` ran only
  from the gallery and order pages; a direct signal-review entry probed
  an empty `ticketsBySymbol` and could stage a duplicate beside a
  persisted STAGED/live ticket. Fixed: `enterPage()` now calls
  `stagingStore.loadTickets()`. Pin added.
- **M3 — option-tab stage leaking past dialog close**
  (`option-order-ticket.component.ts`). A `stageTicketAndWait` resolving
  after the dialog closed emitted into a destroyed host —
  `createdTicketIds` never saw the id, so the persisted STAGED ticket
  survived a "cancel". Fixed: `DestroyRef`-driven `destroyed` flag; a
  post-destroy stage discards its ticket and returns null.
- **M4 — provenance-scoped live-order probe**
  (`gallery-card-actions.service.ts`). `tradeCard` only checked tickets
  matching the card's `decisionIds` — a live equity ticket with
  different provenance (manual flow, another run) was invisible to the
  dup guard. Fixed: symbol-wide equity probe precedes the card-scoped
  reopen; live check also precedes STAGED adoption.
- **M5 — STAGED reopen could win over a coexisting live ticket**
  (facade + gallery service + manual-order service). All three probes
  now check live/non-terminal FIRST (`status !== STAGED &&
  !TERMINAL_TICKET_STATUSES.has(...)`), so a live order vetoes reopen
  and a terminal ticket does not veto staging — also resolves the
  Spec-axis F1 branch-table deviation (terminal tickets no longer
  block). Pins added (live+STAGED coexist → block; FILLED-only →
  stages).
- **M6 — second Trade click while dialog open stacked a second
  dialog**. `tradeInFlight` released when staging returned, before the
  dialog closed. Fixed: the guard now releases in `afterClosed`
  (facade); gallery `openTicketDialog` got a parallel `openDialogs`
  set with the same close-release (gallery-view.component.ts).
- **M7 — discard dropped on the floor for a SUBMITTING ticket**
  (`order-ticket.store.ts`). Dialog closed mid-submit →
  `discardIfStaged` silently no-opped (not STAGED) → the submit-failure
  revert left a leaked STAGED ticket. Fixed: `pendingDiscards` queue —
  `discardIfStaged` on SUBMITTING queues the id; a `withHooks` drain
  effect removes the ticket if the submit reverts to STAGED and clears
  the entry on any other outcome. Drain resolves both id spellings
  (`stDocId` twin) like the discard itself. Pins added (revert→removed,
  submit-success→survives, no stale requeue fire).

### Minor (all remediated)

- `requeueCard` re-reads ticket status inside the busy window — a
  cross-client advance can no longer be reverted to STAGED by a stale
  snapshot.
- Stale "Manual order creation coming soon" placeholders —
  `order.component.ts` and `order-ticket.component.ts` now call
  `ManualOrderService.open()` (their buttons are live; manual orders
  exist). Specs got a `ManualOrderService` stub provider.
- Stale `ManualOrderService` docblock — it adopts ANY STAGED equity
  ticket on the symbol, not only STAGED-MANUAL ones.
- Four copies of the account-config snackbar literal centralized as
  `NO_ACCOUNT_SNACKBAR` in `signal-order-staging.util.ts`.
- `scripts/verify/design-system-foundation-migration-1171.ts` dropped
  the deleted `triage-report.component.scss` from its file map.
- User-side concurrent fixes folded in: duplicate `manual` computed in
  `option-order-ticket.component.ts` (merge artifact) removed; their
  double-`render()` spec was split into two tests during their WIP
  (noted, not mine).

### Round-2 verification

- `tsc --noEmit` — fully clean (the two earlier baseline errors were
  resolved by concurrent user edits).
- Savant Trader feature suite: **127/127 suites, 2,529 tests** pass.
- `git diff --check` — clean.
- New r2 pins: ticket-store hydration on `enterPage`, live-before-
  STAGED coexistence, terminal-doesn't-block staging, `pendingDiscards`
  queue/drain (revert→remove, success→survive).

### Round-2 nits (accepted)

- `decisionId` provenance naming unchanged — same deferred sourceRef
  follow-up as round 1.
- Facade size (~570 lines) — extraction deferred; scope discipline.
- `symbol-list-actions .acr-btn` — unrelated live component, unchanged.

## Round 3 — delta review of the r2 fixes

A targeted correctness pass over only the r2 hunks found one residual
class plus one low item — all closed:

- **Final-await live re-check missing** (LOW-MED, two sites + the
  manual path). The live-ticket probes ran before the config/price
  awaits; a live ticket landing during them could still yield a
  parallel STAGED ticket. Fixed: re-probe after the last await in
  `stageTicketsForSymbol`, `stageCardTicket`, and `stageEquityTicket`;
  `tradeSymbolInner` also re-probes after staging returns and discards
  the fresh twins if a live ticket appeared.
- **Manual-owned STAGED adoption** (LOW). With the manual dialog open,
  a signal-review Trade click could adopt the manual STAGED ticket and
  stack a card dialog on it. Fixed: `ManualOrderService.dialogOpen`
  getter; the facade no-ops the adopt while the manual dialog owns it.
- **Drain-key consistency** (self-review). The `pendingDiscards` drain
  now resolves both id spellings (`stDocId` twin) like
  `discardIfStaged`, surviving a mid-flight `liv_` rekey.
- **Predicate dedup.** `isLiveOrderTicket` exported from
  `order-ticket.types.ts`; all four "a live order exists" probes share
  it (the drift between copies is what produced the r2 findings).

Round-3 verification: `tsc --noEmit` clean; feature suite **127/127
suites, 2,529 tests**; `git diff --check` clean.

## Summary of all three axes

**Spec:** clean. Both task acceptance boxes are satisfied — no live
readers/writers of `savant-trader/data/occurrence-decisions` remain
(service + store deleted, `Collection.ST_OCCURRENCE_DECISIONS` gone,
rules ACL removed, `st-path-cutover` pin spec asserts non-reintroduction),
and the decision-related services/state (vocabulary, status chips,
triage report, screening statuses, stale-decision row fields) are gone.
Deterministic `buildStOccurrenceDecisionId` ids remain as ticket
provenance join keys by design (never documents).

**Standards:** found the shared session-scope major plus naming/dead-code
minors; all remediated.

**Thermo-nuclear:** found three real majors — session-reject run-scope
leak, `tradeSymbol` re-entrancy, mixed-direction provenance corruption —
plus three hardening items; all remediated.

## Round 1 — findings by severity

### Critical

None.

### Major (all remediated)

- **M1 — session-reject map not run-scoped** (`gallery-card-actions.service.ts`).
  A card rejected under run A would sink the same `symbol:side` card
  under run B — the durable model got run scope free from the doc id.
  Fixed: internal `_rejectedByRun` map keyed `${runId}:${cardKey}`;
  public `rejectedCards` projects the active run back to plain card
  keys. Pin test added (reject → switch run → card actionable → switch
  back → still rejected).
- **M2 — `tradeSymbol` re-entrancy** (`signal-review.facade.ts:383`).
  No busy guard: two rapid clicks both pass the ticket probe and
  stage/open twice. Fixed: per-symbol `tradeInFlight` set. Pin test
  added (second click during pending signal fetch → one stage, one
  dialog).
- **M3 — mixed-direction provenance corruption** (`signal-review.facade.ts`).
  An unpartitioned LONG+SHORT signal set staged an invisible
  opposite-side ticket AND corrupted option provenance —
  `findCardTickets` skips the side check for OPTION tickets, so a mixed
  `decisionIds` set statuses both cards and lets Reject on the wrong
  card delete the staged option ticket. Fixed: `pickTradeDirection`
  partitions to one side (active direction filter, or the reopened
  ticket's side, else LONG), reports the skipped side via snackbar.
  Pin test added.
- **M4 — reject during in-flight Trade/Paper** (`gallery-card-actions.service.ts`).
  A stage completing after a Reject left a submittable ticket on a
  rejected card. Fixed: `rejectedCards` re-checked inside the busy
  window in `tradeCard` and `paperCard`; `rejectCard` drops while the
  card is busy (buttons are busy-disabled anyway).

### Minor (all remediated)

- `tradeSymbol` fetched signals before the equity probe — a live ticket
  did not block the no-signals manual fallback. Probe moved first.
- No run-switch re-check after the signals `await` — staging under a
  stale run id. Re-check added.
- `stageTicket` → `stageTicketAndWait` (pessimistic persist — the dialog
  may submit immediately; parity with `stageCardTicket`).
- Facade's `actionContext` duplicated the service's derivation —
  delegated to `actionsService.actionContext`.
- `symbol-acr-actions` → `symbol-actions` rename (component class,
  selector `app-symbol-actions`, directory, `index.ts` export,
  `symbol-row` import/template).
- Stale class names: `review-header` `.header-acr`/`.acr-btn`/
  `.stage-accepted-btn` → `.header-trade`/`.trade-btn`/
  `.order-queue-btn`; `signal-review-header` `.accept` → `.order`.
- Dead CSS removed: `signal-list.component.scss` `.status-badge` block;
  `chart-review.component.scss` `.review-queue-list` block (~145 lines —
  no template references).
- `triage.store.ts` commented-out persistence calls deleted (the #1016
  seam breadcrumb at the load-path site is retained).
- Spec hygiene: stale `occurrenceDecisions` mock member removed from
  `gallery-view.component.spec.ts`; unused `setFullscreen` mock removed
  from `signal-review.facade.spec.ts`; `#719` spec title updated for the
  no-decision world.
- `DATA-MAP.md`: `occurrence-decisions` row marked **removed #1017**
  (data pending #1013 deletion); the merge-candidate bullet resolved —
  ticket existence is the order intent.
- Mojibake (`â†'`, `â€"`) in `symbol-history.store.ts` comments fixed.

### Nit (accepted, not blocking)

- `symbol-list-actions` `.acr-btn` class names — unrelated live
  component (list-membership buttons); rename is out of scope.
- `buildStOccurrenceDecisionId` / `signalContext.decisionId(s)` naming
  retained — renaming the provenance schema is a separate sourceRef-kind
  follow-up, not this task.
- `manual-order.service.ts` diff mixes the task's `initialSymbol` seed
  with the user's concurrent #1189 adoption rewrite (`#1189 r3`
  comment) — flag for ship-time per-hunk staging.
- `functions/scripts/cleanup-st-occurrence-decisions.ts` retained
  intentionally — pinned to #1013's data deletion.
- Pre-existing `tsc --noEmit` baseline errors in
  `scripts/bulk-swing-sweep.ts` and
  `indicator-config-dialog.component.ts` — both files unmodified in this
  worktree; unrelated WIP, out of scope.
- Legacy `jasmine.createSpy` usage in untouched specs — shim-supported
  style per AGENTS.md.
- Jest worker force-exit after the feature suite (open handles) — all
  reported suites/tests pass; recurring, not introduced here.

## Test results

- `tsc --noEmit` — clean on all task files (two pre-existing unrelated
  baseline errors, see nits).
- `git diff --check` — clean on task files.
- Savant Trader feature suite: **127/127 suites, 2,506 tests** pass
  (round 1); **2,529 tests** pass after round 2.
- Full app suite baseline (pre-remediation): 257/257 suites, 4,389
  tests pass.
- 11 stale specs were rewritten during implementation; remediation added
  three new r1 pins (run-scope isolation, in-flight guard, direction
  partition) plus a live-ticket-blocks-manual-fallback pin.
