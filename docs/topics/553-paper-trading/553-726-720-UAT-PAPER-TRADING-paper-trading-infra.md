**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Trade Exits  
**Blueprint:** #663 (BE)  
**Task:** #720  
**QA Issue:** #726  
**Topic Parent:** #553  
**Domain:** PAPER-TRADING  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-09-30  
**Last Updated:** 2026-09-30  

# UAT — #720 BE signal-source option settlement at expiration

## Scope

The nightly settlement orchestrator (`runSettlementForAllInstances`) now runs a
global `runSignalSettlementPass(marketDate, deps)` after exit evaluation and
before the per-instance loop, in its own try/catch. It settles OPEN
`source=SIGNAL` trades whose option legs have all expired
(`expiration <= marketDate` — a missed night retries automatically):

- **All-OTM** → `markPositionSettled(EXPIRED_WORTHLESS)` — status EXPIRED,
  full premium realized, governing run EXITED at 0, expiration-day
  underlying close written to marks.
- **Any-ITM** → cash settlement at net intrinsic via `applyExitFill` +
  governing run finalized EXITED (same close shape as the manual close
  callable). Assignment deliberately not modeled — documented in the pass
  header and review doc.
- **Not candidates**: share-only trades (never expire — not counted),
  trades with unexpired legs (`skipped`).
- **Errors** (loud, retryable, isolated per trade): mixed share+option
  legs, multi-leg option trades, missing `userId`, no underlying close
  within 7 days of expiration (walk-back covers weekend/holiday expiry;
  never settles on a pre-entry close), leg-less trades, invalid intrinsic
  exit price.
- Account resolution for signal trades falls back to `trade.userId` in
  `markPositionSettled`.
- Adjacent fix: stats now book EXPIRED realized P&L from the trade's
  `realizedPnl` via `tradeToPosition` (LONG-side expiries previously read
  as 0); `Position.realizedPnl` emitted for the dashboard column.

## Acceptance criteria (from #720 + review)

| # | Criterion | Method | Result |
|---|---|---|---|
| 1 | OTM signal option trade expires worthless: status EXPIRED, premium realized, governing run EXITED at 0, marks updated | Prod verify | PASS |
| 2 | ITM signal option trade cash-settles: status CLOSED, exit fill at intrinsic, governing run EXITED at intrinsic | Prod verify | PASS |
| 3 | Account bookkeeping moves (realizedPnl, openTradeCount 2→0) on a honestly seeded account | Prod verify | PASS |
| 4 | Settled trades leave the OPEN signal population; live unexpired signal trades untouched | Prod verify | PASS (skipped=7 option, 8 share-only not counted) |
| 5 | Missing underlying close → error, trade stays eligible; weekend expiry walks back to prior trading day | Unit tests | PASS (13/13) |
| 6 | Mixed legs / multi-leg / legless / missing userId → per-trade errors, never partial settle | Unit tests | PASS |
| 7 | Per-trade failures isolated; signal stage can't starve instance settlement | Unit tests + orchestrator wiring | PASS |
| 8 | Full paper-trading suite + typecheck + build | `npm run test:paper-trading`, `tsc --noEmit`, `npm run build` | PASS (142/142, clean, clean) |
| 9 | Registered in both run-alls + READMEs; guide exists | `run-all` sweep | PASS (12/12) |
| 10 | Cleanup: no scratch docs survive the verify run | Prod verify | PASS |

## Prod verify evidence (post-round-2, final)

```
npx tsx scripts/verify/paper-trading-signal-settlement-720.ts
  QQQM close on 2026-09-29: 304.17
  pass summary: settled=2 skipped=7 errors=0
  15 passed, 0 failed
```

- OTM short put → `EXPIRED`, `realizedPnl = +200`, governing run EXITED at 0.
- ITM short put → `CLOSED`, exit fill at intrinsic (104.17→strike math checked), governing run EXITED at intrinsic.
- Account seeded honestly (`openTradeCount: 2`, `equity: 0`); post-pass `realizedPnl` = 200 + (200 − intrinsic×100), count → 0.
- Scratch docs (2 trades + 1 account) deleted and verified gone.

## Residual / known-limited (accepted in review)

- **Assignment modeling**: ITM cash-settles at intrinsic; no delivered
  shares to practice managing. Needs held-shares marking + share exit
  seam for signal trades first. Tracked as a follow-on, not blocking.
- **Engine settlement parity**: engine `settlement-pass` still uses
  strict `expiration !== date` — same missed-night zombie class on the
  strategy side. Filed as **#724**.
- **`account.equity` drift** (pre-existing, systemic): no mark pass
  writes account equity, so post-close equity is off by un-booked mark
  drift — same as manual closes.
- **Root run-all pre-existing failures**: `swing-605` / `portfolio-586`
  can't resolve `firebase-admin` from repo root (pre-date the
  `cwd: 'functions'` convention) — unrelated to #720.

## Verdict

**PASS** — all acceptance criteria verified live + unit; review doc
dispositions confirmed; chain green.
