import { buildIndicatorSummary } from "./indicators";
import type { Client } from "@modelcontextprotocol/sdk/client/index";
import { runAgent } from "./agent";

export interface Strategy {
  name: string;
  description: string;
  prompt: string;
}

export const strategies: Strategy[] = [
  {
    name: "portfolio-summary",
    description: "Summarize current portfolio value, positions, and buying power",
    prompt:
      "Check my portfolio: get my account balances, current positions, and buying power. Summarize what I hold and the current value.",
  },
  {
    name: "dip-buy",
    description: "Buy $X of a ticker if it dropped Y% today",
    prompt:
      "Check if AAPL has dropped 2% or more today. If it has, buy $100 worth at market price. Report the current price and what action you took.",
  },
  {
    name: "rebalance",
    description: "Rebalance portfolio to a target allocation",
    prompt:
      "Look at my current portfolio. Suggest (but do not execute) trades to rebalance to a 60/40 split between my two largest positions.",
  },
  {
    name: "watchlist-check",
    description: "Check prices for all tickers on my watchlist",
    prompt:
      "Get my watchlist and fetch the current quote for each ticker. Show me which ones are up and which are down today.",
  },
  {
    name: "earnings-play",
    description: "Check upcoming earnings and suggest positioning",
    prompt:
      "Look at my current positions and check if any have earnings announcements in the next 7 days. Report which ones and their current P&L.",
  },
];

export function getStrategy(name: string): Strategy | undefined {
  return strategies.find((s) => s.name === name);
}

export function listStrategies(): void {
  console.log("\nAvailable strategies:");
  for (const s of strategies) {
    console.log(`  ${s.name.padEnd(20)} ${s.description}`);
  }
  console.log(`  ${"rsi-oversold".padEnd(20)} Buy if RSI < 30 (oversold) using real price history`);
  console.log(`  ${"macd-crossover".padEnd(20)} Buy/sell signal based on MACD histogram crossover`);
  console.log();
}

// ---------- Indicator-driven strategy runner ----------
// Fetches historical closes from MCP, computes indicators in TypeScript,
// then passes the results as hard facts to the agent.

async function fetchCloses(mcpClient: Client, symbol: string, days = 50): Promise<number[]> {
  const result = await mcpClient.callTool({
    name: "get_price_history",
    arguments: { symbol, interval: "day", span: `${days}d` },
  });
  const content = result.content as Array<{ type: string; text?: string }>;
  const raw = JSON.parse(content.map((c) => c.text ?? "").join(""));
  // Robinhood returns historicals array with close_price field
  const historicals: Array<{ close_price: string }> = raw.historicals ?? raw.results ?? raw;
  return historicals.map((h) => parseFloat(h.close_price));
}

export async function runRsiOversold(
  mcpClient: Client,
  symbol: string,
  buyAmount: number,
  dryRun = false
): Promise<void> {
  console.log(`\nFetching 50-day price history for ${symbol}...`);
  const closes = await fetchCloses(mcpClient, symbol, 50);

  const indicatorContext = buildIndicatorSummary(symbol, closes);
  console.log(indicatorContext);

  const prompt = `
Based on the indicators above:
- If RSI(14) is below 30 (oversold), place a market buy order for $${buyAmount} of ${symbol}.
- If RSI(14) is between 30 and 40, place a limit order 1% below current price for $${buyAmount} of ${symbol}.
- If RSI(14) is above 40, do not place any order. Explain why.
Always check current quote before placing any order.
  `.trim();

  await runAgent({ mcpClient, strategy: prompt, indicatorContext, dryRun });
}

export async function runMacdCrossover(
  mcpClient: Client,
  symbol: string,
  tradeAmount: number,
  dryRun = false
): Promise<void> {
  console.log(`\nFetching 60-day price history for ${symbol}...`);
  const closes = await fetchCloses(mcpClient, symbol, 60);

  const indicatorContext = buildIndicatorSummary(symbol, closes);
  console.log(indicatorContext);

  const prompt = `
Based on the indicators above:
- If the MACD histogram is positive (bullish crossover), buy $${tradeAmount} of ${symbol} at market.
- If the MACD histogram is negative (bearish crossover), check if I hold ${symbol}. If I do, sell $${tradeAmount} worth at market.
- If the signal is ambiguous (histogram near zero, abs value < 0.01), do nothing and explain.
Always confirm current price before acting.
  `.trim();

  await runAgent({ mcpClient, strategy: prompt, indicatorContext, dryRun });
}
