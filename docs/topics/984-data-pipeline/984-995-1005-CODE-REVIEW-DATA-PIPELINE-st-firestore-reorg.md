**Topic:** ST Firestore Reorg  
**Topic Slug:** st-firestore-reorg  
**Thread:** Data Plane Consolidation  
**Thread Slug:** data-plane-consolidation  
**Issue:** #995  
**Thread Parent:** #985  
**Topic Parent:** #984  
**Task:** #1005  
**Domain:** DATA-PIPELINE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-18  
**Last Updated:** 2026-10-18  

# CODE REVIEW — BE-IMPL: expression-fill reads staged tickets + minted trade IDs (#1005)

**Verdict: PASS** (round 3) — three review iterations converged; all findings fixed and regression-tested. Round-1 critical (cross-day retry double-staging) and majors (cancel-vs-mint, lost group join, seed-ownership asymmetry, file-size cap) verified fixed. Round-2 majors (post-snapshot double-mint window; permanent missing-group wedge) fixed via in-loop dedupe recheck + post-mint sibling detection + `group_join`/`no_entry_fill` `lastError` stamping. Round-3 majors (staged-cancel stranding a minted OPEN trade; unconditional post-ledger-cancel ticket write; template-identity coverage gap in `uncoveredSpecs`) fixed and tested; the focused re-check of those seams came back clean of criticals/majors.

## Round 3 — findings + fixes

| # | Finding | Fix |
|---|---|---|
| T1 | Staged-ticket cancel ignored already-minted trades → cancelled ticket + live OPEN trade, no heal path | `handleCancelPaperTrade` checks `listTradesByTicketId`; live stamped trade → `failed-precondition`; cancelled/expired stamped trades still allow the cancel (heal case) |
| T2 | Post-ledger-cancel `markCancelled(pap_{tradeId})` unconditional → could cancel a foreign accept's staged ticket at a shared seed | Ownership guard: `refId === trade.ticket.refId` OR `signalContext.signalId === trade.signalId` (definedness-checked); foreign → warn + skip |
| T3 | `uncoveredSpecs` covered by trade-id == seed only → a suffixed member id re-staged a covered template | `memberTemplateKeys` (key + expression) coverage over cohort members |
| S1 | `signal-order-retry` → `callables` value-import cycle | `buildCohortDoc`/`hasTemplate` moved into `signal-order-retry.ts`; only `import type` remains |
| T8/F1 | `markCancelled`'s `applied:false` discarded → false "cancelled" success | `applied` checked on the ticket-only branch → re-read + `failed-precondition` |
| T9/F2 | `heal()` stamped `averagePrice: 0` on a trade with no entry fill | Defers + `recordTicketError('no_entry_fill')` — ticket stays staged, wedge diagnosable |
| T4 | Minted trades dropped `expressionTemplate` (in-place fills keep it) | `contractOverrides.expressionTemplate` stamped (whitelisted in `PaperTradeOverrides`) |
| — | `errors[].tradeId` carried ticket ids | Renamed `id` |

New tests: minted-trade-blocks-staged-cancel, dead-stamped-trade-allows-cancel, `applied:false` mapping, foreign/owned post-ledger-cancel ticket write, suffixed-member template coverage, `noteError` missing-doc zombie guard, in-loop dedupe race, post-mint sibling detection.

## Round 2 — findings + fixes

- In-loop `listTradesByTicketId` recheck before each seq-scan attempt — closes the dedupe-stale window where a loser pass could mint `seq+1` after the winner committed mid-MCP.
- `ALREADY_EXISTS` retry now re-checks the winner's `ticketId` — heals when ours, rescan only when foreign.
- Post-mint sibling detection — loud `logger.error` for manual cleanup (delete deliberately avoided: it would orphan ledger/account position legs).
- Failed `addMembers` (mint + heal paths) stamps `lastError: group_join` and leaves the ticket staged; the next pass replays the join. A permanently missing group converges via the retry path's `ensure`/`buildGroupDoc` rebuild (fill pass deliberately does not rebuild — it knows only one member and would write a partial doc).
- `noteError` → `update()` (missing doc warns instead of minting a stateless zombie).
- Retry member lists cohort-scoped (`expressionIds`, `pendingMembers`, group rebuild) — same-signal non-cohort trades (auto-paper ingest) can't suppress or join.
- Cancel recheck moved before `selectContract` — a cancelled ticket skips the MCP calls.
- Legacy quantity unified (`legacy.order.quantity`); cancelled-seed heal returns `skipped` not `filled`.

## Change set

- `shared/st-order-tickets.ts` — `StTicketSignalContext.signalId` (caller-passed retry-visible id), `StOrderTicket.cohortId` soak bridge, `tracking` retyped to `OrderTicketTrackingFields`.
- `shared/paper-trading-contracts.ts` — `PaperTicket.ticketId` lineage, `PaperTradeOverrides` contract fields (strike/expiration/optionType).
- `functions/src/order-tickets/st-order-ticket-writer.ts` — `listStagedExpressionTickets()`, `resolveTicketSeed()`, `get()`, `markTicketCancelled` dep surface via `markCancelled`.
- `functions/src/paper-trading/callables.ts` — staged-ticket emission at accept (equity + one per expression template, `create()`-idempotent), retry self-heal (re-emit missing tickets, rebuild cohort/group, equity-ticket heal, uncovered-seed specs), staged-ticket cancel path.
- `functions/src/paper-trading/passes/expression-fill-pass.ts` — staged-ticket source, contract selection → minted `stTradeId` with `ticket.ticketId` back-stamp, legacy `PENDING` drain in place, `sameAcceptMember` ownership predicate, `heal()` path, seq-race retry with ticketId re-check.
- `functions/src/paper-trading/repository.ts` — `listTradesByTicketId`, `listTradeDocIdsByPrefix`.
- `functions/src/paper-trading/ledger.ts` — `EntryFillInput.dims.ticket`, contract overrides plumbing.
- `functions/src/position-groups/st-position-group-writer.ts` — `addMembers` for minted members.
- `functions/src/screenshot-capture/tracking.ts` + `shared/screenshot-capture-contracts.ts` — `intent*` → `orderTicket*`/`ticket*` identifier renames; persisted `LifecycleCarrierKind='intent'` retained (data-migration boundary).
- `functions/scripts/verify/paper-trading-signal-order-564.ts` — prod verify updated to staged-ticket assertions + `markTicketCancelled` wiring.
- Tests: `expression-fill-pass.test.ts` (+mint/race/ownership/cancel specs), `signal-order.test.ts` (retry re-emission, cross-refId adoption, partial-legacy members), `cancel-paper-trade.test.ts` (staged-ticket cancel), `st-order-ticket-writer.test.ts`, screenshot-capture specs.

## Spec coverage (issue #1005 ACs + IMPL-BE Phase 4 + TEST-BE)

All 13 mapped criteria **PASS** with file:line evidence (spec axis, round 3): staged-ticket source, read-only MCP contract resolution, canonical minted id + contract stamps, staged-ticket-as-pending, staged cancel with minted-trade guard, full lineage (cohort/group/ticket/signal), idempotent + race-aware writes, legacy PENDING drain, `lastError` on skips, retry self-heal, fill-wins/cancel-before-mint race doctrine.

## Round-1 findings (all fixed — regression-tested)

### Critical

- **C1 — Cross-day retry double-stages expression tickets.** `callables.ts:222-224` derives `idDate` from the retry's `marketDate`; `memberSeeds` rebuild at `:324-338` re-keys every seed on the retry clock. A retry on a later market date misses `tickets.get(pap_{origSeed})`, `resolveTicketSeed` returns a fresh base, and `uncoveredSpecs` emits a second staged-ticket set while the originals stay staged → the fill pass mints two positions per template and the group rebuild stamps wrong `memberTicketIds`. Fix: derive the member-seed date from `eqTrade.createdAt` (the "rebuild from stored dims" doctrine the cohort rebuild already follows).

### Major

- **M1 — Cancel-vs-mint atomicity regressed.** `st-order-ticket-writer.ts:121` deliberately lets `filled` win over `cancelled`, and nothing re-checks the ticket between `listStagedExpressionTickets` (`expression-fill-pass.ts:180`) and `applyEntryFill`/`applyPendingFill`. A `staged→cancelled` landing mid-pass still mints an OPEN trade and flips the ticket `filled`. Pre-#1005 cancel/fill were mutually exclusive txns on one trade doc. Fix: re-read the ticket's state immediately before the ledger call; honor non-`staged` states.
- **M2 — Failed group join after mint is permanently lost.** `expression-fill-pass.ts:520-527` swallows `addMembers`' `false` and unconditionally `markTicketFilled`s — the ticket goes terminal so the heal-replay at `:344-351` can never fire (same hole inside `heal()` itself). Fix: gate `markTicketFilled` on join success when a group is targeted; a failed join leaves the ticket staged so the next pass replays.
- **M3 — Fresh-path seed ownership is refId-only.** `st-order-ticket-writer.ts:284` — an accept that crashes after ticket emits but before any trade write leaves same-signal tickets that a refId-differing retry treats as foreign → `-2` duplicate staged members, both fillable. The retry path already adopts on refId-OR-signalId (`callables.ts:332-333`); unify the doctrine in one seed resolver.
- **M4 — `callables.ts` = 1,186 lines; `handlePaperSignalOrder` ≈510-line god function.** Guideline §1 hard cap is 1k; the retry/self-heal block (`:299-505`) interleaves five concerns. Extract `runSignalOrderRetry` + a shared `resolveMemberSeeds` helper (also fixes the duplicated seed-resolution loop at `:247-258` vs `:324-338`).

### Minor

- `heal()` stamps `fillSummary.averagePrice: 0` when the covering trade lacks an entry fill (`expression-fill-pass.ts:355`) — a real-looking 0-price fill.
- `dims.ticket.signalId ?? ''` (`:495`) writes an empty-string lie for manual-origin tickets — omit the field.
- `listStagedExpressionTickets` swallows query errors → silently-empty pass (`st-order-ticket-writer.ts:317-322`) — should rethrow so the scheduler sees the outage.
- `sameAcceptMember` ownership predicate triplicated (`expression-fill-pass.ts:244-251`, `callables.ts:331-334`, `:452-454`) — one canonical predicate.
- `deps.tickets`/`deps.groups` optionality doubles branching; production always wires both — make required.
- `SOURCE_BY_ORIGIN` maps `program`/`management` with no producers — speculative.
- Minted trade drops canonical `origin.signalId` (occurrence id becomes fallback-only) — deliberate but loses the trade→`st-signals` join.
- `getTicketDoc`'s unbounded `where refId==` scan grows per ticket (`callables.ts:739-742`).
- `createPendingTrade` lost its last production caller (tests/verify only) — arguably intentional for drain tooling.
- `Mysterious Name` — `fillTicket` means "mark ticket filled" (`auto-paper-ingest-pass.ts:395`) vs "mint trade from staged ticket" (`expression-fill-pass.ts:332`).
- Raw `￿` literal in doc-id range bound (`repository.ts:323`) — prefer `'\uffff'`.

### Nit / doc drift

- Verify script docstring has a duplicated misnumbered step (`paper-trading-signal-order-564.ts:17-18`).
- `callables.ts:4-8` header still describes PENDING-expression accept; `:520-521` claims lifecycle ticket is `pap_{tradeId}` for every member (minted trades stamp `pap_{seed}`).
- `screenshot-capture-contracts.ts:170-171` references nonexistent `st-order-intents`.
- `paper-trading-contracts.ts:490,492` — `expressionTradeIds` doc predates staged-seed semantics; "set once the #1004 group write is wired" — now wired.
- `st-order-ticket-writer.test.ts:7` — "emit() is get-then-set idempotent" predates `create()`.
- Test fixture casts (`as SignalExpressionTemplate`, `{} as ApplyFillResult`).

## Test results

- Focused suites green: paper-trading 272, st-order-tickets 89, st-position-groups 28; screenshot/shared specs 201.
- `tsc --noEmit` clean; functions esbuild clean.
- Full jest run: 228/231 suites, 3807/3851 tests. Three failing suites are **all pre-existing on HEAD, unrelated to this diff**: `screenshot-capture-contracts.spec.ts` (`PositionType` enum drift — verified via stash), `sidenav-menu.component.spec.ts` (`DS Gallery` menu item — in-flight design-system work), `order.component.spec.ts` ×41 (`NG0201: No provider for Functions` — `ScreenshotService` injection landed in commit `746-850`; files are clean in this diff).

## Accepted limitations (deliberate, documented)

- **Post-mint sibling window** — a concurrent pass committing between the loser's in-loop recheck and its write at a different seq leaves two OPEN trades; detected via post-mint check + `logger.error`, not auto-deleted (a delete would orphan account position legs). Single-scheduler reality makes it theoretical.
- **Missing position group** — `addMembers` false → `lastError: group_join`, ticket stays staged, join retried every pass. Rebuild is owned by the retry path's `ensure`/`buildGroupDoc` + `migrate-cohorts-1004`; the fill pass deliberately does not rebuild (it knows only one member — a partial doc would look complete but be wrong).
- **In-flight cancel race** — a cancel committing between the pass's `getTicket` recheck and the mint self-heals: `filled ∈ ALLOWED_FROM['cancelled']`, fill-wins doctrine.
- Optional `deps.tickets`/`deps.groups` — deliberate for the dual-write soak window.
- `SOURCE_BY_ORIGIN` `program`/`management` mappings — forward-compat, no producers yet.
- `cohort.tradeIds` shape asymmetry fresh-vs-rebuild — soak bridge; `migrate-cohorts-1004` owns convergence.
- Minted trades seed `marks: {}` (no `underlyingClose` fetched on the option fill path) — cosmetic.
- `getTicketDoc` `refId==` scan intentionally unbounded — must pick the non-lifecycle doc among hits.
- Standards axis flagged a `mode+state` composite index — not required: equality-only wheres are served by merged single-field indexes.

## Disposition

**PASS** — task #1005 advances to `7_QA`. Run `/proj qa 984 1005`.
