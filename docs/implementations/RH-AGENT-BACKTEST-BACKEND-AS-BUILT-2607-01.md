# RH Agent Strategy Backtest Backend — As-Built

This document describes the RH Agent strategy backtesting backend exactly as it is implemented today. It is split into three parts:

1. **Plain-English process description** — what happens, in order, with no code.
2. **Same description annotated with code paths** — the files and functions that carry out each step.
3. **Implementation reference** — enough detail for another developer to reproduce the same backend in a different app.

> Scope note: this is the backend only. The Angular backtest dashboard is out of scope.

---

## Part 1 — What happens (plain English)

### 1. The moving pieces

The backend backtesting pipeline is made up of the following pieces:

- **Strategy adapter** — the contract every strategy must implement (`metadata` + `execute(input, config)`). Strategies are source-committed TypeScript files.
- **Strategy registry** — a singleton that maps strategy IDs to adapters and validates supplied configs against each strategy's JSON-like schema.
- **Option contract selection helper** — reusable code that picks the best option contract for a single leg or a multi-leg spread from a daily chain, based on target delta, target DTE, DTE bounds, side, and mark availability.
- **Backtest data loader** — loads all available daily bars for a symbol from Firestore and caches historical option chains fetched from the Savant partner proxy.
- **Backtest simulator** — replays daily bars one day at a time, asks the strategy for signals, enters and exits option positions at the close-of-day mark, and tracks an equity curve.
- **Backtest metrics** — computes the initial TradeStation-style performance subset from the equity curve and closed trades.
- **Backtest orchestrator** — a callable Cloud Function (`rhAgentBacktestStart`) that accepts a backtest request, creates a job document, and fans out one Cloud Task per symbol.
- **Backtest worker** — a Cloud Tasks handler (`rhAgentBacktestPermutation`) that runs one symbol+strategy+config permutation end to end and persists the result.
- **Firestore collections** — `backtest-runs` for job/progress metadata and `backtest-permutations` for per-symbol results.
- **Partner historical options proxy** — `callPartnerHistoricalOptions` in `partner-proxy.ts`, which calls the Savant `partnerHistoricalOptionsV2` endpoint using a Google OIDC ID token.

### 2. Starting a backtest run

A run begins when the UI or a client calls the `rhAgentBacktestStart` HTTPS callable.

1. The caller supplies `symbols`, `strategyId`, and optionally `config`, `runType`, `initialCash`, and `reportTier`.
2. The orchestrator trims and uppercases the symbol list, validates that `strategyId` is registered, and defaults `runType` to `'allData'`, `initialCash` to `100,000`, and `reportTier` to `'summary'`.
3. It generates a PT-based `runId` using `getRunDatePT()` and `getRunIdPT()` and creates a document under `backtest-runs/{runId}` with status `RUNNING`.
4. For each symbol, it builds a `BacktestPermutationPayload` and enqueues one Cloud Task on the `rhAgentBacktestPermutation` queue. Tasks are staggered by `0.5` seconds to smooth dispatch.
5. It returns `{ runId, enqueued, failed, total }` so the caller can poll progress.

### 3. Worker execution flow

Each queued task invokes `rhAgentBacktestPermutation`.

1. The worker reads `runId`, `permutationId`, `symbol`, `strategyId`, `config`, `runType`, `initialCash`, and `reportTier` from the task payload.
2. It records a `RUNNING` permutation document under `backtest-permutations/{permutationId}`.
3. It loads the strategy from the registry and validates the config against the strategy's schema.
4. It loads all available daily, weekly, and monthly bars for the symbol through `loadAllBars`.
5. It creates an `OptionsChainCache` for the symbol and calls `runBacktestSimulation`, passing the daily, weekly, and monthly bar sets.
6. The simulator returns metrics, an equity curve, closed trades, and notes.
7. The worker builds a `BacktestPermutationSummary`, appends `trades` only when `reportTier === 'full'`, and writes the result to Firestore with `merge: true`.
8. It increments `completedPermutations` on the parent run document.
9. If the task fails, Cloud Tasks retries it up to three times. Only on the final attempt does the worker mark the permutation `FAILED` and increment `failedPermutations`.

### 4. Simulation loop

`runBacktestSimulation` replays the daily bars in chronological order.

1. It starts iterating at index `minBarsRequired - 1` so the strategy has enough history.
2. Each day it builds a `StrategyInput` with the symbol, the current market date, and the daily, weekly, and monthly bars up to and including today.
3. It calls `strategy.execute(input, config)`, normalizing a single output to an array.
4. It fetches that day's option chain from the `OptionsChainCache` only if an open option position needs marking or the strategy signal includes `optionLegs` metadata.
5. **Open positions are evaluated first.** For each open position `evaluateExit` looks up a mark for every leg (today's close for underlying legs, the option chain for option legs). If the position has hit target gain, stop loss, trailing stop, max hold days, or its contracts are missing and max hold has passed, it is closed at today's mark. Otherwise each leg's `lastMark` is updated. Closed positions generate a `BacktestTrade` and return cash to the balance.
6. **New entries are evaluated second.** Each strategy output with an `action` is checked against `maxConcurrentPositions` (default `0` = unlimited). If room exists, `tryEnterPosition` selects option contracts from `optionLegs` metadata or opens an underlying share position from `underlyingPosition` metadata, deducts the entry cash outflow, and adds the position to the open list.
7. The simulator records an equity-curve point with `cash`, `equity` (cash + marked value of open positions), and `openPositions`.
8. After the loop, any remaining open positions are closed at the last available mark with exit reason `endOfData`.
9. `computeMetrics` is called and the full result is returned.

### 5. Option contract selection

Selection is performed by `selectOptionContract` and `selectOptionSpread`.

1. Contracts are filtered by `type` and positive DTE. DTE is computed as calendar days between the market date and `contract.expiration`.
2. Numeric fields (`delta`, `mark`) are parsed from strings defensively; missing or non-numeric values are treated as `undefined`.
3. The first pass enforces `minDte` and `maxDte` hard bounds. If no contract matches, a second fallback pass relaxes the bounds and adds a soft penalty to the score.
4. Each candidate receives a score: delta distance plus DTE distance, with DTE weighted `0.5`. Lower is better.
5. If `requireMark` is true or `targetDelta` is supplied, candidates missing those fields are discarded.
6. The lowest-scoring candidate wins.
7. For multi-leg spreads, `selectOptionSpread` selects legs sequentially, removing each chosen `contractID` from the remaining pool so no leg reuses the same contract.

### 6. Metrics and reporting

`computeMetrics` produces the initial TradeStation-style subset.

- **Trade-level** values: `totalNetProfit`, `grossProfit`, `grossLoss`, `profitFactor`, `percentProfitable`, `winLossRatio`, `averageTrade`, `averageWin`, `averageLoss`.
- **Drawdown**: max absolute drawdown and max percentage drawdown measured from the equity curve.
- **Sharpe**: mean of daily returns divided by daily standard deviation, annualized with `sqrt(252)`.
- **Calmar**: total return divided by max drawdown percentage; used as the optimization objective / quality score.

The `reportTier` controls persistence:

- `'summary'` — stores run metadata, metrics, equity curve, trade count, and notes, but not individual trades.
- `'full'` — stores the same plus the complete `trades` array.

### 7. Walk-forward and parameter sweeps (as-built status)

The `BacktestPermutationPayload` and `BacktestRun` types include `runType: 'allData' | 'expandingWindow'` and optional `inSampleDays`, `outOfSampleDays`, and `rollStepDays` fields. As of this build:

- `runType` defaults to `'allData'` and is accepted by the orchestrator, but `runBacktestSimulation` currently replays the entire available bar range regardless of `runType`.
- Expanding-window partitioning into in-sample / out-of-sample windows is not yet implemented.
- The `configSchema` supports `min`, `max`, and `step` on numeric fields, but the orchestrator does not expand a parameter grid. It enqueues one task per symbol using the single `config` object supplied by the caller.

### 8. Partner historical options endpoint

Option data comes from the Savant `partnerHistoricalOptionsV2` endpoint.

1. `callPartnerHistoricalOptions({ symbol, date? })` mints a Google OIDC ID token with `generateIdTokenWithEmail` for the configured audience and service account (`CALLER_SA`).
2. The audience and URL default to `https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net/partnerHistoricalOptionsV2` and can be overridden with `PARTNER_HISTORICAL_OPTIONS_AUDIENCE` and `PARTNER_HISTORICAL_OPTIONS_URL`.
3. `fetchWithRetry` performs up to three attempts with exponential backoff + jitter for HTTP `429`, `500`, `502`, `503`, and `504`.
4. The response is parsed as `PartnerHistoricalOptionsResponse`; the contract array lives at `response.data.data`.
5. Options data is not persisted in Firestore. Each task fetches chains on demand and caches them in the `OptionsChainCache` instance for the lifetime of that task.

---

## Part 2 — What happens, with code paths

### Strategy adapter contract

- `functions/src/rh-agent-cloud-function/strategies/base-strategy.ts` defines `StrategyInput`, `OHLCV`, `StrategyOutput`, `StrategyId`, `StrategyConfig`, `ConfigSchemaField`, `StrategyMetadata`, and `StrategyAdapter`.
- `StrategyOutput.metadata` is where a strategy places `optionLegs` and `exit` rules for the simulator to consume.

### Strategy registry

- `functions/src/rh-agent-cloud-function/strategies/strategy-registry.ts` exports a singleton `strategyRegistry` that auto-registers `st-trend-rider` and `leap-drop` at module load.
- It provides `register`, `get`, `has`, `list`, `listIds`, and `validateConfig`. Validation checks numeric `min`/`max`, integer-ness, booleans, strings, and enum membership.

### LEAP-drop strategy (proof-of-concept)

- `functions/src/rh-agent-cloud-function/strategies/leap-drop/leap-drop.strategy.ts` exports `adapter = { metadata, execute }`.
- `metadata.id` is `'leap-drop'`. `execute` compares today's close to yesterday's close; if the drop is at least `dropPct`, it returns a `LONG` signal.
- When `useUnderlying` is `false` (the default), the signal type is `D_LEAP_DROP_LONG` and `metadata.optionLegs` requests one long leg with `targetDelta`, `targetDte`, `minDte`, `maxDte`, and `requireMark: true`.
- When `useUnderlying` is `true`, the signal type is `D_DROP_BUY_UNDERLYING_LONG` and `metadata.underlyingPosition` requests a long share position with a multiplier of `1`.
- `metadata.exit` carries `targetGainPct`, `stopLossPct`, `trailingStopPct`, and `maxHoldDays`.
- `stopLossPct`, `trailingStopPct`, and `maxHoldDays` all use `0` as the disabled sentinel.
- Defaults are supplied by `applyDefaults` and documented in the adjacent `README.md`.

### Option contract selection

- `functions/src/rh-agent-cloud-function/strategies/option-contract-selection.ts` exports `selectOptionContract`, `selectOptionSpread`, `OptionContractSelectionCriteria`, `OptionSpreadLegSelection`, and `SelectedOptionContract`.
- `evaluateContract` computes DTE and score. `computeScore` returns `null` for ineligible candidates and a non-negative number for eligible ones.
- `selectOptionSpread` uses `selectOptionContract` per leg and filters out used `contractID` values.

### Backtest data loader

- `functions/src/rh-agent-cloud-function/backtest/backtest-data-loader.ts`:
  - `loadAllBars(symbol)` calls `getCachedBarsFromSymbolData(symbol, '2999-12-31')` so no future trim is applied, sorts and de-duplicates daily, weekly, and monthly bars, and maps all three arrays to `OHLCV`.
  - `OptionsChainCache` caches chains by `${symbol}:${date}`. On fetch failure it caches an empty array and returns `[]` so the simulator can record a gap note.

### Backtest simulator

- `functions/src/rh-agent-cloud-function/backtest/backtest-simulator.ts`:
  - `runBacktestSimulation` is the main loop; it accepts daily, weekly, and monthly bar sets and passes all three into `StrategyInput`.
  - `evaluateExit` looks up marks for every leg, then compares `pnlPct` against `targetGainPct`, `-stopLossPct` (when `> 0`), `trailingStopPct` (from the running high-water mark, when `> 0`), and `maxHoldDays` (when `> 0`).
  - `findMarkForContract` first tries `contractID`, then falls back to `type + expiration + strike`.
  - `tryEnterPosition` uses `selectOptionContract` or `selectOptionSpread` for option legs, or creates an underlying leg when `metadata.underlyingPosition` is present. Missing `stopLossPct` and `maxHoldDays` default to `0` (disabled).
  - `closePosition` computes per-leg P&L and cash flow, using the last known mark as a fallback when a contract is missing. The closed `BacktestTrade` keeps the first-leg summary fields for backward compatibility and also stores a `legs: BacktestTradeLeg[]` array.
  - `marketValue` and `computeOpenPositionValue` value multi-leg positions using each leg's `multiplier` (`100` for options, `1` for underlying shares).

### Backtest metrics

- `functions/src/rh-agent-cloud-function/backtest/backtest-metrics.ts` exports `computeMetrics(initialCash, equityCurve, closedTrades)`.
- It computes the values described in Part 1 and returns a `BacktestMetrics` object.

### Orchestrator

- `functions/src/rh-agent-cloud-function/backtest/backtest-orchestrator.ts` exports `rhAgentBacktestStart`, an `onCall` function with `{ cors: true, memory: '256MiB', invoker: 'public' }`.
- It writes the `backtest-runs` document and enqueues tasks via `getFunctions().taskQueue(BACKTEST_TASK_QUEUE)`.
- `permutationId` is `${runId}_${symbol}_${index}`.

### Worker

- `functions/src/rh-agent-cloud-function/backtest/backtest-worker.ts` exports `rhAgentBacktestPermutation`, an `onTaskDispatched` function.
- Config: `maxAttempts: 3`, `minBackoffSeconds: 10`, `maxBackoffSeconds: 120`, `maxConcurrentDispatches: 10`, `maxDispatchesPerSecond: 5`, `memory: '512MiB'`, `timeoutSeconds: 300`.
- `retryCount` is cast from the request object; failure is only recorded on the final attempt (`isFinalAttempt`).

### Firestore collections and types

- `functions/src/rh-agent-cloud-function/backtest/backtest-collections.ts` defines `BACKTEST_RUNS_COLLECTION = 'backtest-runs'`, `BACKTEST_PERMUTATIONS_COLLECTION = 'backtest-permutations'`, and status enums.
- `functions/src/rh-agent-cloud-function/backtest/backtest-types.ts` defines `BacktestPermutationPayload`, `BacktestTrade`, `BacktestEquityPoint`, `BacktestMetrics`, `BacktestPermutationSummary`, `BacktestPermutationFull`, and `BacktestRun`.

### Partner proxy and types

- `functions/src/types/partner.ts` adds `PartnerEndpointPath.HISTORICAL_OPTIONS`, the `OptionType` enum, `HistoricalOptionContract`, `HistoricalOptionsAnalysisSummary`, `HistoricalOptionsExpirationGroup`, `HistoricalOptionsStrikeGroup`, and `PartnerHistoricalOptionsResponse`.
- `functions/src/partner-proxy.ts` adds `callPartnerHistoricalOptions`, `generateIdTokenWithEmail` (with `includeEmail: true`), and `fetchWithRetry`.

### Function exports

- `functions/src/index.ts` exports `rhAgentBacktestStart` from `./rh-agent-cloud-function/backtest/backtest-orchestrator` and `rhAgentBacktestPermutation` from `./rh-agent-cloud-function/backtest/backtest-worker`.

---

## Part 3 — Implementation reference

This part is written for a developer who wants to reproduce the same backend in another project.

### Dependencies

The functions package (`functions/package.json`) uses:

```json
{
  "dependencies": {
    "firebase-admin": "^12.7.0",
    "firebase-functions": "^7.0.3",
    "google-auth-library": "^9.14.2"
  },
  "devDependencies": {
    "esbuild": "^0.28.1",
    "tsx": "^4.0.0",
    "typescript": "^5.8.0"
  }
}
```

`firebase-functions` v2 provides `onCall` (HTTPS callable), `onTaskDispatched` (Cloud Tasks), and logger utilities. `firebase-admin` provides Firestore and `getFunctions().taskQueue(...)`. `google-auth-library` mints the OIDC ID token for the partner endpoint.

### Required source files

All paths are relative to `functions/src/`:

| Concern | Files |
| --- | --- |
| Strategy contract | `rh-agent-cloud-function/strategies/base-strategy.ts` |
| Strategy registry | `rh-agent-cloud-function/strategies/strategy-registry.ts` |
| LEAP-drop strategy | `rh-agent-cloud-function/strategies/leap-drop/leap-drop.strategy.ts`, `rh-agent-cloud-function/strategies/leap-drop/README.md` |
| Option selection | `rh-agent-cloud-function/strategies/option-contract-selection.ts` |
| Data loader | `rh-agent-cloud-function/backtest/backtest-data-loader.ts` |
| Simulator | `rh-agent-cloud-function/backtest/backtest-simulator.ts` |
| Metrics | `rh-agent-cloud-function/backtest/backtest-metrics.ts` |
| Orchestrator | `rh-agent-cloud-function/backtest/backtest-orchestrator.ts` |
| Worker | `rh-agent-cloud-function/backtest/backtest-worker.ts` |
| Collections | `rh-agent-cloud-function/backtest/backtest-collections.ts` |
| Types | `rh-agent-cloud-function/backtest/backtest-types.ts` |
| Partner types | `types/partner.ts` |
| Partner proxy | `partner-proxy.ts` |
| Firestore bars loader | `rh-agent-cloud-function/rh-agent-data-loader.ts` |
| PT date utilities | `common/pt-date-utils.ts` |
| Function entry point | `index.ts` |

### Constants

`functions/src/rh-agent-cloud-function/backtest/backtest-orchestrator.ts`:

```ts
const DEFAULT_INITIAL_CASH = 100_000;
```

`functions/src/rh-agent-cloud-function/backtest/backtest-worker.ts`:

```ts
export const BACKTEST_TASK_QUEUE = 'rhAgentBacktestPermutation';
const MAX_ATTEMPTS = 3;
```

`functions/src/types/partner.ts`:

```ts
export enum PartnerEndpointPath {
  TRACKED_SYMBOLS = 'partnerListTrackedSymbolsV2',
  TIME_SERIES = 'partnerTimeSeriesV2',
  MARKET_HOLIDAYS = 'partnerMarketHolidays',
  INTRADAY_SNAPSHOT = 'partnerIntradaySnapshotV2',
  COMPANY_OVERVIEW = 'partnerCompanyOverviewV2',
  HISTORICAL_OPTIONS = 'partnerHistoricalOptionsV2',
}

export enum OptionType {
  CALL = 'call',
  PUT = 'put',
}
```

`functions/src/partner-proxy.ts`:

```ts
export const PARTNER_AUDIENCE =
  process.env.PARTNER_AUDIENCE ||
  'https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net';

const PARTNER_HISTORICAL_OPTIONS_URL =
  process.env.PARTNER_HISTORICAL_OPTIONS_URL ||
  `${PARTNER_AUDIENCE.replace(/\/$/, '')}/${PartnerEndpointPath.HISTORICAL_OPTIONS}`;

const PARTNER_HISTORICAL_OPTIONS_AUDIENCE =
  process.env.PARTNER_HISTORICAL_OPTIONS_AUDIENCE || PARTNER_HISTORICAL_OPTIONS_URL;

const CALLER_SA = process.env.PARTNER_CALLER_SA || DEFAULT_PARTNER_CALLER_SA;
```

### Key type definitions

`functions/src/rh-agent-cloud-function/backtest/backtest-types.ts`:

```ts
export type BacktestRunType = 'allData' | 'expandingWindow';
export type BacktestReportTier = 'summary' | 'full';

export interface BacktestPermutationPayload {
  runId: string;
  permutationId: string;
  symbol: string;
  strategyId: string;
  config: StrategyConfig;
  runType: BacktestRunType;
  initialCash: number;
  reportTier: BacktestReportTier;
  inSampleDays?: number;
  outOfSampleDays?: number;
  rollStepDays?: number;
}

export enum BacktestExitReason {
  TARGET_GAIN = 'targetGain',
  STOP_LOSS = 'stopLoss',
  TRAILING_STOP = 'trailingStop',
  MAX_HOLD_DAYS = 'maxHoldDays',
  MISSING_DATA = 'missingData',
  END_OF_DATA = 'endOfData',
}

export interface BacktestTradeLeg {
  kind: 'option' | 'underlying';
  side: 'long' | 'short';
  quantity: number;
  multiplier: number;
  entryMark: number;
  exitMark: number;
  optionType?: OptionType;
  strike?: string;
  expiration?: string;
  contractId?: string;
  pnl: number;
}

export interface BacktestTrade {
  entryDate: string;
  exitDate: string;
  symbol: string;
  strategyId: string;
  config: StrategyConfig;
  entryUnderlying: number;
  exitUnderlying: number;
  entryMark: number;
  exitMark: number;
  quantity: number;
  side: 'long' | 'short';
  optionType?: OptionType;
  strike?: string;
  expiration?: string;
  contractId?: string;
  /** True when the trade was an equity/underlying position rather than an option. */
  isUnderlying?: boolean;
  pnl: number;
  returnPct: number;
  exitReason: BacktestExitReason;
  daysHeld: number;
  notes?: string[];
  /** Per-leg detail for multi-leg spreads. */
  legs?: BacktestTradeLeg[];
}

export interface BacktestEquityPoint {
  date: string;
  cash: number;
  equity: number;
  openPositions: number;
}

export interface BacktestMetrics {
  totalNetProfit: number;
  grossProfit: number;
  grossLoss: number;
  profitFactor: number;
  percentProfitable: number;
  winLossRatio: number;
  averageTrade: number;
  averageWin: number;
  averageLoss: number;
  maxDrawdown: number;
  maxDrawdownPct: number;
  sharpeRatio: number;
  calmarRatio: number;
  tradeCount: number;
  winCount: number;
  lossCount: number;
}

export interface BacktestPermutationSummary {
  runId: string;
  permutationId: string;
  symbol: string;
  strategyId: string;
  config: StrategyConfig;
  status: 'pending' | 'running' | 'success' | 'failed';
  runType: BacktestRunType;
  initialCash: number;
  finalEquity: number;
  totalReturnPct: number;
  metrics: BacktestMetrics;
  equityCurve: BacktestEquityPoint[];
  tradeCount: number;
  notes?: string[];
  error?: string;
  startedAt?: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
  completedAt?: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
}

export interface BacktestPermutationFull extends BacktestPermutationSummary {
  trades: BacktestTrade[];
}

export interface BacktestRun {
  runId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  symbols: string[];
  strategyId: string;
  runType: BacktestRunType;
  initialCash: number;
  reportTier: BacktestReportTier;
  totalPermutations: number;
  completedPermutations: number;
  failedPermutations: number;
  createdAt: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
  updatedAt: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
  startedAt?: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
  completedAt?: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
  error?: string;
}
```

`functions/src/types/partner.ts` (relevant excerpt):

```ts
export interface HistoricalOptionContract {
  contractID?: string;
  symbol?: string;
  expiration?: string;
  strike?: string;
  type?: OptionType;
  last?: string;
  mark?: string;
  bid?: string;
  bid_size?: string;
  ask?: string;
  ask_size?: string;
  volume?: string;
  open_interest?: string;
  date?: string;
  implied_volatility?: string;
  delta?: string;
  gamma?: string;
  theta?: string;
  vega?: string;
  rho?: string;
}

export interface PartnerHistoricalOptionsResponse {
  ok: boolean;
  symbol: string;
  date: string | null;
  source: string;
  endpoint: string;
  data: {
    endpoint?: string;
    message?: string;
    data: HistoricalOptionContract[];
  };
  analysis: {
    summary: HistoricalOptionsAnalysisSummary;
    expirations: HistoricalOptionsExpirationGroup[];
    strikes: HistoricalOptionsStrikeGroup[];
  };
  timestamp: string;
  processingTimeMs: number;
}
```

### Orchestrator enqueue logic

`functions/src/rh-agent-cloud-function/backtest/backtest-orchestrator.ts`:

```ts
const queue = getFunctions().taskQueue(BACKTEST_TASK_QUEUE);
let enqueued = 0;
let failed = 0;

for (let i = 0; i < symbols.length; i++) {
  const symbol = symbols[i];
  const permutationId = `${runId}_${symbol}_${i}`;

  const payload: BacktestPermutationPayload = {
    runId,
    permutationId,
    symbol,
    strategyId,
    config,
    runType,
    initialCash,
    reportTier,
  };

  try {
    await queue.enqueue(payload, {
      scheduleDelaySeconds: Math.floor(i * 0.5),
    });
    enqueued++;
  } catch (error: unknown) {
    failed++;
    logger.error('backtest_orchestrator_enqueue_error', { ... });
  }
}
```

### Worker dispatch and retry handling

`functions/src/rh-agent-cloud-function/backtest/backtest-worker.ts`:

```ts
export const rhAgentBacktestPermutation = onTaskDispatched<BacktestPermutationPayload>(
  {
    retryConfig: {
      maxAttempts: MAX_ATTEMPTS,
      minBackoffSeconds: 10,
      maxBackoffSeconds: 120,
    },
    rateLimits: {
      maxConcurrentDispatches: 10,
      maxDispatchesPerSecond: 5,
    },
    memory: '512MiB',
    timeoutSeconds: 300,
  },
  async (req) => {
    const { runId, permutationId, symbol, strategyId, config, runType, initialCash, reportTier } = req.data;
    const retryCount = (req as { retryCount?: number }).retryCount ?? 0;
    const isFinalAttempt = retryCount >= MAX_ATTEMPTS - 1;
    // ... load strategy, bars, run simulation, persist result
    catch (error: unknown) {
      if (isFinalAttempt) {
        await permRef.set({ status: BacktestPermutationStatus.FAILED, error: errorMessage, ... }, { merge: true });
        await runRef.set({ failedPermutations: FieldValue.increment(1), ... }, { merge: true });
      }
      throw error;
    }
  },
);
```

### Simulator entry and exit loop

`functions/src/rh-agent-cloud-function/backtest/backtest-simulator.ts` (simplified):

```ts
for (let i = minBars - 1; i < dailyBars.length; i++) {
  const today = dailyBars[i];
  const todayStr = today.date as string;
  const barsUpToToday = dailyBars.slice(0, i + 1);

  const outputs = strategy.execute({ symbol, marketDate: todayStr, bars: barsUpToToday }, config);
  const chain = await optionsCache.getChain(todayStr);

  // Evaluate exits first
  for (const position of openPositions) {
    const exitResult = evaluateExit(position, today, chain);
    if (exitResult.exit) {
      const closed = closePosition(symbol, strategy.metadata.id, config, position, today, exitResult.reason, exitResult.marks, chain);
      cash += closed.cashFlow;
      closedTrades.push(closed.trade);
    } else {
      // update lastMark
    }
  }

  // Evaluate entries
  for (const output of outputs) {
    if (!output.action) continue;
    if (maxConcurrentPositions > 0 && openPositions.length >= maxConcurrentPositions) continue;
    const entry = await tryEnterPosition(symbol, strategy.metadata.id, output, config, today, chain, tradeSequence, notes);
    if (entry) {
      tradeSequence++;
      cash -= entry.cashOutflow;
      openPositions.push(entry.position);
    }
  }

  equityCurve.push({ date: todayStr, cash, equity: cash + computeOpenPositionValue(openPositions, chain, notes), openPositions: openPositions.length });
}
```

### Option contract selection

`functions/src/rh-agent-cloud-function/strategies/option-contract-selection.ts`:

```ts
export function selectOptionContract(
  marketDate: string,
  contracts: HistoricalOptionContract[],
  criteria: OptionContractSelectionCriteria,
): SelectedOptionContract | null {
  const eligible: SelectedOptionContract[] = [];
  const fallback: SelectedOptionContract[] = [];

  for (const contract of contracts) {
    const inRange = evaluateContract(marketDate, contract, criteria, true);
    if (inRange) {
      eligible.push(inRange);
      continue;
    }
    const relaxed = evaluateContract(marketDate, contract, criteria, false);
    if (relaxed) fallback.push(relaxed);
  }

  const pool = eligible.length > 0 ? eligible : fallback;
  if (pool.length === 0) return null;
  pool.sort((a, b) => a.score - b.score);
  return pool[0];
}
```

### Metrics computation

`functions/src/rh-agent-cloud-function/backtest/backtest-metrics.ts`:

```ts
export function computeMetrics(
  initialCash: number,
  equityCurve: BacktestEquityPoint[],
  closedTrades: BacktestTrade[],
): BacktestMetrics {
  // win/loss aggregation
  // profit factor, percent profitable, win/loss ratio, average trade
  // max drawdown walk over equityCurve
  // sharpe = (mean daily return / stdDev) * sqrt(252)
  // calmar = totalReturn / (maxDrawdown / initialCash)
}
```

### Calling the partner historical options endpoint

`functions/src/partner-proxy.ts`:

```ts
export async function callPartnerHistoricalOptions(params: { symbol: string; date?: string }): Promise<PartnerHistoricalOptionsResponse> {
  const audience = PARTNER_HISTORICAL_OPTIONS_AUDIENCE;
  const idToken = await generateIdTokenWithEmail(audience, CALLER_SA);
  const search = new URLSearchParams();
  search.set('symbol', params.symbol);
  if (params.date) search.set('date', params.date);
  const url = `${PARTNER_HISTORICAL_OPTIONS_URL}?${search.toString()}`;
  const resp = await fetchWithRetry(url, { Authorization: `Bearer ${idToken}` });
  const text = await resp.text();
  if (!resp.ok) { throw new PartnerHttpError(...); }
  const parsed = JSON.parse(text) as PartnerHistoricalOptionsResponse;
  return parsed;
}
```

`generateIdTokenWithEmail` in the same file:

```ts
async function generateIdTokenWithEmail(audience: string, serviceAccountEmail: string): Promise<string> {
  const auth = new GoogleAuth({ scopes: [OAUTH_CLOUD_PLATFORM_SCOPE] });
  const accessToken = await auth.getAccessToken();
  const url = `${IAM_CREDENTIALS_BASE_URL}/${IAM_SERVICE_ACCOUNTS_PATH}/${encodeURIComponent(serviceAccountEmail)}:${IamCredentialsMethod.GENERATE_ID_TOKEN}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ audience, includeEmail: true }),
  });
  const data = (await resp.json()) as { token: string };
  return data.token;
}
```

### How to run it

From the repo root:

```powershell
# 1. Install dependencies
npm install
npm --prefix functions install

# 2. Type-check and build
npm --prefix functions run typecheck
npm --prefix functions run build

# 3. Run the local CLI smoke test (requires Firestore credentials)
npx tsx functions/scripts/backtest-qqq-underlying.ts --help

# 4. Run local emulators (Firestore + Functions)
npm --prefix functions run serve

# 5. Deploy to Firebase
firebase deploy --only functions
```

Example orchestrator call (after deployment):

```bash
curl -X POST https://us-central1-<project>.cloudfunctions.net/rhAgentBacktestStart \
  -H "Content-Type: application/json" \
  -d '{
    "symbols": ["SPY"],
    "strategyId": "leap-drop",
    "config": { "dropPct": 0.01, "targetGainPct": 1.0, "stopLossPct": 0.5, "maxHoldDays": 252 },
    "runType": "allData",
    "initialCash": 100000,
    "reportTier": "full"
  }'
```

The response contains `runId`, `enqueued`, `failed`, and `total`. Poll the `backtest-runs/{runId}` and `backtest-permutations/{runId}_{symbol}_{index}` documents in Firestore for progress and results.

### Reproduction checklist

1. Add `firebase-admin`, `firebase-functions`, and `google-auth-library` to the backend project.
2. Provide a Firestore `symbol-data/{symbol}/daily/{YYYY}` schema where each year document holds a `bars: [{d,o,h,l,c,v}]` array. Provide `symbol-data/{symbol}/weekly/all` and `monthly/all` if strategies need them.
3. Provide an allowlisted service account for the partner `partnerHistoricalOptionsV2` endpoint and set `PARTNER_CALLER_SA` / `DEFAULT_PARTNER_CALLER_SA`.
4. Implement a strategy adapter (`metadata + execute`) that returns `StrategyOutput` objects with `action`, `signalType`, `optionLegs` metadata, and `exit` metadata.
5. Register each adapter in a static registry loaded at startup.
6. Implement or reuse `selectOptionContract` / `selectOptionSpread` to choose contracts by delta/DTE/side.
7. Run the simulator as a daily bar replay: evaluate exits at today's mark before evaluating new entries.
8. Compute metrics from the equity curve and closed-trade list; use Calmar or another return-to-drawdown score as the objective.
9. Persist a `backtest-runs` job doc and one `backtest-permutations` result doc per symbol+strategy+config.
10. Wrap the simulator in a Cloud Task worker (`onTaskDispatched`) with bounded retry; wrap the job launcher in a callable (`onCall`).
11. Do not persist raw options chains locally; fetch on demand from the partner and cache only in memory for the task lifetime.

### Limitations and future work

- **Expanding-window walk-forward** is declared in the type contract but not yet implemented; the simulator currently runs `allData` for any `runType` value.
- **Parameter sweeps** are described in the config schema (`min`, `max`, `step`) but the orchestrator does not expand a grid; it uses the single `config` object supplied by the caller.
- **Commissions and slippage** are not modeled; P&L is based on the option `mark` field from the partner response.
- **Underlying data** is loaded as daily, weekly, and monthly bars; all three are passed to strategies in `StrategyInput`, though the proof-of-concept `leap-drop` strategy currently consumes only the daily bars.
- **Options data persistence** is intentionally absent per the ADR; SA will provide persistence in a later phase.
- **Capital model** uses whole-contract sizing with no per-trade dollar cap and no portfolio-wide max capital filter. Negative cash balances are allowed and reported.
- **Live automation** is explicitly out of scope for this phase and deferred until after backtesting selects proven strategies.

### Security notes from the current implementation

- The partner endpoint is called with a short-lived Google OIDC ID token that includes the service-account email (`includeEmail: true`).
- The ID token audience defaults to the partner function URL and can be overridden per environment.
- Partner calls retry only on clearly transient HTTP statuses (`429`, `500`, `502`, `503`, `504`).
- `backtest-runs` and `backtest-permutations` documents contain no Robinhood credentials, no raw partner API keys, and no user PII beyond the symbol list and strategy configuration supplied by the caller.
