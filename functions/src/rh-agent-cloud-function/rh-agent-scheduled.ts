/**
 * RH Agent Scheduled Cloud Function
 *
 * Replaces the setInterval-based scheduler with a Firebase scheduled function.
 * Runs the trading agent on a schedule (default: every 15 minutes during market hours).
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
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
  updateStatus,
} from './rh-agent-firestore';
import { runAgent } from '../rh-agent/agent.js';
import { buildIndicatorSummary } from '../rh-agent/indicators.js';

const MCP_SERVER_URL = 'https://agent.robinhood.com/mcp/trading';

// Default watchlist for scheduled runs
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
    { name: 'rh-agent-cloud-function', version: '1.0.0' },
    { capabilities: {} }
  );

  await client.connect(transport);
  return client;
}

/**
 * Fetch historical closes from Robinhood MCP.
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
 * Execute a strategy for a symbol and record the result.
 */
async function executeStrategy(
  mcpClient: Client,
  runId: string,
  watched: RhWatchedSymbol,
  dryRun: boolean
): Promise<void> {
  const { symbol, strategy, amount } = watched;

  await logRunMessage(runId, `Processing ${symbol} with strategy: ${strategy}`);

  try {
    if (strategy === 'rsi-oversold') {
      await runRsiOversoldStrategy(mcpClient, runId, symbol, amount, dryRun);
    } else if (strategy === 'macd-crossover') {
      await runMacdCrossoverStrategy(mcpClient, runId, symbol, amount, dryRun);
    } else if (strategy === 'dip-buy') {
      await runDipBuyStrategy(mcpClient, runId, symbol, amount, dryRun);
    } else {
      // Generic strategy using agent
      await runGenericStrategy(mcpClient, runId, symbol, strategy, amount, dryRun);
    }

    await incrementSymbolsProcessed(runId);
    await logRunMessage(runId, `✓ ${symbol} completed`);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await recordRunError(runId, `${symbol}: ${errorMsg}`);
    await createSignal(
      runId,
      symbol,
      strategy,
      RhTradeAction.HOLD,
      RhSignalStatus.FAILED,
      `Strategy execution failed: ${errorMsg}`,
      dryRun,
      { error: errorMsg }
    );
  }
}

/**
 * RSI Oversold strategy implementation.
 */
async function runRsiOversoldStrategy(
  mcpClient: Client,
  runId: string,
  symbol: string,
  amount: number,
  dryRun: boolean
): Promise<void> {
  const closes = await fetchCloses(mcpClient, symbol, 50);
  const indicatorContext = buildIndicatorSummary(symbol, closes);

  const prompt = `
Based on the indicators below:
${indicatorContext}

- If RSI(14) is below 30 (oversold), place a market buy order for $${amount} of ${symbol}.
- If RSI(14) is between 30 and 40, place a limit order 1% below current price for $${amount} of ${symbol}.
- If RSI(14) is above 40, do not place any order. Explain why.
Always check current quote before placing any order.
  `.trim();

  // Run agent and capture result
  await runAgent({ mcpClient, strategy: prompt, dryRun });

  // Create signal record based on indicators
  const rsiMatch = indicatorContext.match(/RSI\(14\): ([\d.]+)/);
  const rsi = rsiMatch ? parseFloat(rsiMatch[1]) : null;

  if (rsi !== null && rsi < 30) {
    await createSignal(
      runId,
      symbol,
      'rsi-oversold',
      RhTradeAction.BUY,
      dryRun ? RhSignalStatus.DRY_RUN : RhSignalStatus.GENERATED,
      `RSI oversold (${rsi.toFixed(1)} < 30)`,
      dryRun,
      { amount, indicators: { rsi } }
    );
  } else if (rsi !== null && rsi < 40) {
    await createSignal(
      runId,
      symbol,
      'rsi-oversold',
      RhTradeAction.BUY,
      dryRun ? RhSignalStatus.DRY_RUN : RhSignalStatus.GENERATED,
      `RSI low (${rsi.toFixed(1)}), limit order recommended`,
      dryRun,
      { amount, orderType: 'LIMIT', indicators: { rsi } }
    );
  } else {
    await createSignal(
      runId,
      symbol,
      'rsi-oversold',
      RhTradeAction.HOLD,
      RhSignalStatus.GENERATED,
      `RSI not in buy zone (${rsi?.toFixed(1) ?? 'unknown'})`,
      dryRun,
      { indicators: rsi !== null ? { rsi } : undefined }
    );
  }
}

/**
 * MACD Crossover strategy implementation.
 */
async function runMacdCrossoverStrategy(
  mcpClient: Client,
  runId: string,
  symbol: string,
  amount: number,
  dryRun: boolean
): Promise<void> {
  const closes = await fetchCloses(mcpClient, symbol, 60);
  const indicatorContext = buildIndicatorSummary(symbol, closes);

  const prompt = `
Based on the indicators below:
${indicatorContext}

- If the MACD histogram is positive (bullish crossover), buy $${amount} of ${symbol} at market.
- If the MACD histogram is negative (bearish crossover), check if I hold ${symbol}. If I do, sell $${amount} worth at market.
- If the signal is ambiguous (histogram near zero, abs value < 0.01), do nothing and explain.
Always confirm current price before acting.
  `.trim();

  await runAgent({ mcpClient, strategy: prompt, dryRun });

  const macdMatch = indicatorContext.match(/MACD histogram: ([\d.-]+)/);
  const histogram = macdMatch ? parseFloat(macdMatch[1]) : null;

  if (histogram !== null && histogram > 0.01) {
    await createSignal(
      runId,
      symbol,
      'macd-crossover',
      RhTradeAction.BUY,
      dryRun ? RhSignalStatus.DRY_RUN : RhSignalStatus.GENERATED,
      `MACD bullish crossover (histogram: ${histogram.toFixed(4)})`,
      dryRun,
      { amount, indicators: { macdHistogram: histogram } }
    );
  } else if (histogram !== null && histogram < -0.01) {
    await createSignal(
      runId,
      symbol,
      'macd-crossover',
      RhTradeAction.SELL,
      dryRun ? RhSignalStatus.DRY_RUN : RhSignalStatus.GENERATED,
      `MACD bearish crossover (histogram: ${histogram.toFixed(4)})`,
      dryRun,
      { amount, indicators: { macdHistogram: histogram } }
    );
  } else {
    await createSignal(
      runId,
      symbol,
      'macd-crossover',
      RhTradeAction.HOLD,
      RhSignalStatus.GENERATED,
      `MACD signal ambiguous (histogram: ${histogram?.toFixed(4) ?? 'unknown'})`,
      dryRun,
      { indicators: histogram !== null ? { macdHistogram: histogram } : undefined }
    );
  }
}

/**
 * Dip Buy strategy implementation.
 */
async function runDipBuyStrategy(
  mcpClient: Client,
  runId: string,
  symbol: string,
  amount: number,
  dryRun: boolean
): Promise<void> {
  const prompt = `
Check if ${symbol} has dropped 2% or more today. If it has, buy $${amount} worth at market price. 
Report the current price, the daily change percentage, and what action you took.
  `.trim();

  await runAgent({ mcpClient, strategy: prompt, dryRun });

  // The agent would have placed the order if conditions met
  // We record this as a signal for tracking
  await createSignal(
    runId,
    symbol,
    'dip-buy',
    RhTradeAction.BUY,
    dryRun ? RhSignalStatus.DRY_RUN : RhSignalStatus.GENERATED,
    'Dip-buy strategy executed',
    dryRun,
    { amount }
  );
}

/**
 * Generic strategy using natural language prompt.
 */
async function runGenericStrategy(
  mcpClient: Client,
  runId: string,
  symbol: string,
  strategy: string,
  amount: number,
  dryRun: boolean
): Promise<void> {
  const strategies: Record<string, string> = {
    'portfolio-summary':
      'Check my portfolio: get my account balances, current positions, and buying power. Summarize what I hold and the current value.',
    rebalance:
      'Look at my current portfolio. Suggest (but do not execute) trades to rebalance to a 60/40 split between my two largest positions.',
    'watchlist-check':
      'Get my watchlist and fetch the current quote for each ticker. Show me which ones are up and which are down today.',
    'earnings-play':
      'Look at my current positions and check if any have earnings announcements in the next 7 days. Report which ones and their current P&L.',
  };

  const prompt = strategies[strategy] || strategy;
  await runAgent({ mcpClient, strategy: prompt, dryRun });

  await createSignal(
    runId,
    symbol,
    strategy,
    RhTradeAction.HOLD,
    RhSignalStatus.GENERATED,
    'Generic strategy executed',
    dryRun
  );
}

/**
 * Main scheduled function that runs the agent.
 *
 * Schedule: Every 15 minutes during market hours (9:30 AM - 4:00 PM ET, Mon-Fri)
 * Cron: Every 15 min, 1PM-8PM UTC (9AM-4PM ET), Mon-Fri
 */
export const rhAgentScheduled = onSchedule(
  {
    schedule: '*/15 13-20 * * 1-5', // Every 15 min, 1PM-8PM UTC (9AM-4PM ET), Mon-Fri
    timeZone: 'America/New_York',
    secrets: rhAgentSecrets,
  },
  async () => {
    logger.info('rh_agent_scheduled_start');

    // Validate secrets
    const secretsCheck = validateSecrets();
    if (!secretsCheck.valid) {
      logger.error('rh_agent_missing_secrets', { missing: secretsCheck.missing });
      throw new Error(`Missing secrets: ${secretsCheck.missing.join(', ')}`);
    }

    const { robinhoodAccessToken } = getRhAgentSecrets();

    // Create run record
    const watchlist = DEFAULT_WATCHLIST.filter((w) => w.enabled);
    const runId = await createRun('scheduled-batch', true, watchlist);

    let client: Client | undefined;
    try {
      // Connect to MCP
      client = await createMcpClient(robinhoodAccessToken);
      await logRunMessage(runId, 'Connected to Robinhood MCP');

      // Process each enabled symbol
      for (const watched of watchlist) {
        await executeStrategy(client, runId, watched, true); // Always dry-run in scheduled mode
      }

      // Complete successfully
      await completeRun(
        runId,
        RhAgentRunStatus.SUCCESS,
        `Processed ${watchlist.length} symbols`,
        [`[${new Date().toISOString()}] Scheduled run completed successfully`]
      );

      // Update run count
      await updateStatus({
        totalRuns: Date.now(), // Will be incremented via FieldValue in updateStatus
      });

      logger.info('rh_agent_scheduled_complete', { runId, symbols: watchlist.length });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error('rh_agent_scheduled_error', { error: errorMsg });

      await recordRunError(runId, `Fatal error: ${errorMsg}`);
      await completeRun(
        runId,
        RhAgentRunStatus.FAILED,
        `Failed: ${errorMsg}`,
        [`[${new Date().toISOString()}] Run failed: ${errorMsg}`]
      );

      throw err;
    } finally {
      await client?.close();
    }
  }
);
