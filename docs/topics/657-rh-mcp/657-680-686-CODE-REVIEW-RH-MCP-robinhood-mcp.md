**Topic:** Robinhood MCP  
**Topic Slug:** rh-mcp  
**Thread:** Full RH MCP Tool Discovery  
**Thread Slug:** rh-mcp-full-tool-discovery  
**Issue:** #680  
**Thread Parent:** #658  
**Topic Parent:** #657  
**Task:** #686  
**Domain:** RH-MCP  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-08  
**Last Updated:** 2026-10-08  

# Code Review — NFLX option order matrix session (#686)

## Verdict: **PASS** (with in-loop remediations)

| Axis | Result |
|---|---|
| Standards | Clean after remediation — 3 findings, all fixed |
| Spec | All ACs met after a third execution pass closed the STO gaps |
| Thermo-nuclear | 1 major (fixed), 3 minor (fixed/disclosed), 5 nits |

## Change set

No application code. 38 `opt-matrix` probes in `probe-manifest.json`
(19 committed at `2a28dbf7`, +19 in-tree), 35 `opt-*` captures, TEST doc
runbook/session sections, regenerated canonical doc
(`76 tools / 333 probes / 334 captures`).

## Executed evidence (three passes, 2026-10-07/08)

- **Pass 1** (committed): NFLX chain/instrument harvest, option level, 8
  review sims, resting-limit place/cancel, multi-leg place rejection.
- **Pass 2** (regular hours): BTO limit @1.96 **filled** (avg 190.00),
  STC limit rest+cancel, STC market **filled** → flat, stop_market BTO
  rejected 400, stop_limit BTO accepted+rested+cancelled.
- **Pass 3** (review-driven): put harvest, fee/collateral review variants
  with chain hints, naked-call place reject, CSP place+rest+cancel.

## LIVE FINDINGS (all verbatim, now carried in the canonical doc)

1. `place_option_order` rejects **all** multi-leg orders:
   `400 "Multi-leg options orders aren't supported in the Robinhood
   Trading MCP yet. …"` — despite the tool description advertising
   level-3 spreads and `review_option_order` simulating them cleanly.
2. `stop_market` buy-to-open rejected:
   `400 "Stop market orders aren't supported when buying to open."` —
   `stop_limit` BTO **is** accepted (rests as `type:limit trigger:stop`).
3. Naked STO call rejected at place time:
   `400 "This order introduces infinite risk."` — where review only
   surfaces an advisory `OPTION_NOT_ENOUGH_SHARES_FOR_COLLATERAL` inside
   a success envelope.
4. CSP STO put **accepted** — `opt-rev-csp` shows
   `collateral.cash.amount = 4000.0000` (strike×100); the cash-secured
   path clears where naked fails.
5. `review_option_order` is advisory-only (established pass 1); place is
   the enforcement boundary for every constraint observed.

## Standards axis findings — all resolved

- `env`/`redactFields` convention fields missing on 12 second-pass
  probes → patched (doc-aid fields; validator unaffected).
- `opt-can-stop`/`opt-can-naked` stale cancel notes → "intentionally
  skipped" annotations added (matching `opt-can-spread`/`mx-can-lots`).
- TEST doc `Last Updated` not bumped → fixed.

Leak scan clean: no `5AY08578` artifact, `account_number` masked
`••••6245` or `$ENV:` throughout, UUIDs are evidence identifiers.

## Spec axis findings — gaps closed in-loop

- CSP put had zero coverage → `opt-instr-puts`, `opt-rev-csp`,
  `opt-place-csp`, `opt-can-csp` added and executed (accepted).
- Fee/collateral variant lived only outside opt-matrix → `opt-rev-naked`/
  `opt-rev-csp` carry `chain_symbol`+`underlying_type` and show full
  `fees`/`collateral` blocks.
- Naked call was review-only → `opt-place-naked` captured the place-level
  reject.
- 2-leg credit spread place: moot — multi-leg is a hard 400 boundary;
  review coverage exists (`opt-rev-credit`, `dep-rev-opt-14`).

All four ACs now met with verbatim captures.

## Thermo-nuclear axis findings

- **MAJOR** — canonical doc's generated capability text (quoted from the
  tool description) contradicted live rejects with no callout → resolved
  by carrying `LIVE FINDING:` text in the probe notes, which the
  assembler emits in the per-tool Notes section directly beneath the
  capability claim (canonical doc lines ~3331–3337).
- **MINOR** — `opt-orders-final` filtered `state:"confirmed"` while
  resting option orders report `unconfirmed` (blind spot) → probe made
  unfiltered; re-run shows 6 orders, all terminal.
- **MINOR** — undisclosed `opt-place-fill` re-capture after a
  wrong-account FORBIDDEN → disclosed in the probe note.
- Nits: `$ENV:NFLX_OPT_REF2` var-name reuse (values were fresh UUIDs;
  cosmetic), second-pass probes omit `direction` (schema-legal at 1 leg),
  assembler renders skips inconsistently across the coverage matrix
  (filed for #688/#689), redactor masks `price` while `premium` leaks the
  same value (existing tooling quirk — noted, not blocking).

## Tests

`npm run test:rh-agent-mcp-discovery` — **130/130 green**.

## Residual risk

Real-money round trip executed: bought 1 NFLX 70C @ ~1.90, sold @ market
minutes later — net slippage was small and bounded by design (limit-priced
entry, same-session exit). Account verified flat: `positions: []`,
`orders: []` unfiltered.

## Next

`/proj qa 657 686`
