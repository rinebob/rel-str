# RH Agent Observation Dashboard — Full MCP Tool Surface Rollout Plan

**Date:** 2026-07-19  
**Status:** Draft — docs only  
**Scope:** Extend the local observation dashboard so it can request every tool in `functions/.rh-mcp-tool-catalog.json` through the backend. Read-only and simulation tools are enabled first; account-write tools follow; financial mutations come last.  
**Related docs:**  
- `docs/implementations/RH-AGENT-OBSERVATION-DASHBOARD-IMPLEMENTATION-PLAN.md` (Phase 0 / initial seven tools)  
- `docs/implementations/RH-AGENT-ROBINHOOD-MCP-DISCOVERY-USAGE-2607-01.md` (full 49-tool discovery guide)  
- `docs/implementations/RH-AGENT-MCP-OBSERVATION-BACKEND-AS-BUILT-2607-01.md` (backend as-built)  
- `docs/reviews/2026-07-18-thermo-review-rh-agent-observation.md` (dashboard review history)

---

## Current state

The backend and local dashboard already support the seven core read-only tools from the original plan:

1. `get_accounts`
2. `get_portfolio`
3. `get_equity_positions`
4. `get_equity_quotes`
5. `get_equity_orders`
6. `get_equity_fundamentals`
7. `get_equity_historicals`

The tool catalog currently lists **49 tools**. The rollout below exposes all 49 in the dashboard. If a 50th tool appears in a future catalog export, it is slotted into the matching phase and gated the same way.

---

## Rollout principles

- **Backend owns credentials and connectivity.** The Angular app never stores or sees OAuth tokens.
- **Tool-gate by risk, not by convenience.** A tool is not enabled in the UI until its schema, parser, redaction rules, and confirmation flow are in place.
- **Read-only first, mutate last.** All `get_` tools and simulators (`review_*`) ship before any write. Non-financial writes (`create_*`, `update_*`, `add_*`, `remove_*`, `follow_*`, `unfollow_*`) ship before order placement/cancellation.
- **Confirmation is part of the tool, not the form.** Every mutation path shows an explicit summary modal and requires a second user action; the backend does not accept a one-click execute for writes.
- **No cloud persistence of inputs or raw responses.** Call history stays in browser memory; only redacted results are displayed.
- **Account numbers are never defaulted.** UI helpers can present masked accounts, but every account-scoped call must carry an explicitly chosen account.
- **Result parsers fail closed.** A tool returns a typed, validated structure or a categorized error. Unknown response shapes are not silently passed through.

---

## Tool inventory by phase

### Phase 0 — Foundation (done)

Already implemented in `RH-AGENT-OBSERVATION-DASHBOARD-IMPLEMENTATION-PLAN.md`.

### Phase 1 — Account, position, and performance read-only (3 tools)

| Tool | Why here |
|---|---|
| `get_equity_tax_lots` | Completes the equity-position picture; one symbol per call. |
| `get_pnl_trade_history` | Closed-trade reconciliation; cursor pagination. |
| `get_realized_pnl` | Aggregate P&L buckets by span or date range. |

### Phase 2 — Market data, earnings, and fundamentals (9 tools)

| Tool | Why here |
|---|---|
| `search` | Symbol/name resolution for all downstream tools. |
| `get_equity_price_book` | Level 2 depth; small symbol set (max 4). |
| `get_financials` | Quarterly/annual reported metrics. |
| `get_earnings_calendar` | Market-wide earnings window (max 31 days). |
| `get_earnings_results` | Per-symbol earnings history. |
| `get_equity_technical_indicators` | Indicator computation over historicals. |
| `get_equity_tradability` | Fractional/session eligibility before any order. |
| `get_indexes` | Index symbol → instrument ID resolution. |
| `get_index_quotes` | Index levels by instrument ID. |

### Phase 3 — Options read-only (7 tools)

| Tool | Why here |
|---|---|
| `get_option_chains` | Underlying → expiration/chain map. |
| `get_option_instruments` | Chain/expiration → contract UUIDs. |
| `get_option_quotes` | Live option quotes by instrument ID. |
| `get_option_orders` | Open/closed option orders. |
| `get_option_positions` | Open/closed option positions. |
| `get_option_level_upgrade_info` | Options-access link for an account. |
| `get_option_watchlist` | Single-leg option watchlist contents. |

### Phase 4 — Scanners and watchlists read-only (6 tools)

| Tool | Why here |
|---|---|
| `get_scanner_filter_specs` | Valid filter/predicate catalog for scanner UI. |
| `get_scans` | List saved scanners. |
| `run_scan` | Execute a saved scanner and return results. |
| `get_watchlists` | List custom and followed watchlists. |
| `get_watchlist_items` | Non-option items in a watchlist. |
| `get_popular_watchlists` | Discover Robinhood-curated lists. |

### Phase 5 — Order simulations (2 tools)

| Tool | Why here |
|---|---|
| `review_equity_order` | Dry-run equity order; no money moves. |
| `review_option_order` | Dry-run single-leg option order. |

### Phase 6 — Non-financial account writes (11 tools)

| Tool | Why here |
|---|---|
| `create_scan` | Creates a saved scanner and returns live results. |
| `update_scan_config` | Changes scan result sorting. |
| `update_scan_filters` | Replaces a scan’s full filter set. |
| `create_watchlist` | Creates a custom watchlist. |
| `update_watchlist` | Renames/updates a custom watchlist. |
| `add_to_watchlist` | Adds stocks/crypto/indexes to a watchlist. |
| `remove_from_watchlist` | Removes stocks/crypto/indexes from a watchlist. |
| `follow_watchlist` | Follows a curated watchlist. |
| `unfollow_watchlist` | Unfollows a curated watchlist. |
| `add_option_to_watchlist` | Adds option contracts to the option watchlist. |
| `remove_option_from_watchlist` | Removes option contracts from the option watchlist. |

### Phase 7 — Financial mutations (4 tools, last)

| Tool | Why here |
|---|---|
| `place_equity_order` | Real-money equity order placement. |
| `cancel_equity_order` | Cancels an open equity order. |
| `place_option_order` | Real-money single-leg option order placement. |
| `cancel_option_order` | Cancels an open option order. |

---

## Backend work

### Tool registry and allowlist

- Replace the single fixed `RobinhoodToolName` union with phase-based allowlist sets in `functions/src/rh-agent-mcp/tools/robinhood-tools.ts`.
- Keep the runtime source of truth as `functions/.rh-mcp-tool-catalog.json`.
- Add `mutation: true` for all Phase 6 and Phase 7 tools; add a new `financialMutation: true` flag for Phase 7.
- Add `simulation: true` for Phase 5 tools.
- Maintain backward compatibility: the existing seven tools remain enabled; each phase flips a named allowlist set.

### Argument validation

- Validate `args` against the catalog `inputSchema` before any MCP call.
- Support JSON Schema types used across the catalog: `string`, `number`, `integer`, `boolean`, arrays, `null` unions, enums, `additionalProperties: false`, and `required` arrays.
- Coerce form/string inputs into the correct types (numbers, integers, booleans) before validation and submission.
- Reject extra properties when `additionalProperties: false`.
- Surface validation errors as `ToolExecutionErrorCategory.VALIDATION` with field-level detail.

### Per-tool result parsers

- Add `functions/src/rh-agent-mcp/parsers/` with one parser per tool group:
  - `parse-accounts.ts`, `parse-portfolio.ts`, `parse-equity-positions.ts` (existing concept)
  - `parse-equity-orders.ts`, `parse-equity-tax-lots.ts`, `parse-pnl-trade-history.ts`, `parse-realized-pnl.ts`
  - `parse-search.ts`, `parse-equity-quotes.ts`, `parse-equity-fundamentals.ts`, `parse-equity-historicals.ts`
  - `parse-earnings.ts`, `parse-financials.ts`, `parse-indexes.ts`, `parse-technical-indicators.ts`
  - `parse-option-chains.ts`, `parse-option-instruments.ts`, `parse-option-quotes.ts`, `parse-option-orders.ts`, `parse-option-positions.ts`
  - `parse-scans.ts`, `parse-watchlists.ts`, `parse-watchlist-items.ts`
  - `parse-review-order.ts` (simulation)
- Parsers return typed objects; failures throw `ToolValidationError` so the executor maps them to `VALIDATION`.

### Redaction

- Extend `functions/src/rh-agent-mcp/tools/robinhood-response-redactor.ts`:
  - Add tool-specific sensitive paths (e.g., option contract UUIDs, order IDs, tax-lot IDs, account numbers in new contexts).
  - Keep default field/pattern redaction.
  - Allow per-call `extraRedactFields` to include nested dotted paths (`positions.account_number`).
- The dashboard receives `parsed` (typed) and `redacted` (masked) views; `parsed` is never rendered by default.

### Local API

- `GET /api/rh/tools` returns the currently enabled phase group, not the entire catalog.
- `POST /api/rh/tools/:toolName` performs allowlist, schema, and redaction checks unchanged.
- Add a `phase` or `toolGroup` query parameter so the UI can list tools by category.

### Error and safety categories

- Map validation failures to `VALIDATION`.
- Map connection/auth failures to `AUTH`.
- Map Robinhood/MCP runtime errors to `MCP`.
- For mutations, the executor must return a distinct `MUTATION_NOT_ENABLED` error if a tool is called before its phase is active.

---

## Frontend work

### Tool selector and grouping

- Group tools by phase/category in the dropdown:
  - Account & Performance
  - Market Data & Research
  - Options
  - Scanners & Watchlists
  - Simulations
  - Account Writes
  - Order Placement (last, visually separated)
- Disable mutation groups until their phase is enabled; show a tooltip explaining the rollout order.

### Dynamic argument form

- Render JSON Schema properties as form controls:
  - `string` → text input; `enum` → dropdown; `format: date/date-time` → date picker.
  - `number`/`integer` → numeric input; honor `minimum`, `maximum`.
  - `boolean` → toggle.
  - `array` of strings → multi-chip/tag input or comma-separated text that is split and trimmed.
  - `null` union (`["null", "integer"]`) → optional numeric input; empty means omitted.
  - Required fields marked; optional fields collapsed under an “Optional” section.
- Add computed helpers:
  - Account picker populated from `get_accounts` with masked display and explicit selection.
  - Symbol search helper backed by `search`.
  - Option-chain helper: symbol → `get_option_chains` → expiration → `get_option_instruments` → `get_option_quotes`.
  - Watchlist picker populated from `get_watchlists`.
  - Scan picker populated from `get_scans`.

### Result viewer

- Raw JSON (`redacted`) shown by default.
- Toggle to `parsed` structured view when a parser exists.
- For arrays, show a table where available.
- Pagination controls for cursor-paginated tools.

### Call history

- Record tool name, timestamp, duration, success/error category, and redacted summary.
- Do not persist history across reloads.

### Mutation confirmation

- All Phase 6 and Phase 7 tools require a two-step confirmation modal.
- The modal shows:
  - Tool name and description
  - Account and full argument summary
  - For financial orders: side, symbol/option, quantity/amount, order type, time in force, estimated price/alerts from `review_*`
- User must type or click an explicit confirm button; accidental Enter does not submit.
- Phase 7 tools additionally require the user to type a short confirmation string (e.g., the symbol) before the backend accepts the call.

---

## Phase-by-phase acceptance criteria

### Phase 1

- The dashboard can list and call the three account/position/performance tools.
- Parsers return stable shapes for `get_equity_tax_lots`, `get_pnl_trade_history`, `get_realized_pnl`.
- Redaction masks account numbers, tax-lot IDs, and trade IDs.
- Pagination is exercised for `get_pnl_trade_history`.

### Phase 2

- All nine market/earnings/financial tools are selectable.
- `search` resolves names/symbols and `get_indexes`/`get_index_quotes` resolve index IDs.
- `get_equity_technical_indicators` exposes indicator type, interval, period, and output mode controls.
- `get_equity_price_book` limits symbol input to four.

### Phase 3

- All seven options read-only tools are selectable.
- The UI has a chain → expiration → contract → quote helper flow.
- `get_option_orders` and `get_option_positions` support pagination and filters.

### Phase 4

- Scanner and watchlist tools are selectable.
- `run_scan` requires a scan selected from `get_scans`.
- `get_watchlist_items` requires a watchlist selected from `get_watchlists`.

### Phase 5

- `review_equity_order` and `review_option_order` can be called with full argument forms.
- Results show alerts, estimated price, and buying-power impact.
- The UI clearly labels these as simulations with a “Place order” follow-up disabled until Phase 7.

### Phase 6

- All eleven non-financial writes are gated by confirmation modal.
- Scanner writes require reading existing scan/watchlist state first.
- `add_to_watchlist` enforces exactly one of `symbols`/`currency_pair_ids`/`index_ids`.
- `update_scan_filters` warns that it replaces the entire filter set.

### Phase 7

- All four financial mutation tools are enabled.
- `place_equity_order` and `place_option_order` require:
  - explicit account selection
  - `ref_id` generated and displayed before call
  - preflight `review_*` call with same arguments
  - typed confirmation
- `cancel_*_order` requires resolving the order via `get_*_orders` and confirming the order_id.
- On ambiguous responses, the UI surfaces the broker state and offers a manual refresh instead of a blind retry.

---

## Testing plan

### Unit tests

- Registry allowlist sets per phase.
- JSON schema validation for representative tools from each phase.
- Parsers against synthetic fixtures stored under `tests/functions/rh-agent-mcp-tool-responses/`.
- Redactor on fixtures containing new sensitive fields.

### Integration tests

- In-memory MCP server exercises the full executor path for each phase.
- Local API tests confirm route allowlist and body-size behavior.

### Manual end-to-end

- Run `npm --prefix functions run probe:rh-agent-mcp-tool -- <toolName>` for every new tool.
- Exercise each tool through the dashboard UI against real Robinhood data.
- Record redacted result shapes in `docs/implementations/RH-AGENT-OBSERVATION-DASHBOARD-SHAPES.md` (or equivalent) for parser refinement.

---

## Security and operational checklist

- [ ] OAuth token never leaves the `functions/` backend.
- [ ] Mutations require explicit confirmation; financial mutations require typed confirmation.
- [ ] `ref_id` is generated, persisted, and reused on retry.
- [ ] Account numbers are masked in the UI and redacted in responses.
- [ ] No raw MCP responses or account identifiers are written to cloud storage.
- [ ] The local API remains loopback-only and refuses to start in production.
- [ ] `additionalProperties: false` schemas reject stray fields.
- [ ] Cursor pagination preserves filters across pages.
- [ ] Order-side alone is never used to infer position effect.
- [ ] Broker-reported state is treated as the source of truth after every mutation.

---

## Sequencing summary

1. Land Phase 1 parsers/redaction and enable the three account/performance tools.
2. Land Phase 2 market/earnings/financial tools.
3. Land Phase 3 options read-only tools with chain/instrument/quote helpers.
4. Land Phase 4 scanner/watchlist read-only tools.
5. Land Phase 5 order simulators.
6. Land Phase 6 non-financial account writes with confirmation modals.
7. Land Phase 7 financial mutations last, with preflight, `ref_id`, and typed confirmation.
8. Document redacted response shapes and update the as-built backend doc.

Each phase lands as a focused backend PR followed by a UI PR; parsers and redaction ride with the backend PR.

---

## Open questions before Phase 1 coding

1. Should the dashboard expose all tools under one generic “Tool Runner” view, or split observation from order/execution into separate dashboard pages?
2. For options, does the UI chain helper belong in the observation dashboard or a dedicated options panel?
3. Do Phase 6 scanner/watchlist writes require a separate “Sandbox” mode, or are confirmations sufficient?
4. What is the intended production credential story? The local API is intentionally local; exposing Phase 7 in the cloud requires unattended MCP authentication, which is not yet designed.
5. Is there a desired audit-trail persistence for mutations (outside browser memory), or does Robinhood remain the system of record?
