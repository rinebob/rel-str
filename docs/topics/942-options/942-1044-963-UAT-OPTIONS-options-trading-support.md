**Topic:** Options Trading Support  
**Topic Slug:** options  
**Thread:** Single-leg option orders  
**Thread Slug:** single-leg-option-orders  
**Issue:** #1044  
**Thread Parent:** #943  
**Topic Parent:** #942  
**Task:** #963  
**Domain:** FE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-15  
**Last Updated:** 2026-10-15  

# UAT — #963 OptionOrderTicketComponent

Scope: `OptionOrderTicketComponent` — the option order ticket UI
(expiration/strike/type selects, OCC paste, quote resolution, staging
lifecycle, quantity/price/order-type/TIF form, fatfinger cap, bucket
picker, confirm → submit) plus the shared-store additions it exercises
(`OrderTicketPatch` distributive update, `patchTicket`,
`findTicketByRefId`, `cardTickets`/`cardOptionTickets`). The component is
deliberately **unhosted** — no production dialog mounts it until #964
wires the gallery ticket-dialog tabs — so there is no dev-server path in
this UAT. All acceptance evidence is the executable spec suite; the
visual refinement pass inside the real dialog is carried forward as a
#964 acceptance item.

Prerequisites: none beyond the repo — no credentials, no dev server.
Evidence is the focused Jest suite
(`option-order-ticket.component.spec.ts`, 43 specs), which mounts the
real component and asserts DOM state, wire-arg shape, and lifecycle
against mocked `OrderTicketStore`/`RobinhoodMcpClient` boundaries, plus
the adjacent store suite for regression.

## Scenarios

Run: `npx jest src/app/features/savant-trader/components/option-order-ticket --coverage=false --verbose`

| # | Scenario | Spec(s) | Expected | Result | Evidence |
|---|---|---|---|---|---|
| 1 | Expirations load on init; strike select disabled until expiration picked; strikes populate; list narrows to selected call/put type; chain failure shows inline error + retry | "loads expirations on init", "disables the strike select…", "enables the strike select…", "populates strikes…", "narrows the strike list…", "shows an inline chain error with retry" | Selects gate correctly; call-only/put-only instruments never mixed | PASS | 6 specs green |
| 2 | Selects → quote → single staged ticket; contract change re-legs the same ticket (refId preserved, no second stage); untradable contract surfaces inline error; quote failure still stages with mark null; limit price defaults from mark | "resolves selects → quote → stages…", "re-legs the same ticket…", "surfaces an unresolved error…", "still stages when the quote fetch fails", "defaults the limit price to the resolved mark" | One ticket per card; re-leg not re-stage; graceful quote degradation | PASS | 5 specs green |
| 3 | OCC paste converges on the select path; malformed paste rejected inline; different-underlying paste rejected inline | "converges on the same resolution…", "rejects garbage…", "rejects a contract for a different underlying" | Same resolution regardless of entry path | PASS | 3 specs green |
| 4 | Staging guard: adopt existing STAGED card ticket (binds, re-legs, clears stale error); block on live option ticket; terminal (FAILED) ticket ignored; concurrent resolutions serialize to one stage | "adopts a STAGED card ticket…", "blocks staging when the card already has a live…", "adopting clears a stale submit error", "serializes concurrent resolutions", "ignores terminal tickets" | One live option ticket per card, ever | PASS | 5 specs green |
| 5 | Rejection handling: all-REJECTed occurrences block with persistent inline reason; lifting the reject auto-retries and heals the block; REJECTed occurrences excluded from decisionIds; deselecting clears stale stage errors | "blocks staging when every occurrence is REJECTed", "retries staging when the REJECT is lifted", "clears a stale stage error…", "filters REJECTed occurrences out" | Blocks are honest, self-healing, and decisionIds are correct | PASS | 4 specs green |
| 6 | Submit gating: disabled until contract resolves; positive-integer quantity required; positive limit price required on LIMIT; MARKET needs no price, forces gfd, hides price row; premium over cash cap blocked (fail-closed), within cap allowed; submit disabled while re-resolution in flight | "stays disabled until…", "requires a positive integer quantity", "requires a limit price…", "allows a market order…", "blocks when the premium exceeds the cash cap", "passes when the premium is within the cap", "disables submit while a re-resolution is in flight", "hides the limit-price row" | Cannot submit an unpriceable/uncapped/unresolved order | PASS | 8 specs green |
| 7 | Async-integrity: clearing any select mid-resolution abandons the frame — no ghost contract, no re-leg, no bind, no staged emit (incl. frames parked on the staging lock); stale cash snapshot after account switch dropped; resolved contract cleared on incomplete triplet | "clears the resolved contract…", "abandons a lock-waiting resolution…", "does not land a ghost contract…", "does not land a stale cash snapshot" | Deselect always wins over late async completions | PASS | 4 specs green |
| 8 | Submit integrity: form persisted before confirm; cancel aborts; stored legs re-verified post-confirm (changed-under-dialog → re-confirm, no submit); market submits price-omitted + gfd pinned | "persists the form fields…", "does not submit when the confirm dialog is cancelled", "does not submit when the stored legs changed…", "omits price and pins gfd" | The ticket submitted is the ticket confirmed | PASS | 4 specs green |
| 9 | Defaults + account: SHORT card defaults to put; account snapshot fetched once for cap; bucket picker lists ACTIVE buckets on the ticket's account; adopted ticket's bucketId hydrates the pick | "defaults to put on a SHORT card", "fetches the account snapshot once…", "lists ACTIVE buckets…", "hydrates the bucket pick from an adopted ticket" | Sensible defaults; buckets scoped to the right account | PASS | 4 specs green |
| 10 | Adjacent regression — store lifecycle (adopt/stage/re-leg/submit) unchanged for equity/ETF | `npx jest src/app/features/savant-trader/services/order-ticket.store.spec.ts --coverage=false` | Full store suite green | PASS | 47/47 |
| 11 | Typecheck | `npx tsc -p tsconfig.app.json --noEmit` | clean | PASS | exit 0 |

## Traceability

| Acceptance criterion (IMPL/PRD/Test plan) | Scenario |
|---|---|
| Discover expirations via chains; strikes per expiration; filter by type; strike disabled until expiration | 1 |
| Resolve expiration/strike/type → tradable instrument; OCC paste same path; malformed/wrong-underlying rejected inline | 2, 3 |
| Quote → mark (last trade / prev close); stage continues on quote failure; limit defaults from mark | 2 |
| One option ticket per card; re-leg preserves refId; live ticket blocks, terminal ignored; REJECTed filtered + self-healing; errors persist inline | 4, 5 |
| Async integrity — deselect abandons stale resolution/staging/cash/chain work | 7 |
| Quantity positive integer; limit price required on limit; market price-less + gfd; fatfinger cap fail-closed | 6 |
| Persist → confirm → re-verify stored legs → submit via `OrderTicketStore.submitTicket` | 8 |
| Bucket picker scopes to ticket account; adopted bucketId hydrates | 9 |
| No equity/ETF regression | 10 |

## Regression / smoke checklist

- [x] `order-ticket.store.spec.ts` — 47/47 (adopt, stage, re-leg, submit, patch merge unchanged)
- [x] `tsc -p tsconfig.app.json --noEmit` — clean
- [x] Full suite unchanged vs baseline — 3726 pass / 43 fail, same two unrelated pre-existing suites (screenshot-capture contracts; order.component Functions provider) — verified during review, unchanged by QA rerun scope

## Refinement pass

**Not applicable at #963 — no reachable user-facing surface.** The
component is not mounted by any production dialog; #964 wires it into
the gallery ticket-dialog tabs. The DOM-level behavior (testids, disabled
states, hidden rows, inline errors) is asserted in the spec suite; the
visual refinement pass inside the hosted dialog — tab layout, spacing vs
the equity ticket, loading/error states in the real shell — is an
explicit acceptance item for #964's UAT. DOM-contract checks executed
here: strike-select disable/enable, market-order price-row hide, inline
error render/clear, bucket "inactive" option display — all asserted by
specs (scenarios 1, 5, 6, 9).
