# Robinhood AI Trading Agent — Architecture Overview

## What It Does

An automated trading agent that connects to Robinhood's MCP server, computes technical indicators in TypeScript, filters signals, and uses Claude to place orders.

## MCP Server

- **URL**: `https://agent.robinhood.com/mcp/trading`
- **Auth**: OAuth 2.0 with PKCE, tokens stored in `.rh-tokens.json`

## File Structure

```
src/
  agent.ts           - Claude integration. Converts MCP tools to Anthropic tool format, runs agentic loop
  strategies.ts      - Strategy implementations. fetchCloses() gets price history, computes indicators
  indicators.ts      - Pure math: sma(), ema(), rsi(), macd(), bollingerBands(), buildIndicatorSummary()
  scheduler.ts       - Interval-based timer (WRONG for 700 symbols - needs rebuild as batch.ts)
  watchlist.ts       - Symbol configs with strategy, amount, interval, enabled flag
  index.ts           - CLI entry point with auth, MCP connection, command routing
```

## Root Files

| File | Purpose |
|------|---------|
| `.env.example` | `ANTHROPIC_API_KEY`, optional `ROBINHOOD_TOKEN` |
| `.rh-tokens.json` | Created on first OAuth success, stores tokens (gitignored) |
| `scheduler.log` | Append-only log of all decisions |

## Key Dependencies

```json
{
  "@anthropic-ai/sdk": "^0.39.0",
  "@modelcontextprotocol/sdk": "^1.12.1",
  "dotenv": "^16.4.0"
}
```

## Architecture Principles

1. **TypeScript does ALL data fetching and indicator math** — deterministic, fast, free
2. **Claude ONLY sees pre-filtered signals** with pre-computed facts
3. **Claude ONLY makes order placement decisions** — judgment required
4. **Never call Claude for symbols that don't trigger**

## Data Flow

```
MCP: get_price_history() ×700  →
compute indicators ×700        →
filter signals                 →  12 hits
pass facts to Claude           →  Claude places orders via MCP
```

## Current Blocker

Robinhood OAuth auth is failing on their side. The `.rh-tokens.json` file does not exist yet.

## What Needs to Change for 700 Symbols

The current `scheduler.ts` uses `setInterval` per symbol — this is wrong. For 700 symbols doing one daily run at 12:30 PM:

- Replace `scheduler.ts` with `batch.ts`
- Single run: fetch all 700 histories in parallel (batched, e.g. 20 at a time)
- Compute all indicators locally
- Filter to ~10-30 signals
- **ONE Claude call** with the full filtered list
- Claude places orders for all hits
- Process exits

## External Data Source (Future)

I have my own data at `savantapi.com` (Firestore). Eventually add `src/datasource.ts` with a `DataSource` interface so we can swap Robinhood price history for Alpha Vantage/Firestore without touching strategy logic. Robinhood MCP would then be order execution only.

## Watchlist Config

Currently `watchlist.ts`:

```typescript
export const watchlist: WatchedSymbol[] = [
  { symbol: "AAPL", strategy: "rsi-oversold", amount: 100, intervalMs: 5*60*1000, enabled: true },
  // ...
]
```

For 700 symbols, better to use `symbols.csv`:

```csv
symbol,amount,strategy
AAPL,100,pullback
NVDA,200,pullback
```

## CLI Commands

```bash
npx tsx src/index.ts watch --dry    # Dry run, no real orders
npx tsx src/index.ts watch          # Live trading (interval mode - wrong for batch)
npx tsx src/index.ts scan           # One-time batch (need to build)
```

## tsconfig Requirements

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022", "DOM"]
  }
}
```

## Next Immediate Task: 20-Symbol Daily Pullback System

- `symbols.csv` with 20 symbols
- `batch.ts` that runs once daily at 12:30 PM Pacific
- **Pullback strategy**: price down ≥2% from yesterday's close AND price > 50-day SMA
- Pre-filter in TypeScript, Claude only sees hits
- MCP `place_order` for each hit

## Strategy Parameters

### rsi-oversold
- Fetches: 50 days of daily candles
- Fires when: RSI(14) < 30
- Action: Market buy or limit 1% below

### macd-crossover
- Fetches: 60 days of daily candles
- Fires when: MACD histogram crossover
- Action: Buy (bullish) or sell (bearish)

### dip-buy
- No history fetch — live quote only
- Fires when: Price dropped ≥2% from open
- Action: Market buy

## How to Port to Another Project

Copy these files:
```
src/agent.ts
src/strategies.ts
src/indicators.ts
src/scheduler.ts
src/watchlist.ts
src/index.ts
.env.example
```

Merge dependencies into `package.json`:
```json
"@anthropic-ai/sdk": "^0.39.0",
"@modelcontextprotocol/sdk": "^1.12.1",
"dotenv": "^16.4.0"
```

Update `tsconfig.json` with NodeNext module resolution.

Add to `.gitignore`:
```
.rh-tokens.json
auth-url.txt
scheduler.log
```
