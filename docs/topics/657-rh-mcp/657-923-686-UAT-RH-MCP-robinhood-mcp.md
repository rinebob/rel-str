**Topic:** Robinhood MCP  
**Topic Slug:** rh-mcp  
**Thread:** Full RH MCP Tool Discovery  
**Thread Slug:** rh-mcp-full-tool-discovery  
**Issue:** #923  
**Thread Parent:** #658  
**Topic Parent:** #657  
**Task:** #686  
**Domain:** RH-MCP  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-08  
**Last Updated:** 2026-10-08  

# UAT — NFLX option order matrix session (#686 / QA #923)

## Scope

Task #686 delivered the option-order probe matrix: 38 `opt-matrix`
manifest probes covering NFLX chain/instrument harvest (calls + puts),
10 `review_option_order` sims (incl. chain-hint fee/collateral variants
and deliberate constraint rejects), 12 place + 8 cancel mutations, and
flat/resting verification reads. All evidence lives under
`docs/topics/657-rh-mcp/captures/opt-*.json` (35 captures; 3 probes
intentionally skipped because their place leg rejected and no order
existed to cancel).

Review doc: `657-680-686-CODE-REVIEW-RH-MCP-robinhood-mcp.md` (PASS).

## Prerequisites

- Repo at the post-#686 working tree (probes 333 total in
  `probe-manifest.json`).
- Python 3 + Node/tsx available; `functions/` deps installed.
- For *re-execution* (not required to verify evidence): a live
  `RH_ACCOUNT_NUMBER` in `.env.local`, `RH_PROBE_AUTOYES=1` for headless
  mutation gates, regular market hours for fills.

## Scenarios

### 1. Manifest ↔ capture reconciliation

- Run: `python` — count `group:"opt-matrix"` probes in
  `probe-manifest.json` and `captures/opt-*.json` files.
- Expected: **38 probes, 35 captures**, and the only probes without a
  capture are `opt-can-spread`, `opt-can-stop`, `opt-can-naked` — each
  carrying an "intentionally skipped" note (a cancel whose place leg
  rejected; same pattern as `mx-can-lots`).
- Result: **PASS** — 38/35, exactly those 3 no-capture ids, zero orphans.

### 2. Verbatim capability-boundary rejects

- `opt-place-spread.json` contains `400 "Multi-leg options orders aren't
  supported in the Robinhood Trading MCP yet. You can still place
  multi-leg options orders through the app or on web."`
- `opt-place-stop.json` contains `400 "Stop market orders aren't
  supported when buying to open. Select another order type to place this
  order."`
- `opt-place-naked.json` contains `400 "This order introduces infinite
  risk."`
- Result: **PASS** — all three byte-confirmed.

### 3. Fill / sell-to-close / flat round-trip

- `opt-place-fill.json` — place response `state:"unconfirmed"`,
  `processed_quantity:"0"`, premium 196 (limit 1.96 vs ask 1.95).
- `opt-pos-open.json` — `positions[]` shows long 1 NFLX 70C,
  `average_price:"190.0000"`, `opened_at` 17:25:56.112Z ≈ order
  `created_at` 17:25:56.073Z (+39 ms — fill proven via positions read).
- `opt-sell-lim.json` rested → `opt-can-stc.json` `accepted:true`.
- `opt-sell-mkt.json` → `opt-pos-flat.json` `positions:[]`.
- Result: **PASS** — causation chain (order → +39 ms → position → flat)
  verified from captures.

### 4. STO constraint coverage (spec AC)

- `opt-rev-naked.json` — success envelope carrying advisory
  `order_checks.alertType=OPTION_NOT_ENOUGH_SHARES_FOR_COLLATERAL` +
  full `fees` block + `collateral.cash` infinite debit.
- `opt-rev-csp.json` — success, empty `order_checks`,
  `collateral.cash.amount:"4000.0000"` (strike×100 — CSP requirement
  shown live).
- `opt-place-naked.json` — place-level reject (scenario 2).
- `opt-place-csp.json` — **accepted**, `opening_strategy:"short_put"`,
  rested `unconfirmed`; `opt-can-csp.json` `accepted:true`.
- Result: **PASS** — naked call + CSP constraints recorded at both
  review (advisory) and place (enforcement) layers.

### 5. Stop-type asymmetry

- `opt-place-stop.json` — stop_market BTO rejected (scenario 2).
- `opt-place-stplim.json` — stop_limit BTO **accepted**
  (`type:"limit", trigger:"stop"`), cancelled via `opt-can-stplim.json`.
- Result: **PASS** — the restriction is stop_market-specific.

### 6. Final state — flat, zero resting, unfiltered

- `opt-orders-final.json` — **unfiltered** scan (fixed during review:
  resting option orders report `state:"unconfirmed"`, so a
  `state:"confirmed"` filter would be blind to a leak): 6 orders,
  states `['cancelled','cancelled','filled','cancelled','filled',
  'cancelled']` — all terminal.
- `opt-positions.json` — `positions:[]`.
- Result: **PASS** — zero resting, zero positions, full session audit
  trail.

### 7. Redaction / secrets hygiene

- Scan all `opt-*.json` for the fabricated `5AY08578` and for any
  unmasked `account_number` value: expected zero hits (request args may
  show `$ENV:` or the masked `••••6245` form; UUIDs are evidence ids).
- Result: **PASS** — zero leaks.

### 8. Canonical doc carries the findings

- `rh-mcp-tool-discovery-canonical-657-658-689.md` header:
  `tools=76 probes=333 captures=334`.
- `place_option_order` Notes section contains the `LIVE FINDING:`
  callouts for multi-leg / stop_market-BTO / naked-call rejects adjacent
  to the tool's stale "level-3 supported" capability text.
- Result: **PASS** — callouts present at lines ~3331–3337; counts
  verified after regen.

### 9. Manifest integrity + tests

- `npx tsx src/rh-agent-mcp/diagnostics/run-probe-manifest.ts --dry-run`
  → 333 probes, 0 validation errors.
- `npm run test:rh-agent-mcp-discovery` → 130/130 green.
- Result: **PASS**.

## Traceability

| AC / spec item | Scenario |
|---|---|
| Multi-leg verdict captured verbatim | 2, 8 |
| Sell-to-open constraints (naked call + CSP) | 4, 5 |
| Fee/collateral review variant | 4 |
| Option position ends flat; resting orders cancelled | 3, 6 |
| Resolve via chains/instruments; review sims | 1, 4 |
| BTO limit fill; STC limit rest→cancel; STC market flat | 3 |
| stop_market / stop_limit opens | 5 |
| Redaction / no secrets | 7 |

## Regression / smoke

- `mx-*` equity-matrix captures untouched by this pass.
- `opt-orders-final` intentionally re-captured (unfiltered args) — the
  earlier `state:"confirmed"` capture was superseded by design and its
  overwrite is documented in the review.

## Refinement pass

Not applicable — no user-facing surface (discovery evidence + docs).
The manual-judgment equivalent (doc readability) is covered by scenario
8's canonical-doc check.

## Notes

- Known tooling quirks logged for #688/#689 (not blocking): assembler
  renders skipped probes inconsistently in the coverage matrix;
  redactor masks `price` while `premium` carries the same value;
  `$ENV:NFLX_OPT_REF2` var-name reused across two probes (values were
  distinct fresh UUIDs).
