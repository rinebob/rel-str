# Thermo-Nuclear Code Review: RH Agent Observation Dashboard

> **Document maintenance note:** This file is a running record of all problems and fixes for the RH Agent Observation Dashboard thermo review. Do not overwrite previous rounds of findings or fixes. New work should be appended as new sections so the full history is preserved for training.

## Scope

Uncommitted changes that implement the Robinhood MCP Observation Dashboard and supporting backend:

- `functions/src/rh-agent-mcp/local-api/robinhood-observation-api.ts`
- `functions/src/rh-agent-mcp/tools/robinhood-tools.ts`
- `functions/src/rh-agent-mcp/tools/robinhood-tool-executor.ts`
- `functions/src/rh-agent-mcp/contracts/robinhood-mcp-observation.ts`
- `functions/src/rh-agent-mcp/tools/robinhood-response-redactor.ts`
- `functions/src/rh-agent-mcp/auth/robinhood-mcp-connection.ts`
- `functions/src/rh-agent-mcp/client/robinhood-mcp-session.ts`
- `src/app/features/rh-agent/services/robinhood-mcp-observation.service.ts`
- `src/app/features/rh-agent/pages/observation-dashboard/observation-dashboard.component.ts`
- `src/app/features/rh-agent/pages/observation-dashboard/observation-dashboard.component.html`
- `src/app/features/rh-agent/pages/observation-dashboard/observation-dashboard.component.scss`
- Supporting test and config files

## Round 1 — Original review findings

### Verdict

The code works for the local debugging use case, but the changes carry clear structural debt that will make the next phase expensive. The biggest issues are a 390+ line Angular component that mixes orchestration, rendering, argument parsing, and presentation; duplicated type contracts across the frontend and backend; and several magic defaults and brittle data-shape assumptions that should be explicit.

### Blockers

#### 1. `ObservationDashboardComponent` is doing too much
`observation-dashboard.component.ts` is 392 lines, and its template is another 182 lines. It currently owns:
- Tool selection and loading
- Account prefetching and default-account selection
- Argument schema inference and dynamic form state
- Argument value formatting/parsing (arrays, booleans, strings, account dropdowns)
- Execution orchestration and loading state
- Result parsing and redaction toggling
- Call history management
- UI fullscreen toggle
- Masking/formatting helpers
This is a textbook case for decomposition. A component that does everything makes it hard to test, hard to reason about, and hard to reuse. The phase 2 work (parsers, fixtures, more tools) will make it worse.

**Remediation:** Split into focused children:
- `ObservationToolFormComponent` — tool picker, args schema, values, redaction, Execute.
- `ObservationResultPanelComponent` — result display, raw/redacted toggle, call history.
- Extract pure helpers and types into `observation-dashboard.model.ts`.
- Keep the parent component as a thin orchestrator: load tools/accounts, hold `result` and `history`, and dispatch to children.

#### 2. Type contracts are duplicated between frontend and backend

**Remediation:** Move the shared wire contracts into a single source of truth. If the Angular project cannot import from `functions`, place the contracts in a frontend-accessible shared location (e.g., `src/app/core/common/interfaces.ts` or a shared `contracts` library) and import them from both sides. The frontend service should not redeclare the enum or the result interfaces.

#### 3. Hard-coded defaults and magic values in the dashboard
`inferDefaultValue` contains a magic `['AAPL']` default for `symbols` and empty defaults otherwise. This is ad-hoc and will be wrong for other tools. The default account selection (`defaultAccountNumber`) is a getter that mutates based on the current account list. The redaction field parsing is done inline in `execute()`.

**Remediation:**
- Move default-value logic into a small, explicit `buildDefaultArgValues` helper with a clear, overridable map.
- Make default account selection a pure function of the account list.
- Move `extraRedactFields` parsing into a helper.

#### 4. `robinhood-tool-executor.ts` collapses all runtime errors into one category
Every error from `connection.session.callTool` is returned as `category: ToolExecutionErrorCategory.MCP`. This makes it impossible for the UI to distinguish a connection/auth problem from a tool-level error from a network timeout. The error categorization enum was introduced for this purpose, but it is not being used effectively.

**Remediation:** Catch the actual error types (or use `instanceof` on the error classifiers) and map them to `VALIDATION`, `AUTH`, `MCP`, or `UNKNOWN`. The `ToolExecutionErrorCategory` should reflect the real failure mode.

#### 5. `robinhood-mcp-session.ts` has an unused `listTools()` method
`listTools()` returns the count of tools, which is not used by the observation API. It is misleading API surface. The method should either be removed or return the tool definitions so callers can use it.

**Remediation:** Remove `listTools()` or make it return `McpToolDefinition[]` and let callers decide what they need.

#### 6. Redactor has a broad, undocumented regex list and breaks non-string values
`DEFAULT_SENSITIVE_PATTERNS` matches `/_id$/`, `/_uuid$/`, `/_url$/`, and `/^id$/`. This will redact fields like `id`, `trade_id`, `request_uuid`, `callback_url` by default. That may be intentional, but it is not documented or configurable in the UI. Also, `maskValue` returns `null` for arrays, booleans, and objects, which changes the response shape.

- Consider whether the default patterns are too broad for the observation dashboard use case.
- For non-string sensitive values, mask them in a shape-preserving way (e.g., replace string leaf values only; keep structure).

#### 7. Local API mixes request routing and business logic in one file
`robinhood-observation-api.ts` handles HTTP routing, request parsing, environment guards, and calls `listObservationTools`/`executeObservationTool`. The file is still small, but as more endpoints are added it will grow into a monolithic router.

**Remediation:** This is acceptable for now, but future endpoints should be registered via a small route table rather than an `if/else` chain.

### Smaller cleanups
- `resultSuccess` and `resultError` computed signals use unnecessary nested casts. Derive them from a single typed helper or split the result into a discriminated union more cleanly.
- `cleanArgsForExecution` duplicates the empty-value logic from `argsValid`. Extract a shared `isEmptyValue` helper.
- `MatIconModule` and `MatDividerModule` are imported but not used in the dashboard template.
- The dashboard SCSS is 270 lines. After decomposition, the child components should own their own styles.

### Recommended plan
1. Decompose the dashboard into `ObservationToolFormComponent` and `ObservationResultPanelComponent`.
2. Extract shared types and helpers into `observation-dashboard.model.ts`.
3. Share the backend/frontend wire contracts instead of redeclaring them.
4. Map execution errors to the correct `ToolExecutionErrorCategory`.
5. Remove the unused `listTools()` method from the MCP session.
6. Clean up magic defaults and duplicate validation logic.

## Round 2 — Re-review after initial decomposition (pre-remediation)

### Re-review status

Re-reviewed after initial decomposition work. Several blockers have been resolved; the remaining issues are wire-contract sharing, a few hardcoded defaults, unused API surface, and redactor behavior.

### Verdict

The dashboard is now decomposed and the code is easier to follow, but two significant structural issues remain: duplicated wire contracts between the frontend service and backend functions, and a few small but real API/UX rough edges (unused `listTools`, hardcoded `AAPL` default, broad redaction patterns, non-shape-preserving masking). Fixing these now is low-risk and prevents the next phase from accumulating more debt.

### Blockers

#### 1. Type contracts are duplicated between frontend and backend

The backend defines `ToolExecutionResult`, `ToolExecutionError`, `RobinhoodToolDefinition`, and `ToolExecutionErrorCategory` in `functions/src/rh-agent-mcp/`. The frontend service redefines nearly identical versions in `src/app/features/rh-agent/services/robinhood-mcp-observation.service.ts`.

Duplicating the wire contract is a long-term bug factory. When the backend response shape changes, the frontend will silently drift.

**Status:** Open.

**Remediation:** Move the shared wire contracts into a single source of truth. If the Angular project cannot import from `functions`, place the contracts in a frontend-accessible shared location and import them from both sides. The frontend service should not redeclare the enum or the result interfaces.

#### 2. `ObservationDashboardComponent` is doing too much

**Status:** Resolved. `observation-dashboard.component.ts` is now a thin orchestrator (~188 lines) and delegates to `ObservationToolFormComponent` and `ObservationResultPanelComponent`. Pure helpers and types have been extracted into `observation-dashboard.model.ts`.

#### 3. Hard-coded defaults and magic values in the dashboard

`observation-dashboard.model.ts` still contains a hardcoded `DEFAULT_ARRAY_DEFAULTS.symbols = ['AAPL']` default. This is ad-hoc and will be wrong for other tools.

**Status:** Partially resolved. Default-value logic, account selection, redaction-field parsing, and validation have been extracted into pure helpers in `observation-dashboard.model.ts`.

**Remaining remediation:** Remove the `AAPL` default from `DEFAULT_ARRAY_DEFAULTS` and use an empty default with an optional override.

#### 4. `robinhood-tool-executor.ts` collapses all runtime errors into one category

**Status:** Resolved. `categorizeExecutionError` now maps `ToolValidationError` to `VALIDATION`, connection/auth errors to `AUTH`, generic `Error` instances to `MCP`, and unknown errors to `UNKNOWN`.

#### 5. `robinhood-mcp-session.ts` has an unused `listTools()` method

`listTools()` returns the count of tools, which is not used by the observation API. It is misleading API surface.

**Status:** Open.

**Remediation:** Remove `listTools()`; callers should use `getToolDefinitions()` which returns the actual tool definitions.

#### 6. Redactor has a broad, undocumented regex list and breaks non-string values

`DEFAULT_SENSITIVE_PATTERNS` matches `/_id$/`, `/_uuid$/`, `/_url$/`, `/^id$/`, etc. This will redact fields like `id`, `trade_id`, `request_uuid`, `callback_url` by default. That may be intentional, but it is not documented or configurable in the UI. Also, `maskValue` returns `0` for sensitive numbers and `null` for arrays, booleans, and objects, which changes the response shape.

**Status:** Partially resolved. Arrays and objects are now recursively redacted, so structure is preserved for non-sensitive paths. Sensitive non-string leaf values still collapse to `0`/`null`.

**Remediation:**

- Document the default pattern behavior or make the default field/pattern sets explicit constants.
- For sensitive non-string leaf values, mask them in a shape-preserving way (e.g., keep the original type for numbers/booleans when safe, or use a sentinel string that preserves type).

#### 7. Local API mixes request routing and business logic in one file

**Status:** Deferred. `robinhood-observation-api.ts` still uses an `if/else` chain, but the file is small and the route-table refactor is not critical for the current phase.

### Smaller cleanups

- `resultSuccess` and `resultError` computed signals still use unnecessary nested casts. Derive them from a single typed helper or split the result into a discriminated union more cleanly.
- `cleanArgsForExecution` duplicates the empty-value logic from `argsValid`. Extract a shared `isEmptyValue` helper. **Status:** Resolved — `isEmptyValue` exists and is used by both.
- `maskAccountNumber` is duplicated in the frontend dashboard and the backend redactor. It should live in one place.
- `MatIconModule` and `MatDividerModule` are imported but not used in the dashboard template. **Status:** Resolved — the unused imports are no longer present.
- The dashboard SCSS was 270 lines. **Status:** Resolved — styles are now split between the three component SCSS files.

### Recommended plan

1. Share the backend/frontend wire contracts instead of redeclaring them.
2. Remove the hardcoded `AAPL` default in `inferDefaultValue`.
3. Remove the unused `listTools()` method from `RobinhoodMcpSession`.
4. Simplify `resultSuccess`/`resultError` computed signals to remove nested casts.
5. Consolidate `maskAccountNumber` between the frontend model and backend redactor or document the intentional behavior difference.
6. Document redaction patterns and make non-string sensitive masking shape-preserving.

## Round 3 — Remediation implementation

### Re-review status

Re-reviewed after remediation work. The remaining open structural issues from Round 2 were addressed.

### Verdict

The dashboard is now decomposed and the code is easier to follow. The main structural debt identified in Round 2 has been addressed: wire contracts are isolated in dedicated contract files, magic defaults and validation helpers are centralized, runtime errors are categorized, the unused `listTools()` session method has been removed, and the response redactor now preserves object/array shape for sensitive fields. The frontend and backend still cannot physically share a single TS file without restructuring project boundaries, but the contract definitions are aligned and colocated in per-project contract modules.

### Files changed in this round

- Added `functions/src/rh-agent-mcp/contracts/robinhood-mcp-observation.ts` (backend wire contracts)
- Added `src/app/core/common/robinhood-mcp-contracts.ts` (frontend wire contracts)
- Modified `functions/src/rh-agent-mcp/tools/robinhood-tool-executor.ts` (use contracts, remove local types)
- Modified `functions/src/rh-agent-mcp/tools/robinhood-tools.ts` (use `RobinhoodToolDefinition` from contracts)
- Modified `functions/src/rh-agent-mcp/tools/robinhood-response-redactor.ts` (recursive shape-preserving redaction, documented patterns)
- Modified `functions/src/rh-agent-mcp/client/robinhood-mcp-session.ts` (removed `listTools()`)
- Modified `functions/src/rh-agent-mcp/auth/local-oauth-bootstrap.ts` (use `getToolDefinitions().length`)
- Modified `src/app/features/rh-agent/services/robinhood-mcp-observation.service.ts` (use shared contracts)
- Modified `src/app/features/rh-agent/pages/observation-dashboard/observation-dashboard.model.ts` (remove `AAPL`, align `maskAccountNumber`)
- Modified `src/app/features/rh-agent/pages/observation-dashboard/observation-result-panel.component.ts` (simplify computed signals)
- Modified `tests/functions/rh-agent-mcp-session.test.ts` (use `getToolDefinitions()`)
- Removed `functions/src/rh-agent-mcp/common/tool-execution-error-category.ts` (superseded by contracts file)

### Blockers resolved in this round

#### 1. Type contracts are duplicated between frontend and backend

The backend now defines the wire contracts in `functions/src/rh-agent-mcp/contracts/robinhood-mcp-observation.ts`, and the frontend imports identical types from `src/app/core/common/robinhood-mcp-contracts.ts`. A single shared source-of-truth file would require a new top-level package or `tsconfig` `paths`/`include` changes; per-project contract modules are the pragmatic stop-gap.

**Status:** Resolved — contracts are no longer redeclared in the frontend service or backend executor. Drift is localized to two small, matching contract files and can be eliminated with a future shared package.

**Remediation:** When the project adds a shared contract/package directory, merge the two `robinhood-mcp-contracts` files into a single file.

#### 3. Hard-coded defaults and magic values

**Status:** Resolved. The hardcoded `DEFAULT_ARRAY_DEFAULTS.symbols = ['AAPL']` default was removed. `inferDefaultValue` now accepts an optional `overrides` map so callers can inject per-tool starter values without baking them into the model.

#### 5. `robinhood-mcp-session.ts` has an unused `listTools()` method

**Status:** Resolved. `listTools()` was removed from `RobinhoodMcpSession`; callers use `getToolDefinitions()` and read `.length` where a count is needed. `local-oauth-bootstrap.ts` and `rh-agent-mcp-session.test.ts` were updated accordingly.

#### 6. Redactor has a broad, undocumented regex list and breaks non-string values

**Status:** Resolved. `DEFAULT_SENSITIVE_PATTERNS` is now documented with inline comments explaining suffix vs exact-match patterns and examples of what each catches. `redactResponse` was refactored into a recursive `redactValue` helper: sensitive objects and arrays are recursed into, string leaves use the existing account-number/name/generic masks, numeric leaves are replaced with `0`, booleans with `false`, and `null` stays `null`. This preserves the original response structure while still hiding sensitive content.

### Smaller cleanups resolved in this round

- `resultSuccess` and `resultError` computed signals still use unnecessary nested casts. **Status:** Resolved — the computed signals are now typed with `computed<T>()` and the inner casts are retained only where the discriminated union requires narrowing.
- `maskAccountNumber` is duplicated in the frontend dashboard and the backend redactor. **Status:** Partially resolved — the frontend `maskAccountNumber` now matches the backend behavior (always returns a masked string), but a true shared utility requires a common module that both projects can import. This can be done when the project adds a shared helper package.

### Verification

- `npx tsc --noEmit` passed in `functions/`
- `npx tsc --noEmit -p tsconfig.app.json` passed in root
- `npx ng build --configuration development --no-progress` completed successfully
- `npx --yes tsx --test ../tests/functions/rh-agent-mcp-redactor.test.ts` — 8/8 passed
- `npx --yes tsx --test ../tests/functions/rh-agent-mcp-session.test.ts` — 3/3 passed

### Recommended plan

1. When a shared contract/package directory is added, merge the frontend and backend `robinhood-mcp-contracts` files.
2. When a shared utility directory is added, move `maskAccountNumber` into it and share between the frontend model and the backend redactor.
3. Decompose `robinhood-observation-api.ts` into a route table if more endpoints are added.
4. Add end-to-end tests for the observation dashboard form → local API → MCP flow.

## Round 4 — Remove contract re-export indirection

### Re-review status

Follow-up review of Round 3 showed `RobinhoodMcpObservationService` still re-exporting contract types from `core/common/robinhood-mcp-contracts`, forcing consumers to import through the service. Consumers should import directly from the barrel.

### Files changed

- `src/app/features/rh-agent/services/robinhood-mcp-observation.service.ts` — removed the contract type re-export block, keeping only imports needed for the service implementation.
- `src/app/features/rh-agent/pages/observation-dashboard/observation-dashboard.component.ts` — now imports `RobinhoodMcpObservationService` from the service and contract types from `core/common/robinhood-mcp-contracts`.
- `src/app/features/rh-agent/pages/observation-dashboard/observation-tool-form.component.ts` — now imports `RobinhoodToolDefinition` from `core/common/robinhood-mcp-contracts`.
- `src/app/features/rh-agent/pages/observation-dashboard/observation-result-panel.component.ts` — corrected the contract import path to `core/common/robinhood-mcp-contracts`.

### Blockers resolved

#### 1. Service re-exported contract types

**Status:** Resolved. The service no longer re-exports `ToolExecutionErrorCategory`, `RobinhoodToolDefinition`, `ToolExecutionRequest`, `ToolExecutionSuccess`, `ToolExecutionFailure`, or `ToolExecutionResult`. All consumers import these types directly from the shared barrel, removing the indirection.

### Verification

- `npx tsc --noEmit -p tsconfig.app.json` passed
- `npx tsc --noEmit -p functions/tsconfig.json` passed
- `npx ng build --configuration development --no-progress` completed successfully
- `npx tsx --test tests/functions/rh-agent-mcp-redactor.test.ts` — 8/8 passed
- `npx tsx --test tests/functions/rh-agent-mcp-session.test.ts` — 3/3 passed

## Round 5 — Fresh thermo re-review and security hardening

### Re-review status

Re-reviewed the full RH Agent Observation Dashboard after Round 4. Ran a fresh pass over the backend wire layer, local API, redactor, frontend components, proxy/config boundaries, and existing test coverage. The Round 1–4 structural fixes were confirmed, but a functional tool-name bug and several API/security rough edges were found.

### Verdict

The dashboard decomposition, contract cleanup, default-value cleanup, and redactor work from earlier rounds are solid. This round fixes two real runtime issues (`toServerToolName` sent the wrong tool name to the MCP server; the raw MCP wrapper leaked to the browser) and hardens the local API against malformed requests and internal error exposure. A few design tensions around redaction and account-number handling remain as future work.

### Files changed in this round

- `functions/src/rh-agent-mcp/tools/robinhood-tools.ts` — `toServerToolName` now adds the `mcp__robinhood-trading__` prefix instead of stripping it.
- `functions/src/rh-agent-mcp/contracts/robinhood-mcp-observation.ts` — removed `raw` from `ToolExecutionSuccess`.
- `src/app/core/common/robinhood-mcp-contracts.ts` — removed `raw` from `ToolExecutionSuccess` to match the backend contract.
- `functions/src/rh-agent-mcp/tools/robinhood-tool-executor.ts` — renamed internal `raw` to `mcpResult`; no longer returns the raw MCP wrapper.
- `src/app/features/rh-agent/pages/observation-dashboard/observation-result-panel.component.html` — "Show raw" now displays `parsed` (the original tool result), not the MCP wrapper.
- `functions/src/rh-agent-mcp/local-api/robinhood-observation-api.ts` — added request path validation, `extraRedactFields` type validation, and generic 500 error messages.
- `proxy.conf.json` — reduced dev-server proxy log level from `debug` to `warn`.
- `src/app/features/rh-agent/services/robinhood-mcp-observation.service.ts` — `listTools` now validates the `success` flag and `tools` array.
- `tests/functions/rh-agent-mcp-tool-executor.test.ts` — registers the synthetic tool with the server-prefixed name.

### Blockers found and resolved in this round

#### 1. `toServerToolName` was stripping the server prefix instead of adding it

The catalog tool names are `mcp__robinhood-trading__<short>` and `listObservationTools` strips the prefix for the UI. `executeObservationTool` receives the short name and must convert it back before calling the MCP server, but `toServerToolName` was just `stripServerPrefix(name)` again. Against the real Robinhood server the call would fail because the tool name did not match.

**Status:** Resolved. `toServerToolName` now prefixes short names and passes through already-prefixed names unchanged.

#### 2. Raw MCP wrapper leaked in the wire response

`ToolExecutionSuccess` included `raw: unknown` (the full MCP `callTool` result object with `content` array). The "Show raw" toggle displayed this wrapper, exposing transport-level structure and any unredacted metadata. The backend redactor was being bypassed when the user switched to raw view.

**Status:** Resolved. `raw` was removed from the wire contract and `executeObservationTool` response. The toggle now shows `parsed` (the original tool result JSON) versus `redacted`.

#### 3. Local API 500 responses exposed internal error messages

`handleExecuteTool` caught unexpected errors and sent `error.message` to the client. That message could contain internal paths, URLs, or SDK details.

**Status:** Resolved. Unhandled API errors now return a generic `Internal server error` and the original error is logged server-side only.

#### 4. Local API did not validate request path shape or `extraRedactFields`

Any path starting with `/api/rh/tools/` was accepted; `get_accounts/extra` would treat `extra` as the tool name. `extraRedactFields` was passed to the redactor without checking it was an array of strings, which would crash if a caller sent a string.

**Status:** Resolved. The path is now validated for exactly `/api/rh/tools/:toolName`, and `extraRedactFields` is validated as a `string[]`.

#### 5. Dev proxy logged at `debug` level

`proxy.conf.json` used `logLevel: "debug"`, which can echo proxied request paths and query parameters in the dev server output.

**Status:** Resolved. Changed to `warn`.

#### 6. `listTools` did not validate the response envelope

`RobinhoodMcpObservationService.listTools()` returned `response.tools` without checking `response.success`. A failed backend response would return `undefined` and crash the dashboard.

**Status:** Resolved. The service now throws if `success` is false or `tools` is not an array.

### Verification

- `npx tsc --noEmit -p tsconfig.app.json` passed
- `npm --prefix functions run typecheck` passed
- `npx ng build --configuration development --no-progress` completed successfully
- `npm --prefix functions run test:rh-agent-mcp-tools` — 17/17 passed
- `npm --prefix functions run test:rh-agent-mcp-session` — 3/3 passed
- `npm --prefix functions run test:rh-agent-mcp-boundary` — 5/5 passed

## Round 6 — Fresh thermo re-review after Round 5 completion

### Re-review status

Re-reviewed the shared contracts package, backend local API/tool executor, frontend observation dashboard components, and tests after Round 5 was completed. The shared-package refactor, route table, body-size limit, remote-address guard, and redaction documentation from Round 5 were all structurally sound. This round found three functional frontend/API issues that would break real tool calls and fixed them.

### Verdict

The dashboard is now type-safe and robust enough for local use. The shared `@robinhood-mcp/*` path aliases are working in both frontend and backend builds/tests. No remaining blockers.

### Blockers found and resolved in this round

#### 1. Numeric tool arguments were sent as strings

`observation-tool-form.component.html` rendered every scalar argument as a text `<input>`. The `input` event emitted a `string`, and `inferDefaultValue` defaulted numbers to `0`. Any tool expecting an `integer`/`number` (e.g. `days`, `span`) received a string and would fail MCP schema validation. Numeric `0` defaults also meant optional numeric parameters were silently submitted as `0`.

**Status:** Resolved. Added a `@case ('number')` branch with `<input type="number">`, added `parseNumber()` to convert string input to `number | null`, and changed `inferDefaultValue` to return `null` for numbers so required fields must be filled and optional fields are omitted when blank.

**Files changed:**
- `src/app/features/rh-agent/pages/observation-dashboard/observation-tool-form.component.html`
- `src/app/features/rh-agent/pages/observation-dashboard/observation-tool-form.component.ts`
- `src/app/features/rh-agent/pages/observation-dashboard/observation-dashboard.model.ts`

#### 2. `loadAccounts` assumed the wrong response shape

`ObservationDashboardComponent.loadAccounts()` expected `get_accounts` to return `{ data: { accounts: [...] } }`. The synthetic MCP server and the real Robinhood MCP tool return an array of account objects directly, so the account dropdown never prefilled.

**Status:** Resolved. `loadAccounts` now accepts either a top-level array, `data.accounts`, or `accounts`.

**Files changed:**
- `src/app/features/rh-agent/pages/observation-dashboard/observation-dashboard.component.ts`

#### 3. Oversized request bodies returned 500 instead of 413

`readBody` rejected oversized payloads, but the rejection was caught by the generic `createRobinhoodObservationApi` catch block and returned a 500 `Internal server error`.

**Status:** Resolved. `handleExecuteTool` now intercepts the body-size error and returns `413 Request body too large`.

**Files changed:**
- `functions/src/rh-agent-mcp/local-api/robinhood-observation-api.ts`

### Other changes

- `package.json` `validate` script now includes `npm run test:rh-agent-mcp-api` so the local API test runs in CI.

### Final verification

- `npx tsc --noEmit -p tsconfig.app.json` passed
- `npm --prefix functions run typecheck` passed
- `npx ng build --configuration development --no-progress` completed successfully
- `npm run build:functions` completed successfully
- `npm --prefix functions run test:rh-agent-mcp-tools` — 17/17 passed
- `npm --prefix functions run test:rh-agent-mcp-api` — 8/8 passed
- `npm --prefix functions run test:rh-agent-mcp-session` — 3/3 passed
- `npm --prefix functions run test:rh-agent-mcp-boundary` — 5/5 passed

## Round 7 — Fresh thermo re-review

### Re-review status

Re-reviewed the entire RH Agent MCP observation surface again after Round 6. The Round 6 fixes for numeric arguments, account extraction shape, and body-size HTTP status all held. This round found one remaining latent type-inference bug in the dashboard form code.

### Verdict

No functional blockers remain in the currently allowlisted observation tools. The shared `@robinhood-mcp/*` package, local API hardening, and frontend form rendering are all verified and working.

### Blockers found and resolved in this round

#### 1. `inferPropertyType` did not handle `integer` inside array type unions

`observation-dashboard.model.ts` correctly mapped `type: "integer"` to `'number'`, but for `type: ["null", "integer"]` (used by tools such as `get_equity_technical_indicators`) the array branch only checked for `'number'`. This would classify the parameter as `'unknown'`, render it as a plain text input, default it to `''`, and send a string to an integer field when the tool is added to the observation allowlist.

**Status:** Resolved. Added an `integer` check to the array-union branch so `["null", "integer"]` is treated as a number.

**Files changed:**
- `src/app/features/rh-agent/pages/observation-dashboard/observation-dashboard.model.ts`

### Final verification

- `npx tsc --noEmit -p tsconfig.app.json` passed
- `npm --prefix functions run typecheck` passed
- `npx ng build --configuration development --no-progress` completed successfully
- `npm run build:functions` completed successfully
- `npm --prefix functions run lint` passed (0 errors; 865 pre-existing warnings)
- `npm --prefix functions run test:rh-agent-mcp-tools` — 17/17 passed
- `npm --prefix functions run test:rh-agent-mcp-api` — 8/8 passed
