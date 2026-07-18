# RH Agent Observation Dashboard — Implementation Plan

**Date:** 2026-07-18  
**Status:** Draft — pending review  
**Depends on:** `docs/implementations/RH-AGENT-DIRECT-MCP-AUTH-PROOF-2607-01.md` Phase 2 complete.

## Overview

Implement the backend-first, then the UI, for the observation dashboard described in `docs/planning/rh-agent/RH-AGENT-OBSERVATION-DASHBOARD-PRD.md`.

## Architecture principles

- **Backend owns MCP connectivity.** The Angular app never holds or sees OAuth tokens. All Robinhood calls go through `functions/src/rh-agent-mcp/`.
- **Allowlisted tool execution.** The backend exposes one execution endpoint per tool or a single endpoint with a strict tool-name allowlist, not a generic MCP proxy.
- **Redaction before serialization.** Every response passes through a redactor that masks sensitive fields before JSON is sent to the browser.
- **No cloud persistence.** Tool inputs and responses are not written to Firestore or other cloud storage. Session-local browser memory is acceptable.

## Phase 1 — Backend tool registry and executor

**Goal:** Be able to list tools and execute an allowlisted tool through a backend function or local Express API, returning a redacted response.

**Tool scope for Phase 1:**

The executor and redactor must be generic enough to handle any tool in the catalog, but the initial allowlist is limited to the core read-only set below. This keeps the first validation surface small while proving the end-to-end path.

1. `get_accounts`
2. `get_portfolio`
3. `get_equity_positions`
4. `get_equity_quotes`
5. `get_equity_orders`
6. `get_equity_fundamentals`
7. `get_equity_historicals`

**Order within Phase 1:** implement the registry/executor first against `get_accounts`, then verify `get_equity_positions` and `get_equity_quotes`, then add the remaining four. `get_accounts` is first because every account-scoped tool needs an `account_number`.

### 1.1 Tool registry

Source of truth: `functions/.rh-mcp-tool-catalog.json` (generated 2026-07-17; schemas only, no credentials or results).

Create `functions/src/rh-agent-mcp/tools/robinhood-tools.ts`:

- Define `RobinhoodToolName` as a union of supported tool names. Derive from the catalog, but keep a TypeScript union so the compiler catches tool names.
- Define `RobinhoodToolDefinition` interface: name, description, argument schema (JSON Schema shape), mutation flag.
- Load tool definitions from `functions/.rh-mcp-tool-catalog.json` at runtime. Fail fast if the catalog is missing or malformed.
- Maintain an allowlist of tool names the dashboard may execute. The Phase 1 allowlist is the seven core read-only tools listed under **Tool scope for Phase 1**.
- Mark tools whose descriptions indicate a write or side effect as `mutation: true` (e.g. `create_scan`, `create_watchlist`, `cancel_equity_order`, `add_to_watchlist`). Mutation tools require explicit confirmation before execution and are not in the Phase 1 allowlist.

**Catalog synchronization:** Keep `RobinhoodToolName` in `robinhood-tools.ts` in sync with `functions/.rh-mcp-tool-catalog.json`. If the catalog is regenerated, add a CI/script step that fails the build when the TypeScript union and the catalog differ. The runtime registry should load from the catalog directly, while the union exists only for compile-time safety.

### 1.2 Tool executor

Create `functions/src/rh-agent-mcp/tools/robinhood-tool-executor.ts`:

- `executeTool(name: RobinhoodToolName, args: unknown): Promise<unknown>`
- Validate that `name` is in the allowlist.
- Validate arguments against the tool’s JSON schema using a lightweight validator (e.g. `zod` or `ajv`).
- Reuse `RobinhoodMcpSession` to call the tool via the MCP client.
- Reuse the local bootstrap path to ensure a valid token before the call.
- Return the raw tool result.

### 1.3 Redaction layer

Create `functions/src/rh-agent-mcp/tools/robinhood-response-redactor.ts`:

- `redactResponse(toolName: RobinhoodToolName, response: unknown): unknown`
- Maintain a per-tool map of sensitive field paths.
- Default redaction rules:
  - Mask account numbers to last 4 digits.
  - Replace SSN/TIN-like fields with `••••`.
  - Replace `first_name`, `last_name`, `name` with initials where applicable.
- Allow caller-provided extra redaction paths for experimentation.
- Redaction must be deep-walk; arrays and nested objects must be handled.

### 1.4 Backend API surface

The dashboard backend runs locally in the functions workspace. We do not use Firebase emulators, so the API is a local Express server that the Angular dev server proxies to.

Create `functions/src/rh-agent-mcp/local-api/robinhood-observation-api.ts`:

- `GET /api/rh/tools` — return the allowlisted tool definitions (name, description, input schema, mutation flag).
- `POST /api/rh/tools/:toolName` — execute a tool with JSON args and return the redacted response.
- Bind only to `127.0.0.1`; refuse to start if the host is not localhost.
- Fail closed if `NODE_ENV` is production or if the server is not running in the local workspace.
- This API must never be deployed. It exists only for local development and observation.

A small wrapper script starts the Express server alongside the Angular dev server. The Angular proxy configuration forwards `/api/rh/*` to `http://127.0.0.1:<port>`.

### 1.5 Diagnostic script

Create `functions/src/rh-agent-mcp/diagnostics/run-tool-observation.ts`:

- Given a tool name and JSON args file, execute the tool, redact, and print the redacted response to stdout.
- Proves backend works before the UI is built.

### 1.6 Tests

- Unit tests for the registry allowlist.
- Unit tests for the redactor on synthetic fixtures.
- Integration test using in-memory MCP server that returns synthetic tool responses.

## Phase 2 — Response parsers and fixtures

**Goal:** Capture and validate the exact shape returned by each Robinhood tool.

**Tool parser order:**

Build parsers in this order so the dashboard can progressively display richer data. Each parser needs real or synthetic fixtures before the next one.

1. `get_accounts` — foundation; supplies `account_number` for every account-scoped call.
2. `get_portfolio` — account-level summary; small response surface.
3. `get_equity_positions` — array of positions; establishes array-item parsing and redaction patterns.
4. `get_equity_quotes` — real-time quote data; simple top-level fields.
5. `get_equity_orders` — paginated list with state machine fields.
6. `get_equity_fundamentals` — nested company profile and valuation object.
7. `get_equity_historicals` — time-series OHLCV bars; establishes interval/bounds handling.

**Deferred to a follow-up phase (not Phase 2):**

- `get_earnings_calendar`
- `get_earnings_results`
- `get_financials`
- `get_indexes`
- `get_index_quotes`
- All option tools (`get_option_chains`, `get_option_instruments`, `get_option_quotes`, `get_option_positions`, `get_option_orders`)
- All mutation tools (write actions require additional confirmation UI and review)

### 2.1 Capture real responses

Run the diagnostic script for each read-only tool and record the response structure (not values):

- Top-level fields and types.
- Array item shapes.
- Nullable fields.
- Pagination fields.
- Sensitive field locations.

Store these as markdown notes under `docs/implementations/RH-AGENT-OBSERVATION-DASHBOARD-SHAPES.md` or similar.

### 2.2 Build strict parsers

Create `functions/src/rh-agent-mcp/parsers/`:

- One parser per tool: e.g. `parse-equity-positions.ts`.
- Use `zod` or a small custom parser.
- Parsers fail closed on unexpected shapes.
- Parsed output is what the observation dashboard renders in structured view.

### 2.3 Synthetic fixtures

Create `tests/functions/rh-agent-mcp-tool-responses/`:

- JSON fixtures for each tool response.
- Fixtures contain realistic structure but no real account data.
- Used by both parser tests and redactor tests.

## Phase 3 — Angular observation dashboard UI

**Goal:** Browser UI for selecting tools, editing JSON args, running tools, and viewing redacted raw + structured responses.

**Tool exposure order:**

Expose tools in the UI only after their backend parser and redaction rules are in place. The UI starts with the same seven Phase 1/2 tools.

1. `get_accounts`
2. `get_portfolio`
3. `get_equity_positions`
4. `get_equity_quotes`
5. `get_equity_orders`
6. `get_equity_fundamentals`
7. `get_equity_historicals`

**Deferred UI tools (same as deferred parsers):**

- Earnings and financials tools
- Index tools
- All option tools
- All mutation tools

### 3.1 Backend integration service

Create `src/app/features/rh-agent/services/robinhood-mcp-observation.service.ts`:

- `listTools(): Promise<ToolDefinition[]>`
- `executeTool(name: string, args: unknown, extraRedactPaths?: string[]): Promise<ToolExecutionResult>`
- Calls the backend endpoint.
- Handles errors and maps them to a safe error model.

### 3.2 Dashboard component

Create `src/app/features/rh-agent/components/observation-dashboard/`:

- Tool selector dropdown.
- JSON argument editor (textarea or code editor; start with textarea for simplicity).
- Execute button.
- Raw response viewer (prettified JSON, redacted by default; toggle to see original if allowed locally).
- Structured response viewer (parsed object tree).
- Extra redaction path input.
- Call history panel (in-memory only).

### 3.3 Routing and shell

Add the dashboard to the RH Agent feature routing and navigation.

### 3.4 Tests

- Component tests for tool selection, arg validation, and display.
- Service tests with mocked backend responses.

## File structure

```text
functions/.rh-mcp-tool-catalog.json                  (existing source of truth)
functions/src/rh-agent-mcp/
  tools/
    robinhood-tools.ts
    robinhood-tool-executor.ts
    robinhood-response-redactor.ts
  parsers/
    parse-accounts.ts
    parse-portfolio.ts
    parse-equity-positions.ts
    parse-equity-quotes.ts
    parse-equity-orders.ts
    parse-equity-fundamentals.ts
    parse-equity-historicals.ts
  local-api/
    robinhood-observation-api.ts
    start-observation-api.ts
  diagnostics/
    run-tool-observation.ts

tests/functions/rh-agent-mcp-tool-responses/
  accounts.json
  portfolio.json
  equity-positions.json
  equity-quotes.json
  equity-orders.json
  equity-fundamentals.json
  equity-historicals.json

src/app/features/rh-agent/
  services/
    robinhood-mcp-observation.service.ts
  components/
    observation-dashboard/
      observation-dashboard.component.ts
      observation-dashboard.component.html
      observation-dashboard.component.scss
      observation-dashboard.component.spec.ts
```

## Security checklist

- [ ] OAuth token never leaves backend.
- [ ] Backend redacts sensitive fields before responding.
- [ ] Tool name is validated against allowlist.
- [ ] Arguments are validated against schema.
- [ ] Mutation tools require explicit confirmation.
- [ ] No raw responses persisted to cloud storage.
- [ ] Browser history is in-memory only.
- [ ] Account numbers and personally identifiable fields are masked in the UI.

## Testing strategy

- Unit tests for registry, redactor, and parsers using synthetic fixtures.
- Integration test for executor with in-memory MCP server.
- Angular component and service tests with mocked backend.
- Manual end-to-end test against real Robinhood with forced local authentication.

## Sequencing

1. Review and approve this plan and the PRD.
2. Implement Phase 1 backend (registry, executor, redactor, endpoint, diagnostic script, tests).
   - Prove `get_accounts` first.
   - Then add `get_portfolio`, `get_equity_positions`, and `get_equity_quotes`.
   - Then add `get_equity_orders`, `get_equity_fundamentals`, and `get_equity_historicals`.
3. Validate Phase 1 with real Robinhood tool calls for the seven core tools.
4. Implement Phase 2 parsers and fixtures in the same order as the tool list.
5. Implement Phase 3 Angular UI, exposing the same seven tools in order.
6. End-to-end test and document findings.

## Notes

- Keep the backend and UI in separate commits: backend first, UI second.
- Do not proceed to the UI until the backend can list and execute at least one read-only tool and redact its response.
- Cloud deployment of this dashboard is out of scope until Phase 3 cloud credential storage is implemented.
