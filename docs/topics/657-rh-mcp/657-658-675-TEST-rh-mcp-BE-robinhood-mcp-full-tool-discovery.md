**Topic:** Robinhood MCP  
**Topic Slug:** robinhood-mcp  
**Thread:** Full RH MCP Tool Discovery  
**Thread Slug:** full-tool-discovery  
**Issue:** #675  
**Thread Parent:** #658  
**Topic Parent:** #657  
**Domain:** RH-MCP  
**Type:** TEST  
**Status:** Complete  
**Created:** 2026-09-28  
**Last Updated:** 2026-10-08  

> **2026-09-29 amendment.** Manifest loader (24 cases) + drift diff (17 cases) shipped. Live surface = 76 tools — the read sweep target expands accordingly; coverage matrix rows = live tool count.  
> **2026-10-05 amendment — #684 read-only sweep executed.** 233 manifest probes → 233 captures in `docs/topics/657-rh-mcp/captures/` (plus 2 pre-existing #682 artifacts = 235 files). See "Sweep execution results" below.

# TEST — BE: Full RH MCP Tool Discovery

Most of this Thread's "test surface" is the probe harness (pure/verifiable) plus the doc-coverage verify script. Live probes are gated manual sessions, not automated tests.

## E2E User Journeys

- **Harness dry-run:** `run-probe-manifest.ts --dry-run` prints the ordered probe list + gate classification without calling MCP → operator confirms coverage before the session.
- **Discovery session:** operator runs the manifest group-by-group; mutation probes prompt per call; captures land under `docs/topics/657-rh-mcp/captures/`.
- **Doc check:** verify script passes once every catalog tool has a doc section with params + ≥1 response block.

## Integration Tests

- **Runner → `executeObservationTool`:** ✅ shipped (22 cases, `rh-agent-mcp-probe-runner.test.ts`) — mock the caller; sequential order, capture write shape, `redactFields` passthrough, gate prompt on `mutation` entries, skip/abort bookkeeping, `--only`/`--group`/`--from`/`--dry-run` filters.
- **Pacing behavior:** ✅ shipped — settle poll waits for order to leave `new`/`queued`/`confirmed` before the next probe (timeout → operator prompt); `read` auto-pause on `success:false` and 429/Retry-After backoff; between-group checkpoint pause (`--auto` skips); `abort` prints the recovery checklist.
- **Drift checker:** ✅ shipped — fixture live `tools/list` vs fixture bundled catalog → added/removed/renamed/schema-changed output (17 cases); live capture `00-drift.json` produced 2026-09-30.
- **Doc assembler:** fixture manifest + fixture captures → emitted sections contain the tool name, a params table from the fixture schema, a response field-tree derived from the capture, and a coverage-matrix row.

## Unit Tests

- **Manifest loader/validator** — ✅ shipped (24 cases): unknown tool → error naming it; duplicate id → error; missing gate → error; mutation-over-read safety; strict unknown-arg check; env placeholders.
- **Drift diff** — ✅ shipped: pure function — added/removed/renamed/schema-changed classifications on small fixtures.
- **Field-tree summarizer** (reuse `summarizeShape` approach from `option-quote-discovery-function.ts`) — nested objects, arrays, nullability, depth cap.
- **Coverage matrix join** — manifest×captures produces probed/skipped/missing rows.
- **Capture redaction check** — sample capture contains no account-number-shaped values.

## Test Seams

- **Highest seam:** `executeObservationTool` boundary — mock it for all harness tests; no MCP needed in CI.
- **Verify script seam:** reads the doc + catalog JSON from disk — no credentials, CI-safe (same pattern as `workflows-template-647.ts`).
- Live probes themselves are manual (US8 gating) — never automated.

## Edge Cases

- Tool returns `success: false` → capture records error + category, probe marked failed (not silently absent).
- `next_cursor` empty on first page → pagination probe marked single-page.
- Capture write fails mid-run → runner stops (no partial-overwrite ambiguity).
- Manifest references a tool removed upstream → validator fails the sweep, not just that probe.
- `--only <id>` rerun overwrites that capture cleanly (idempotent probe ids).

## Sweep execution results (#684, 2026-10-05)

Six waves executed live against the agentic account (`RH_ACCOUNT_NUMBER`, `••••6245`) — waves 1–4 during market hours, waves 5–6 as review remediation:

| Wave | Probes | Outcome |
|---|---|---|
| 1 — param permutations from literals/env (ro-*) | 168 | 148 ok / 19 errors / 1 declined mutation |
| 2 — dependency-harvested IDs + cursor follows + review matrix (dep-*) | 30 | 28 ok / 2 errors kept |
| 3 — nested deps (SEC section, offset follow, axis filter) | 5 | 5 ok |
| 4 — param-gap closure (tax lots, strike filter, stop_market) | 9 | 7 ok / 2 errors kept |
| + run_scan synthetic-id probe | 1 | error captured (NotFound envelope) |
| 5 — review remediation: expression filters, stop_limit, ratio spreads, 4-leg, deeper pages | 13 | 9 ok / 4 errors kept |
| 6 — remediation follow-ups: 4-leg debit, SPXW curb hours, RSI+plot bug | 4 | 3 ok / 1 error kept |
| + corrected plot probe (PERCENT_CHANGE_FROM_CLOSE) | 1 | 1 ok |
| + gfm tif + bounds=24_7 enum closures | 2 | 1 ok / 1 error kept |
| **Total** | **233** | **204 success / 28 error / 1 declined** |

**Coverage:** all 53 in-scope read/sim tools have ≥1 capture; 50 have ≥1 success capture. Every schema param was sent in ≥1 request — including nested sub-params (`legs[].ratio_quantity`, `filters[].{expression,display_title,interval,length,plot}`, `columns[].{expression,visible,order}`, `tax_lots[]`) — except the rationale-noted set below.

**Environment-limited (success shape not observable on this account):**
- `get_crypto_orders`, `preview_crypto_order` — "no crypto account linked to brokerage account" (agentic acct not crypto-onboarded). All params including `order_id` (synthetic UUID, dep-crypto-orders-13) were sent; every call fails at the account gate before param evaluation.
- `run_scan` — no saved scans exist and `create_scan` is a mutation (out of scope). `scan_id` exercised via synthetic UUID → NotFound error envelope captured (dep-run-scan-01).
- `cursor` on `get_alert_log`, `get_alerts`, `get_crypto_orders`, `get_crypto_positions`, `get_equity_orders`, `get_equity_positions`, `get_equity_tax_lots`, `get_option_orders`, `get_option_positions`, `get_pnl_trade_history` — first page emitted no `next`/`next_cursor` (account data fits one page; these tools have no `limit` to force pagination). Cursor mechanics proven on 4 other tools.

**Empty-ledger tools (success captures but no item shapes for #688):** `get_option_orders`, `get_option_positions`, `get_pnl_trade_history`, `get_alerts`, `get_alert_log`, `get_scans`, `get_crypto_positions`, `get_option_watchlist` all returned `[]` — the account has no option orders/positions, alerts, scans, or crypto positions. The assembler can emit envelope + `guide` text only. `get_realized_pnl` returns the `data_points` bucket shape with all-null `realized_gain` fields.

**Pagination:** 7 follows captured — `get_currency_pairs` p2+p3 (`cursor`), `get_sec_filing_index` p2+p3 (`cursor`), `get_option_instruments` p2 (`cursor`), `get_sec_filing_facts_catalog` p2+p3 (`offset`).

**Notable discoveries recorded as error captures:**
- `data.next` (not `next_cursor`) is the cursor field on most tools; `get_pnl_trade_history` uses `next_cursor` — field-name inconsistency.
- `get_equity_historicals`: minute interval capped at 5000 bars; `adjustment_type=all` requires interval ≥ day (first-pass errors observed; captures overwritten by corrected reruns — notes say so).
- `get_index_historicals`: minute rejected ("granularity too small"); hour works.
- `get_option_instruments`: `tradability=untradable` rejected at tool layer (as documented).
- `review_option_order` types: `market/limit/stop_market/stop_limit`; `market_hours` enums are `regular_hours/regular_curb_hours/regular_curb_overnight_hours` (differs from equity's `regular_market_hours`). Curb hours validated live on SPXW index legs (dep-rev-opt-17/18).
- `review_option_order` validates `direction` against live pricing — "direction 'credit' does not match these legs: net debit of about 2.53" (dep-rev-opt-15).
- `review_option_order` does NOT refuse `position_effect=close` with no open position at review time (dep-rev-opt-06).
- Schema vs observed: catalog says `stop_market` is "sell-to-close only" but a buy-to-open `stop_market` review succeeded (dep-rev-opt-12); catalog says `adjustment_type=all` is "intraday only" but `day`+`all` succeeded (ro-eq-hist-11). Carry both into the doc as catalog-bug notes.
- `review_equity_order` uses `limit_price`; `review_option_order` uses `price` — naming asymmetry.
- `preview_scan`: `display_title` is expression-filters-only (rejected on enum filters, dep-prev-scan-03); boolean expression form `predicate:"=" + values:["True"]` works (dep-prev-scan-05); `plot` is not validated pre-flight — RSI+plot produced a malformed DXFeed expression server-side (dep-prev-scan-06); valid plot on `PERCENT_CHANGE_FROM_CLOSE` works (dep-prev-scan-07).
- `preview_crypto_order.tax_lots` rejected: "specified-lot selling is not available for this account" (reached tax-lots layer past the acct gate).
- `get_alerts.asset_class` without `symbol` → "asset_class can only be used together with symbol" (dep-alerts-03).
- `run_scan` NotFound error leaks raw RPC text — truncated mid-word ("Scan not found because\n> no rows in result set").
- Agentic acct: no crypto account, empty `option_level` (relevant to #686).
- Mutation gate verified live: `mut-eq-market-buy-01` auto-declined in non-interactive mode.

**Redaction:** account-number scan across all 235 capture files → zero leaks (`••••6245`/`••••1655`/`••••5100` masked forms only).

**Manifest conventions:** `ro-*` = wave-1 permutation probes; `dep-*` = dependency-harvested probes (waves 2–6); `mut-*` = gated mutations. The 12 `get_crypto_orders` error captures all hit the account gate — params were sent but not evaluated; keep them as the param-coverage evidence, treat one as the environmental-limit capture.

## Existing Coverage

- `run-tool-observation.ts` + `executeObservationTool` + `robinhood-response-redactor.ts` are already exercised in production paths — reused, not re-tested here.
- `option-quote-discovery-function.ts` shows the capture/summarize pattern this generalizes.

## Equity order matrix session (#685) — execution runbook

42 `eq-matrix` probes authored (10 review sims, 4 harvest reads, 18 place,
9 cancel, 1 short-probe). **Requires regular market hours** — market/stop
orders are `regular_hours`-only and `dollar_amount` fractional is market +
regular-hours only (verified live — see session results). Execution is
strictly sequential; every mutation prompts y/n/abort, or approves via
`RH_PROBE_AUTOYES=1` on headless hosts (see execution pattern below).

### Env vars (set in `.env.local` before each step)

| Var | When set | Source |
|---|---|---|
| `RH_ACCOUNT_NUMBER` | already set | Agentic acct |
| `OOMA_ASK`, `OOMA_BID` | run start | `mx-quote-start` capture |
| `OOMA_STOP_BUY_HI` (~ask+2%) | run start | derived |
| `OOMA_STOP_BUY_LO` (~bid−2%) | run start | derived |
| `OOMA_STOPLIM_BUY` (> stop) | run start | derived |
| `OOMA_SELL_TGT` (~+2%) | before exits | derived |
| `OOMA_SELL_STOP` (~−2%), `OOMA_SELL_STOP2` (−1.5%), `OOMA_SELL_STOPLIM` (< stop), `OOMA_SELL_STOP_HI` (> market) | before exits | derived |
| `OOMA_ORDER_ID` | before EVERY cancel | `id` field of the preceding place capture |
| `OOMA_LOT_ID` | before `mx-sell-lots` | `mx-taxlots` capture |
| `OOMA_ALL_QTY` | before `mx-sell-flat` | `mx-pos-preflat` capture (2 + $5 fractional ≈ 2.x) |
| `RH_ZERO_SYM` | before `mx-sell-short` | any listed symbol absent from positions (post-flat OOMA also qualifies) |

### Execution pattern

Headless hosts have no TTY — approve each mutation with
`RH_PROBE_AUTOYES=1` on the invocation (mutation gate only; retries, settle
timeouts and checkpoints still fail closed). Do not put it in `.env.local`.

Per probe (env-dependent args must be set first):

```
cd functions && npx tsx --env-file=../.env.local \
  src/rh-agent-mcp/diagnostics/run-probe-manifest.ts \
  --manifest ../docs/topics/657-rh-mcp/probe-manifest.json --only <probe-id>
```

Review sims may batch: `--from mx-rev-buy-mkt` through `mx-rev-sell-mkt`
(gate=read, no prompts). Place probes needing the order to rest have no
`settle` — the resting state IS the capture; harvest `id` → set
`OOMA_ORDER_ID` → run the paired `mx-can-*`. Fill-expected and
fire-or-reject probes carry `settle` polls.

**Schema drift caught 2026-10-06:** `get_equity_technical_indicators` went
multi-symbol — `symbol` (string) → `symbols` (array, max 10) since the
2026-09-30 catalog refresh. 19 sweep probes patched to the array form;
bundled catalog re-pulled via `refresh-tool-catalog.ts` (4 tools changed —
the indicators schema + doc-only edits on create_scan/update_scan_filters).

### Session results (2026-10-07) — executed

All 42 planned probes ran (+4 added during/after: `mx-can-cleanup` ×3,
`mx-sell-flat-xh` ×2, `mx-pos-postflat`, `mx-sell-xh-frac` — 46 manifest
entries total). Findings beyond the manifest's expectations:

- **At-bid limit buy FILLED** (19.83→19.8299) — tight-book reality vs the
  "rests" assumption; the cancel on that filled order returned
  `403 "Order cannot be cancelled at this time."` — both kept as hand
  captures (`mx-buy-lim-bid-filled`, `mx-can-bid-403-filled`). Rest→cancel
  path re-run successfully at 18.85.
- **`ref_id` uniqueness is server-enforced:** re-placing a probe with a
  consumed ref_id → `409 "Reference ID must be unique."`
  (`mx-buy-lim-bid-409-refid` hand capture). `mx-buy-lim-bid` and
  `mx-sell-flat` ref_ids are now env-driven for re-arm.
- **Stop-direction asymmetry:** buy stop-market BELOW market accepted at
  place then **auto-cancelled server-side**; sell stop-market ABOVE market
  accepted and **rested `queued`** (cancelled via mx-can-cleanup).
- **`tax_lots` rejected at every layer:** the review sim surfaced
  `order_checks.alertType:"EQUITY_TAX_LOT_STALE"` (advisory warning inside a
  success envelope — same advisory-review pattern as option orders), and the
  place returned `400 "Some of your selected lots are no longer
  available."` — consistent with all 4 lots reporting `is_selectable:false`.
  Lot-select selling unavailable on this surface; `mx-can-lots`
  intentionally skipped (nothing live).
- **Oversell + zero-position short:** both `400 "Not enough shares to
  sell."` — identical envelope.
- **Market orders queue post-close:** the flat-out market sell was placed
  at 20:26:19Z — already 16:26 ET, *after* the close — and sat `queued` for
  next session (cancelled ~20 min in). Whole-share market sells behave
  identically (not a fractional issue). Flat-out completed via
  `mx-sell-flat-xh` (limit@19.60, market_hours=extended_hours → filled
  19.72, price improvement).
- **Fractional/dollar orders are regular_hours-only** — verbatim reject
  `fractional and dollar-based orders are only allowed in regular_hours`.
  First observed on mx-sell-flat-xh attempt-1 (capture overwritten by its
  rerun); re-captured verbatim via `mx-sell-xh-frac`.
- **End state (evidenced by `mx-pos-postflat` + refreshed
  `mx-orders-confirmed`):** OOMA 3.252705 → 0.252705 fractional remainder
  (untradeable post-close); zero resting OOMA orders; all other
  positions/standing book untouched. Residual: sell 0.252705 market during
  regular hours to finish flat.

### Abort procedure

If anything wedges: run `get_equity_orders` filtered to OOMA AND
`state: "confirmed"` — **`confirmed` is the resting/live state; `open` and
`queued` return `[]` even with a full resting book** (verified 2026-10-06:
`mx-orders-confirmed` capture — the account carries ~15 resting GTC limit
buys + 8 resting stop-market sells on unrelated symbols; leave those
untouched). Cancel every resting OOMA order (`mx-can-*` pattern with
`OOMA_ORDER_ID`), then sell-all market for the held qty. AC: account ends
with zero OOMA position and zero OOMA resting orders (pre-existing book
stays).

## Option order matrix session (#686) — execution runbook

38 `opt-matrix` probes authored + dry-run validated across three passes
(harvest reads incl. put side, 10 review sims incl. deliberate constraint
rejects + the chain-hint fee/collateral variants, 12 place + 8 cancel
mutations, flat/resting verification reads).
**Unblocked 2026-10-07:** the Agentic account now reports
`type: limited_margin` + `option_level: option_level_3` (verified via
get_accounts) — level 3 covers the multi-leg spread probes; limited margin
clears the settle-free reuse path for the equity matrix too.

### Env vars (set in `.env.local` before each step)

| Var | When set | Source |
|---|---|---|
| `RH_ACCOUNT_NUMBER` | already set | Agentic acct |
| `NFLX_CHAIN_ID` | run start | `opt-chains-nflx` capture |
| `NFLX_EXP` | run start | nearest monthly Friday from the chain capture |
| `NFLX_OPT_ID` | after harvest | ~ATM call from `opt-instr-harvest` |
| `NFLX_OPT_ID2` | after harvest | next strike up, same expiration |
| `NFLX_OPT_PRICE` | after `opt-optq` | ~mark price of the ATM leg (review sims) |
| `NFLX_OPT_PRICE_LO` | before places | ~half the mark — rests, cannot fill |
| `NFLX_OPT_REF` / `_2`…`_6` | before places | fresh UUIDs (idempotency) |
| `NFLX_OPT_ORDER_ID` / `_2`…`_4` | before cancels | `id` from the place captures |
| `NFLX_OPT_ASK` / `_HI` / `_STOP` / `_STOPLIM` | second pass | `opt-quote-fill` mark — ask for the fill buy, mark+~2 for resting sells/stops |

### Notes

- Review sims are gate=read — `review_option_order` never submits.
  Captured 2026-10-07: review is **advisory, not a validation gate** —
  market+gtc and sell-close-without-position both returned success with
  empty `order_checks`; the naked-call credit surfaced
  `order_checks.alertType=OPTION_NOT_ENOUGH_SHARES_FOR_COLLATERAL` as a
  *warning inside a success envelope*. Only multi-leg+market produced a
  true reject ("multi-leg orders must be limit orders — market and stop
  types are single-leg only"). Hard enforcement of the other rules likely
  lives in `place_option_order`.
- `place_option_order` does NOT take `chain_symbol`/`underlying_type` —
  those are `review_option_order`-only fee/collateral hints. The place
  mutation keys everything off leg `option_id`s.
- `get_option_instruments` uses `expiration_dates` (plural, comma-sep),
  not `expiration_date`.
- Abort: `opt-orders-confirmed` (`state:"confirmed"` — resting option
  orders use the same state name as equities), cancel anything resting
  under this session's ref ids.

### Session results (2026-10-08) — executed

18 of 19 probes captured (`opt-can-spread` intentionally skipped — nothing
live). 15 harvest/review probes ran 2026-10-07; the 4 mutation probes ran
2026-10-08 during regular hours:

- `opt-place-lim` — NFLX 70C debit limit @ 0.60 (half the ~1.21 mark)
  accepted, rested `unconfirmed`, cancelled cleanly via `opt-can-lim`.
- **`opt-place-spread` — headline finding:** `place_option_order` rejects
  **all multi-leg orders**, even though the schema takes a `legs` array and
  `review_option_order` simulated a 2-leg vertical without complaint:
  `400 "Multi-leg options orders aren't supported in the Robinhood Trading
  MCP yet. You can still place multi-leg options orders through the app or
  on web."` Advisory-review vs place-enforcement divergence confirmed end
  to end — review accepts what place rejects.
- `opt-can-spread` intentionally skipped (same pattern as `mx-can-lots`) —
  no order was created; `opt-orders-confirmed` refresh verifies 0 resting
  option orders.
- **Residual #685 closed:** `mx-sell-frac-flat` (market sell 0.252705 OOMA,
  regular hours) — position row gone, zero resting OOMA orders. Literal
  "ends flat" AC now satisfied.

### Session results (2026-10-08, second pass) — fill round-trip legs

12 more probes (`opt-quote-fill` … `opt-orders-final`, total group 31)
added to cover the task's fill / sell-to-close / stop-open ACs. Executed
~17:23–17:28Z with the mark at ~1.91 (rallied from ~1.21):

- `opt-place-fill` — BTO limit @ 1.96 (crossed the 1.95 ask) **filled**:
  `opt-pos-open` shows long 1 NFLX 70C, avg_price 190.00. Note the place
  response itself returns `state: unconfirmed` with `processed_quantity: 0`
  — the fill is only visible via positions/orders reads.
- `opt-sell-lim` — STC limit @ 3.90 (above mark) rested `unconfirmed`,
  cancelled via `opt-can-stc` (`accepted: true`).
- `opt-sell-mkt` — STC market **filled**; `opt-pos-flat` shows
  `positions: []`. Position flat round-trip complete.
- **`opt-place-stop` — second capability boundary:** `stop_market` BTO
  rejected verbatim: `400 "Stop market orders aren't supported when buying
  to open. Select another order type to place this order."` `opt-can-stop`
  skipped (nothing live).
- `opt-place-stplim` — `stop_limit` BTO **accepted** (rests as
  `type: limit, trigger: stop`, state `unconfirmed`) — the stop_market
  restriction does NOT extend to stop_limit. Cancelled via `opt-can-stplim`.
- `opt-orders-final` — refreshed to an UNFILTERED scan after review
  (resting option orders report `state: unconfirmed`, not `confirmed` —
  a state filter would be blind to a leaked order). Result: 6 orders, all
  terminal (2 filled, 4 cancelled) — the full session audit trail.

### Session results (2026-10-08, third pass) — sell-to-open constraints

7 more probes (total group 38) to close the spec's STO coverage — review
sims WITH `chain_symbol`+`underlying_type` (fee/collateral variant inside
opt-matrix) plus real place-level STO attempts, ~17:38–17:44Z:

- `opt-instr-puts` — put-side harvest (first pass was calls-only);
  NFLX 2026-10-16 40P selected for the CSP leg.
- `opt-rev-naked` — review sim, STO 195C (max strike): success envelope
  carrying `order_checks.alertType=OPTION_NOT_ENOUGH_SHARES_FOR_COLLATERAL`
  + full `fees` block + `collateral.cash` infinite-debit (margin).
- `opt-rev-csp` — review sim, STO 40P: success, **empty `order_checks`**,
  `collateral.cash.amount = 4000.0000` — exactly strike×100, the
  cash-secured requirement shown live.
- **`opt-place-naked` — third capability boundary:** naked STO call
  rejected verbatim: `400 "This order introduces infinite risk."` The
  advisory alert in review is enforced hard at place time.
  `opt-can-naked` skipped (nothing live).
- `opt-place-csp` — STO 40P @ credit 2.00 (above mark) **ACCEPTED**
  (`opening_strategy: short_put`, rested `unconfirmed`) — cash-secured
  passes where naked fails. Cancelled via `opt-can-csp`.
- `opt-orders-final` re-run: `orders: []` at close.

35 of 38 opt-matrix probes captured; `opt-can-spread`, `opt-can-stop`,
`opt-can-naked` intentionally skipped (no live order — same pattern as
`mx-can-lots`). Option side ends flat: `positions: []`, `orders: []`.

## Error-envelope session (#687, 2026-10-06)

Group `err-matrix` — 15 manifest probes + 2 hand-captured executor-level
calls (`err-quote-missing-param`, `err-quote-wrong-type` via
`run-tool-observation.ts`; the manifest runner can't express
schema-invalid args — Ajv rejects them at `validateToolArgs` pre-flight).
17 captures, zero account-number leaks.

### Outcomes

| Shape | Count | Probes |
|---|---|---|
| JSON 404 `{"detail":"Not found."}` | 3 | `err-watchlist-bad-id`, `err-positions-bad-acct`, `err-cancel-bad-order` |
| Structured 404 `{"missing_instruments":[...]}` | 1 | `err-quote-bad-symbol` |
| **Raw HTML 404 page** | 2 | `err-sec-bad-id`, `err-cancel-malformed-order` |
| Server validation string | 5 | `err-hist-bad-interval`, `err-hist-bad-time` (RFC3339), `err-pnl-inverted` (cross-field), `err-search-empty`, `err-search-bad-asset` |
| Executor `VALIDATION` (never reaches server) | 2 | `err-quote-missing-param`, `err-quote-wrong-type` |
| **Success instead of error** | 4 | `err-chain-bad-symbol`, `err-crypto-bad-pair`, `err-optq-bad-id`, `err-markalerts-bad-id` |

### Envelope conformance / deviations

- **Standard error envelope:** `content[0].text` message +
  `_meta.rh_error_category: "invalid_request"` + `isError:true`. All
  server errors observed conform — no distinct category codes seen; all
  404s and validation strings share `invalid_request`.
- **Deviation — HTML 404s:** malformed ids (`"bogus"` as `order_id` or
  `filing_id`) return a raw `<html>…Not Found…</html>` page inside the
  text payload — the malformed value misses the upstream URL route
  entirely, while a well-formed-but-nonexistent UUID reaches the
  endpoint and returns JSON `{"detail":"Not found."}`.
- **Deviation — success-instead-of-error:** `get_option_chains` (bad
  underlying), `get_crypto_quotes` (bad pair), `get_option_quotes`
  (bogus instrument id), and `mark_alerts_read` (nonexistent log ids)
  return `success` with empty/absent results rather than an error —
  callers must treat empty as not-found on these tools.
- **Client-side layer:** missing-required and wrong-type args die at
  the local executor's Ajv validation (`VALIDATION` category) — the MCP
  server never sees them. Server-side validation messages are
  human-readable strings, no machine codes; the `asset_type`
  error helpfully enumerates valid values (`interval` does not).
- **Transient transport:** one transient `fetch failed` on `cancel_equity_order`
  (no HTTP response) preceded the successful 404 capture; the retry
  capture overwrote it, so only the JSON 404 is on disk.

### Env note

`--env-file=../.env.local` (per the #685 runbook) is the intended env
mechanism; non-interactive runs auto-decline mutation gates — the 3
bogus-id mutations were approved interactively.
