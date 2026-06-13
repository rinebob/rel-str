import * as fs from "fs";
import * as path from "path";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { runRsiOversold, runMacdCrossover, getStrategy } from "./strategies.js";
import { runAgent } from "./agent.js";
import type { WatchedSymbol } from "./watchlist.js";

const LOG_FILE = path.join(process.cwd(), "scheduler.log");

// ---------- Logging ----------

function log(msg: string) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + "\n");
}

// ---------- Per-symbol tick ----------

async function tick(
  mcpClient: Client,
  watched: WatchedSymbol,
  dryRun: boolean
): Promise<void> {
  const { symbol, strategy, amount } = watched;
  log(`Checking ${symbol} — strategy: ${strategy}`);

  try {
    if (strategy === "rsi-oversold") {
      await runRsiOversold(mcpClient, symbol, amount, dryRun);
    } else if (strategy === "macd-crossover") {
      await runMacdCrossover(mcpClient, symbol, amount, dryRun);
    } else if (strategy === "dip-buy") {
      const builtIn = getStrategy("dip-buy");
      if (builtIn) {
        const prompt = builtIn.prompt.replace(/AAPL/g, symbol).replace(/\$100/g, `$${amount}`);
        await runAgent({ mcpClient, strategy: prompt, dryRun });
      }
    } else if (strategy === "custom" && watched.customPrompt) {
      await runAgent({ mcpClient, strategy: watched.customPrompt, dryRun });
    }
    log(`✓ ${symbol} done`);
  } catch (err) {
    log(`✗ ${symbol} error: ${err}`);
  }
}

// ---------- Scheduler ----------

interface SchedulerState {
  timers: Map<string, ReturnType<typeof setInterval>>;
  running: boolean;
}

const state: SchedulerState = {
  timers: new Map(),
  running: false,
};

export function startScheduler(
  mcpClient: Client,
  watchlist: WatchedSymbol[],
  dryRun: boolean
): void {
  if (state.running) {
    log("Scheduler already running.");
    return;
  }
  state.running = true;

  const enabled = watchlist.filter((w) => w.enabled);
  log(`Scheduler starting — ${enabled.length} symbols enabled, dryRun=${dryRun}`);
  log(`Log file: ${LOG_FILE}`);

  for (const watched of enabled) {
    log(`  ${watched.symbol}: ${watched.strategy} every ${watched.intervalMs / 1000}s`);

    // Run immediately on start
    tick(mcpClient, watched, dryRun);

    // Then on interval
    const timer = setInterval(() => {
      if (!state.running) return;
      tick(mcpClient, watched, dryRun);
    }, watched.intervalMs);

    state.timers.set(watched.symbol, timer);
  }

  // Graceful shutdown
  process.on("SIGINT", () => stopScheduler());
  process.on("SIGTERM", () => stopScheduler());
}

export function stopScheduler(): void {
  if (!state.running) return;
  state.running = false;
  for (const [symbol, timer] of state.timers) {
    clearInterval(timer);
    log(`Stopped timer for ${symbol}`);
  }
  state.timers.clear();
  log("Scheduler stopped.");
  process.exit(0);
}
