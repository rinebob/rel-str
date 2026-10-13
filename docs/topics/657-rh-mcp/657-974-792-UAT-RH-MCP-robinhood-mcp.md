**Topic:** Robinhood MCP  
**Topic Slug:** robinhood-mcp  
**Thread:** Full RH MCP Tool Discovery  
**Thread Slug:** full-tool-discovery  
**Issue:** #974  
**Thread Parent:** #658  
**Topic Parent:** #657  
**Task:** #792  
**Domain:** RH-MCP  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-12  
**Last Updated:** 2026-10-12  

# UAT — #792 Observation page: surface all 76 tools

## Scope

Account Inquiry observation page (`tools/account`) expanded from the
previous 49-tool surface to all 76 live Robinhood MCP tools across 9
categories. New behaviors under test: `rhs_account_number` dropdown
resolution, JSON textarea args (object/array-of-object params),
malformed-JSON execution block, financial-mutation type-the-name
confirmation, category ordering.

## Prerequisites

- Dev server running (`npm start` → http://localhost:4200)
- Authenticated session; Robinhood MCP backend reachable (agentic account
  selected — the account selector on the page)
- Read-only execution checks only; **do not** confirm/submit any mutation
  or financial-mutation tool during QA — the confirmation gate itself is
  the test target, cancel out after observing it

## Start

1. `npm start`
2. Navigate to http://localhost:4200 → nav **Tools → Account Inquiry**
   (route `tools/account`)

## Scenarios

### S1 — Full 76-tool surface across 9 categories

Feature: `listObservationTools()` coverage.
Steps: open the tool picker (grouped dropdown/list).
Expected: 9 groups in order — Account & Performance (7), Market Data &
Research (15), Options (7), Crypto (8), Alerts (6), SEC Filings (4),
Scanners (8), Watchlists (11), Orders (10) — 76 total. New groups
Crypto/Alerts/SEC Filings render with their tools.
Result:

### S2 — `rhs_account_number` dropdown resolves rhs value

Feature: account-field detection.
Steps: select a crypto tool with `rhs_account_number`
(`get_crypto_positions`, `get_crypto_orders`, `get_crypto_quotes`,
`place_crypto_order`, `cancel_crypto_order`, or `preview_crypto_order`
— the six crypto tools carrying the param). Inspect the
param control.
Expected: `rhs_account_number` renders the account dropdown (not a free
text box); the submitted value is the account's rhs number, not the
brokerage account number. Regression pair: a standard
`account_number` tool (e.g. `get_accounts`) also renders the dropdown
with brokerage account numbers.
Result:

### S3 — JSON textarea for object / array-of-object params

Feature: `json` arg type.
Steps: select `place_option_order` (param `legs`) or `create_scan`
(params `filters`, `columns`). Inspect the control.
Expected: a multi-line textarea renders (not single-line input).
String-array params (e.g. `symbols` on `get_equity_quotes`) still render
the comma-separated input — unchanged.
Result:

### S4 — Malformed JSON blocks execute

Feature: `jsonArgsValid` gate.
Steps: same tool as S3; enter `{invalid` in the JSON textarea; attempt
Execute.
Expected: execute is blocked and a validation error is shown; no network
call is made (check devtools Network if desired).
Result:

### S5 — Financial mutation requires type-the-name confirmation

Feature: `FINANCIAL_MUTATION_TOOLS` gate.
Steps: select `place_crypto_order` (or `exercise_option`,
`cancel_crypto_order`, `cancel_option_exercise`); click Execute.
Expected: a confirmation UI appears requiring the exact tool name to be
typed before the action proceeds; typing anything else keeps it blocked.
Do not type the name — cancel out.
Result:

### S6 — Plain mutation / simulation keeps click-confirm gate

Feature: `MUTATION_TOOLS` / `SIMULATION_TOOLS` gate.
Steps: select `create_alert` (mutation) then `preview_scan`
(simulation); click Execute on each.
Expected: each shows the standard click-confirm prompt — NOT the
type-the-name gate. Cancel out without confirming `create_alert`;
`preview_scan` is safe to run if you want a live execution check.
Result:

### S7 — Representative live execution per new category

Feature: end-to-end reachability of newly surfaced categories.
Steps: execute one read-only tool from each new group:
- Crypto: `get_crypto_positions` or `get_crypto_quotes` (symbols e.g. `BTC,ETH`)
- Alerts: `get_alerts`
- SEC Filings: `get_sec_filing_index` (symbol `AAPL`; returns the
  filing index — use it to pick a `filing_id` if you want to probe
  `get_sec_filing` / `get_sec_filing_facts` deeper)
Expected: each returns a structured response in the result panel; errors
surface as readable errors, not crashes.
Result:

### S8 — Regression: pre-existing surface intact

Feature: no regression on the 49-tool baseline.
Steps: run a previously-working tool (e.g. `get_equity_quotes` with
`symbols: AAPL,NFLX`); check run history list and cursor-pagination
controls on a paginated tool (e.g. `get_option_chains` OOMA/NFLX or
`get_equity_orders` — it takes `cursor`).
Expected: results render as before; history records the run; pagination
controls work.
Result:

## Traceability

| AC | Scenario |
|---|---|
| `listObservationTools()` returns all 76 tools across 9 categories | S1 |
| Financial mutations type-the-name; mutations/simulations click-confirm | S5, S6 |
| `rhs_account_number` params get account dropdown resolving rhs | S2 |
| Object/array-of-object params render JSON textarea; malformed JSON blocks execute | S3, S4 |
| Model specs cover inference/validation/account detection (25/25) | automated evidence below |

## Automated evidence

- `observation-dashboard.model.spec.ts` — 25/25 pass (review rerun)
- `npx tsc --noEmit -p tsconfig.app.json` — clean
- `TOOL_GROUPS` counts 7+15+7+8+6+4+8+11+10 = 76 (verified in review)

## Regression / smoke checklist

- [ ] Tool picker category order matches `TOOL_CATEGORY_ORDER`
- [ ] String-array params still comma-separated inputs (S3)
- [ ] Run history + pagination unaffected (S8)
- [ ] Account selector still feeds both `account_number` and
      `rhs_account_number` params (S2)

## Results log

| Scenario | Result | Evidence | Date |
|---|---|---|---|
| S1 | PASS | user-confirmed | 2026-10-12 |
| S2 | PASS | user-confirmed | 2026-10-12 |
| S3 | PASS | user-confirmed | 2026-10-12 |
| S4 | PASS | user-confirmed | 2026-10-12 |
| S5 | PASS | user-confirmed | 2026-10-12 |
| S6 | PASS | user-confirmed | 2026-10-12 |
| S7 | PASS | user-confirmed | 2026-10-12 |
| S8 | PASS | user-confirmed | 2026-10-12 |
