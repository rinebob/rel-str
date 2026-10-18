**Topic:** ST Firestore Reorg  
**Topic Slug:** st-firestore-reorg  
**Thread:** Data Plane Consolidation  
**Thread Slug:** data-plane-consolidation  
**Issue:** #1092  
**Thread Parent:** #985  
**Topic Parent:** #984  
**Task:** #1005  
**Domain:** DATA-PIPELINE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-19  
**Last Updated:** 2026-10-19  

# UAT — expression-fill reads staged tickets + minted trade IDs (#1005)

## Scope

Task #1005 makes the staged Order Ticket the pending expression order: `paperSignalOrder` emits one `pap_{seed}` ticket per expression template (`state:'staged'` + `terms.expressionTemplate`) instead of writing `PENDING` trade docs; the expression-fill pass resolves a contract via RH MCP and mints the canonical trade `{SYM}-{YYMMDD}-{origin}-{expr}-{exp}-{strike}-{NN}`; `cancelPaperTrade` cancels the staged ticket without creating a trade; legacy `PENDING` trades keep draining in place during the soak.

## Prerequisites

- Repo at the #1005 working tree; `cd functions && npm run build` clean.
- Firebase CLI authenticated to the prod project; `NODE_OPTIONS=--require C:\Users\bob\.config\node\ipv4-only.cjs` (IPv6 workaround).
- RH MCP session valid (the verify script drives real `get_option_*` calls).
- Firestore console access for the manual inspection checks.

## Execution

### 1. Deploy

```powershell
cd functions
npm run build
firebase deploy --only functions
```

### 2. Production verification run

```powershell
cd functions
npx tsx scripts/verify/paper-trading-signal-order-564.ts
```

The script accepts a seeded order ticket as paper, retries the accept, cancels one staged ticket, runs `runExpressionFillPass` against real RH market data, asserts the minted trade shape + lineage + group join + ticket closeout, then deletes every doc it created.

## Scenarios

| # | Scenario | Steps | Expected | Result |
|---|---|---|---|---|
| S1 | Accept stages tickets, not PENDING trades | verify run step 1 | `pap_{seed}` tickets `staged` with `terms.expressionTemplate`; zero trade docs at the seeds; equity trade OPEN | **PASS** — `staged tickets: all staged with expressionTemplate recipes` ✔ |
| S2 | Retry idempotency + self-heal | verify run (built-in second accept) | same cohort + adopted seeds, no `-2` duplicates, same `positionGroupId` | **PASS** — `retry is idempotent`, `retry returns the same positionGroupId` ✔ |
| S3 | Cancel pending expression | verify run step 2 | `pap_{seed}` → `cancelled`; no trade minted; `cancelRes.tradeId` = seed | **PASS** — `cancel: ticket flipped to cancelled, no trade minted` ✔ |
| S4 | Fill pass mints canonical trade | verify run step 3 | canonical contract-bearing id OPEN with contract leg + entry fill; lineage stamps; source ticket `filled` | **PASS** — minted `QQQM-261018-sig-LC-261120-295-01` OPEN, real contract leg, `source ticket marked filled` ✔ |
| S5 | Group join | verify run step 3 | minted trade in `memberTradeIds`, `rollups.openCount` incremented | **PASS** — `minted trade joined the group` ✔ |
| S6 | No PENDING docs on new path | verify check | PASS | **PASS** — `no PENDING expression trades written` ✔ |
| S7 | Read-only RH calls | verify MCP assertion | no `place_`/`review_` calls | **PASS** — `no broker mutation tools anywhere` ✔ |
| S8 | Cleanup leaves no orphans | verify cleanup + post-run probe | all seeded docs removed | **PASS** — `cleanup: verification docs removed`; probe: 0 verify-564 leftovers across `st-order-tickets`/trades/groups ✔ |
| S9 | Cancel blocked on minted trade | unit spec | `failed-precondition` | **PASS (unit)** — `cancel-paper-trade.test.ts`: minted-trade-blocks-staged-cancel + dead-trade-allows-cancel + `applied:false` specs (272-suite run); not exercised live — requires a wedged group join |
| S10 | `no_contract` skip | unit spec | `lastError` stamped, stays `staged` | **PASS (unit)** — `skips a staged ticket with no selectable contract` + `recordTicketError` spy assertion |
| S11 | Legacy PENDING drain | unit spec | `applyPendingFill` in place | **PASS (unit)** — `fills a legacy PENDING trade in place when the seed doc still exists` + `fills a ticket-less pending trade` |

## Traceability

| AC | Scenario |
|---|---|
| Pass reads staged tickets not PENDING trades | S1, S4, S6 |
| Mints canonical id + contract fields | S4 |
| cancel pending → ticket cancelled, not trade | S3, S9 |
| Lineage preserved (cohort/group/ticket/signal) | S4, S5 |
| Idempotent + race-aware | S2 |
| `lastError` on skips (TEST-BE:44) | S10 |
| Legacy drain preserved | S11 |

## Manual refinement pass

- [x] `st-order-tickets` probe post-cleanup: 0 staged tickets, 0 verify-564 leftovers — cleanup removes every canonical doc the run creates
- [x] `st-position-groups` probe: 9 production groups intact, 0 verify-564 leftovers
- [x] Minted trade shape observed live: `QQQM-261018-sig-LC-261120-295-01` — canonical id with contract fields (verify step 3 assertions)
- [x] No user-facing UI surface — BE pipeline task; visual refinement N/A

## Results log

- `firebase deploy --only functions` — all functions updated (incl. `paperSignalOrder`, `cancelPaperTrade`, `expressionFillPassTimer`); `unregisterPairs` needed one retry for a transient GCP 500, then succeeded.
- `npx tsx scripts/verify/paper-trading-signal-order-564.ts` — **28/28 checks PASS**. Equity `261018-sig-QQQM-EQ` OPEN at a real quote; 2 staged `pap_` expression tickets; retry idempotent + same group; staged cancel → `cancelled` w/ no trade; fill pass `filled=1 skipped=0 errors=0`, minted `QQQM-261018-sig-LC-261120-295-01` joined the group; cleanup clean.
- Note: `[ScreenshotLifecycle] lifecycle capture threw … Bucket name not specified` during the run — local script env quirk (no `storageBucket` in the script's admin init); capture is fail-soft by design and the deployed env carries the bucket. Not a product defect.
- Post-run probe (`.devin/tmp/probe-1005.ts`): 0 staged tickets, 0 verify leftovers, 9 prod groups intact.
