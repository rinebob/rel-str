# UAT — #667 BE Live-quote close

**Topic:** Paper Trading Infra
**Topic Slug:** paper-trading-infra
**Issue:** #696
**Task:** #667
**Topic Parent:** #553
**Domain:** PAPER-TRADING
**Type:** UAT
**Status:** Draft
**Created:** 2026-09-29
**Last Updated:** 2026-09-29

## Scope

`closePaperTrade` callable: close an OPEN paper trade at a **live** RH quote
— per-leg marks netted to one order-level exit price, ledger close via
`applyExitFill`, governing run finalized EXITED + exitEvent. No stored-mark
fallback, no user-entered price; any quote failure → `unavailable` with no
ledger write.

## Prerequisites

- `cd functions && npm i`; ADC (`gcloud auth application-default login`)
- Working RH MCP OAuth for the prod verify (same as `paper-trading-signal-order-564.ts`)

## Scenarios

### S1 — Unit suite

**Run:** `npx tsx --test "tests/functions/paper-trading/*.test.ts"`
**Expect:** all pass incl. `handleClosePaperTrade` — equity close w/ run
finalize + exitEvent (price/pnl/daysHeld), option close (signed short-entry
price), multi-leg netting to one unit price, unavailable on
missing/NaN/throwing quote (both equity and option paths), full guard
ladder, ledger-race remap, run-finalize tolerance.
**Result:** PASS — 131/131.

### S2 — Prod round trip

**Run:** `cd functions && npx tsx scripts/verify/paper-trading-close-667.ts`
**Expect:** 7 `OK` — scratch OPEN trade created, wrong-user →
permission-denied, live-quote close (price printed), CLOSED read-back, exit
fill price matches, governing run EXITED + exitEvent, re-close →
failed-precondition; docs cleaned up.
**Result:** PASS — 7/7 on prod (QQQM @ 303.84 live quote).

### S3 — Build + export

**Run:** `cd functions && npm run build`
**Expect:** clean; `closePaperTrade` exported.
**Result:** PASS.

## Traceability

| AC | Scenario |
|---|---|
| Live quote per leg → net order-level price, no fallbacks | S1, S2 |
| Missing quote → `unavailable`, no ledger write | S1 (miss + NaN + provider-throw + tool-throw) |
| `applyExitFill` → CLOSED + realizedPnl + cash | S1, S2 |
| Governing run EXITED + exitEvent same handler | S1, S2 |
| Non-OPEN → `failed-precondition`; session cleanup | S1, S2 |

## Refinement pass

Not applicable — no user-facing surface (FE close button: #671).
