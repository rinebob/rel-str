# Verification Scripts — Task #240: BE Normalize Robinhood Orders and Positions

## Overview

These scripts verify the broker-order adapter against the **real Robinhood MCP
server** (prod). They exercise the full pipeline: MCP connection → tool call →
response normalization → output.

## Prerequisites

- Robinhood MCP credentials must be stored locally (run `npm run probe:rh-agent-mcp-auth` from `functions/` if needed).
- The observation API or direct MCP connection must be available.
- Node IPv4 workaround: `NODE_OPTIONS=--require C:\Users\bob\.config\node\ipv4-only.cjs`

## Scripts

### 1. `savant-trader-broker-orders-list.ts` — List Orders

**Command:**
```bash
npx tsx scripts/verify/savant-trader-broker-orders-list.ts <accountNumber>
```

**Arguments:**
- `accountNumber` (required) — The Robinhood account number to list orders for.

**Passing result:**
- Prints `Normalized N order(s):` with one line per order showing ID, symbol, side, type, state, quantity, and average fill price.
- If there are more pages, prints `Next cursor: <cursor>`.
- Exit code 0.

**Failing result:**
- `Verification failed: <error>` — adapter could not connect, tool error, or normalization failure.
- Exit code 1.

### 2. `savant-trader-broker-orders-get.ts` — Get Single Order

**Command:**
```bash
npx tsx scripts/verify/savant-trader-broker-orders-get.ts <accountNumber> <brokerOrderId>
```

**Arguments:**
- `accountNumber` (required) — The Robinhood account number.
- `brokerOrderId` (required) — The Robinhood order UUID to fetch.

**Passing result:**
- Prints normalized order fields (brokerOrderId, symbol, side, type, rawState, quantities, prices, executions).
- If the order is not found, prints `Order not found (returned null).`
- Exit code 0.

**Failing result:**
- `Verification failed: <error>` — adapter or MCP error.
- Exit code 1.

### 3. `savant-trader-broker-positions-list.ts` — List Positions

**Command:**
```bash
npx tsx scripts/verify/savant-trader-broker-positions-list.ts <accountNumber>
```

**Arguments:**
- `accountNumber` (required) — The Robinhood account number to list positions for.

**Passing result:**
- Prints `Normalized N position(s):` with one line per position showing symbol, quantity, average buy price, held/available shares, and position type.
- If there are more pages, prints `Next cursor: <cursor>`.
- Exit code 0.

**Failing result:**
- `Verification failed: <error>` — adapter or MCP error.
- Exit code 1.

## Run Order

1. `savant-trader-broker-orders-list.ts` — verify order list normalization and pagination.
2. `savant-trader-broker-orders-get.ts` — verify single-order fetch and nested response handling.
3. `savant-trader-broker-positions-list.ts` — verify position normalization.

## Run All

```bash
npx tsx scripts/verify/run-all.ts
```

This runs all three scripts in order and reports pass/fail for each.
