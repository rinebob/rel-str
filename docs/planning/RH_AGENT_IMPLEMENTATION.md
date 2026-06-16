# RH Agent Cloud Functions - Implementation Guide

## Audience

This document has two sections:
- **Operators**: Just need to deploy and run
- **Developers**: Need to understand/modify the system

---

## SECTION 1: FOR OPERATORS

### Overview

Daily trading agent that:
1. **Automatically triggers when SavantAPI intraday data arrives** (via partner-data-ready Pub/Sub message)
2. Scans ~700 symbols from internal rel-str database
3. Generates trade opportunities based on simple technical indicators
4. Shows opportunities in UI for your approval/rejection
5. Only approved trades are sent to Robinhood
6. Must complete by **12:30-12:45 PM Pacific** to enter trades

### Data Flow

```
SavantAPI hourly intraday pipeline runs (7am-12pm PT)
    │
    ▼
PDR message sent (runType: "intraday-snapshot")
    │
    ▼
RH Agent trigger:
  1. Receive PDR with runStatus: "completed"
  2. Call partnerIntradaySnapshotV2 (POST all 700 symbols)
  3. Receive intraday data: {snapshots: [{symbol, ip, ipc, io, it, ic}, ...]}
    │
    ▼
Queue 700 symbol-analysis tasks (intraday data passed in job payload)
    │
    ▼
Cloud Tasks workers (parallel, ~20 concurrent)
    │
    ▼
For each symbol:
  1. Read historical closes from rs-symbol-cache (days 1-14)
  2. Use intraday price from job payload (today's ip)
  3. Create close array: [historical..., intraday.ip]
  4. Calculate indicators (RSI, MACD), check for signals
  5. Store opportunity if signal triggered
    │
    ▼
All jobs complete → UI shows opportunities for review
    │
    ▼
You approve/reject each opportunity
    │
    ▼
Approved trades → Manual execution (HIL step)
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
firebase deploy --only functions:rhAgentPdrTrigger,functions:rhAgentProcessSymbol,functions:rhAgentGetOpportunities,functions:rhAgentApproveTrade
```

### Daily Workflow

1. **~7:00 AM - 1:00 PM PT** - SavantAPI fetches hourly intraday data, sends PDR messages
2. **~5 minutes after each PDR** - RH Agent triggers, analysis completes, opportunities appear in UI
3. **Review window** - You review and approve/reject opportunities
4. **Trade deadline** - Approved trades executed (manual for now)

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
│  │  RS Complete    │───▶│  Cloud Tasks Queue   │───▶│  Symbol Workers │  │
│  │  Firestore Trigger│   │  (maxConcurrent: 20) │    │  ├─ Firestore   │  │
│  └─────────────────┘    └──────────────────────┘    │  │  (daily bars) │  │
│                                                     │  ├─ SavantAPI    │  │
│                                                     │  │  (intraday)   │  │
│                                                     │  └─────────────────┘  │
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
│  │  ├─ SavantAPI (intraday price snapshots per symbol)                 │  │
│  │  ├─ Anthropic Claude (signal generation)                            │  │
│  │  └─ Robinhood OAuth (trade execution - approved only)               │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Data Source

**IMPORTANT:** We use internal rel-str Firestore data + SavantAPI intraday snapshot, NOT Robinhood API for price data.

> **📋 SA LLM Guidance:** SavantAPI provides a bulk endpoint `partnerIntradaySnapshotV2` that reads from their pre-populated intraday cache (fetched hourly from Alpha Vantage). This avoids 700 individual API calls and rate limits.

**Historical Source:** `rs-symbol-cache/{marketDate}/symbols/{symbol}`
- `dailyBars` - Historical OHLCV data from previous days (already cached)

**Live Source:** SavantAPI `partnerIntradaySnapshotV2` endpoint
- **Auth:** Google OIDC ID token (service-account-to-service-account)
- **Request:** POST `{"symbols": ["AAPL", "MSFT", ...]}` (up to 1000 symbols)
- **Response:** `{"marketDate": "2026-06-15", "count": 700, "snapshots": [{"symbol": "AAPL", "ip": 225.50, "ipc": 1.25, "io": 1757892000000, "it": "10:30", "ic": 2.78}, ...]}`
- **Fields:** `ip` (price), `ipc` (change %), `io` (timestamp), `it` (time), `ic` (change $)

**Trigger fetches once, workers receive in payload:**
```typescript
// Trigger (one call for all symbols)
const intradayData = await callPartnerIntradaySnapshotV2(allSymbols);

// Pass to workers via job payload
for (const symbol of symbols) {
  await createJobAndEnqueue(runId, symbol, marketDate, 'pdr', intradayData[symbol]);
}

// Worker creates close array for indicators
const dailyBars = await getCachedBars(symbol, marketDate);  // Historical from rs-symbol-cache
const intraday = jobPayload.intraday;                         // From trigger's fetch

// Simple array of closes: historical + today's intraday price
const closes = [
  ...dailyBars.map(bar => bar.c),  // Historical closes (days 1-14)
  intraday.ip                       // Today's intraday close
];
```

**Why:**
- Single bulk API call (not 700 individual calls)
- No Alpha Vantage rate limits (SavantAPI handles caching)
- Service account auth (secure, auditable)
- Workers get intraday data in payload (no per-worker API calls)

### File Structure

```
functions/src/
├── index.ts                                    # Exports all functions
├── rh-agent-cloud-function/
│   ├── rh-agent-config.ts                     # Types, enums, interfaces
│   ├── rh-agent-secrets.ts                    # Secrets config
│   ├── rh-agent-firestore.ts                  # Firestore persistence
│   ├── rh-agent-trigger.ts                    # NEW: Pub/Sub trigger on partner-data-ready
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

#### 1. rhAgentPdrTrigger (Pub/Sub Trigger)

**Trigger:** `partner-data-ready` Pub/Sub message with `runType = "intraday-snapshot"`

> **📋 SA LLM Guidance:** After consulting with SavantAPI team, we determined:
> - SavantAPI already runs an hourly intraday snapshot pipeline (7am-12pm PT)
> - New endpoint `partnerIntradaySnapshotV2` will read from this pre-populated cache
> - PDR messages include `runType: "intraday-snapshot"` to distinguish from RS pipeline triggers
> - Service account auth (OIDC ID tokens) like existing `partnerTimeSeriesV2`

**Why PDR-based?**
- RH Agent runs immediately when intraday data is ready (no waiting for RS pipeline)
- Historical bars already in `rs-symbol-cache` from previous days
- Intraday snapshot provides today's live price from SavantAPI cache
- Decouples RH Agent from RS pipeline timing

**PDR Payload (Intraday):**
```json
{
  "version": "v1",
  "runId": "2026-06-15-MON-INTRADAY-1000",
  "marketDate": "2026-06-15",
  "phase": "intraday",
  "intervals": ["INTRADAY"],
  "status": "end",
  "runStatus": "completed"
}
```

**Config:**
```typescript
export const rhAgentPdrTrigger = onMessagePublished({
  topic: 'partner-data-ready',
}, async (event) => {
  const attributes = event.data.message.attributes;
  const payload = JSON.parse(Buffer.from(event.data.message.data, 'base64').toString());
  
  // Only process intraday-snapshot PDR messages when completed
  if (attributes.runType !== 'intraday-snapshot') return;
  if (payload.status !== 'end') return;
  if (payload.runStatus !== 'completed' && payload.runStatus !== 'completed_with_errors') return;
  
  const marketDate = payload.marketDate;
  
  // Idempotency check
  const existingRun = await db.collection('rh-agent-runs').doc(marketDate).get();
  if (existingRun.exists) return;
  
  // Fetch intraday snapshot for all symbols (one POST call)
  const intradayData = await callPartnerIntradaySnapshotV2(symbols);
  
  // Start RH Agent run
  await startRhAgentRun(marketDate, 'pdr', intradayData);
});
```

**Flow:**
```typescript
async function startRhAgentRun(
  marketDate: string, 
  triggeredBy: string,
  intradaySnapshots: IntradaySnapshot[]  // From partnerIntradaySnapshotV2
) {
  // 1. Load symbol list (~700 symbols from Firestore)
  const symbols = await loadEnabledSymbols();
  
  // 2. Create "run" document
  const runId = await createDailyRun(marketDate, symbols.length, getDeadlineISO(30), 'pdr');
  
  // 3. Create job docs and enqueue tasks (one per symbol)
  // Pass intraday data in job payload so workers don't need to fetch
  for (const symbol of symbols) {
    const intraday = intradaySnapshots.find(s => s.symbol === symbol);
    await createJobAndEnqueue(runId, symbol, marketDate, 'pdr', intraday);
  }
  
  logger.info('rh_agent_triggered_by_pdr', { 
    runId, 
    marketDate, 
    symbolCount: symbols.length,
    intradayCount: intradaySnapshots.length 
  });
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
  intraday: {
    symbol: string;
    ip: number;      // Latest intraday price
    ipc: number;     // Intraday change %
    io: number;      // Epoch ms timestamp
    it: string;      // Time string (e.g., "10:30")
    ic: number;      // Intraday change $
  };
}
```

**Flow:**
```typescript
async function processSymbolHandler(payload) {
  const { runId, symbol, marketDate, intraday } = payload;
  
  try {
    // 1. Read cached daily bars from Firestore (historical, days 1-14)
    const dailyBars = await getCachedBars(symbol, marketDate);
    
    // 2. Create close array: historical + today's intraday price
    // Most indicators (RSI, MACD) only need close prices
    const closes = [
      ...dailyBars.map(bar => bar.c),  // Historical closes
      intraday.ip                       // Today's intraday price
    ];
    
    // 3. Calculate indicators on close array
    const indicators = calculateIndicators(closes);
    
    // 4. Check if signal triggered
    const signal = checkSignal(symbol, indicators);
    
    if (signal) {
      // 5. Generate opportunity using Claude
      const opportunity = await generateOpportunity(symbol, indicators, signal);
      
      // 6. Store opportunity (pending approval)
      await storeOpportunity(runId, opportunity);
    }
    
    // 7. Mark job complete
    await markJobComplete(runId, symbol, 'SUCCESS');
    
  } catch (error) {
    await markJobComplete(runId, symbol, 'FAILED', error);
  }
}
```

**Why intraday in job payload?**
- Trigger makes ONE bulk API call to `partnerIntradaySnapshotV2` (all 700 symbols)
- Workers receive intraday data in payload (no per-worker API calls)
- Efficient: single API call, no coordination needed
- Workers are simple: just read historical bars + use payload intraday

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
RS Processing Complete
    │
    ▼
Firestore trigger fires (runStatus = COMPLETE)
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
| UI ready by | ~5 min after RS completes |
| User review window | Configurable |
| Trade deadline | Configurable |

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
- [ ] Deploy Pub/Sub trigger function (`rhAgentPdrTrigger`)
- [ ] Test PDR intraday-snapshot trigger in emulator
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
| Trigger | Cron schedule (12:00 PM PT) | Event-based (PDR intraday-snapshot) |
| Symbols | 3 (AAPL, NVDA, TSLA) | ~700 symbols |
| Architecture | Single long-running function | Cloud Tasks queue with workers |
| Data Source | Robinhood API | Internal Firestore + SavantAPI intraday |
| Execution | Dry-run only | User approval required |
| Deadline | N/A | Manual execution (no auto-deadline) |
| RH Auth | API key (incorrect) | OAuth2 (TBD - unconfirmed) |
| Intraday Fetch | Per-worker | Bulk via `partnerIntradaySnapshotV2` |
| Complexity | Multiple strategies | One simple strategy (MVP) |

---

## Open Questions

1. **Symbol list source:** Where do the 700 symbols come from? Existing `rs-symbol-cache`? Separate collection?
2. **Claude rate limits:** ~5-10 approved opportunities/day → ~150-300 requests/month. Well within limits. (Only approved opportunities go to Claude, not all 700 symbols)
3. **Cost estimate:** Cloud Tasks (700 tasks/day) + Claude API (minimal) + Firestore reads. Need budget calculation.
4. **OAuth mechanism:** Verify Robinhood OAuth2 flow, token expiration, refresh strategy.

---

## Appendix: SavantAPI Integration Details

### SA LLM Interaction Summary

The RH Agent intraday data architecture was designed in collaboration with the SavantAPI (SA) team. Below is the interaction log for reference:

#### Initial Question to SA
> We need intraday data fetching specs for ~700 symbols, 6x/day (7am-12pm PT). Looking for:
> 1. Bulk endpoint for intraday snapshots
> 2. Partner benefits (rate limits, etc.)
> 3. Recommended orchestration approach

#### SA Response
**Endpoint:** `POST /partnerIntradaySnapshotV2` (to be implemented)
- Accepts up to 1000 symbols in single request
- Returns array format: `{marketDate, count, snapshots: [{symbol, ip, ipc, io, it, ic}]}`
- Reads from SA's pre-populated intraday cache (not live AV calls)

**Auth:** Google OIDC ID tokens (service-account-to-service-account)
- Same as existing `partnerTimeSeriesV2`
- Dedicated SA: `rs-partner-caller@rel-str.iam.gserviceaccount.com`

**PDR Messages:** New `runType: "intraday-snapshot"`
- 6 messages/day (hourly 7am-12pm PT)
- Payload includes `status: "end"`, `runStatus: "completed"`
- Subscribe with: `attributes.runType === "intraday-snapshot"`

#### Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Bulk fetch in trigger | One API call vs 700 individual calls |
| Pass intraday in job payload | Workers don't need API client, simpler code |
| Service account auth | Secure, auditable, same pattern as other endpoints |
| No local intraday cache | SA already caches, we just read |

#### Implementation Checklist (SA Side)
- [ ] Build `partnerIntradaySnapshotV2` endpoint
- [ ] Add intraday PDR messages with `runType: "intraday-snapshot"`
- [ ] Allowlist `rs-partner-caller@rel-str.iam.gserviceaccount.com`
- [ ] Deploy and notify RSH team

#### Implementation Checklist (RSH Side)
- [ ] Create `rs-partner-caller` service account
- [ ] Implement `rhAgentPdrTrigger` with intraday-snapshot filter
- [ ] Add `callPartnerIntradaySnapshotV2` client function
- [ ] Update `createJobAndEnqueue` to accept intraday data
- [ ] Update worker payload type to include intraday fields
- [ ] Test end-to-end with SA staging environment
