# RH Agent Observation Dashboard — Product Requirements Document

**Date:** 2026-07-18  
**Status:** Draft — pending review before implementation  
**Scope:** Local-only developer/owner dashboard for inspecting Robinhood MCP tool calls and responses.

## Objective

Build an observation dashboard that lets the owner run any Robinhood MCP tool locally, view the exact JSON arguments and raw JSON response, and inspect the structured shape of the response in the browser. The dashboard is a development and validation tool, not a trading interface.

## Users and context

- Primary user: the application owner/developer.
- Environment: local development machine only.
- Purpose: understand what data Robinhood returns, validate response parsers, and confirm tool behavior before building production features.

## Functional requirements

1. **Tool catalog**
   - Display the list of tools exposed by the connected Robinhood MCP server.
   - Show each tool’s name and expected JSON argument schema.

2. **Tool execution**
   - Allow the user to select one tool at a time.
   - Provide a JSON editor for the tool’s input arguments.
   - Execute the tool call through the local authenticated MCP session.
   - Display the raw JSON response returned by Robinhood.

3. **Structured inspection**
   - Parse the raw response and render a structured view: fields, types, arrays, nested objects.
   - Highlight sensitive or previously marked fields.

4. **Redaction controls**
   - Automatically mask known sensitive fields such as account numbers, SSN/TIN fragments, and full names.
   - Allow the user to mark additional fields as sensitive so they are redacted in the displayed output.
   - Redaction must be display-only; the original raw response remains available locally.

5. **Call history**
   - Keep a session-local history of tool calls, inputs, and raw responses.
   - Allow clearing history.
   - History must not be sent to cloud storage or persisted across browser sessions unless explicitly exported.

6. **Read-only default**
   - All tools are callable by default for observation.
   - Any tool that performs a mutation must require an explicit confirmation step before execution.

## Non-functional requirements

1. **Local only**
   - The dashboard runs against the local authenticated MCP session.
   - No credentials, tokens, or raw responses are transmitted to cloud services.

2. **Deterministic calls**
   - Tool calls are exact JSON arguments to the MCP server. No LLM translates or rewrites user intent into tool calls.

3. **No generic proxying**
   - The backend does not expose a generic MCP proxy. It exposes a narrow, allowlisted tool-execution surface.

4. **Security**
   - The backend never returns the OAuth access token, refresh token, or full account identifiers to the browser.
   - Responses pass through a redaction layer before being sent to the UI.
   - Call history is stored in browser memory only unless the user explicitly exports it.

## Out of scope

- Automated trading, order placement, or account management workflows.
- Cloud-hosted or multi-user access.
- LLM-driven tool selection or argument generation.
- Persistence of raw responses to Firestore or any cloud database.
- Real-time streaming or polling.

## Success criteria

- Owner can authenticate locally once and run any available RH tool from the browser.
- Raw response and structured response are both visible.
- Sensitive fields are redacted by default in the UI.
- No credential material appears in browser devtools or network traffic.
- Backend tests prove each tool can be called and redacted deterministically.

## Related planning documents

- `docs/implementations/RH-AGENT-DIRECT-MCP-AUTH-PROOF-2607-01.md` — local OAuth refresh proof.
- `docs/implementations/RH-AGENT-OBSERVATION-DASHBOARD-IMPLEMENTATION-PLAN.md` — implementation sequencing.
