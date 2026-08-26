**Topic:** Savant Trader — FE-D2b: Verify Robinhood simultaneous resting orders
**Issue:** #203
**Topic Parent:** #176
**Domain:** SAVANT-TRADER
**Type:** Code Review
**Status:** Complete
**Created:** 2026-08-26
**Last Updated:** 2026-08-26

---

## Summary

Three-axis review of FE-D2b (#203): Verify Robinhood simultaneous resting orders. This is a verification/research task — no code changes, only a verification doc. The task resolves an open PRD question: can a stop loss and target exit rest simultaneously on the same symbol?

### Tasks covered

| Task | Issue # | Description | Stage |
|---|---|---|---|
| FE-D2b | #203 | Verify Robinhood simultaneous resting orders | 6_REVIEW |

**Verdict: PASS** — no critical or major findings. All acceptance criteria met or justifiably deferred. The PRD open question is resolved with a definitive answer and actionable recommendation.

---

## Standards

### Doc quality
- Verification doc follows a clear structure: objective → setup → results (4 phases) → conclusion → splitting analysis → recommendation.
- Real order IDs, prices, states, and position fields documented for reproducibility.
- Four test phases cover buy/buy simultaneity, sell/sell with 1 share, sell/sell with 2 shares (split), and fractional share limitations.
- Conclusion is honest: splitting is technically possible but not viable for the stop-loss + target-exit use case.
- Recommendation is actionable: stop loss as resting order, target exit via polling/monitoring, cancel stop loss on target exit.

### Findings accepted (no fix needed)

**1. Account number in doc (NIT → fixed)**
- **File:** `docs/topics/176-savant-trader/VERIFY-savant-trader-176-203-simultaneous-resting-orders.md:4`
- The account number was included in the doc. The RH MCP discovery doc says "Never write account numbers to documentation, fixtures, or logs." The repo is public.
- **Fix:** Account number redacted to `[REDACTED]` in both the verification doc and this code review doc.

---

## Spec

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 1 | review_equity_order simulation called for a stop_market sell on a symbol | DEFERRED | The task specified simulation, but the user correctly identified that simulation doesn't test simultaneity. Real `place_equity_order` was used instead — a stronger test. |
| 2 | review_equity_order simulation called for a limit sell on the same symbol | DEFERRED | Same as above — real placement used. |
| 3 | If rejected: document the one-at-a-time constraint | MET | Phase 2 documents the rejection: "Not enough shares to sell." The doc explains the share-availability constraint and why splitting doesn't work. |
| 4 | If allowed: no constraint needed, both can rest simultaneously | MET (with nuance) | Phase 1 (buy/buy) and Phase 3 (sell/sell with split) show simultaneity IS allowed at the broker level. But the doc correctly identifies that splitting is not viable for stop-loss + target-exit, so the practical answer is: stop loss only as resting order, target exit via polling. |

### Deviation note

The acceptance criteria specify "sell" orders and "review_equity_order simulation." The actual test used:
- **Real `place_equity_order`** instead of simulation — because the user correctly identified that simulation doesn't test simultaneity (it's a preflight that doesn't know about existing resting orders).
- **Multiple test phases** (buy/buy, sell/sell with 1 share, sell/sell with 2 shares, fractional) — more thorough than the criteria specified.

The deviation is justified and produces a more rigorous, definitive answer.

---

## Thermo-nuclear

### Test methodology
The test methodology is rigorous and covers the real use case:
1. **Phase 1 (buy/buy):** Confirms broker allows simultaneous resting orders at the symbol level.
2. **Phase 2 (sell/sell, 1 share):** Confirms the share-availability constraint — the first sell holds the shares, rejecting the second.
3. **Phase 3 (sell/sell, 2 shares split):** Confirms splitting works mechanically but leads to the "half position" problem.
4. **Phase 4 (fractional):** Incidental finding that fractional shares don't support stop/limit orders at all.

### "Splitting is NOT viable" analysis
The doc correctly identifies the fatal flaw in splitting: only one order will actually exit. If the stop loss fills, the target exit is still resting on shares that no longer exist. If the target exit fills, the stop loss is still resting on shares that no longer exist. Either way, you end up with half a position open and the wrong order still resting. This is a sound analysis.

### Recommendation soundness
The recommendation (stop loss as resting order, target exit via polling) is the correct architecture:
- Stop loss is the safety net → must be on the broker → gets the full position
- Target exit is the profit-taking → can be monitored client-side or via Cloud Function → cancels stop loss when it fires
- This avoids the share-availability constraint entirely

### Implications for the project
This finding has architectural implications beyond #203:
- A **price monitoring mechanism** is needed for target exits (Cloud Function or client-side watcher)
- The **signal order screen** must stage stop loss only as a resting order
- The **order execution service** must handle "cancel stop loss when target exit fires"
- These should be captured as new tasks or PRD updates

---

## Verification

- **Tests:** N/A — no code changes (doc-only task)
- **Build:** N/A — no code changes
- **Real order test:** PASS — 4 phases, all orders placed/verified/cancelled, position cleared

---

## Files changed

| File | Status | Description |
|---|---|---|
| `docs/topics/176-savant-trader/VERIFY-savant-trader-176-203-simultaneous-resting-orders.md` | NEW | Verification doc with 4-phase real order test results |
