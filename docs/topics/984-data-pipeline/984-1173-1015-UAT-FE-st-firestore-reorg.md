**Topic:** ST Firestore Reorg  
**Topic Slug:** st-firestore-reorg  
**Thread:** Data Plane Consolidation  
**Thread Slug:** data-plane-consolidation  
**Issue:** #1173  
**Thread Parent:** #985  
**Topic Parent:** #984  
**Task:** #1015  
**Domain:** FE  
**Type:** UAT  
**Status:** Draft  
**Created:** 2026-10-27  
**Last Updated:** 2026-10-27  

# UAT — #1015 FE-IMPL: order-ticket.service → st-order-tickets

## Scope

Order-ticket boundary moved to canonical `st-order-tickets`: a bidirectional
mapper translates the legacy FE `OrderTicket` model ↔ `StOrderTicket` docs
(`{liv|pap}_` id prefix mirrors `mode`). Acceptance = every ticket surface
reads/writes canonical docs correctly, terminal/pending states surface
properly, migrated docs render alongside native ones, and no `liv_` doc can
carry `mode:'paper'`.

## Prerequisites

- Prod Firebase project `rel-str`; admin access via
  `functions/src/firebase-admin-init` (read-only probes under `.devin/tmp`).
- Dev server: `http://localhost:4210` (ng serve).
- Jest: `npx jest --coverage=false`.
- Canonical audit (read-only, prod):
  `cd functions && npx tsx scripts/verify/data-pipeline-st-order-tickets-1002.ts`

## Scenario 1 — prod canonical audit (prefix/mode + terminal invariants)

Feature: every `st-order-tickets` doc satisfies the canonical contract —
`{liv|pap}_` prefix mirrors `mode`, `filled` carries `fillSummary+filledAt`,
`failed` carries `lastError+terminalAt`, `cancelled` carries
`cancelledAt+terminalAt`, `staged` carries no terminal fields.

Steps: `cd functions && npx tsx scripts/verify/data-pipeline-st-order-tickets-1002.ts`
Expected: `AUDIT PASS`, 0 FAIL.
Result: **PASS** — 188 docs, **0 FAIL / 16 WARN**. WARNs are pre-existing
data, not FE writes: migrated `order-intents` `filled` docs never captured
fill data, `pap_` `filledAt` is a date vs `submittedAt` timestamp (BE/migration
quirk), and one migrated management ticket `submitted` without
`brokerOrderId`.

## Scenario 2 — prod census: mixed migrated + native docs hydrate

Feature: the hydration query (`userId ==` + `state not-in ['filled']`)
returns both migrated and native docs; nothing is silently invisible.

Steps: `npx tsx .devin/tmp/qa-probe-1015.ts` (read-only census).
Expected: nonzero doc count; both `migratedFrom:order-intents` and
`migratedFrom:none` present; zero docs missing `state`.
Result: **PASS** — 188 docs: 91 `order-intents`-migrated + 97 native;
82 live / 106 paper; 74 hydratable (29 staged, 40 submitted, 5 cancelled);
**0 docs missing `state`**; mode prefix consistent everywhere (audit S1).

## Scenario 3 — spec-level acceptance (mapper/service/store/queue/component)

Feature: bidirectional translation, terminal-field invariants, paper-doc
consume-and-repoint, cancel_pending merge, management reconcile, and the
`{liv|pap}_` boundary are all pinned by specs.

Steps: `npx jest --coverage=false order-ticket-st-mapper order-ticket.service
order-ticket.store order-queue order-ticket.component broker-order.util
order.component st-path-cutover-1014`
Expected: all green; specs assert canonical paths (`st-order-tickets`),
`{liv|pap}_` normalization, `deleteField()` terminal cleanup on requeue,
`fillSummary+lastError` on terminal batch, `pap_{tradeId}` repointing,
and `ST_ORDER_INTENTS` removed from `Collection`.
Result: **PASS** — see Results log below.

## Scenario 4 — compile + dev server

Steps: `npx tsc -p tsconfig.app.json --noEmit`;
`curl -s -o nul -w "%{http_code}" http://localhost:4210/`
Expected: zero errors; HTTP 200.
Result: **PASS** — tsc clean; dev server serves 200.

## Scenario 5 — live surface: gallery Trade → dialog → real broker order

Feature: the gallery card Trade flow stages a canonical ticket, the dialog
renders/edits it, and submit writes `state:'submitted'` + `brokerOrderId`
on the `liv_` doc; the card derives `resting` and only that card disables.

Steps (user): Signal Gallery → Trade on the PLTR card → set a limit order →
submit to Robinhood.
Expected: ticket renders in dialog; submit succeeds; the canonical doc
carries the submitted state and broker linkage; no other card is affected.
Result: **PASS** — live order placed 2026-10-21. Prod doc
`liv_PLTR-BUY-261021-WED-1028PT` verified read-only: `state:'submitted'`,
`mode:'live'`, `auto:true`, `origin:{type:'signal', signalId:'PLTR_2026-10-21_D_ST_TREND_RIDER_V1_LONG'}`,
`signalContext.decisionIds` preserved, `brokerOrderId` set, `submittedAt`
stamped. Full-predicate replay against prod (`probe-gallery-cards-1015.ts`):
205 cards → exactly PLTR `resting`/blocked, 204 tradeable — card-state
derivation verified end-to-end against real data.

**Incident during verification (resolved — NOT a #1015 defect):** the user
reported "all trade buttons disabled" shortly after the order. Investigation
proved the ticket pipeline innocent (the 205-card replay above). The global
gate is `actionsDisabled = !isActionableRun()` → `viewedRun()` null → caused
by the `st.store.ts` runs stream: `catchError → of([])` permanently empties
`runs` for the session, collapsing `isActionableRun` while cards keep
rendering from the session cache. Buttons self-healed on stream recovery.
Latent store fragility filed separately (see Results log).

## Scenario 6 — cancel_pending → cancelled (no live surface)

Feature: cancelling a submitted ticket shows "Cancelling" (not a dead
Cancel button) until the broker resolves terminal.

Steps (user): on the Order page, select a SUBMITTED ticket with a live
broker order → Cancel → observe the snackbar ("Cancel submitted — awaiting
broker confirmation"), the ticket moves to the Cancelling group, Modify/
Cancel hide, Refresh remains. After RH resolves, the ticket lands in
Cancelled with the terminal timestamp.
Expected: pending state visible; terminal transition completes on the next
reconcile tick.
Result: **SPEC-COVERED (no live UI surface)** — the Cancel control + pending
indicator live on the deprecated `signal-order` page (`order-queue` /
`order-ticket` detail). Behavior is pinned by specs: `CANCEL_PENDING`
status mapping, pending-vs-terminal precedence in `mergeWithRhOrder`,
queue group + hidden Modify/Cancel rendering.

## Scenario 7 — ticket detail: error code + filled quantity (no live surface)

Feature: a FAILED ticket renders the error category/code beneath the message;
a FILLED row shows filled quantity/price from `fillSummary`.

Steps (user): select a FAILED or FILLED ticket in the queue → ticket detail.
Expected: error `code` visible beneath the message; Fill row shows filled
qty/price (not just requested qty).
Result: **SPEC-COVERED (no live UI surface)** — the detail panel lives on the
deprecated `signal-order` page. Rendering paths are spec-pinned
(`error.code` row, `fillSummary` → filled qty/price).

## Scenario 8 — paper accept leaves no liv_ mode:'paper' doc (deprecated flow)

Feature: accept-as-paper consumes the `liv_` staged doc; the paper order
lives on the BE's `pap_{tradeId}` lifecycle doc.

Steps: accept a staged signal as paper on the Order page, then re-run
Scenario 1's audit + Scenario 2's census.
Expected: the `liv_` doc is gone; a `pap_` doc exists; audit still 0 FAIL
(any `liv_` with `mode:'paper'` would FAIL the prefix check).
Result: **SPEC-COVERED (deprecated flow)** — accept-as-paper is deprecated;
the doc-move seam is spec-verified (`deleteTicket` + `stTicketId('paper',
equityTradeId)` repoint) and the audit enforces the invariant on all
existing docs (0 `liv_` docs with `mode:'paper'` in prod).

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| CRUD + hydration on st-order-tickets (mode/origin/brokerOrderId/fillSummary) | 1, 2, 3, 5 |
| Migrated docs render alongside new-schema tickets | 2, 3, 5 |
| cancel_pending surfaced in UI | 3, 5, 6 |
| filled excluded / cancelled retained for requeue / cancel_pending handled | 2, 3, 5 |
| lastError + error category surfaced; fillSummary fill qty/price rendered | 3, 7 |
| No liv_ doc carries mode:'paper' | 1, 8 |
| Requeue clears terminal artifacts (no re-kill, no audit FAIL) | 1, 3 |
| Management tickets reconcile terminal broker states | 3 |
| No stale ST_ORDER_INTENTS / legacy path literals | 3 (pin spec) |
| No "needs review" UI | 5 (visual) |

## Refinement pass

User-facing surface: queue groups, ticket detail, snackbar copy. Manual
checks folded into Scenarios 5–7 (visual hierarchy, pending affordance,
error/fill rendering). Pending user confirmation.

## Regression smoke

- Option-order ticket, gallery card actions, ticket dialog, position sizing
  — covered by the affected-suite run in Scenario 3.
- Server callable (`paperSignalOrder` `refId` lookup) resolves FE-written
  canonical docs — canonical-first `getTicketDoc` verified at review.

## Findings

- **R2 review fixes carried into QA:** `fillSummary.filledAt` now emitted on
  both write paths; `averagePrice` derived from `executions[]` (market fills
  report `price: null`); `isRequeueableRow` rename; schema-drifted `state`
  hydrates to FAILED.
- **QA-found schema nit (fixed):** canonical program-origin tickets carry
  `auto:true` — the mapper now emits `auto = signal || program` for parity
  (FE never mints program docs; convention holds on any re-create path).
- **Accepted limitation (review-deferred):** `sourceRef` kind
  (`stop_loss`/`fractional_close`/`position_close`) has no canonical slot —
  hydrated management tickets detect stop-loss via `orderType` only.
  Blueprint-level contract decision if the distinction must survive reload.
- **QA incident → separate bug #1180:** "all trade buttons disabled" after
  the live PLTR order was the `st.store` runs stream collapsing to `[]` on
  error (`isActionableRun` → false → global gate) — NOT the ticket pipeline.
  Verified by full-predicate replay: 205 cards, only PLTR blocked. Filed:
  retry/keep-last-good for the runs stream + `isActionableRun` aged-out-run
  fallback.

## Results log

- 2026-10-27 — S1 audit: AUDIT PASS, 188 docs, 0 FAIL/16 WARN.
- 2026-10-27 — S2 census: 188 docs (91 migrated + 97 native; 82 liv/106 pap;
  74 hydratable; 0 missing state).
- 2026-10-27 — S3 specs: 362/362 green across 9 suites (mapper, service,
  store, queue, ticket component, broker-order util, page, cutover pin,
  program-origin auto parity spec added during QA).
- 2026-10-27 — S4: tsc clean; dev server HTTP 200.
- 2026-10-27 — S5: **PASS** — live PLTR limit order via gallery; canonical
  doc verified (`submitted`/`brokerOrderId`/`decisionIds`/`auto:true`);
  card-state replay: PLTR resting, 204/205 cards tradeable.
- 2026-10-27 — S6/S7: spec-covered — Cancel control + detail panel live only
  on the deprecated `signal-order` page; no live surface to exercise.
- 2026-10-27 — S8: spec-covered — accept-as-paper deprecated; doc-move seam
  spec-verified; audit confirms 0 `liv_` docs with `mode:'paper'`.
