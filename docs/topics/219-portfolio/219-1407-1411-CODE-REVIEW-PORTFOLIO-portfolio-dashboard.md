**Topic:** Portfolio Dashboard  
**Topic Slug:** portfolio  
**Thread:** Load Architecture & Order Surfacing  
**Thread Slug:** load-architecture-order-surfacing  
**Issue:** #1407  
**Thread Parent:** #1403  
**Topic Parent:** #219  
**Task:** #1411  
**Domain:** PORTFOLIO  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-10  
**Last Updated:** 2026-11-10  

# Code Review — #1411 Open Orders completeness audit (forensic)

**Verdict: PASS** (third pass — two prior FAILs remediated in-cycle)

## Review history

| Pass | Result | Blocker |
|---|---|---|
| 1 | FAIL | `runOrdersBatch` ran `executeBatch` over single-page specs — the dashboard never called the new walking methods; Open Orders/Order History still truncated at page 1 |
| 2 | FAIL (Thermo; Standards+Spec passed) | `normalizeOrder` required top-level `side` — **no wire option order carries one** (all 9 in the live capture), so every option order threw and was silently skipped; `optionOrders.data` permanently `[]` |
| 3 | **PASS** all axes | Both criticals verified fixed against live capture + code |

## What the review process caught

This task is the case for the gate: the first implementation fixed the
client methods but not the call path that actually serves the dashboard
(critical, pass 1). The re-review then found the audit's own miss —
a 100%-of-feed silent drop on the option side that had existed invisibly
because the fixture mocked a wire shape the broker never emits (critical,
pass 2). Both were verified against the live capture, not assumed.

## Pass-3 verification highlights

- **`orderSide` mapping verified 9/9 against `ro-opt-orders-01`** — every
  `debit` order has buy legs, every `credit` order sell legs; wire doc
  confirms no top-level `side` for options.
- **Batch walk correctness** — `pending[i]`↔`results[i]` alignment via
  `executeBatch` index mapping + tool-stamp; surviving walk keeps batching
  alone after a sibling rejects; verbatim `next`→`cursor` pass-back
  spec-asserted (`store.spec.ts` round-2 cursors `['EQ2','OPT2']`).
- **No consumer breaks on newly-flowing option orders** — stop-protection
  utils take `equityOrders` only (now also equity-guarded defensively);
  cancel routing already branches on `instrumentType`; `isOpeningOrder`
  consults `legs[].positionEffect` before `side`.
- **`walkPages` success guard** — all three delegating specs threw
  identically already; the explicit guard closes the trap for future specs.
- **Spec-delegation pair** (`equityOrdersSpec`/`optionOrdersSpec` → page
  spec parse) keeps tool/args/error naming identical — no drift surface.

## Residual findings (recorded in audit doc Residuals)

- `order.component.ts` `refreshRhOrders` — same page-1 truncation class in
  the signal-order workspace (feeds `findActiveStopLoss` → possible
  duplicate-stop risk). **Follow-up task required.**
- Option orders render with no Mark/Dist (legs' instrument IDs don't feed
  the quote fetch).
- Option closing orders have no list surface (equity stops do; options
  don't).
- Filled *market* option orders skipped in allocation fills (`price:""`
  + `processed_premium` — derivable, currently skipped).
- `crypto`/`advanced` (OCO) order tools never fetched — scope note, not
  defect.
- Nits: `OptionOrderQuery` lacks `orderId`/`chain_ids`/`created_at_gte`
  capability; `EquityOrdersPage` name shared by option spec.

## Test evidence

- Touched suites: 262 specs green (client 133, store 42, open-orders 24,
  utils remainder); full area sweep 770/770; typecheck clean.
- New specs since pass 1: batched multi-page walk + verbatim cursor +
  mid-walk slot rejection (store); wire-shape option fixtures +
  direction→side + leg-executions (client); scope-note (component).
