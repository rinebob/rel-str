# RH Agent Cloud Function

Firebase Cloud Function wrapper for the Robinhood AI Trading Agent.

## Overview

The RH Agent is an autonomous trading agent that uses Claude (Anthropic) and Robinhood MCP (Model Context Protocol) to:
- Monitor stock prices and technical indicators (RSI, MACD)
- Generate trade signals based on configured strategies
- Place orders via Robinhood (optional - currently dry-run mode)
- Persist all signals and results to Firestore

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Cloud Schedule │────▶│  rhAgentScheduled │────▶│   Firestore    │
│  (15 min cron)   │     │    (v2 Function)  │     │  (runs/signals)│
└─────────────────┘     └──────────────────┘     └─────────────────┘
                               │
                               ▼
                        ┌──────────────────┐
                        │  Robinhood MCP   │
                        │  (OAuth2)        │
                        └──────────────────┘
                               │
                               ▼
                        ┌──────────────────┐
                        │   Anthropic      │
                        │   Claude API     │
                        └──────────────────┘
```

## Files

- `rh-agent-config.ts` - Collection names, enums, and interfaces
- `rh-agent-secrets.ts` - Firebase Secrets configuration
- `rh-agent-firestore.ts` - Firestore persistence layer
- `rh-agent-scheduled.ts` - Scheduled Cloud Function
- `rh-agent-callables.ts` - HTTP callable functions (manual trigger, status, history)

## Setup

### 1. Configure Firebase Secrets

```bash
# Set the Anthropic API key
firebase functions:secrets:set ANTHROPIC_API_KEY
# Enter your Anthropic API key when prompted

# Set the Robinhood OAuth tokens
firebase functions:secrets:set ROBINHOOD_ACCESS_TOKEN
# Enter your Robinhood access token (from .rh-tokens.json after CLI auth)

firebase functions:secrets:set ROBINHOOD_REFRESH_TOKEN
# Enter your Robinhood refresh token (optional, for token refresh)
```

### 2. Get Robinhood OAuth Token

Use the CLI version first to authenticate:

```bash
cd functions
npm run dev
# Follow the OAuth flow, authenticate with Robinhood
# Copy the access_token from .rh-tokens.json
```

### 3. Deploy Functions

```bash
cd functions
npm run build
firebase deploy --only functions:rhAgentScheduled,functions:rhAgentManualRun,functions:rhAgentGetStatus,functions:rhAgentGetRunHistory,functions:rhAgentGetSignalHistory
```

## Cloud Functions

### Scheduled Function

**Name:** `rhAgentScheduled`

**Schedule:** Every 15 minutes, 1PM-8PM UTC (9AM-4PM ET), Monday-Friday

**Config:**
- Dry-run mode (no real orders placed)
- Processes enabled symbols from DEFAULT_WATCHLIST
- Requires `ANTHROPIC_API_KEY` and `ROBINHOOD_ACCESS_TOKEN` secrets

### Callable Functions

All callable functions support CORS for the Angular frontend.

#### `rhAgentManualRun`

Trigger a manual agent run on demand.

**Request:**
```typescript
{
  symbols?: string[];    // Optional: specific symbols to run
  strategy?: string;     // Optional: specific strategy
  dryRun?: boolean;      // Default: true
}
```

**Response:**
```typescript
{
  runId: string;
  status: string;
  symbolsProcessed: number;
  signalsGenerated: number;
  message: string;
}
```

#### `rhAgentGetStatus`

Get current agent status.

**Response:**
```typescript
{
  isEnabled: boolean;
  lastRunAt?: string;
  lastRunStatus?: string;
  totalRuns: number;
  totalSignalsGenerated: number;
  symbolsMonitored: string[];
  schedule: string;
}
```

#### `rhAgentGetRunHistory`

Get recent run history.

**Request:** `{ limit?: number }` (default: 20)

**Response:** Array of run records

#### `rhAgentGetSignalHistory`

Get recent trade signals.

**Request:** `{ limit?: number, runId?: string }` (default: 50)

**Response:** Array of signal records

## Firestore Collections

### `rh-agent-runs`

Stores agent run metadata.

**Document Fields:**
- `id` - Run ID
- `status` - PENDING, RUNNING, SUCCESS, PARTIAL, FAILED
- `startedAt` - Timestamp
- `completedAt` - Timestamp (optional)
- `strategy` - Strategy name
- `dryRun` - Boolean
- `symbolsProcessed` - Count
- `signalsGenerated` - Count
- `errors` - Error messages array
- `logs` - Log messages array
- `summary` - Run summary

### `rh-agent-signals`

Stores individual trade signals.

**Document Fields:**
- `id` - Signal ID
- `runId` - Parent run ID
- `symbol` - Stock symbol
- `strategy` - Strategy used
- `action` - BUY, SELL, HOLD
- `status` - GENERATED, PENDING_EXECUTION, EXECUTED, REJECTED, FAILED, DRY_RUN
- `amount` - Trade amount (optional)
- `reason` - Signal reason
- `indicators` - Technical indicators (optional)
- `createdAt` - Timestamp
- `executedAt` - Execution timestamp (optional)
- `orderId` - Order ID (optional)
- `error` - Error message (optional)
- `dryRun` - Boolean

### `rh-agent-status`

Singleton document with agent state.

**Document ID:** `current`

**Fields:**
- `isEnabled` - Boolean
- `lastRunAt` - Timestamp
- `lastRunId` - Last run ID
- `lastRunStatus` - Status of last run
- `totalRuns` - Total run count
- `totalSignalsGenerated` - Total signals count
- `symbolsMonitored` - Array of symbols
- `schedule` - Cron schedule string
- `updatedAt` - Last update timestamp

## Strategies

### RSI Oversold
- Triggers when RSI(14) < 30 (oversold)
- Places market buy order
- Also considers RSI 30-40 for limit orders

### MACD Crossover
- Triggers on MACD histogram crossover
- Positive histogram = Buy
- Negative histogram = Sell (if holding position)

### Dip Buy
- Triggers when stock drops 2% or more today
- Places market buy order

### Portfolio Summary
- Reports current portfolio value, positions, buying power

### Rebalance
- Suggests trades to rebalance portfolio

### Watchlist Check
- Reports prices for all watchlist symbols

### Earnings Play
- Checks for upcoming earnings announcements

## Local Development

```bash
# Terminal 1 - Start emulators
npm run emulators:start

# Terminal 2 - Build functions
 cd functions
npm run build:watch

# Terminal 3 - Serve frontend
ng serve
```

Note: In emulator mode, secrets must be set in `.env.local`:

```
ANTHROPIC_API_KEY=your_key_here
ROBINHOOD_ACCESS_TOKEN=your_token_here
```

## Security Considerations

1. **Secrets never committed** - Use Firebase Secret Manager
2. **Dry-run by default** - Scheduled runs always use dryRun=true
3. **Auth required** - Callable functions require authenticated users
4. **CORS enabled** - Only for savanttrader.com domain

## Future Enhancements

1. Token refresh for Robinhood OAuth
2. Live trading mode (with additional confirmation steps)
3. Email notifications for signals
4. More technical indicators and strategies
5. Backtesting framework
6. Portfolio performance analytics
