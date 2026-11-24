**Topic:** Strategy Manager  
**Topic Slug:** strat-manage  
**Thread:** Live Position Lifecycle  
**Thread Slug:** live-position-lifecycle  
**Issue:** #1699  
**Thread Parent:** #1690  
**Topic Parent:** #137  
**Domain:** BE  
**Type:** TEST  
**Status:** Draft  
**Created:** 2026-11-23  
**Last Updated:** 2026-11-23  

# TEST-BE: mark + settle + eval pass specs and verify scripts

## Scope

Pass-level specs with injected deps (quote provider, position repo, evaluators, underlying-close reader), plus the conventional `scripts/verify/` live-wiring checks. Covers the unified mark pass, position-grain settlement + held-shares, per-tick shadow-eval, and the slimmed EOD finalizer.

## E2E User Journeys

- **Intraday:** an open manage position receives per-leg marks each tick → `currentValue`/`unrealizedPnl` update → dashboard shows live P&L (FE journey verifies the render).
- **To expiry:** a position's last leg expires → next settlement closes it worthless or assigns → closed table / held-shares flow.
- **Shadow matrix:** a rule that would have fired at 10:20 AM shows `firstFiredAt` intraday, not just an EOD flag.
- **STOPPED instance:** open positions continue marking/settling after the instance is stopped.

## Integration Tests

- Mark pass over a mixed corpus: legacy doc + manage doc + signal stock trade → both option positions marked, stock trade untouched.
- Settlement idempotence: already-settled/terminal trades throw/skip (the repo's non-idempotent guard), missed-night retry settles `expiration <= runDate`.
- Analysis-doc merge: tick-eval writes don't clobber the 2 PM scan's doc shape; `firstFiredAt` accumulates.

## Unit Tests

- **Selection:** `OPEN` + `hasOptionLegs` — includes manage/legacy option trades, excludes signal stock trades and non-OPEN statuses.
- **Per-leg marking:** each leg gets its own `lastMark` from its own contract's quote — never one order-level stamp; missing quote → per-position error isolation, others continue.
- **Net valuation:** `currentValue`/`unrealizedPnl` through the SHARED formula for all postures.
- **Shadow-eval:** all 6 rules evaluated per tick; `firstFiredAt` persists on subsequent ticks; `firstFiredMark` captured; idempotent on re-run of the same tick.
- **Leg expiry:** last-leg rule; weekend/holiday lookback; ITM assignment → `ASSIGNED_HOLDING_SHARES` + shares record (qty, strike basis); OTM → worthless; `realizedPnl` written.
- **Held-shares:** `ASSIGNED` positions mark daily vs share close.
- **Timer wiring:** schedules/paths spec-pinned where the convention supports it.

## Test Seams

- `BatchQuoteProvider` — injected fake quotes per contract.
- Position repo — injected `queryTrades`/`markPosition`/`markPositionSettled` fakes.
- Exit evaluators — injected `evaluateExit` stubs; also spec the real 6-rule registry on canned mark series.
- `UnderlyingCloseReader` — injected closes (weekend-expiry lookback fixture).

## Test data / fixtures

- Canned trades: 2-leg credit + 4-leg IC + naked strangle + signal stock trade + STOPPED-instance position.
- Quote maps per contractId; underlying-close series with a weekend expiration.

## Existing Test Coverage

- `tests/functions/options-strategy-engine/{open-pass,settlement-pass}.test.ts`, `paper-trading/*.test.ts` (mark/settlement/stats) — extend patterns; legacy-era assertions must still pass (regression on unified pass).

## Edge Cases

- RH quote absent for one leg of many → per-position error, no partial-position write ambiguity (pin atomicity choice).
- Missed ticks / restarts → `firstFiredAt` doesn't regress.
- Zombie `260819-*` corpus — verification: post-first-run they land terminal (worthless or assigned).

## Verify relay

- `npx tsx` specs + a `scripts/verify/*-1690-*.ts` live-wiring check per convention → FE renders the written fields.
