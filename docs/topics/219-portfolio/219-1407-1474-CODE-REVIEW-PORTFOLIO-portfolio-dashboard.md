**Topic:** Portfolio Dashboard  
**Topic Slug:** portfolio  
**Thread:** Load Architecture & Order Surfacing  
**Thread Slug:** load-architecture-order-surfacing  
**Issue:** #1407  
**Thread Parent:** #1403  
**Topic Parent:** #219  
**Task:** #1474  
**Domain:** PORTFOLIO  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-13  
**Last Updated:** 2026-11-13  

# Code Review — #1474 Position feeds may page-truncate

**Verdict: PASS** (three parallel axes — Spec PASS / Thermo-Nuclear
APPROVE / Standards PASS — six in-cycle remediations applied; one
pre-existing major discrepancy filed as a follow-up)

## Change summary

Position feeds accepted `cursor` on the documented contract but every
consumer fetched page 1 only — same latent class as orders (#1411/#1462).
Positions now ride the same machinery:

- `RobinhoodMcpClient` — `equityPositionsPageSpec` /
  `optionPositionsPageSpec` (`{positions, next}` envelopes),
  `getEquityPositionsRaw` (verbatim wire records walked to exhaustion),
  typed `getEquityPositions`/`getOptionPositions` now walk via shared
  `walkPages`; `MAX_ORDER_LIST_PAGES` → `MAX_LIST_PAGES`;
  `PositionsPage<T>` added.
- `portfolio-dashboard.store` — `runPagedBatch` extracted from the
  orders lockstep walker (pending-subset per round, per-walk failure
  isolation, 25-round cap warn) plus `rideAlong` specs that join the
  round-0 batch only; `runOrdersBatch` refactored onto it;
  `runPositionsBatch` rides `get_portfolio` in round 0 — the original
  3-spec core session is preserved.
- `fetchCore` — per-section rejection handling; all-rejected round
  (transport/auth) returns false → group unmarked → retryable; partial
  failure continues to quotes/peaks.
- `PortfolioService.getSnapshot` — positions via
  `getEquityPositionsRaw`, rejects shaped back into the null-on-failure
  contract (`ok`/`err` outcome union); parallel fetch preserved.
- Fixtures — `PAGE_TOOLS` auto-wrap extended to position tools;
  `positionsPage` helper; dead `*Spec` mocks removed.

## Axes

### Spec — PASS (all requirements met)

| Requirement | Verdict |
|---|---|
| Verify-first (probe or wire doc) | Met (deviation, sound) — the wire-doc path is satisfied: `cursor` is in the live inputSchema (`rh-mcp-tools-options.md:242`, `rh-mcp-tools-account-performance.md:56`) and the endpoint's own `guide` text documents `next` semantics (`captures/opt-pos-open.json:19`). The unconditional walk is provably zero-cost if `next` never appears (cursor only sent after a non-empty `next`). |
| Raw walking variant + `getSnapshot` routed | Met — `getEquityPositionsRaw` preserves wire strings (`'0.049734'`/`'2010.700000'` passthrough spec'd). |
| Dashboard positions get the orders walk | Met — `runPositionsBatch`, lockstep rounds, portfolio ride-along. |
| `get_crypto_positions` out of scope | Met — zero call sites in `src/`. |
| Bonus consumer: `allocation-data.service` | Met automatically — typed methods now walk; serial-page latency scales with depth (correct trade-off). |

### Thermo-Nuclear — APPROVE

`runPagedBatch` traced correct: pending-subset indexing, `settled[i]`
alignment, ride-along round-0-only, `extra` lifecycle guards
load-bearing, walk-failure drops accumulated pages (consistent with
`walkPages`), cap warn keeps partial. No criticals/majors attributable
to this diff.

### Standards — PASS

Pattern-faithful to the orders machinery; test conventions consistent.
One major finding is pre-existing and documented below.

## In-cycle remediations (applied, re-verified)

1. `runPagedBatch` `as never`/`as {next}` erasures → per-walk `toWalk`
   closure with a single honest `as P`; `toResult` generic keeps item
   types — zero casts in the return path.
2. Ride-along typing — `runPagedBatch` gained an `R` generic so
   `runPositionsBatch.portfolio` is `PromiseSettledResult<PortfolioSnapshot>`
   without the call-site cast or `extra[0]` untyped index.
3. `optionPositionsPageSpec` arg-order asymmetry → unified options bag
   `{cursor?, nonzero?}` (public + `positionsArgs` + mock + spec).
4. Dead `*Spec` mock entries removed from `createMockClient`.
5. `provideZonelessChangeDetection()` added to
   `portfolio.service.spec.ts` (sibling-spec consistency).
6. New spec: round ≥1 transport failure keeps the round-0 ride-along
   and errors both position sections (the one uncovered branch that
   mattered).

## Findings carried / follow-ups

- **MAJOR (pre-existing, filed)** — `get_option_positions` wire-shape
  mismatch: the parse hunts `results`/`option_positions` +
  `instrument_id`/`average_cost`/`strike_price`/`option_type`, but the
  documented + captured wire is `data.positions[]` with
  `option_id`/`chain_symbol`/`average_price`/`type`=`long|short`. The
  extraction returns `[]` on the real wire — option positions silently
  never render (Options tab, option quotes for held positions,
  allocation legs). Keys were relocated verbatim — not a #1474
  regression, but the option-side walk inherits it. Filed **#1481 —
  "get_option_positions wire-shape mismatch"** under #1407; the fix
  needs a semantic remap (`long`/`short` vs call/put `optionType`) plus
  a probable `get_option_instruments` join for `strikePrice`.
- **MAJOR (pre-existing, documented)** — `robinhood-mcp-client.service.ts`
  ≈1274 lines (was ~1199 at #1462 review; guideline cap 1k). Same
  disposition as #1462: flag, don't block — the module split is owed.
- Minor (accepted): partial walk failure marks the core group loaded
  with errored sections (per-section policy parity with orders);
  `runPagedBatch` lives in the store (revisit placement when a second
  consumer appears); no cap-warn spec (shared bound, pre-existing gap).

## Test results

Full suite **308/308 suites, 5,526/5,526 specs green**; `tsc --noEmit`
clean on `tsconfig.app.json` + `tsconfig.spec.json`. New coverage:
client walk/verbatim/mid-walk/page-spec specs, store page-2+ landing +
verbatim cursor injection + mid-walk isolation + ride-along round-0
shape + continuation-round transport failure, service null-on-reject.
