# RH Agent Local Trade Bridge Usage Guide

> **Archived implementation:** This guide documents the retired Claude trade bridge as it worked historically; it is not an active operating procedure. The executable implementation has been deleted from the active source tree. Its exact, unmodified source is preserved in `RH-AGENT-LEGACY-CLAUDE-BRIDGE-SOURCE-ARCHIVE-2607-01.md`, with architecture and retirement context in `RH-AGENT-LEGACY-CLAUDE-BRIDGE-ARCHIVE-2607-01.md`.

## Purpose

This guide describes the complete setup and operating procedure for placing Robinhood equity orders from the RH Agent Order page through the local trade bridge.

This is a live-trading mechanism. Clicking **Execute via Bridge** is currently the final authorization to submit every enabled, unexecuted row shown on the Order page. There is no second confirmation dialog. A confirmation dialog may be added later.

## Architecture

The execution path is:

1. The user reviews the latest RH Agent signals.
2. The user marks selected signal occurrences as `ACCEPT`.
3. Accepted, current-run, unexecuted occurrences appear on the Order page.
4. The Angular app sends the enabled rows to `POST http://localhost:3001/trade`.
5. The local bridge starts a non-interactive Claude Code process for each trade.
6. Claude Code calls the configured `robinhood-trading` MCP server.
7. The MCP flow resolves the account, reviews the order, and places the order.
8. The bridge requires an `orderId` and `state` before it considers an order confirmed.
9. Only confirmed orders are persisted as RH Agent trades and marked executed in the app.

The bridge processes a batch sequentially. It completes the first order before starting the second. It stops after the first failed or unconfirmed order. Orders confirmed before a later failure remain confirmed and are persisted individually.

## Important Safety Rules

- **Execute via Bridge places real orders.** It is not a preview or dry-run button.
- Verify every enabled row, symbol, direction, and dollar amount before clicking.
- The button click is currently treated as final authorization. Claude is instructed not to request another confirmation.
- The bridge pre-authorizes only these Robinhood MCP tools:
  - `get_accounts`
  - `review_equity_order`
  - `place_equity_order`
- Never assume a failed HTTP response means no order was placed. If a response is ambiguous, inspect Robinhood Activity before retrying to avoid a duplicate order.
- A broker state such as `queued` means Robinhood accepted the order but the order has not necessarily filled.
- Do not share raw bridge responses. Robinhood responses can contain order IDs, account details, and account-specific links.
- The bridge does not persist prompts or execution responses to disk. Legacy artifact names remain ignored as defense in depth.

## Relevant Project Files

- Bridge server: `functions/src/rh-agent/trade-bridge-server.ts`
- Order page: `src/app/features/rh-agent/pages/agent-order/rh-agent-order.component.ts`
- Trade execution persistence: `src/app/features/rh-agent/services/rh-agent-execution.service.ts`
- Trade query service: `src/app/features/rh-agent/services/rh-agent-trade.service.ts`
- Firestore rules: `firestore.rules`
- Local artifact ignore rules: `functions/.gitignore`

## Prerequisites

### Accounts and access

- A Robinhood account with access to the Agentic trading account used by the bridge.
- Sufficient buying power for all intended orders.
- A completed Robinhood investor profile. Robinhood can block order placement until required regulatory profile questions are complete.
- A Claude account with Claude Code access.
- Access to the Firebase project used by the Angular app.

### Local software

- Windows PowerShell.
- Git.
- Node.js compatible with the project. The Functions package declares Node 20.
- npm.
- Firebase CLI for deploying Firestore rules when rules change.
- Claude Code CLI.

### Install Claude Code on Windows

If Claude Code is not installed, use the official native Windows installer from PowerShell:

```powershell
irm https://claude.ai/install.ps1 | iex
```

Open a new PowerShell window after installation, then verify:

```powershell
claude --version
```

Official installation reference: `https://code.claude.com/docs/en/install`

Verify the main tools:

```powershell
node --version
npm --version
firebase --version
claude --version
```

### Project dependencies

From the repository root:

```powershell
npm install
npm --prefix functions install
```

The bridge uses the Functions package's local `tsx` dependency. Do not expect a globally available `tsx` command.

## One-Time Claude Code Setup

### 1. Authenticate the Claude Code CLI

Check authentication:

```powershell
claude auth status
```

A usable result reports `loggedIn: true`.

If authentication is missing, expired, or produces a `401 Invalid authentication credentials` error, refresh it:

```powershell
claude auth login
```

Claude opens a browser. Complete the sign-in and return to the terminal. The terminal should report `Login successful`.

If the installed CLI does not support `claude auth login`, start an interactive session:

```powershell
claude
```

Then enter:

```text
/login
```

### 2. Register the Robinhood MCP server

Check configured MCP servers:

```powershell
claude mcp list
```

The required entry is:

```text
robinhood-trading: https://agent.robinhood.com/mcp/trading (HTTP)
```

If it is missing, add it:

```powershell
claude mcp add --transport http --scope user robinhood-trading https://agent.robinhood.com/mcp/trading
```

`--scope user` makes the MCP registration available to Claude Code for the current Windows user. A local or project scope can be used intentionally, but the bridge process must run in a context where Claude can see that configuration.

### 3. Open the Robinhood authorization page

Start Claude interactively:

```powershell
claude
```

Inside Claude Code, enter:

```text
/mcp
```

Select `robinhood-trading` and start authentication. Claude opens the Robinhood authorization page in the browser.

On the Robinhood page:

1. Sign in to the correct Robinhood account.
2. Complete any identity, device, or multi-factor challenge.
3. Review the requested Agent/MCP access.
4. Authorize the connection.
5. Complete any required investor-profile questions.
6. Return to Claude Code and verify that the MCP server reports connected.

Exit the interactive Claude session after authorization if it is no longer needed. The bridge does not require a permanently open interactive Claude window; it starts `claude --print` for each order.

### 4. Verify the MCP connection

Run:

```powershell
claude mcp list
```

Expected status:

```text
robinhood-trading: https://agent.robinhood.com/mcp/trading (HTTP) - Connected
```

If the entry exists but is disconnected, repeat the interactive `/mcp` authentication flow.

## One-Time Firebase Setup

The app stores confirmed trades in Firestore and marks their source occurrence decisions executed.

Required paths:

```text
rh-agent-trades/{SYMBOL}/trades/{tradeId}
rh-agent-occurrence-decisions/{decisionId}
```

The app loads trades with a `collectionGroup('trades')` query. The Firestore rule therefore needs a recursive collection-group match for `trades` and must enforce authenticated `userId` ownership.

Authenticate the Firebase CLI when needed:

```powershell
firebase login --reauth
```

Deploy the rules from the repository root:

```powershell
firebase deploy --only firestore:rules
```

A successful deploy should report that the rules compiled and were released. If Firebase says the rules are already up to date, it means the deployed rules match the local file; it does not independently prove that the rule logic is correct.

## Starting Everything for a Trading Session

Use separate terminals for the Angular app and bridge server.

### Terminal 1: Start the Angular app

From the repository root:

```powershell
npm start
```

Open the local Angular URL printed by the CLI and sign in to the app.

If using the deployed app instead of local Angular, keep the local bridge running on the same computer and use the browser on that computer. The app calls `127.0.0.1:3001`, which always means the browser's machine. The bridge accepts browser requests only from the project's approved local and deployed origins.

### Terminal 2: Start the trade bridge

Open PowerShell in the `functions` directory and run:

```powershell
npx tsx src/rh-agent/trade-bridge-server.ts
```

Expected output includes:

```text
Trade Bridge Server running on http://127.0.0.1:3001
Session token: <random startup token>
POST http://localhost:3001/trade
```

The bridge generates a new 256-bit session token every time it starts and prints the live value exactly once on the `Session token:` line. Startup curl examples use `<SESSION_TOKEN>` instead of repeating the secret; replace that placeholder only when intentionally running an authenticated request. Keep this terminal open. Closing it or pressing `Ctrl+C` stops the bridge and invalidates that token.

The first time you click **Execute via Bridge** in a browser session, the app asks for the token shown in the bridge terminal. Paste it exactly. The app retains it in browser `sessionStorage`, not persistent local storage. Restarting the bridge requires a new token; after the first HTTP 401, retry the button and enter the newly printed token.

Do not run this from `functions`:

```powershell
tsx src/rh-agent/trade-bridge-server.ts
```

Plain `tsx` fails unless it was installed globally. Use `npx tsx` so npm resolves the local dependency.

From the repository root, the equivalent command is:

```powershell
npm --prefix functions exec -- tsx src/rh-agent/trade-bridge-server.ts
```

### Confirm port 3001 is listening

Use this read-only PowerShell command:

```powershell
Get-NetTCPConnection -LocalPort 3001 -State Listen
```

A listening entry confirms that a process owns the port. It does not prove that the process contains the latest bridge code.

## Daily Order Workflow

### 1. Review current signals

Use Signal Review for the latest completed RH Agent run. Historical runs are not alternate execution contexts.

### 2. Accept only intended occurrences

Mark the desired current-run signal occurrences `ACCEPT`. Acceptance means the setup is approved for ordering; it remains distinct from the broker order being filled.

### 3. Open the Order page

The Order page shows accepted occurrences that are:

- In the latest run.
- Current in that latest run.
- Not already marked with `executedAt`.

If the list is empty, do not place orders outside the intended workflow until the missing state is understood.

### 4. Review every trade row

For each row:

- Verify the symbol.
- Verify long maps to buy and short maps to sell.
- Verify **Size ($)**.
- Verify **Stop %**.
- Verify the entry-price context.
- Disable any row that should not be included.

The bridge currently sends market orders from this page.

### 5. Execute

Click **Execute via Bridge** once.

That click is final authorization for all enabled, unexecuted rows. If the current browser session has no bridge token, paste the token printed by the bridge terminal when prompted. The browser sends one authenticated batch request. The bridge processes the orders sequentially and rejects another concurrent batch with HTTP 409.

Watch the bridge terminal. For each successful order, expect a parsed result containing:

```json
{
  "orderId": "...",
  "state": "queued-or-other-broker-state",
  "estimatedShares": "..."
}
```

The bridge considers an order confirmed only when both `orderId` and `state` are present.

### 6. Verify in Robinhood

Open Robinhood Activity and verify:

- Symbol.
- Buy or sell side.
- Dollar amount.
- Order type.
- Submitted time.
- Broker state.

A state of `queued` or `pending` is not a fill. It means the broker accepted the order for later processing. Market orders submitted outside regular hours may queue for the next regular session.

### 7. Verify app persistence

Confirmed trades are written to:

```text
rh-agent-trades/{SYMBOL}/trades/{tradeId}
```

The source occurrence decision receives `executedAt` under:

```text
rh-agent-occurrence-decisions/{decisionId}
```

The accepted row then leaves the active Order list because it is no longer unexecuted.

## Bridge Request Security

- The server listens only on `127.0.0.1`; it is not intended to accept LAN connections.
- Browser trade requests must come from the canonical RH Agent origin allowlist.
- Every POST requires the startup session token in `X-Trade-Bridge-Token`.
- Requests must use `Content-Type: application/json`.
- Request bodies are limited to 16 KiB.
- A batch is limited to 20 trades.
- Each trade amount must be between the project minimum of $1 and maximum of $100, inclusive.
- Symbols, sides, order types, limit prices, and fields are validated before Claude starts; each batch permits only one trade per normalized symbol regardless of side, amount, order type, or limit price.
- Approved deployed origins receive browser private-network preflight support.

The startup token authorizes access to a process that can place live orders. Do not paste it into chat, logs, issues, source files, or another website.

## Batch Behavior

- The browser sends all enabled rows in one request.
- The bridge executes one trade at a time.
- The next order starts only after the current order returns.
- The bridge stops at the first error or unconfirmed result.
- Confirmed orders before a failure are persisted.
- Unattempted and unconfirmed orders are not persisted as executed.
- A full batch reports success only when every requested order returns an order ID and state.
- Large batches can take time because each Claude invocation has a 60-second timeout.

## Stopping and Restarting the Bridge

Normally, press `Ctrl+C` in the bridge terminal.

After editing `trade-bridge-server.ts`, always restart the bridge. `tsx` in this command does not watch and reload the already-running process. Every restart prints a new session token; the browser clears a stale stored token after HTTP 401 and asks for the new token on the next execution attempt.

If the process does not stop or the terminal was lost, identify the PID:

```powershell
$listener = Get-NetTCPConnection -LocalPort 3001 -State Listen
Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)" | Select-Object ProcessId, Name, CommandLine
```

Then stop the confirmed stale bridge PID:

```powershell
taskkill /PID <PID> /F
```

Restart from `functions`:

```powershell
npx tsx src/rh-agent/trade-bridge-server.ts
```

## Logs and Sensitive Data

The bridge does not persist prompts, trade requests, or Claude/Robinhood execution responses to disk. The Claude prompt remains in process memory and is sent directly to the child process through stdin.

The authenticated HTTP response can still contain order IDs, states, error details, and raw Claude output needed by the current bridge flow. Do not paste raw responses publicly or attach them to issues without redaction.

The legacy local artifact names `.trade-results.json` and `.trade-prompt.txt` are ignored in `functions/.gitignore` as defense in depth. If either file appears from an older bridge version, stop the bridge and delete it securely.

## Troubleshooting

### `claude` is not recognized

First install Claude Code with the official PowerShell installer:

```powershell
irm https://claude.ai/install.ps1 | iex
```

If installation succeeded but a new PowerShell window still cannot find `claude`, inspect the command and PATH:

```powershell
Get-Command claude -ErrorAction SilentlyContinue
$env:PATH -split ';' | Select-String '\.local\\bin'
```

The native installer normally places the executable under `%USERPROFILE%\.local\bin`. Add that directory to the user PATH if necessary:

```powershell
$currentPath = [Environment]::GetEnvironmentVariable('PATH', 'User')
[Environment]::SetEnvironmentVariable('PATH', "$currentPath;$env:USERPROFILE\.local\bin", 'User')
```

Close and reopen PowerShell, then run `claude --version` again.

### `tsx` is not recognized

Cause: PowerShell cannot find a global `tsx` executable.

From `functions`, use:

```powershell
npx tsx src/rh-agent/trade-bridge-server.ts
```

Do not use plain `tsx`.

### Browser reports `POST http://localhost:3001/trade 400 Bad Request`

Likely causes:

- An older single-trade bridge process is still running.
- The request body does not contain valid `trades` entries.
- A trade is missing `symbol` or `side`, or its `amount` is outside the inclusive $1 to $100 range.

For the stale-process case:

1. Identify the process on port 3001.
2. Stop it.
3. Start the current server source again.
4. Reload the app and retry only after checking Robinhood Activity for any ambiguous prior attempt.

### Browser reports `500 Internal Server Error`

Read the response body and bridge terminal. The browser status alone is not the root cause.

Common causes include:

- Claude CLI authentication failure.
- Claude subprocess startup failure.
- MCP authorization failure.
- Timeout.
- An old bridge version using incompatible shell syntax.

Restart the current bridge source after any code update.

### `401 Invalid authentication credentials`

Refresh Claude authentication:

```powershell
claude auth status
claude auth login
```

After successful login, retry. The bridge starts a fresh Claude process per request, so it normally picks up refreshed credentials without a bridge restart.

### Claude asks for permission instead of placing the order

The current bridge runs Claude with `--permission-mode dontAsk` and explicitly allows only the three required Robinhood tools.

Check:

1. The bridge was restarted after the permission changes.
2. `claude mcp list` reports `robinhood-trading` connected.
3. The server source includes the exact `mcp__robinhood-trading__...` tool allowlist.
4. The installed Claude CLI supports `--allowedTools` and `--permission-mode dontAsk`.

Do not switch to unrestricted permission bypass. The narrow tool allowlist is intentional.

### Robinhood blocks the order for an incomplete investor profile

Open the account-specific Robinhood link returned in the error, sign in, and complete the investor profile. Then verify the profile is saved.

Before retrying:

1. Check Robinhood Activity to confirm the prior attempt did not place an order.
2. Wait briefly if Robinhood needs time to propagate the profile update.
3. Retry once.

### Robinhood returns `queued`

This is a confirmed broker order state, not an error. The order was accepted but may not be filled. Outside regular market hours, a market order may wait until the next regular session.

Track or cancel it in Robinhood using Activity.

### `Missing or insufficient permissions` while loading trades

The Angular app queries the `trades` collection group. Confirm:

- The user is signed in.
- The trade document's `userId` matches the authenticated Firebase UID.
- The recursive collection-group rule is present in `firestore.rules`.
- The latest rules were deployed.

Reauthenticate and deploy if needed:

```powershell
firebase login --reauth
firebase deploy --only firestore:rules
```

### Firebase deploy says credentials are no longer valid

Run:

```powershell
firebase login --reauth
```

Then rerun the deploy. Do not interpret a failed deploy as a deployed rule change.

### Port 3001 is already in use

Find the listener:

```powershell
Get-NetTCPConnection -LocalPort 3001 -State Listen
```

Inspect the owning process before terminating it. Stop only the confirmed stale bridge process.

### Connection refused or no bridge response

Check:

- The bridge terminal is still open.
- Port 3001 is listening.
- The browser is running on the same computer as the bridge.
- A firewall or security tool is not blocking localhost.
- The Angular code is calling `http://localhost:3001/trade`.

### No orders were confirmed

Inspect the Order-page message and the authenticated `/trade` response in browser developer tools. Do not share the raw response.

Possible meanings:

- Claude did not call the MCP tools.
- Robinhood rejected the order.
- The response did not include both an order ID and state.
- The process timed out.

If Robinhood Activity shows an order despite an unconfirmed bridge result, do not retry. Reconcile the broker order and app state manually first.

### `estimatedShares` is undefined

Robinhood may return estimated shares as a numeric string. The current parser records `estimatedShares` only when it is already a number. This does not invalidate an order with a valid order ID and state.

### Accepted symbol disappeared after a failed historical attempt

Older bridge behavior could falsely report success and stamp `executedAt` without a confirmed broker order. The current result validation prevents that path.

For a verified false historical execution only:

1. Confirm Robinhood Activity contains no corresponding order.
2. Delete the false trade document under `rh-agent-trades/{SYMBOL}/trades`.
3. Find the matching latest-run document in `rh-agent-occurrence-decisions`.
4. Remove only its `executedAt` field.
5. Keep `decisionType: ACCEPT` and `isCurrentInLatestRun: true`.
6. Reload the app.

The symbol should return to the Order page as accepted and unexecuted. Never perform this cleanup for a real queued, pending, partially filled, or filled broker order.

## Verification Commands

Complete repository validation:

```powershell
npm run validate
```

This runs the Angular development build, Functions typecheck, focused frontend bridge-client tests, and all backend trade-bridge policy and HTTP integration tests. Any failed step returns a nonzero exit code and stops validation.

Frontend bridge-client tests only:

```powershell
npm run test:trade-bridge-client
```

These ChromeHeadless tests cover stored-token reuse, prompt cancellation, prompt trimming and storage, required request headers, stale-token clearing after HTTP 401, and typed failures when browser storage or the token prompt is unavailable.

Backend trade-bridge security tests only:

```powershell
npm run test:trade-bridge
```

The backend bridge suites intentionally use Node's built-in test runner through the Functions-local `tsx` dependency and retain the `*.test.ts` suffix. They are separate from the Angular Karma/Jasmine `*.spec.ts` client suite. Every HTTP integration test injects a fake executor and cannot invoke Claude or Robinhood MCP.

Backend typecheck:

```powershell
npm --prefix functions run typecheck
```

Angular development build:

```powershell
npm run build -- --configuration development --no-progress
```

Claude authentication:

```powershell
claude auth status
```

Robinhood MCP status:

```powershell
claude mcp list
```

Port status:

```powershell
Get-NetTCPConnection -LocalPort 3001 -State Listen
```

## Quick Start Checklist

### One-time

- Install root and Functions dependencies.
- Authenticate Claude Code.
- Add `robinhood-trading` MCP.
- Complete Robinhood OAuth in Claude `/mcp`.
- Complete the Robinhood investor profile.
- Verify `claude mcp list` reports connected.
- Deploy the required Firestore rules.

### Every trading session

- Confirm Robinhood buying power and account status.
- Confirm Claude authentication and MCP connection if either has recently expired.
- Start the Angular app or open the deployed app.
- Start the local bridge from `functions` with `npx tsx src/rh-agent/trade-bridge-server.ts`.
- Review and accept only intended latest-run signals.
- Verify every Order-page row and dollar amount.
- Click **Execute via Bridge** once.
- Watch the bridge result.
- Verify every confirmed order in Robinhood Activity.
- Treat queued orders as submitted but not filled.

## Current Limitations and Planned Improvement

- Button click is final authorization; there is no separate confirmation dialog yet.
- The bridge runs only on localhost and must remain open.
- The app uses a fixed bridge URL at port 3001.
- Orders are processed sequentially.
- The bridge currently submits market orders from the Order page.
- Broker acceptance is recorded by the app before later fill status is known.
- The app does not yet poll Robinhood for queued-to-filled state transitions.
- Estimated shares returned as a string are not currently normalized to a number.
- The bridge intentionally has no persistent local execution audit log.
