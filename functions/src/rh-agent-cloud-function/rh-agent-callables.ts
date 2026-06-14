/**
 * RH Agent Callable Functions
 *
 * HTTP callable functions for manual agent trigger and status queries.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { rhAgentSecrets, validateSecrets, getRhAgentSecrets } from './rh-agent-secrets';
import {
  RhWatchedSymbol,
  RhAgentRunStatus,
  RhSignalStatus,
  RhTradeAction,
} from './rh-agent-config';
import {
  createRun,
  logRunMessage,
  recordRunError,
  incrementSymbolsProcessed,
  completeRun,
  createSignal,
  getStatus,
  getRecentRuns,
  getRecentSignals,
  getSignalsForRun,
} from './rh-agent-firestore';
import { runAgent } from '../rh-agent/agent.js';
import { buildIndicatorSummary } from '../rh-agent/indicators.js';

const MCP_SERVER_URL = 'https://agent.robinhood.com/mcp/trading';

/**
 * Request/response types for callables.
 */
interface ManualRunRequest {
  symbols?: string[]; // Optional: specific symbols to run, or all enabled
  strategy?: string; // Optional: specific strategy to run
  dryRun?: boolean; // Default: true
}

interface ManualRunResponse {
  runId: string;
  status: string;
  symbolsProcessed: number;
  signalsGenerated: number;
  message: string;
}

interface AgentStatusResponse {
  isEnabled: boolean;
  lastRunAt?: string;
  lastRunStatus?: string;
  totalRuns: number;
  totalSignalsGenerated: number;
  symbolsMonitored: string[];
  schedule: string;
}

interface RunHistoryResponse {
  runs: Array<{
    id: string;
    status: string;
    startedAt: string;
    completedAt?: string;
    strategy: string;
    symbolsProcessed: number;
    signalsGenerated: number;
    summary?: string;
  }>;
}

interface SignalHistoryResponse {
  signals: Array<{
    id: string;
    symbol: string;
    action: string;
    status: string;
    reason: string;
    createdAt: string;
    dryRun: boolean;
  }>;
}

// Default watchlist (same as scheduled function)
const DEFAULT_WATCHLIST: RhWatchedSymbol[] = [
  {
    symbol: 'AAPL',
    strategy: 'rsi-oversold',
    amount: 100,
    enabled: true,
    intervalMinutes: 15,
  },
  {
    symbol: 'NVDA',
    strategy: 'macd-crossover',
    amount: 200,
    enabled: true,
    intervalMinutes: 15,
  },
  {
    symbol: 'TSLA',
    strategy: 'dip-buy',
    amount: 150,
    enabled: false,
    intervalMinutes: 15,
  },
];

/**
 * Create MCP client using Firebase Secrets for OAuth.
 */
async function createMcpClient(accessToken: string): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(
    new URL(MCP_SERVER_URL),
    {
      requestInit: {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    }
  );

  const client = new Client(
    { name: 'rh-agent-callable', version: '1.0.0' },
    { capabilities: {} }
  );

  await client.connect(transport);
  return client;
}

/**
 * Manual trigger callable - run the agent on demand.
 */
export const rhAgentManualRun = onCall<ManualRunRequest, Promise<ManualRunResponse>>(
  {
    secrets: rhAgentSecrets,
    cors: true, // Allow from the Angular frontend
  },
  async (request) => {
    logger.info('rh_agent_manual_run_called', { auth: request.auth?.uid });

    // Validate secrets
    const secretsCheck = validateSecrets();
    if (!secretsCheck.valid) {
      logger.error('rh_agent_missing_secrets', { missing: secretsCheck.missing });
      throw new HttpsError('failed-precondition', `Missing secrets: ${secretsCheck.missing.join(', ')}`);
    }

    const { robinhoodAccessToken } = getRhAgentSecrets();
    const { symbols, strategy, dryRun = true } = request.data;

    // Filter watchlist based on request
    let watchlist = DEFAULT_WATCHLIST.filter((w) => w.enabled);
    if (symbols && symbols.length > 0) {
      watchlist = watchlist.filter((w) => symbols.includes(w.symbol));
    }
    if (watchlist.length === 0) {
      throw new HttpsError('invalid-argument', 'No symbols to process');
    }

    // Create run record
    const runId = await createRun(strategy || 'manual-run', dryRun, watchlist);

    let client: Client | undefined;
    try {
      // Connect to MCP
      client = await createMcpClient(robinhoodAccessToken);
      await logRunMessage(runId, 'Manual run started - Connected to Robinhood MCP');

      // Process each symbol with simple strategy execution
      for (const watched of watchlist) {
        await logRunMessage(runId, `Processing ${watched.symbol}`);

        try {
          // Fetch indicators for the symbol
          const closes = await fetchCloses(client, watched.symbol, 50);
          const indicatorContext = buildIndicatorSummary(watched.symbol, closes);

          // Build strategy prompt
          const prompt = buildStrategyPrompt(watched, indicatorContext);

          // Run agent
          await runAgent({ mcpClient: client, strategy: prompt, dryRun });

          // Record signal
          await createSignal(
            runId,
            watched.symbol,
            watched.strategy,
            RhTradeAction.HOLD,
            dryRun ? RhSignalStatus.DRY_RUN : RhSignalStatus.GENERATED,
            `Manual run: ${watched.strategy}`,
            dryRun
          );

          await incrementSymbolsProcessed(runId);
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          await recordRunError(runId, `${watched.symbol}: ${errorMsg}`);
        }
      }

      // Complete run
      await completeRun(
        runId,
        RhAgentRunStatus.SUCCESS,
        `Manual run completed: ${watchlist.length} symbols`,
        [`[${new Date().toISOString()}] Manual run completed`]
      );

      return {
        runId,
        status: 'SUCCESS',
        symbolsProcessed: watchlist.length,
        signalsGenerated: watchlist.length,
        message: `Successfully processed ${watchlist.length} symbols`,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error('rh_agent_manual_run_error', { error: errorMsg });

      await recordRunError(runId, `Fatal error: ${errorMsg}`);
      await completeRun(
        runId,
        RhAgentRunStatus.FAILED,
        `Failed: ${errorMsg}`,
        [`[${new Date().toISOString()}] Run failed: ${errorMsg}`]
      );

      throw new HttpsError('internal', errorMsg);
    } finally {
      await client?.close();
    }
  }
);

/**
 * Get agent status callable.
 */
export const rhAgentGetStatus = onCall<void, Promise<AgentStatusResponse>>(
  {
    cors: true,
  },
  async () => {
    const status = await getStatus();

    if (!status) {
      return {
        isEnabled: false,
        totalRuns: 0,
        totalSignalsGenerated: 0,
        symbolsMonitored: [],
        schedule: '*/15 13-20 * * 1-5',
      };
    }

    // Convert timestamps to ISO strings for JSON serialization
    const lastRunAt = status.lastRunAt
      ? typeof status.lastRunAt === 'object' && 'toDate' in status.lastRunAt
        ? (status.lastRunAt as { toDate(): Date }).toDate().toISOString()
        : new Date().toISOString()
      : undefined;

    return {
      isEnabled: status.isEnabled,
      lastRunAt,
      lastRunStatus: status.lastRunStatus,
      totalRuns: status.totalRuns,
      totalSignalsGenerated: status.totalSignalsGenerated,
      symbolsMonitored: status.symbolsMonitored,
      schedule: status.schedule || '*/15 13-20 * * 1-5',
    };
  }
);

/**
 * Get run history callable.
 */
export const rhAgentGetRunHistory = onCall<{ limit?: number }, Promise<RunHistoryResponse>>(
  {
    cors: true,
  },
  async (request) => {
    const limit = request.data.limit ?? 20;
    const runs = await getRecentRuns(limit);

    return {
      runs: runs.map((run) => ({
        id: run.id,
        status: run.status,
        startedAt: run.startedAt
          ? typeof run.startedAt === 'object' && 'toDate' in run.startedAt
            ? (run.startedAt as { toDate(): Date }).toDate().toISOString()
            : new Date().toISOString()
          : new Date().toISOString(),
        completedAt: run.completedAt
          ? typeof run.completedAt === 'object' && 'toDate' in run.completedAt
            ? (run.completedAt as { toDate(): Date }).toDate().toISOString()
            : undefined
          : undefined,
        strategy: run.strategy,
        symbolsProcessed: run.symbolsProcessed,
        signalsGenerated: run.signalsGenerated,
        summary: run.summary,
      })),
    };
  }
);

/**
 * Get signal history callable.
 */
export const rhAgentGetSignalHistory = onCall<{ limit?: number; runId?: string }, Promise<SignalHistoryResponse>>(
  {
    cors: true,
  },
  async (request) => {
    const { limit, runId } = request.data;

    let signals;
    if (runId) {
      signals = await getSignalsForRun(runId);
    } else {
      signals = await getRecentSignals(limit ?? 50);
    }

    return {
      signals: signals.map((s) => ({
        id: s.id,
        symbol: s.symbol,
        action: s.action,
        status: s.status,
        reason: s.reason,
        createdAt: s.createdAt
          ? typeof s.createdAt === 'object' && 'toDate' in s.createdAt
            ? (s.createdAt as { toDate(): Date }).toDate().toISOString()
            : new Date().toISOString()
          : new Date().toISOString(),
        dryRun: s.dryRun,
      })),
    };
  }
);

/**
 * Helper: Fetch historical closes from Robinhood MCP.
 */
async function fetchCloses(
  mcpClient: Client,
  symbol: string,
  days = 50
): Promise<number[]> {
  const result = await mcpClient.callTool({
    name: 'get_price_history',
    arguments: { symbol, interval: 'day', span: `${days}d` },
  });
  const content = result.content as Array<{ type: string; text?: string }>;
  const raw = JSON.parse(content.map((c) => c.text ?? '').join(''));
  const historicals: Array<{ close_price: string }> =
    raw.historicals ?? raw.results ?? raw;
  return historicals.map((h) => parseFloat(h.close_price));
}

/**
 * Helper: Build strategy prompt from watched symbol config.
 */
function buildStrategyPrompt(watched: RhWatchedSymbol, indicatorContext: string): string {
  const { symbol, strategy, amount } = watched;

  switch (strategy) {
    case 'rsi-oversold':
      return `
Based on the indicators below:
${indicatorContext}

- If RSI(14) is below 30 (oversold), place a market buy order for $${amount} of ${symbol}.
- If RSI(14) is between 30 and 40, place a limit order 1% below current price for $${amount} of ${symbol}.
- If RSI(14) is above 40, do not place any order. Explain why.
Always check current quote before placing any order.
      `.trim();

    case 'macd-crossover':
      return `
Based on the indicators below:
${indicatorContext}

- If the MACD histogram is positive (bullish crossover), buy $${amount} of ${symbol} at market.
- If the MACD histogram is negative (bearish crossover), check if I hold ${symbol}. If I do, sell $${amount} worth at market.
- If the signal is ambiguous (histogram near zero, abs value < 0.01), do nothing and explain.
Always confirm current price before acting.
      `.trim();

    case 'dip-buy':
      return `Check if ${symbol} has dropped 2% or more today. If it has, buy $${amount} worth at market price. Report the current price, the daily change percentage, and what action you took.`;

    case 'portfolio-summary':
      return 'Check my portfolio: get my account balances, current positions, and buying power. Summarize what I hold and the current value.';

    case 'rebalance':
      return 'Look at my current portfolio. Suggest (but do not execute) trades to rebalance to a 60/40 split between my two largest positions.';

    case 'watchlist-check':
      return 'Get my watchlist and fetch the current quote for each ticker. Show me which ones are up and which are down today.';

    case 'earnings-play':
      return 'Look at my current positions and check if any have earnings announcements in the next 7 days. Report which ones and their current P&L.';

    default:
      return `Execute strategy for ${symbol} with amount $${amount}: ${strategy}`;
  }
}
