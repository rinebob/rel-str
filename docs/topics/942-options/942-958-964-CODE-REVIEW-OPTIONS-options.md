**Topic:** Options Trading Support  
**Topic Slug:** options-trading-support  
**Thread:** Single-leg option orders  
**Thread Slug:** single-leg-option-orders  
**Issue:** #958  
**Thread Parent:** #943  
**Topic Parent:** #942  
**Task:** #964  
**Domain:** OPTIONS  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-16  
**Last Updated:** 2026-10-16  

# Code Review — #964 Gallery dialog tabs + card statusing + discard

## Scope reviewed

- `components/gallery-ticket-dialog/` (ts/html/spec) — Stock/Option `mat-tab-group`, lazy `matTabContent` option mount, dual close-on-done watchers, `(staged)` forwarding, `Open order ticket` title
- `gallery-view.component.ts` — `OptionTabSeed` plumbing (symbol/runId/occurrences/live `occurrenceDecisions` signal), session-created ticket-id tracking via `Set`, discard-on-close of exactly the created ids
- `utils/gallery-card-actions.util.ts` + `utils/gallery-cards.util.ts` — `findCardTickets` OPTION admission via `decisionIds` (equity side check skipped for OPTION — a long put on a SHORT card is still `side:'buy'`), `GalleryCard.ticket` widened to `OrderTicket`, option-aware `ticketLine`
- `stores/gallery-card-actions.service.ts` — tradeCard/paperCard reopen checks equity-scoped (a STAGED option ticket can never masquerade as the stock-tab reopen), exposed `activeRunId` + live `occurrenceDecisions`
- `core/robinhood-mcp/robinhood-mcp-client.service.ts` — `getOptionInstruments` wire contract corrected by live probe (`expiration_dates` CSV honored; explicit `state`/`tradability` pins zero the upstream response — dropped and replaced with client-side filtering; `data.next` cursor pagination with 10-page cap) and `getOptionQuotes` live-shape parse (`quote.mark_price` → `lastTradePrice`, paired `close.price` → `previousClose`)
- `components/option-order-ticket/` (post-hosting fixes) — quantity defaults to `'1'` (component field + staged model, matching equity), quote mark auto-fill with `priceAutoFilled` tracking (user-typed prices never clobbered; auto-filled prices follow contract changes / clear on no-quote or incomplete triplet), stale-stage emit fix (below)

## Verdict: PASS (after in-review remediation)

One critical (found independently by Standards and Thermo), several majors/minors — all remediated in-review and spec-pinned. Deferred items listed at bottom.

## Findings & resolutions

| Sev | Axis | Finding | Resolution |
|---|---|---|---|
| CRITICAL | Standards + Thermo (convergent) | **Orphaned option ticket on stale stage:** deselecting the contract while `stageTicketAndWait` was in flight persisted the ticket but suppressed the `staged` emit — the host's created-id `Set` never learned the id, so close-without-submit discard silently orphaned a live staged ticket | Emit `staged` for stale-session commits too — a committed stage can't be un-rung, so the host must know the id either way. Spec: deselect during stage → emit fires, ticket lands in discard set |
| MAJOR | Standards | **Card status precedence:** `findCardTickets` could surface a STAGED ticket ahead of a live one — a card with a RESTING option ticket would display `pending`/`tradeable` | Live (non-STAGED) tickets sort ahead of STAGED in card-ticket selection. Specs: live option statuses the card; STAGED-only leaves it pending and tradeable |
| MEDIUM | Standards | **Duplicated ticket-matcher logic** between the util's card-ticket predicate and the service's reopen predicate — two copies of the symbol/decisionId/side predicate drifting | Shared matcher in the util; service calls it — single source of truth for "is this ticket this card's" |
| minor | Standards | Dead ternary / unreachable branch in dialog status text | Removed |
| MEDIUM | Spec (found by new test) | **`matTabContent` destroys option ticket on tab switch** — lazy tab content unmounts on deactivation by default, so switching Stock→Option→Stock lost form state and re-fired chain requests | `preserveContent` moved onto `mat-tab-group` (its actual owner — putting it on `mat-tab` was a no-op). Spec: switch tabs → same component instance, no second `getOptionChains` call |
| minor | Thermo | Lock-wait spec observed duplicate `staged` emits (stage emit + adopt emit) | By design — host dedupes created ids with a `Set`; spec updated to assert the dedupe semantics instead of forbidding the second emit |
| minor | Standards | **Spec-mock drift:** `ticketsBySymbol` hand-maintained beside `tickets` in option-ticket and actions-service specs — mock could diverge from the store's computed derivation | Both specs derive `ticketsBySymbol` via `computed` from the `tickets` signal, matching `order-ticket.store.ts` |
| — | Thermo | Whole-flag model for created-ticket tracking vs a `createdAt`-session-anchored rewrite | Documented, deferred — flag/Set model was accepted at #963; the plumbing rewrite is out of #964 scope |
| — | Standards | Option ticket SCSS near-duplicate of equity ticket (~200 lines) | Carried from #963 — shared partial deferred to a host-polish task, out of #964 scope |

## Test results

- `robinhood-mcp-client.service.spec.ts` — **74/74** (incl. pagination cap, dropped-pins contract, live quote shape)
- `option-order-ticket.component.spec.ts` — green (incl. default-qty submit-enable, auto-fill lifecycle, stale-stage emit, computed-mock derivation)
- `gallery-ticket-dialog.component.spec.ts` — **12/12** (incl. tab-preservation spec that caught the `preserveContent` bug)
- `gallery-card-actions.service.spec.ts` — **31/31**
- `gallery-cards.util.spec.ts` / `gallery-card-actions.util.spec.ts` — **46/46** (OPTION admission, side-skip, live-over-STAGED precedence)
- Focused 6-suite run — **230/230**
- `tsc -p tsconfig.app.json --noEmit` — **clean**
- Full suite unchanged vs baseline: savant-trader 1936 pass / 42 pre-existing `order.component` Functions-provider failures (documented, unrelated)

## Manual verification (hosted, in-session)

- Option tab: expirations → strikes load; contract select fills Limit $ from live `mark_price`; qty defaults 1, stepper 1→2
- Limit order submitted, confirmed placed at Robinhood; dialog closed on `SUBMITTED` (by design — done-status watcher, same as equity)

## Deferred

- Multi-leg options, sell-to-open, close/exercise flows — future threads
- Option-chain direct ordering (chain-page copy-contract) — #965
- Option positions in portfolio view — future task
- Equity/option SCSS shared partial — host-polish task

## Verdict: **PASS**
