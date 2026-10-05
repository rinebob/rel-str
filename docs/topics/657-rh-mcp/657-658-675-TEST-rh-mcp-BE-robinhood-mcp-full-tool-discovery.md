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
**Last Updated:** 2026-10-05  

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
