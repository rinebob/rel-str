# RH Agent Cloud Functions - Implementation Guide

## Audience

This document has two sections:
- **Operators**: Just need to deploy and run
- **Developers**: Need to understand/modify the system

---

## SECTION 1: FOR OPERATORS

### Overview

Daily trading agent that:
1. Runs once per day around **12:00 PM Pacific** (time TBD based on processing duration)
2. Scans ~700 symbols from internal rel-str database
3. Generates trade opportunities based on simple technical indicators
4. Shows opportunities in UI for your approval/rejection
5. Only approved trades are sent to Robinhood
6. Must complete by **12:30-12:45 PM Pacific** to enter trades

### Data Flow

```
Daily Scheduler (12:00 PM PT)
    │
    ▼
Queue 700 symbol-analysis tasks
    │
    ▼
Cloud Tasks workers (parallel, ~20 concurrent)
    │
    ▼
Analyze each symbol using internal rel-str data
    │
    ▼
Store trade opportunities in Firestore
    │
    ▼
UI shows opportunities for approval
    │
    ▼
You approve/reject each opportunity
    │
    ▼
Approved trades → Robinhood API (OAuth - TBD, mechanism unconfirmed)
```

### Prerequisites

1. **Robinhood OAuth** - ⚠️ TBD: OAuth mechanism unconfirmed. RH doesn't use API keys but exact OAuth2 flow needs verification.
2. **Anthropic API Key** - For Claude AI signal generation
3. **700 Symbol List** - Stored in rel-str Firestore

### Configuration

**Files to edit:**
- `functions/.env.local` (emulator mode)
- Firebase Secrets (production)

**Required secrets:**
```bash
# Anthropic API key
firebase functions:secrets:set ANTHROPIC_API_KEY

# Robinhood OAuth (obtained via web auth flow - no API keys)
# See: functions/src/rh-agent/README.md for OAuth setup
```

### Deployment

```bash
cd functions
npm run build
firebase deploy --only functions:rhAgentDailyScheduler,functions:rhAgentProcessSymbol,functions:rhAgentGetOpportunities,functions:rhAgentApproveTrade
```

### Daily Workflow

1. **12:00 PM PT** - Agent starts automatically
2. **~12:05-12:15 PM PT** - Analysis completes, opportunities appear in UI
3. **12:15-12:30 PM PT** - You review and approve/reject opportunities
4. **12:30 PM PT** - Approved trades sent to Robinhood
5. **12:45 PM PT** - Deadline for trade entry

### UI Access

Navigate to: `https://savanttrader.com/rh-agent`

Shows:
- Status: Last run, opportunities generated, approved count
- List of today's opportunities with approve/reject buttons
- Historical performance (later)

---

## SECTION 2: FOR DEVELOPERS

### Architecture Overview

**Pattern:** Cloud Tasks queue with parallel workers (not one long-running function)

**Why:** 
- 700 symbols × ~5 seconds each = ~58 minutes single-threaded
- With 20 concurrent workers = ~3 minutes
- Fault tolerant: individual symbol failures don't kill the whole run

**Existing Pattern Used:** Same as `rs-time-series-jobs.worker.ts`

### Components

```
┌─────────────────────────────────────────────────────────────────────────┐
│                            FIREBASE                                      │
│                                                                          │
│  ┌─────────────────┐    ┌──────────────────────┐    ┌─────────────────┐  │
│  │  Daily Scheduler│───▶│  Cloud Tasks Queue   │───▶│  Symbol Workers │  │
│  │  (12:00 PM PT)  │    │  (maxConcurrent: 20) │    │  (parallel)     │  │
│  └─────────────────┘    └──────────────────────┘    └─────────────────┘  │
│                              │                          │              │
│                              ▼                          ▼              │
│                       ┌──────────────┐          ┌──────────────┐      │
│                       │  Job Docs    │          │  Opportunities│      │
│                       │  (Firestore) │          │  (Firestore)  │      │
│                       └──────────────┘          └──────────────┘      │
│                                                          │              │
│                                                          ▼              │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │                        Angular UI                                    ││
│  │  ├─ Show opportunities with approve/reject                          ││
│  │  ├─ Approved → Call rhAgentExecuteTrade                             ││
│  │  └─ Display status/progress                                         ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │                     External APIs                                    │  │
│  │  ├─ Anthropic Claude (signal generation)                            │  │
│  │  └─ Robinhood OAuth (trade execution - approved only)               │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Data Source

**IMPORTANT:** We use internal rel-str Firestore data, NOT Robinhood API for price data.

**Source:** `rs-symbol-cache/{marketDate}/symbols/{symbol}`

Fields used:
- `dailyBars` - OHLCV data for indicator calculation
- `fetchedAt` - Data freshness check

**Why:** 
- RH API has rate limits and latency
- Our data is already processed and cached
- Consistent with rest of rel-str app

### File Structure

```
functions/src/
├── index.ts                                    # Exports all functions
├── rh-agent-cloud-function/
│   ├── rh-agent-config.ts                     # Types, enums, interfaces
│   ├── rh-agent-secrets.ts                    # Secrets config
│   ├── rh-agent-firestore.ts                  # Firestore persistence
│   ├── rh-agent-scheduler.ts                  # NEW: Daily scheduler + queue
│   ├── rh-agent-worker.ts                     # NEW: Symbol analysis worker
│   └── rh-agent-approval.ts                   # NEW: Approval workflow
└── rh-agent/                                  # Reused from CLI
    ├── indicators.ts                          # RSI, MACD, etc. (simple only)
    └── strategies.ts                          # Strategy definitions

src/app/features/rh-agent/
├── rh-agent.service.ts                        # HTTP callables
├── rh-agent-dashboard.component.ts            # Opportunities list + approval
└── opportunity.interface.ts                   # NEW: Opportunity types
```

### Functions

#### 1. rhAgentDailyScheduler (Scheduled)

**Trigger:** Once daily at 12:00 PM Pacific

**Config:**
```typescript
export const rhAgentDailyScheduler = onSchedule({
  schedule: '0 20 * * 1-5',  // 8:00 PM UTC = 12:00 PM PT (no DST issues)
  timeZone: 'Etc/UTC',
  secrets: [ANTHROPIC_API_KEY],
});
```

**Flow:**
```typescript
async function dailySchedulerHandler() {
  // 1. Load symbol list (~700 symbols from Firestore)
  const symbols = await loadSymbolList();
  
  // 2. Create "run" document
  const runId = await createRun('daily-scan', symbols.length);
  
  // 3. Create job docs and enqueue tasks (one per symbol)
  for (const symbol of symbols) {
    await createJobAndEnqueue(runId, symbol);
  }
  
  // 4. Update run status
  await updateRunStatus(runId, 'QUEUED', symbols.length);
}
```

#### 2. rhAgentProcessSymbol (Cloud Task Worker)

**Trigger:** `onTaskDispatched` from queue

**Config:**
```typescript
export const rhAgentProcessSymbol = onTaskDispatched<SymbolJobPayload>({
  retryConfig: { maxAttempts: 3, minBackoffSeconds: 5 },
  rateLimits: { maxConcurrentDispatches: 20, maxDispatchesPerSecond: 10 },
  memory: '256MiB',
  timeoutSeconds: 60,
});
```

**Payload:**
```typescript
interface SymbolJobPayload {
  runId: string;
  symbol: string;
  marketDate: string;  // YYYY-MM-DD
}
```

**Flow:**
```typescript
async function processSymbolHandler(payload) {
  const { runId, symbol, marketDate } = payload;
  
  try {
    // 1. Fetch cached bars from Firestore (NOT from RH)
    const bars = await getCachedBars(symbol, marketDate);
    
    // 2. Calculate simple indicators (RSI, MACD)
    const indicators = calculateIndicators(bars);
    
    // 3. Check if signal triggered
    const signal = checkSignal(symbol, indicators);
    
    if (signal) {
      // 4. Generate opportunity using Claude
      const opportunity = await generateOpportunity(symbol, indicators, signal);
      
      // 5. Store opportunity (pending approval)
      await storeOpportunity(runId, opportunity);
    }
    
    // 6. Mark job complete
    await markJobComplete(runId, symbol, 'SUCCESS');
    
  } catch (error) {
    await markJobComplete(runId, symbol, 'FAILED', error);
  }
}
```

#### 3. rhAgentGetOpportunities (Callable)

**Purpose:** UI fetches today's opportunities

**Request:** `{ runId?: string }` (defaults to latest run)

**Response:**
```typescript
interface GetOpportunitiesResponse {
  runId: string;
  runStatus: string;  // QUEUED | RUNNING | COMPLETE | PARTIAL
  totalSymbols: number;
  processedCount: number;
  opportunities: TradeOpportunity[];
}

interface TradeOpportunity {
  id: string;
  symbol: string;
  action: 'BUY' | 'SELL';
  strategy: string;
  confidence: number;  // 0-100
  reason: string;
  indicators: {
    rsi?: number;
    macdHistogram?: number;
    priceChange?: number;
  };
  suggestedAmount?: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXECUTED' | 'FAILED';
  createdAt: string;
}
```

#### 4. rhAgentApproveTrade (Callable)

**Purpose:** User approves or rejects an opportunity

**Request:**
```typescript
interface ApproveTradeRequest {
  opportunityId: string;
  action: 'APPROVE' | 'REJECT';
  // Optional overrides
  amount?: number;
  orderType?: 'MARKET' | 'LIMIT';
  limitPrice?: number;
}
```

**Flow:**
```typescript
async function approveTradeHandler(request) {
  const { opportunityId, action } = request.data;
  
  // 1. Get opportunity
  const opp = await getOpportunity(opportunityId);
  
  if (action === 'REJECT') {
    await updateOpportunityStatus(opportunityId, 'REJECTED');
    return { status: 'REJECTED' };
  }
  
  // 2. Execute via Robinhood OAuth
  try {
    const orderResult = await executeRobinhoodTrade({
      symbol: opp.symbol,
      action: opp.action,
      amount: request.data.amount || opp.suggestedAmount,
      orderType: request.data.orderType || 'MARKET',
      // OAuth token from secrets
    });
    
    await updateOpportunityStatus(opportunityId, 'EXECUTED', {
      orderId: orderResult.orderId,
      executedAt: new Date(),
    });
    
    return { status: 'EXECUTED', orderId: orderResult.orderId };
    
  } catch (error) {
    await updateOpportunityStatus(opportunityId, 'FAILED', { error: error.message });
    throw new https.HttpsError('internal', 'Trade execution failed');
  }
}
```

### Firestore Collections

#### `rh-agent-runs`

```typescript
interface RhAgentRun {
  id: string;
  type: 'daily-scan';
  status: 'QUEUED' | 'RUNNING' | 'COMPLETE' | 'PARTIAL' | 'FAILED';
  marketDate: string;  // YYYY-MM-DD
  totalSymbols: number;
  processedCount: number;
  successCount: number;
  failureCount: number;
  opportunitiesFound: number;
  opportunitiesApproved: number;
  opportunitiesRejected: number;
  opportunitiesExecuted: number;
  startedAt: Timestamp;
  completedAt?: Timestamp;
  deadlineAt: Timestamp;  // 12:30 PM PT cutoff
}
```

#### `rh-agent-jobs` (subcollection under run)

```typescript
interface RhAgentJob {
  id: string;  // symbol name
  symbol: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'SUCCESS' | 'FAILED';
  attempts: number;
  lastError?: string;
  createdAt: Timestamp;
  startedAt?: Timestamp;
  completedAt?: Timestamp;
}
```

#### `rh-agent-opportunities`

```typescript
interface RhTradeOpportunity {
  id: string;
  runId: string;
  symbol: string;
  action: 'BUY' | 'SELL';
  strategy: 'rsi-oversold' | 'macd-crossover' | 'simple-breakout';
  confidence: number;
  reason: string;
  indicators: Record<string, number>;
  
  // User-modifiable
  suggestedAmount: number;
  amount?: number;  // User override
  orderType: 'MARKET' | 'LIMIT';
  limitPrice?: number;
  
  // Status workflow
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXECUTED' | 'FAILED';
  
  // Execution details (if executed)
  orderId?: string;
  executedAt?: Timestamp;
  executedPrice?: number;
  error?: string;
  
  // Metadata
  createdAt: Timestamp;
  updatedAt: Timestamp;
  approvedAt?: Timestamp;
  approvedBy?: string;  // User UID
}
```

### Simple Strategy (Phase 1)

**Goal:** Get the code working with minimal complexity

**Strategy:** RSI Oversold Bounce

```typescript
function checkRsiOversold(symbol: string, bars: Bar[], indicators: Indicators): Signal | null {
  const currentRSI = indicators.rsi;
  const priceChange = calculatePriceChange(bars);
  
  // Simple rule: RSI < 30 AND price down > 2% today
  if (currentRSI < 30 && priceChange < -0.02) {
    return {
      symbol,
      action: 'BUY',
      strategy: 'rsi-oversold',
      confidence: Math.round((30 - currentRSI) / 30 * 100),  // Higher confidence as RSI drops
      reason: `RSI oversold (${currentRSI.toFixed(1)}) with ${(priceChange * 100).toFixed(1)}% price drop`,
      indicators: {
        rsi: currentRSI,
        priceChange,
      },
      suggestedAmount: 1000,  // Fixed for now
    };
  }
  
  return null;
}
```

**Future:** Proprietary indicators from Pinescript → TypeScript (separate project)

### Robinhood OAuth (⚠️ TBD - Speculative)

**Status:** OAuth mechanism NOT verified. The following is based on typical OAuth2 patterns but needs confirmation with Robinhood's actual implementation.

**Hypothetical Mechanism:**
1. User authenticates via Robinhood website (OAuth2 flow)
2. RH returns `access_token` (+ possibly `refresh_token`)
3. Store `access_token` in Firebase Secrets
4. Token may expire (duration unknown)
5. May need refresh mechanism (unconfirmed)

**Known:** RH doesn't provide API keys like traditional brokers.

**Setup (TBD):**
```bash
# 1. OAuth flow - DETAILS TBD
# Need to verify RH OAuth endpoints, scopes, token format

# 2. Store in Firebase Secrets
firebase functions:secrets:set ROBINHOOD_ACCESS_TOKEN
# firebase functions:secrets:set ROBINHOOD_REFRESH_TOKEN  # TBD - unconfirmed
```

**Open Questions:**
- Exact OAuth2 endpoint URLs
- Required scopes
- Token expiration time
- Presence/need for refresh_token
- Rate limits for trading API

### Data Flow (Detailed)

```
Daily Run Start
    │
    ▼
Load 700 symbols from symbol-list collection
    │
    ▼
Create run doc + 700 job docs (status: PENDING)
    │
    ▼
Enqueue 700 Cloud Tasks (symbol worker)
    │
    ▼
Workers execute (max 20 concurrent):
    ├─▶ Get symbol bars from rs-symbol-cache/{date}/symbols/{symbol}
    ├─▶ Calculate RSI, price change
    ├─▶ If signal triggered:
    │   ├─ Call Claude for reasoning
    │   └─ Create opportunity doc (status: PENDING)
    └─▶ Update job doc (status: SUCCESS or FAILED)
    │
    ▼
Run completes when all jobs done
    │
    ▼
UI polls for opportunities (realtime or callable)
    │
    ▼
User reviews opportunities:
    ├─ Reject → Update status: REJECTED
    └─ Approve → Call rhAgentApproveTrade
        │
        ▼
    Execute via RH OAuth API
        │
        ▼
    Update opportunity: EXECUTED + orderId
```

### Performance Estimates

| Metric | Estimate |
|--------|----------|
| Symbols | ~700 |
| Time per symbol | ~3-5 seconds (with Claude call) |
| Single-threaded | ~58 minutes |
| With 20 workers | ~3 minutes |
| Buffer for variance | +2 minutes |
| **Total runtime** | **~5 minutes** |
| UI ready by | ~12:05 PM PT |
| User review window | ~25 minutes |
| Trade deadline | 12:30 PM PT |

### Error Handling

**Symbol-level failures:**
- Log error in job doc
- Mark job FAILED
- Continue processing other symbols
- Run still completes (status: PARTIAL)

**Claude API failures:**
- Retry 3 times with backoff
- If still failing, skip signal generation
- Log failure, continue

**Robinhood execution failures:**
- Mark opportunity FAILED with error
- Show error in UI
- User can retry approval

**Timeout handling:**
- Each worker: 60 second timeout
- If deadline (12:30 PM) approaching, stop accepting new approvals
- Show warning in UI

### Angular UI Components

**RhAgentDashboardComponent:**

```typescript
// Main dashboard
class RhAgentDashboardComponent {
  // Current run status
  currentRun$: Observable<RhAgentRun>;
  
  // Opportunities list
  opportunities$: Observable<RhTradeOpportunity[]>;
  
  // Actions
  approveOpportunity(opp: TradeOpportunity, amount?: number): void;
  rejectOpportunity(opp: TradeOpportunity): void;
  
  // Filters
  filterByStatus(status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXECUTED'): void;
  sortByConfidence(): void;
}
```

**UI Layout:**
```
┌─────────────────────────────────────────────────────┐
│ RH Agent - March 15, 2026                           │
│ Status: COMPLETE (700/700 symbols, 23 opportunities)│
├─────────────────────────────────────────────────────┤
│                                                     │
│ ▼ Filter: [All ▼]  Sort: [Confidence ▼]  Deadline: 12:30 PM │
│                                                     │
│ ┌─────────────────────────────────────────────────┐ │
│ │ AAPL    BUY    Confidence: 87%                 │ │
│ │ RSI: 24.5 (oversold) | Price: -3.2%           │ │
│ │ Reason: Strong oversold bounce likely...      │ │
│ │ Suggested: $1,000                               │ │
│ │                                                 │ │
│ │ [✓ Approve] [✗ Reject] [⚙ Customize]          │ │
│ └─────────────────────────────────────────────────┘ │
│                                                     │
│ ┌─────────────────────────────────────────────────┐ │
│ │ NVDA    BUY    Confidence: 72%    [APPROVED]   │ │
│ │ RSI: 28.1 | Price: -2.8%                        │ │
│ │ Order: MARKET $1,000  →  Executed: $892.50     │ │
│ └─────────────────────────────────────────────────┘ │
│                                                     │
│ ... more opportunities ...                          │ │
│                                                     │
├─────────────────────────────────────────────────────┤
│ Summary: 23 opportunities | 15 approved | 8 rejected│
└─────────────────────────────────────────────────────┘
```

### Deployment Checklist

- [ ] Set `ANTHROPIC_API_KEY` secret
- [ ] Set `ROBINHOOD_ACCESS_TOKEN` secret (after OAuth flow - TBD)
- [ ] Verify OAuth mechanism details
- [ ] Load 700-symbol list into Firestore
- [ ] Deploy Cloud Functions
- [ ] Verify UI route `/rh-agent` works
- [ ] Test manual run in emulator
- [ ] Set daily scheduler (12:00 PM PT)
- [ ] Test approval workflow end-to-end

### Future Enhancements (Post-MVP)

1. **Proprietary Indicators** - Migrate Pinescript → TypeScript
2. **More Strategies** - MACD crossover, breakout detection
3. **Position Sizing** - Kelly criterion, risk-based sizing
4. **Performance Tracking** - P&L analysis, win rate
5. **Notifications** - Email/SMS when opportunities ready
6. **Auto-approval** - High-confidence trades auto-executed
7. **Backtesting** - Strategy performance on historical data

---

## Key Differences from Original Design

| Aspect | Original | Revised |
|--------|----------|---------|
| Frequency | Every 15 min (intraday) | Once daily at 12:00 PM PT |
| Symbols | 3 (AAPL, NVDA, TSLA) | ~700 symbols |
| Architecture | Single long-running function | Cloud Tasks queue with workers |
| Data Source | Robinhood API | Internal rel-str Firestore |
| Execution | Dry-run only | User approval required |
| Deadline | N/A | Must complete by 12:45 PM PT |
| RH Auth | API key (incorrect) | OAuth2 (TBD - unconfirmed) |
| Complexity | Multiple strategies | One simple strategy (MVP) |

---

## Open Questions

1. **Symbol list source:** Where do the 700 symbols come from? Existing `rs-symbol-cache`? Separate collection?
2. **Claude rate limits:** ~5-10 approved opportunities/day → ~150-300 requests/month. Well within limits. (Only approved opportunities go to Claude, not all 700 symbols)
3. **Cost estimate:** Cloud Tasks (700 tasks/day) + Claude API (minimal) + Firestore reads. Need budget calculation.
4. **OAuth mechanism:** Verify Robinhood OAuth2 flow, token expiration, refresh strategy.
