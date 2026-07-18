# RH Agent Legacy Claude Bridge Source Archive

**Status:** Exact historical source transcript — do not execute
**Residual-source commit:** `6e4873324ee653e4d8a44210fdf1f55ae96780c3`
**Last hardened integrated commit:** `44b9ca3712774a3df8beddc6b3990449567286f0`
**Operating guide:** `docs/implementations/RH-AGENT-TRADE-BRIDGE-USAGE-2607-01_local-trade-execution-guide.md`

This document preserves two exact tracked snapshots: the residual source still present at the retirement baseline and the final integrated Order-page, persistence, deployment, and Firestore boundary before retirement. It is historical evidence, not an enabled fallback or operating instruction.

**Approved size exception:** The user explicitly required one unmodified copy-paste transcript so the working implementation can be recovered without reconstructing or refactoring it. The embedded source is intentionally not decomposed.

**Approved historical identifier exception:** The masked display suffix in the original source is intentionally retained. It is not an authentication credential or a complete account identifier.

## `functions/src/rh-agent/agent.ts`

```typescript
import Anthropic from "@anthropic-ai/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index";
import type { Tool } from "@anthropic-ai/sdk/resources/messages";

const MODEL = "claude-sonnet-4-5";
const MAX_ITERATIONS = 10;

const SYSTEM_PROMPT = `You are an autonomous trading agent connected to a Robinhood brokerage account via MCP tools.

Your responsibilities:
- Execute trading strategies accurately and safely
- Always check current prices and portfolio state before placing orders
- Confirm order details (symbol, quantity, price) before submitting
- Report clearly what actions you took and their outcomes
- If a strategy is ambiguous or risky, ask for clarification rather than guessing

When placing trades:
- Use limit orders when possible for better price control
- Never place an order without first checking the current quote
- Always report the order ID and status after submission

Be concise in your responses. Focus on actions and outcomes.`;

export interface AgentOptions {
  mcpClient: Client;
  strategy: string;
  dryRun?: boolean;
  indicatorContext?: string;
}

export async function runAgent(options: AgentOptions): Promise<void> {
  const { mcpClient, strategy, dryRun = false, indicatorContext } = options;

  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  // Fetch available MCP tools and convert to Anthropic tool format
  const { tools: mcpTools } = await mcpClient.listTools();

  if (mcpTools.length === 0) {
    throw new Error("No tools available from MCP server. Is it connected and authenticated?");
  }

  console.log(`\nLoaded ${mcpTools.length} MCP tools: ${mcpTools.map((t) => t.name).join(", ")}\n`);

  const anthropicTools: Tool[] = mcpTools.map((tool) => ({
    name: tool.name,
    description: tool.description ?? "",
    input_schema: (tool.inputSchema as Tool["input_schema"]) ?? { type: "object", properties: {} },
  }));

  const contextBlock = indicatorContext
    ? `The following technical indicators have been pre-computed from price history. Treat these as ground truth — do not recalculate them yourself:\n\n${indicatorContext}\n\n`
    : "";

  const userMessage = dryRun
    ? `[DRY RUN - do not place any real orders, just describe what you would do]\n\n${contextBlock}${strategy}`
    : `${contextBlock}${strategy}`;

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: userMessage },
  ];

  console.log(`Strategy: ${strategy}`);
  if (dryRun) console.log("Mode: DRY RUN (no real orders will be placed)\n");
  console.log("─".repeat(60));

  // Agentic loop
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: anthropicTools,
      messages,
    });

    // Print any text blocks
    for (const block of response.content) {
      if (block.type === "text" && block.text.trim()) {
        console.log(`\nAgent: ${block.text}`);
      }
    }

    // If no more tool calls, we're done
    if (response.stop_reason === "end_turn") {
      console.log("\n" + "─".repeat(60));
      console.log("Agent finished.");
      break;
    }

    // Collect tool use blocks
    const toolUseBlocks = response.content.filter((b) => b.type === "tool_use");
    if (toolUseBlocks.length === 0) break;

    // Add assistant message to history
    messages.push({ role: "assistant", content: response.content });

    // Execute each tool call via MCP
    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const block of toolUseBlocks) {
      if (block.type !== "tool_use") continue;

      console.log(`\n  → Calling tool: ${block.name}`);
      if (Object.keys(block.input as object).length > 0) {
        console.log(`    Input: ${JSON.stringify(block.input, null, 2)}`);
      }

      let resultContent: string;

      // In dry run mode, skip mutating tools
      const isMutatingTool = block.name.toLowerCase().includes("order") ||
        block.name.toLowerCase().includes("place") ||
        block.name.toLowerCase().includes("buy") ||
        block.name.toLowerCase().includes("sell") ||
        block.name.toLowerCase().includes("cancel");

      if (dryRun && isMutatingTool) {
        resultContent = JSON.stringify({ dry_run: true, message: "Order not placed (dry run mode)" });
        console.log(`    [DRY RUN] Skipped mutating tool: ${block.name}`);
      } else {
        try {
          const result = await mcpClient.callTool({
            name: block.name,
            arguments: block.input as Record<string, unknown>,
          });
          const content = result.content as Array<{ type: string; text?: string }>;
          resultContent = content.map((c) => (c.type === "text" ? c.text ?? "" : JSON.stringify(c))).join("\n");
          console.log(`    Result: ${resultContent.slice(0, 200)}${resultContent.length > 200 ? "..." : ""}`);
        } catch (err) {
          resultContent = JSON.stringify({ error: String(err) });
          console.log(`    Error: ${err}`);
        }
      }

      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: resultContent,
      });
    }

    // Add tool results back into the conversation
    messages.push({ role: "user", content: toolResults });
  }
}
```

## `functions/src/rh-agent/capture-oauth.ts`

```typescript
/**
 * One-time OAuth token capture script
 * Generates fresh OAuth URL and captures tokens
 */
import "dotenv/config";
import {
  auth,
  type OAuthClientProvider,
  type AuthResult,
} from "@modelcontextprotocol/sdk/client/auth";
import type {
  OAuthClientMetadata,
  OAuthClientInformationMixed,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import * as readline from "readline";

const MCP_SERVER_URL = "https://agent.robinhood.com/mcp/trading";
const TOKENS_FILE = path.join(process.cwd(), ".rh-tokens.json");

// Generate PKCE code verifier
function generateCodeVerifier(): string {
  const array = crypto.randomBytes(32);
  return base64UrlEncode(array);
}

function base64UrlEncode(buffer: Buffer): string {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

// ---------- OAuth provider ----------

class RobinhoodOAuthProvider implements OAuthClientProvider {
  private _tokens: OAuthTokens | undefined;
  private _clientInfo: OAuthClientInformationMixed | undefined;
  private _codeVerifier: string;

  constructor(codeVerifier: string) {
    this._codeVerifier = codeVerifier;
  }

  get redirectUrl() { 
    return "http://localhost:3456/callback"; 
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "rh-cloud-function",
      redirect_uris: ["http://localhost:3456/callback"],
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }

  clientInformation() { return this._clientInfo; }
  saveClientInformation(info: OAuthClientInformationMixed) { this._clientInfo = info; }

  tokens() { return this._tokens; }
  saveTokens(tokens: OAuthTokens) {
    this._tokens = tokens;
    fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2), "utf-8");
    console.log("\n✅ Tokens saved to:", TOKENS_FILE);
  }

  saveCodeVerifier(v: string) { this._codeVerifier = v; }
  codeVerifier() { return this._codeVerifier; }

  redirectToAuthorization(authorizationUrl: URL) {
    const url = authorizationUrl.toString();
    console.log("\n" + "=".repeat(60));
    console.log("ROBINHOOD OAUTH - MANUAL CAPTURE");
    console.log("=".repeat(60));
    console.log("\n1. Open this URL in your browser (use Incognito):");
    console.log("\n" + url + "\n");
    console.log("2. Log in to Robinhood and authorize");
    console.log("3. When it tries to redirect to localhost, COPY the 'code' from the URL");
    console.log("   Example: http://localhost:3456/callback?code=Abc123...");
    console.log("4. Paste the code below:\n");
    
    const urlFile = path.join(process.cwd(), "auth-url.txt");
    fs.writeFileSync(urlFile, url, "utf-8");
  }
}

// ---------- Main ----------

async function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (prompt: string): Promise<string> => {
    return new Promise((resolve) => {
      rl.question(prompt, (answer) => resolve(answer.trim()));
    });
  };

  try {
    // Generate fresh PKCE
    const codeVerifier = generateCodeVerifier();
    
    console.log("Generating fresh OAuth URL...\n");
    
    const provider = new RobinhoodOAuthProvider(codeVerifier);
    
    // Start auth flow (will output URL)
    const result: AuthResult = await auth(provider, { serverUrl: MCP_SERVER_URL });
    
    if (result === "REDIRECT") {
      // Wait for manual code entry
      const authCode = await ask("Enter the authorization code: ");
      
      if (!authCode) {
        console.log("❌ No code provided. Exiting.");
        process.exit(1);
      }
      
      console.log("\nExchanging code for tokens...");
      await auth(provider, { 
        serverUrl: MCP_SERVER_URL, 
        authorizationCode: authCode 
      });
      
      console.log("\n✅ SUCCESS! Tokens saved to .rh-tokens.json");
      console.log("\nNext steps:");
      console.log("1. Store in Firebase Secrets:");
      console.log("   firebase functions:secrets:set ROBINHOOD_TOKENS < .rh-tokens.json");
      console.log("2. Deploy cloud functions:");
      console.log("   firebase deploy --only functions:rhExecuteTrade,rhGetAccountSummary");
    }
    
    rl.close();
  } catch (err) {
    console.error("\n❌ Error:", err);
    rl.close();
    process.exit(1);
  }
}

main();
```

## `functions/src/rh-agent/index.ts`

```typescript
import "dotenv/config";
import { Client } from "@modelcontextprotocol/sdk/client/index";
import {
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/sdk/client/streamableHttp";
import {
  auth,
  type OAuthClientProvider,
  type AuthResult,
} from "@modelcontextprotocol/sdk/client/auth";
import type {
  OAuthClientMetadata,
  OAuthClientInformationMixed,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth";
import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import { exec } from "child_process";
import { runAgent } from "./agent";
import { listStrategies, getStrategy, runRsiOversold, runMacdCrossover } from "./strategies";
import { startScheduler } from "./scheduler";
import { watchlist } from "./watchlist";

const MCP_SERVER_URL = "https://agent.robinhood.com/mcp/trading";
const REDIRECT_PORT = 3456;
const REDIRECT_URL = `http://localhost:${REDIRECT_PORT}/callback`;
const TOKENS_FILE = path.join(process.cwd(), ".rh-tokens.json");

// ---------- Persist tokens to disk ----------

function loadTokens(): OAuthTokens | undefined {
  try {
    if (fs.existsSync(TOKENS_FILE)) {
      return JSON.parse(fs.readFileSync(TOKENS_FILE, "utf-8")) as OAuthTokens;
    }
  } catch {}
  return undefined;
}

function saveTokens(tokens: OAuthTokens) {
  fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2), "utf-8");
}

// ---------- OAuth provider ----------

class RobinhoodOAuthProvider implements OAuthClientProvider {
  private _tokens: OAuthTokens | undefined = loadTokens();
  private _clientInfo: OAuthClientInformationMixed | undefined;
  private _codeVerifier = "";

  get redirectUrl() { return REDIRECT_URL; }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "rh-ai-mcp-client",
      redirect_uris: [REDIRECT_URL],
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }

  clientInformation() { return this._clientInfo; }
  saveClientInformation(info: OAuthClientInformationMixed) { this._clientInfo = info; }

  tokens() { return this._tokens; }
  saveTokens(tokens: OAuthTokens) {
    this._tokens = tokens;
    saveTokens(tokens);
    console.log("Tokens saved to", TOKENS_FILE);
  }

  saveCodeVerifier(v: string) { this._codeVerifier = v; }
  codeVerifier() { return this._codeVerifier; }

  redirectToAuthorization(authorizationUrl: URL) {
    const url = authorizationUrl.toString();
    const urlFile = path.join(process.cwd(), "auth-url.txt");
    fs.writeFileSync(urlFile, url, "utf-8");
    console.log("\n=== ROBINHOOD LOGIN REQUIRED ===");
    console.log("URL written to:", urlFile);
    console.log("Open this URL in a browser (use Incognito/InPrivate if redirected to dashboard):");
    console.log("\n" + url + "\n");
    // Open browser cross-platform
    const cmd = process.platform === "win32"
      ? `start "" "${url}"`
      : process.platform === "darwin"
        ? `open "${url}"`
        : `xdg-open "${url}"`;
    exec(cmd);
  }
}

// ---------- Local callback server ----------

function waitForAuthCode(): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const urlObj = new URL(req.url ?? "/", `http://localhost:${REDIRECT_PORT}`);
      if (urlObj.pathname === "/callback") {
        const code = urlObj.searchParams.get("code");
        const error = urlObj.searchParams.get("error");

        res.writeHead(200, { "Content-Type": "text/html" });
        if (code) {
          res.end("<h2>Authenticated! You can close this tab.</h2>");
          server.close();
          resolve(code);
        } else {
          res.end(`<h2>Auth error: ${error ?? "unknown"}</h2>`);
          server.close();
          reject(new Error(`OAuth error: ${error}`));
        }
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    server.listen(REDIRECT_PORT, () => {
      console.log(`Waiting for OAuth callback on http://localhost:${REDIRECT_PORT}/callback ...`);
    });

    server.on("error", reject);
  });
}

// ---------- MCP client factory ----------

async function connectMCPClient(): Promise<Client> {
  const provider = new RobinhoodOAuthProvider();

  if (!provider.tokens()) {
    console.log("No saved tokens. Starting OAuth flow...");
    const codePromise = waitForAuthCode();
    const result: AuthResult = await auth(provider, { serverUrl: MCP_SERVER_URL });
    if (result === "REDIRECT") {
      const code = await codePromise;
      console.log("Got authorization code, exchanging for tokens...");
      await auth(provider, { serverUrl: MCP_SERVER_URL, authorizationCode: code });
    }
  } else {
    console.log("Using saved tokens.");
  }

  const tokens = provider.tokens()!;
  const transport = new StreamableHTTPClientTransport(
    new URL(MCP_SERVER_URL),
    { requestInit: { headers: { Authorization: `Bearer ${tokens.access_token}` } } }
  );

  const client = new Client(
    { name: "rh-ai-mcp-client", version: "1.0.0" },
    { capabilities: {} }
  );

  console.log(`Connecting to ${MCP_SERVER_URL} ...`);
  await client.connect(transport);
  console.log("Connected.\n");
  return client;
}

// ---------- Main CLI ----------

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  // Show help
  if (!command || command === "--help" || command === "-h") {
    console.log(`
Robinhood AI Trading Agent

Usage:
  npx tsx src/index.ts <command> [options]

Commands:
  tools                    List all available MCP tools from Robinhood
  strategies               List built-in trading strategies
  run <strategy-name>      Run a named strategy once
  run --dry <strategy>     Run a strategy in dry-run mode (no real orders)
  ask "<prompt>"           Run the agent with a custom natural language prompt
  ask --dry "<prompt>"     Dry-run a custom prompt
  watch                    Start the scheduler — monitors all enabled symbols continuously
  watch --dry              Start scheduler in dry-run mode (no real orders)
`);
    listStrategies();
    return;
  }

  if (command === "strategies") {
    listStrategies();
    return;
  }

  // Commands that need MCP connection
  let client: Client | undefined;
  try {
    client = await connectMCPClient();

    if (command === "watch") {
      const dryRun = args[1] === "--dry";
      // startScheduler keeps the process alive via setInterval — don't close client
      startScheduler(client, watchlist, dryRun);
      return; // intentionally skip finally client.close()
    } else if (command === "tools") {
      const { tools } = await client.listTools();
      console.log(`=== Available MCP Tools (${tools.length}) ===\n`);
      for (const tool of tools) {
        console.log(`[${tool.name}]`);
        if (tool.description) console.log(`  ${tool.description}`);
        if (tool.inputSchema) console.log(`  Schema: ${JSON.stringify(tool.inputSchema, null, 2)}`);
        console.log();
      }
    } else if (command === "run") {
      const dryRun = args[1] === "--dry";
      const strategyName = dryRun ? args[2] : args[1];
      if (!strategyName) {
        console.error("Usage: run [--dry] <strategy-name>");
        listStrategies();
        process.exit(1);
      }
      if (strategyName === "rsi-oversold") {
        const symbol = args[dryRun ? 3 : 2] ?? "AAPL";
        const amount = parseFloat(args[dryRun ? 4 : 3] ?? "100");
        await runRsiOversold(client, symbol, amount, dryRun);
      } else if (strategyName === "macd-crossover") {
        const symbol = args[dryRun ? 3 : 2] ?? "AAPL";
        const amount = parseFloat(args[dryRun ? 4 : 3] ?? "100");
        await runMacdCrossover(client, symbol, amount, dryRun);
      } else {
        const strategy = getStrategy(strategyName);
        if (!strategy) {
          console.error(`Unknown strategy: "${strategyName}"`);
          listStrategies();
          process.exit(1);
        }
        await runAgent({ mcpClient: client, strategy: strategy.prompt, dryRun });
      }
    } else if (command === "ask") {
      const dryRun = args[1] === "--dry";
      const prompt = dryRun ? args.slice(2).join(" ") : args.slice(1).join(" ");
      if (!prompt) {
        console.error('Usage: ask [--dry] "<your prompt>"');
        process.exit(1);
      }
      await runAgent({ mcpClient: client, strategy: prompt, dryRun });
    } else {
      console.error(`Unknown command: "${command}". Run with --help for usage.`);
      process.exit(1);
    }
  } catch (err) {
    console.error("Error:", err);
    process.exit(1);
  } finally {
    await client?.close();
  }
}

main();
```

## `functions/src/rh-agent/indicators.ts`

```typescript
export interface OHLCV {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: number;
}

export interface Quote {
  symbol: string;
  price: number;
  open: number;
  high: number;
  low: number;
  previousClose: number;
  volume: number;
}

// ---------- Basic price stats ----------

export function pctChange(current: number, reference: number): number {
  return ((current - reference) / reference) * 100;
}

export function dollarChange(current: number, reference: number): number {
  return current - reference;
}

// ---------- Moving averages ----------

export function sma(prices: number[], period: number): number | null {
  if (prices.length < period) return null;
  const slice = prices.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

export function ema(prices: number[], period: number): number | null {
  if (prices.length < period) return null;
  const k = 2 / (period + 1);
  let emaVal = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < prices.length; i++) {
    emaVal = prices[i] * k + emaVal * (1 - k);
  }
  return emaVal;
}

// ---------- RSI ----------

export function rsi(prices: number[], period = 14): number | null {
  if (prices.length < period + 1) return null;
  const changes = prices.slice(1).map((p, i) => p - prices[i]);
  const gains = changes.map((c) => (c > 0 ? c : 0));
  const losses = changes.map((c) => (c < 0 ? -c : 0));

  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;

  for (let i = period; i < changes.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

// ---------- Bollinger Bands ----------

export interface BollingerBands {
  upper: number;
  middle: number;
  lower: number;
  bandwidth: number;
  percentB: number;
}

export function bollingerBands(
  prices: number[],
  period = 20,
  stdDevMultiplier = 2
): BollingerBands | null {
  if (prices.length < period) return null;
  const slice = prices.slice(-period);
  const middle = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((a, b) => a + Math.pow(b - middle, 2), 0) / period;
  const stdDev = Math.sqrt(variance);
  const upper = middle + stdDevMultiplier * stdDev;
  const lower = middle - stdDevMultiplier * stdDev;
  const currentPrice = prices[prices.length - 1];
  return {
    upper,
    middle,
    lower,
    bandwidth: (upper - lower) / middle,
    percentB: (currentPrice - lower) / (upper - lower),
  };
}

// ---------- MACD ----------

export interface MACDResult {
  macd: number;
  signal: number;
  histogram: number;
}

export function macd(
  prices: number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9
): MACDResult | null {
  if (prices.length < slowPeriod + signalPeriod) return null;
  const fastEMA = ema(prices, fastPeriod);
  const slowEMA = ema(prices, slowPeriod);
  if (fastEMA === null || slowEMA === null) return null;

  const macdLine = fastEMA - slowEMA;

  // Build MACD line history for signal calculation
  const macdHistory: number[] = [];
  for (let i = slowPeriod - 1; i < prices.length; i++) {
    const f = ema(prices.slice(0, i + 1), fastPeriod);
    const s = ema(prices.slice(0, i + 1), slowPeriod);
    if (f !== null && s !== null) macdHistory.push(f - s);
  }

  const signalLine = ema(macdHistory, signalPeriod);
  if (signalLine === null) return null;

  return {
    macd: macdLine,
    signal: signalLine,
    histogram: macdLine - signalLine,
  };
}

// ---------- ATR (volatility) ----------

export function atr(candles: OHLCV[], period = 14): number | null {
  if (candles.length < period + 1) return null;
  const trueRanges = candles.slice(1).map((c, i) => {
    const prev = candles[i];
    return Math.max(
      c.high - c.low,
      Math.abs(c.high - prev.close),
      Math.abs(c.low - prev.close)
    );
  });
  return trueRanges.slice(-period).reduce((a, b) => a + b, 0) / period;
}

// ---------- Summary builder ----------
// Converts raw price data into a facts string for the agent prompt

export function buildIndicatorSummary(symbol: string, closes: number[], quote?: Quote): string {
  const lines: string[] = [`=== ${symbol} Indicator Summary ===`];

  if (quote) {
    const dayChange = pctChange(quote.price, quote.previousClose);
    lines.push(`Current price: $${quote.price.toFixed(2)}`);
    lines.push(`Day change: ${dayChange >= 0 ? "+" : ""}${dayChange.toFixed(2)}% ($${dollarChange(quote.price, quote.previousClose).toFixed(2)})`);
    lines.push(`Day range: $${quote.low.toFixed(2)} – $${quote.high.toFixed(2)}`);
  }

  if (closes.length >= 20) {
    const sma20 = sma(closes, 20);
    const sma50 = sma(closes, 50);
    const sma200 = sma(closes, 200);
    if (sma20) lines.push(`SMA(20): $${sma20.toFixed(2)}`);
    if (sma50) lines.push(`SMA(50): $${sma50.toFixed(2)}`);
    if (sma200) lines.push(`SMA(200): $${sma200.toFixed(2)}`);
  }

  if (closes.length >= 15) {
    const rsiVal = rsi(closes);
    if (rsiVal !== null) {
      const rsiLabel = rsiVal > 70 ? " (OVERBOUGHT)" : rsiVal < 30 ? " (OVERSOLD)" : "";
      lines.push(`RSI(14): ${rsiVal.toFixed(1)}${rsiLabel}`);
    }
  }

  if (closes.length >= 20) {
    const bb = bollingerBands(closes);
    if (bb) {
      lines.push(`Bollinger Bands: $${bb.lower.toFixed(2)} / $${bb.middle.toFixed(2)} / $${bb.upper.toFixed(2)} (%B: ${(bb.percentB * 100).toFixed(1)}%)`);
    }
  }

  if (closes.length >= 35) {
    const macdResult = macd(closes);
    if (macdResult) {
      const crossLabel = macdResult.histogram > 0 ? " (bullish)" : " (bearish)";
      lines.push(`MACD histogram: ${macdResult.histogram.toFixed(4)}${crossLabel}`);
    }
  }

  return lines.join("\n");
}
```

## `functions/src/rh-agent/scheduler.ts`

```typescript
import * as fs from "fs";
import * as path from "path";
import type { Client } from "@modelcontextprotocol/sdk/client/index";
import { runRsiOversold, runMacdCrossover, getStrategy } from "./strategies";
import { runAgent } from "./agent";
import type { WatchedSymbol } from "./watchlist";

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
```

## `functions/src/rh-agent/strategies.ts`

```typescript
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
```

## `functions/src/rh-agent/trade-bridge-security.ts`

```typescript
import { timingSafeEqual } from "crypto";

export const TRADE_BRIDGE_TOKEN_HEADER = "x-trade-bridge-token";
export const TRADE_BRIDGE_MAX_BODY_BYTES = 16_384;
export const TRADE_BRIDGE_MAX_BATCH_SIZE = 20;
export const TRADE_BRIDGE_MIN_TRADE_AMOUNT = 1;
export const TRADE_BRIDGE_MAX_TRADE_AMOUNT = 100;

export interface TradeRequest {
  symbol: string;
  side: "buy" | "sell";
  amount: number;
  orderType?: "market" | "limit";
  limitPrice?: number;
}

export class TradeBridgeRequestError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export function isAllowedOrigin(origin: string | undefined, allowedOrigins: readonly string[]): origin is string {
  return typeof origin === "string" && allowedOrigins.includes(origin);
}

export function isValidBridgeToken(providedToken: string | undefined, expectedToken: string): boolean {
  if (!providedToken || !expectedToken) return false;
  const provided = Buffer.from(providedToken);
  const expected = Buffer.from(expectedToken);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

export function assertBodySize(byteLength: number): void {
  if (byteLength > TRADE_BRIDGE_MAX_BODY_BYTES) {
    throw new TradeBridgeRequestError(413, "Request body is too large");
  }
}

export function isJsonContentType(contentType: string | undefined): boolean {
  return contentType?.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}

export class TradeBridgeExecutionGate {
  private active = false;

  tryAcquire(): boolean {
    if (this.active) return false;
    this.active = true;
    return true;
  }

  release(): void {
    this.active = false;
  }

  isActive(): boolean {
    return this.active;
  }
}

export function parseTradeRequest(body: string): TradeRequest[] {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    throw new TradeBridgeRequestError(400, "Request body must be valid JSON");
  }

  if (!isRecord(value)) {
    throw new TradeBridgeRequestError(400, "Request body must be a JSON object");
  }

  const isBatch = "trades" in value;
  if (isBatch) {
    const unsupportedField = Object.keys(value).find((field) => field !== "trades");
    if (unsupportedField) {
      throw new TradeBridgeRequestError(400, `Batch request has unsupported field: ${unsupportedField}`);
    }
  }

  const tradesValue = isBatch ? value["trades"] : [value];
  if (!Array.isArray(tradesValue) || tradesValue.length === 0) {
    throw new TradeBridgeRequestError(400, "At least one trade is required");
  }
  if (tradesValue.length > TRADE_BRIDGE_MAX_BATCH_SIZE) {
    throw new TradeBridgeRequestError(400, `A batch cannot exceed ${TRADE_BRIDGE_MAX_BATCH_SIZE} trades`);
  }

  const trades = tradesValue.map((trade, index) => parseTrade(trade, index));
  const symbols = new Set<string>();
  for (const trade of trades) {
    if (symbols.has(trade.symbol)) {
      throw new TradeBridgeRequestError(400, `Duplicate trade symbol in batch: ${trade.symbol}`);
    }
    symbols.add(trade.symbol);
  }
  return trades;
}

function parseTrade(value: unknown, index: number): TradeRequest {
  if (!isRecord(value)) {
    throw new TradeBridgeRequestError(400, `Trade ${index + 1} must be a JSON object`);
  }

  const allowedFields = new Set(["symbol", "side", "amount", "orderType", "limitPrice"]);
  const unsupportedField = Object.keys(value).find((field) => !allowedFields.has(field));
  if (unsupportedField) {
    throw new TradeBridgeRequestError(400, `Trade ${index + 1} has unsupported field: ${unsupportedField}`);
  }

  const symbol = typeof value["symbol"] === "string" ? value["symbol"].trim().toUpperCase() : "";
  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol)) {
    throw new TradeBridgeRequestError(400, `Trade ${index + 1} has an invalid symbol`);
  }

  const side = value["side"];
  if (side !== "buy" && side !== "sell") {
    throw new TradeBridgeRequestError(400, `Trade ${index + 1} side must be buy or sell`);
  }

  const amount = value["amount"];
  if (
    typeof amount !== "number" ||
    !Number.isFinite(amount) ||
    amount < TRADE_BRIDGE_MIN_TRADE_AMOUNT ||
    amount > TRADE_BRIDGE_MAX_TRADE_AMOUNT
  ) {
    throw new TradeBridgeRequestError(
      400,
      `Trade ${index + 1} amount must be between ${TRADE_BRIDGE_MIN_TRADE_AMOUNT} and ${TRADE_BRIDGE_MAX_TRADE_AMOUNT}`,
    );
  }

  const orderTypeValue = value["orderType"] ?? "market";
  if (orderTypeValue !== "market" && orderTypeValue !== "limit") {
    throw new TradeBridgeRequestError(400, `Trade ${index + 1} orderType must be market or limit`);
  }

  const limitPriceValue = value["limitPrice"];
  if (orderTypeValue === "limit") {
    if (typeof limitPriceValue !== "number" || !Number.isFinite(limitPriceValue) || limitPriceValue <= 0) {
      throw new TradeBridgeRequestError(400, `Trade ${index + 1} requires a positive limitPrice`);
    }
  } else if (limitPriceValue !== undefined) {
    throw new TradeBridgeRequestError(400, `Trade ${index + 1} cannot set limitPrice for a market order`);
  }

  return {
    symbol,
    side,
    amount,
    orderType: orderTypeValue,
    ...(typeof limitPriceValue === "number" ? { limitPrice: limitPriceValue } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
```

## `functions/src/rh-agent/trade-bridge-server.ts`

```typescript
/**
 * Trade Bridge Server
 * 
 * Local HTTP server that accepts trade requests from Angular
 * and forwards them to Claude Code for execution via MCP.
 * 
 * This is a temporary solution until Robinhood provides direct API access.
 * 
 * Run: npx tsx src/rh-agent/trade-bridge-server.ts
 */
import * as http from "http";
import { exec } from "child_process";
import { randomBytes } from "crypto";
import * as path from "path";
import { pathToFileURL } from "url";
import { RH_AGENT_ALLOWED_ORIGINS } from "../rh-agent-cloud-function/rh-agent-cors";
import {
  TRADE_BRIDGE_TOKEN_HEADER,
  TradeBridgeExecutionGate,
  TradeBridgeRequestError,
  TradeRequest,
  assertBodySize,
  isAllowedOrigin,
  isJsonContentType,
  isValidBridgeToken,
  parseTradeRequest,
} from "./trade-bridge-security";

export const TRADE_BRIDGE_HOST = "127.0.0.1";
export const TRADE_BRIDGE_PORT = 3001;
const CLAUDE_CMD = "claude";

export interface ParsedOrderResult {
  confirmed: boolean;
  orderId?: string;
  state?: string;
  estimatedShares?: number;
  raw: string;
  error?: string;
}

export interface TradeExecutionResult {
  trade: TradeRequest;
  output: string;
  parsed: ParsedOrderResult;
}

export interface TradeBridgeServerOptions {
  expectedToken: string;
  allowedOrigins: readonly string[];
  executeTrade: (trade: TradeRequest) => Promise<TradeExecutionResult>;
  now?: () => Date;
}

// CORS headers
function responseHeaders(
  origin: string | undefined,
  allowedOrigins: readonly string[],
  allowPrivateNetwork = false,
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Vary": "Origin, Access-Control-Request-Private-Network",
  };
  if (isAllowedOrigin(origin, allowedOrigins)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = `Content-Type, ${TRADE_BRIDGE_TOKEN_HEADER}`;
    if (allowPrivateNetwork) {
      headers["Access-Control-Allow-Private-Network"] = "true";
    }
  }
  return headers;
}

function sendJson(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  statusCode: number,
  payload: unknown,
  allowedOrigins: readonly string[],
): void {
  const origin = typeof req.headers.origin === "string" ? req.headers.origin : undefined;
  res.writeHead(statusCode, responseHeaders(origin, allowedOrigins));
  res.end(JSON.stringify(payload));
}

async function readRequestBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let byteLength = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    byteLength += buffer.length;
    assertBodySize(byteLength);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

// Execute trade via Claude Code
async function executeViaClaude(trade: TradeRequest): Promise<string> {
  const prompt = `Execute this trade in my Agentic account (••••6245):
- Symbol: ${trade.symbol.toUpperCase()}
- Side: ${trade.side}
- Amount: $${trade.amount}
- Type: ${trade.orderType || "market"}
${trade.limitPrice ? `- Limit Price: $${trade.limitPrice}` : ""}

The user clicked Execute via Bridge, which is final authorization to place this order immediately. Do not ask for additional permission or confirmation.
Use the robinhood-trading MCP tools get_accounts, review_equity_order, and place_equity_order. Return only a JSON object with orderId, state, and estimatedShares. Do not report success unless place_equity_order returns an order ID and state.`;

  return new Promise((resolve, reject) => {
    // Run claude with the prompt
    const allowedTools = [
      "mcp__robinhood-trading__get_accounts",
      "mcp__robinhood-trading__review_equity_order",
      "mcp__robinhood-trading__place_equity_order",
    ].join(",");
    const cmd = `${CLAUDE_CMD} --print --permission-mode dontAsk --allowedTools "${allowedTools}"`;
    
    const child = exec(cmd, { timeout: 60000 }, (error, stdout, stderr) => {
      if (error) {
        const details = stderr.trim() || stdout.trim() || error.message;
        reject(new Error(`Claude execution failed: ${details}`));
        return;
      }

      resolve(stdout);
    });

    child.stdin?.end(prompt);

  });
}

// Parse Claude's response to extract order details
function parseOrderResult(output: string): ParsedOrderResult {
  // Try to find JSON in the output
  const jsonMatch = output.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const data = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
      const orderId = data["orderId"] ?? data["order_id"] ?? data["id"];
      const state = data["state"] ?? data["status"];
      const estimatedShares = data["estimatedShares"] ?? data["estimated_shares"];
      return {
        raw: output,
        orderId: typeof orderId === "string" ? orderId : undefined,
        state: typeof state === "string" ? state : undefined,
        estimatedShares: typeof estimatedShares === "number" ? estimatedShares : undefined,
        confirmed: typeof orderId === "string" && orderId.length > 0 && typeof state === "string" && state.length > 0,
      };
    } catch {
      // Not valid JSON, return raw
    }
  }

  // Extract order ID if present
  const orderIdMatch = output.match(/order[_\s]?id["']?\s*[:=]\s*["']?([a-z0-9-]+)/i);
  const stateMatch = output.match(/state["']?\s*[:=]\s*["']?([a-z_]+)/i);
  const orderId = orderIdMatch?.[1];
  const state = stateMatch?.[1];
  
  return {
    raw: output,
    orderId,
    state,
    confirmed: !!orderId && !!state,
  };
}

async function executeTradeViaClaude(trade: TradeRequest): Promise<TradeExecutionResult> {
  try {
    const output = await executeViaClaude(trade);
    return { trade, output, parsed: parseOrderResult(output) };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      trade,
      output: "",
      parsed: { confirmed: false, raw: "", error: message },
    };
  }
}

// HTTP server
export function createTradeBridgeServer(options: TradeBridgeServerOptions): http.Server {
  const executionGate = new TradeBridgeExecutionGate();
  const now = options.now ?? (() => new Date());

  return http.createServer(async (req, res) => {
    const origin = typeof req.headers.origin === "string" ? req.headers.origin : undefined;

    if (req.method === "OPTIONS") {
      if (!isAllowedOrigin(origin, options.allowedOrigins)) {
        sendJson(req, res, 403, { error: "Origin is not allowed" }, options.allowedOrigins);
        return;
      }
      const allowPrivateNetwork = req.headers["access-control-request-private-network"] === "true";
      res.writeHead(204, responseHeaders(origin, options.allowedOrigins, allowPrivateNetwork));
      res.end();
      return;
    }

    if (req.method === "GET" && req.url === "/health") {
      sendJson(req, res, 200, {
        status: "ok",
        acceptingTrades: !executionGate.isActive(),
        timestamp: now().toISOString(),
      }, options.allowedOrigins);
      return;
    }

    if (req.method !== "POST" || req.url !== "/trade") {
      sendJson(req, res, 404, { error: "Not found" }, options.allowedOrigins);
      return;
    }

    if (!isAllowedOrigin(origin, options.allowedOrigins)) {
      sendJson(req, res, 403, { error: "Origin is not allowed" }, options.allowedOrigins);
      return;
    }

    const providedToken = typeof req.headers[TRADE_BRIDGE_TOKEN_HEADER] === "string"
      ? req.headers[TRADE_BRIDGE_TOKEN_HEADER]
      : undefined;
    if (!isValidBridgeToken(providedToken, options.expectedToken)) {
      sendJson(req, res, 401, { error: "Invalid trade bridge token" }, options.allowedOrigins);
      return;
    }

    if (!isJsonContentType(req.headers["content-type"])) {
      sendJson(req, res, 415, { error: "Content-Type must be application/json" }, options.allowedOrigins);
      return;
    }

    if (!executionGate.tryAcquire()) {
      sendJson(req, res, 409, { error: "Another trade request is already executing" }, options.allowedOrigins);
      return;
    }

    try {
      const trades = parseTradeRequest(await readRequestBody(req));
      const startTime = now().getTime();
      const results: TradeExecutionResult[] = [];
      for (const trade of trades) {
        try {
          const result = await options.executeTrade(trade);
          results.push(result);
          if (!result.parsed.confirmed) break;
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          results.push({
            trade,
            output: "",
            parsed: { confirmed: false, raw: "", error: message },
          });
          break;
        }
      }
      const duration = now().getTime() - startTime;
      const confirmedCount = results.filter((result) => result.parsed.confirmed).length;
      sendJson(req, res, 200, {
        success: confirmedCount === trades.length,
        count: confirmedCount,
        requestedCount: trades.length,
        results,
        duration,
      }, options.allowedOrigins);
    } catch (error: unknown) {
      const statusCode = error instanceof TradeBridgeRequestError ? error.statusCode : 500;
      const message = error instanceof Error ? error.message : "Trade execution failed";
      sendJson(req, res, statusCode, { success: false, error: message }, options.allowedOrigins);
    } finally {
      executionGate.release();
    }
  });
}

export function listenTradeBridgeServer(
  server: http.Server,
  port: number,
  onListening?: () => void,
): http.Server {
  return server.listen(port, TRADE_BRIDGE_HOST, onListening);
}

export function formatTradeBridgeStartupMessages(bridgeToken: string): string[] {
  return [
    `\n🚀 Trade Bridge Server running on http://${TRADE_BRIDGE_HOST}:${TRADE_BRIDGE_PORT}`,
    `\nSession token: ${bridgeToken}`,
    "Enter this token in the Order page when prompted. It is valid until this bridge process stops.",
    "\nEndpoints:",
    `  POST http://localhost:${TRADE_BRIDGE_PORT}/trade  - Execute a single trade or a batch`,
    `  GET  http://localhost:${TRADE_BRIDGE_PORT}/health - Health check`,
    "\nPrerequisites:",
    "  - Claude Code must be running with robinhood-trading MCP connected",
    "  - Agentic account (••••6245) must have buying power",
    "\nExample requests:",
    `  curl -X POST http://${TRADE_BRIDGE_HOST}:${TRADE_BRIDGE_PORT}/trade \\`,
    '    -H "Origin: http://localhost:4200" \\',
    '    -H "X-Trade-Bridge-Token: <SESSION_TOKEN>" \\',
    '    -H "Content-Type: application/json" \\',
    '    -d \'{"symbol":"AAPL","side":"buy","amount":100}\'',
    `  curl -X POST http://${TRADE_BRIDGE_HOST}:${TRADE_BRIDGE_PORT}/trade \\`,
    '    -H "Origin: http://localhost:4200" \\',
    '    -H "X-Trade-Bridge-Token: <SESSION_TOKEN>" \\',
    '    -H "Content-Type: application/json" \\',
    '    -d \'{"trades":[{"symbol":"AAPL","side":"buy","amount":100},{"symbol":"TSLA","side":"sell","amount":100}]}\'',
    "\nPress Ctrl+C to stop\n",
  ];
}

function startTradeBridgeServer(): void {
  const bridgeToken = randomBytes(32).toString("base64url");
  const server = createTradeBridgeServer({
    expectedToken: bridgeToken,
    allowedOrigins: RH_AGENT_ALLOWED_ORIGINS,
    executeTrade: executeTradeViaClaude,
  });

  listenTradeBridgeServer(server, TRADE_BRIDGE_PORT, () => {
    for (const message of formatTradeBridgeStartupMessages(bridgeToken)) {
      console.log(message);
    }
  });

  // Graceful shutdown
  process.on("SIGINT", () => {
    console.log("\n\nShutting down...");
    server.close(() => process.exit(0));
  });
}

const entryPath = process.argv[1];
if (entryPath && pathToFileURL(path.resolve(entryPath)).href === import.meta.url) {
  startTradeBridgeServer();
}
```

## `functions/src/rh-agent/watchlist.ts`

```typescript
export type StrategyName = "rsi-oversold" | "macd-crossover" | "dip-buy" | "custom";

export interface WatchedSymbol {
  symbol: string;
  strategy: StrategyName;
  amount: number;
  intervalMs: number;
  enabled: boolean;
  customPrompt?: string;
}

export const watchlist: WatchedSymbol[] = [
  {
    symbol: "AAPL",
    strategy: "rsi-oversold",
    amount: 100,
    intervalMs: 5 * 60 * 1000,
    enabled: true,
  },
  {
    symbol: "NVDA",
    strategy: "macd-crossover",
    amount: 200,
    intervalMs: 15 * 60 * 1000,
    enabled: true,
  },
  {
    symbol: "TSLA",
    strategy: "dip-buy",
    amount: 150,
    intervalMs: 10 * 60 * 1000,
    enabled: false,
  },
];
```

## `functions/src/rh-agent-cloud-function/rh-agent-executor.ts`

```typescript
/**
 * RH Agent Trade Executor
 *
 * Cloud Callable function that executes trades via Robinhood MCP.
 * Auth is handled by the MCP session — no stored tokens required.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { defineSecret } from 'firebase-functions/params';
import { RH_AGENT_ALLOWED_ORIGINS } from './rh-agent-cors';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const mcpServerUrlSecret = defineSecret('RH_AGENT_MCP_SERVER_URL');
const accountNumberSecret = defineSecret('RH_AGENT_ACCOUNT_NUMBER');

/**
 * Safely parse MCP text content as JSON. Returns null if the content is empty or
 * malformed so the caller can fail gracefully instead of throwing.
 */
function safeParseMcpJson(text: string): any | null {
  const trimmed = text.trim();
  if (!trimmed) {
    logger.warn('mcp_response_empty');
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch (error: any) {
    logger.warn('mcp_response_parse_failed', { error: error?.message, preview: trimmed.slice(0, 200) });
    return null;
  }
}

// Interface definitions
interface TradeRequest {
  symbol: string;
  side: 'buy' | 'sell';
  amount: number; // Dollar amount
  orderType?: 'market' | 'limit';
  limitPrice?: number;
  dryRun?: boolean;
}

interface TradeResponse {
  success: boolean;
  orderId?: string;
  symbol: string;
  side: string;
  amount: number;
  state?: string;
  estimatedShares?: number;
  error?: string;
}

/**
 * Create MCP client connected to the RH Agentic API.
 */
async function createMCPClient(mcpServerUrl: string): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(mcpServerUrl));

  const client = new Client(
    { name: 'rh-cloud-executor', version: '1.0.0' },
    { capabilities: {} }
  );

  await client.connect(transport);
  return client;
}

/**
 * Execute a trade via MCP
 */
async function executeTrade(
  client: Client,
  accountNumber: string,
  request: TradeRequest
): Promise<TradeResponse> {
  const { symbol, side, amount, orderType = 'market', limitPrice, dryRun = false } = request;

  try {
    // Step 1: Review the order (preview)
    logger.info('trade_review_start', { symbol, side, amount, orderType });

    const reviewResult = await client.callTool({
      name: 'review_equity_order',
      arguments: {
        account_number: accountNumber,
        symbol: symbol.toUpperCase(),
        side: side.toLowerCase(),
        type: orderType,
        dollar_amount: amount,
        limit_price: orderType === 'limit' ? limitPrice : undefined,
        time_in_force: 'gfd', // Good for day
      },
    });

    const reviewContent = (reviewResult.content as Array<{ type: string; text?: string }>)
      .map(c => c.text ?? '').join('');

    logger.info('trade_review_complete', { reviewContent: reviewContent.slice(0, 200) });

    // If dry run, stop here
    if (dryRun) {
      return {
        success: true,
        symbol,
        side,
        amount,
        state: 'DRY_RUN',
        error: undefined,
      };
    }

    // Step 2: Place the order
    logger.info('trade_place_start', { symbol, side, amount });

    const placeResult = await client.callTool({
      name: 'place_equity_order',
      arguments: {
        account_number: accountNumber,
        symbol: symbol.toUpperCase(),
        side: side.toLowerCase(),
        type: orderType,
        dollar_amount: amount,
        limit_price: orderType === 'limit' ? limitPrice : undefined,
        time_in_force: 'gfd',
      },
    });

    const placeContent = (placeResult.content as Array<{ type: string; text?: string }>)
      .map(c => c.text ?? '').join('');

    // Parse order confirmation
    const orderData = safeParseMcpJson(placeContent);
    if (!orderData) {
      return {
        success: false,
        symbol,
        side,
        amount,
        error: 'Invalid order confirmation from MCP',
      };
    }

    logger.info('trade_place_complete', {
      orderId: orderData.id,
      state: orderData.state,
    });

    return {
      success: true,
      orderId: orderData.id,
      symbol,
      side,
      amount,
      state: orderData.state,
      estimatedShares: orderData.estimated_shares,
    };

  } catch (error: any) {
    logger.error('trade_execution_error', {
      symbol,
      side,
      amount,
      error: error?.message,
    });

    return {
      success: false,
      symbol,
      side,
      amount,
      error: error?.message || 'Trade execution failed',
    };
  }
}

/**
 * Callable function: Execute a trade
 */
export const rhExecuteTrade = onCall<TradeRequest, Promise<TradeResponse>>(
  {
    cors: RH_AGENT_ALLOWED_ORIGINS,
    timeoutSeconds: 30,
    secrets: [mcpServerUrlSecret, accountNumberSecret],
  },
  async (request) => {
    const { symbol, side, amount, orderType, limitPrice, dryRun } = request.data;

    if (!symbol || !side || !amount) {
      throw new HttpsError('invalid-argument', 'Missing required fields: symbol, side, amount');
    }

    if (!['buy', 'sell'].includes(side.toLowerCase())) {
      throw new HttpsError('invalid-argument', 'Side must be "buy" or "sell"');
    }

    if (amount <= 0 || amount > 5000) {
      throw new HttpsError('invalid-argument', 'Amount must be between $1 and $5000');
    }

    logger.info('trade_request_received', {
      symbol,
      side,
      amount,
      orderType: orderType || 'market',
      dryRun: dryRun || false,
      auth: request.auth?.uid,
    });

    let client: Client | undefined;

    try {
      const mcpServerUrl = mcpServerUrlSecret.value();
      const accountNumber = accountNumberSecret.value();
      client = await createMCPClient(mcpServerUrl);
      const result = await executeTrade(client, accountNumber, {
        symbol,
        side,
        amount,
        orderType,
        limitPrice,
        dryRun: dryRun || false,
      });

      return result;
    } catch (error: any) {
      logger.error('trade_callable_error', { error: error?.message });
      throw new HttpsError('internal', `Trade execution failed: ${error?.message}`);
    } finally {
      await client?.close();
    }
  }
);

/**
 * Callable function: Get account summary
 */
export const rhGetAccountSummary = onCall<void, Promise<any>>(
  {
    cors: RH_AGENT_ALLOWED_ORIGINS,
    timeoutSeconds: 15,
    secrets: [mcpServerUrlSecret, accountNumberSecret],
  },
  async () => {
    let client: Client | undefined;

    try {
      const mcpServerUrl = mcpServerUrlSecret.value();
      const accountNumber = accountNumberSecret.value();
      client = await createMCPClient(mcpServerUrl);

      const result = await client.callTool({
        name: 'get_portfolio',
        arguments: { account_number: accountNumber },
      });

      const content = (result.content as Array<{ type: string; text?: string }>)
        .map(c => c.text ?? '').join('');

      const parsed = safeParseMcpJson(content);
      if (!parsed) {
        throw new HttpsError('internal', 'Invalid account summary response from MCP');
      }
      return parsed;
    } catch (error: any) {
      logger.error('account_summary_error', { error: error?.message });
      throw new HttpsError('internal', `Failed to get account summary: ${error?.message}`);
    } finally {
      await client?.close();
    }
  }
);
```

## `src/app/features/rh-agent/services/trade-bridge-client.service.ts`

```typescript
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, InjectionToken, inject } from '@angular/core';
import { Observable, catchError, defer, map, of } from 'rxjs';

const TRADE_BRIDGE_URL = 'http://127.0.0.1:3001/trade';
const TRADE_BRIDGE_TOKEN_HEADER = 'X-Trade-Bridge-Token';
const TRADE_BRIDGE_TOKEN_STORAGE_KEY = 'rhAgentTradeBridgeToken';
const TRADE_BRIDGE_TOKEN_PROMPT = 'Enter the session token shown in the trade bridge terminal:';

export const TRADE_BRIDGE_SESSION_STORAGE = new InjectionToken<Storage>('TRADE_BRIDGE_SESSION_STORAGE', {
  providedIn: 'root',
  factory: () => window.sessionStorage,
});

export const TRADE_BRIDGE_PROMPT = new InjectionToken<(message: string) => string | null>('TRADE_BRIDGE_PROMPT', {
  providedIn: 'root',
  factory: () => window.prompt.bind(window),
});

export interface TradeBridgeTrade {
  symbol: string;
  side: 'buy' | 'sell';
  amount: number;
  orderType: 'market' | 'limit';
  limitPrice?: number;
}

export interface TradeBridgeResult {
  trade: { symbol: string };
  parsed: {
    confirmed: boolean;
    orderId?: string;
    state?: string;
    error?: string;
  };
}

export interface TradeBridgeResponse {
  success: boolean;
  count: number;
  requestedCount: number;
  results: TradeBridgeResult[];
}

export interface TradeBridgeTransportError {
  kind: 'cancelled' | 'unauthorized' | 'request';
  message: string;
  status?: number;
}

export type TradeBridgeClientResult =
  | { ok: true; response: TradeBridgeResponse }
  | { ok: false; error: TradeBridgeTransportError };

@Injectable({ providedIn: 'root' })
export class TradeBridgeClientService {
  private readonly http = inject(HttpClient);
  private readonly storage = inject(TRADE_BRIDGE_SESSION_STORAGE);
  private readonly prompt = inject(TRADE_BRIDGE_PROMPT);

  executeTrades(trades: TradeBridgeTrade[]): Observable<TradeBridgeClientResult> {
    return defer(() => {
      const token = this.acquireToken();
      if (!token) {
        return of({
          ok: false as const,
          error: { kind: 'cancelled' as const, message: 'Trade bridge token entry was cancelled' },
        });
      }

      return this.http.post<TradeBridgeResponse>(
        TRADE_BRIDGE_URL,
        { trades },
        { headers: { [TRADE_BRIDGE_TOKEN_HEADER]: token } }
      ).pipe(map((response) => ({ ok: true as const, response })));
    }).pipe(
      catchError((error: unknown) => of({
        ok: false as const,
        error: this.toTransportError(error),
      }))
    );
  }

  private acquireToken(): string | null {
    const storedToken = this.storage.getItem(TRADE_BRIDGE_TOKEN_STORAGE_KEY);
    if (storedToken) return storedToken;

    const enteredToken = this.prompt(TRADE_BRIDGE_TOKEN_PROMPT)?.trim();
    if (!enteredToken) return null;
    this.storage.setItem(TRADE_BRIDGE_TOKEN_STORAGE_KEY, enteredToken);
    return enteredToken;
  }

  private toTransportError(error: unknown): TradeBridgeTransportError {
    if (error instanceof HttpErrorResponse && error.status === 401) {
      try {
        this.storage.removeItem(TRADE_BRIDGE_TOKEN_STORAGE_KEY);
      } catch (storageError: unknown) {
        return this.toClientFailure(storageError, error.status);
      }
      return {
        kind: 'unauthorized',
        status: error.status,
        message: 'Trade bridge token expired. Retry and enter the token shown by the bridge.',
      };
    }

    if (error instanceof HttpErrorResponse) {
      const responseMessage = this.isErrorResponse(error.error) ? error.error.error : undefined;
      return {
        kind: 'request',
        status: error.status || undefined,
        message: responseMessage ?? error.message ?? 'Trade bridge request failed',
      };
    }

    return this.toClientFailure(error);
  }

  private toClientFailure(error: unknown, status?: number): TradeBridgeTransportError {
    const details = error instanceof Error && error.message ? error.message : 'Browser token storage or prompt failed';
    return {
      kind: 'request',
      status,
      message: `Trade bridge client failed: ${details}`,
    };
  }

  private isErrorResponse(value: unknown): value is { error: string } {
    return typeof value === 'object' && value !== null && 'error' in value && typeof value.error === 'string';
  }
}
```

## `src/app/features/rh-agent/services/trade-bridge-client.service.spec.ts`

```typescript
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import {
  TRADE_BRIDGE_PROMPT,
  TRADE_BRIDGE_SESSION_STORAGE,
  TradeBridgeClientResult,
  TradeBridgeClientService,
  TradeBridgeResponse,
  TradeBridgeTrade,
} from './trade-bridge-client.service';

const TOKEN = 'test-session-token';
const STORAGE_KEY = 'rhAgentTradeBridgeToken';
const URL = 'http://127.0.0.1:3001/trade';
const TRADE: TradeBridgeTrade = {
  symbol: 'AAPL',
  side: 'buy',
  amount: 10,
  orderType: 'market',
};
const RESPONSE: TradeBridgeResponse = {
  success: true,
  count: 1,
  requestedCount: 1,
  results: [{
    trade: { symbol: 'AAPL' },
    parsed: { confirmed: true, orderId: 'fake-order', state: 'queued' },
  }],
};

describe('TradeBridgeClientService', () => {
  let service: TradeBridgeClientService;
  let http: HttpTestingController;
  let storage: Storage;
  let prompt: jasmine.Spy<(message: string) => string | null>;

  beforeEach(() => {
    storage = {
      length: 0,
      clear: jasmine.createSpy('clear'),
      getItem: jasmine.createSpy('getItem'),
      key: jasmine.createSpy('key'),
      removeItem: jasmine.createSpy('removeItem'),
      setItem: jasmine.createSpy('setItem'),
    };
    prompt = jasmine.createSpy('prompt');

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: TRADE_BRIDGE_SESSION_STORAGE, useValue: storage },
        { provide: TRADE_BRIDGE_PROMPT, useValue: prompt },
      ],
    });
    service = TestBed.inject(TradeBridgeClientService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('reuses the stored token without prompting', () => {
    (storage.getItem as jasmine.Spy).and.returnValue(TOKEN);
    let result: TradeBridgeClientResult | undefined;

    service.executeTrades([TRADE]).subscribe((value) => {
      result = value;
    });

    const request = http.expectOne(URL);
    expect(prompt).not.toHaveBeenCalled();
    expect(request.request.headers.get('X-Trade-Bridge-Token')).toBe(TOKEN);
    request.flush(RESPONSE);
    expect(result).toEqual({ ok: true, response: RESPONSE });
  });

  it('returns a typed cancellation result without sending a request', () => {
    (storage.getItem as jasmine.Spy).and.returnValue(null);
    prompt.and.returnValue(null);
    let result: TradeBridgeClientResult | undefined;

    service.executeTrades([TRADE]).subscribe((value) => {
      result = value;
    });

    http.expectNone(URL);
    expect(result).toEqual({
      ok: false,
      error: { kind: 'cancelled', message: 'Trade bridge token entry was cancelled' },
    });
  });

  it('trims and stores a prompted token and sends the required request headers', () => {
    (storage.getItem as jasmine.Spy).and.returnValue(null);
    prompt.and.returnValue(`  ${TOKEN}  `);

    service.executeTrades([TRADE]).subscribe();

    const request = http.expectOne(URL);
    expect(storage.setItem).toHaveBeenCalledWith(STORAGE_KEY, TOKEN);
    expect(request.request.method).toBe('POST');
    expect(request.request.headers.get('X-Trade-Bridge-Token')).toBe(TOKEN);
    expect(request.request.body).toEqual({ trades: [TRADE] });
    request.flush(RESPONSE);
  });

  it('clears a stale token and returns a typed unauthorized result on 401', () => {
    (storage.getItem as jasmine.Spy).and.returnValue(TOKEN);
    let result: TradeBridgeClientResult | undefined;

    service.executeTrades([TRADE]).subscribe((value) => {
      result = value;
    });

    const request = http.expectOne(URL);
    request.flush({ error: 'Invalid trade bridge token' }, { status: 401, statusText: 'Unauthorized' });

    expect(storage.removeItem).toHaveBeenCalledWith(STORAGE_KEY);
    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'unauthorized',
        status: 401,
        message: 'Trade bridge token expired. Retry and enter the token shown by the bridge.',
      },
    });
  });

  it('returns a typed request failure when reading session storage throws', () => {
    (storage.getItem as jasmine.Spy).and.throwError(new Error('getItem blocked'));
    let result: TradeBridgeClientResult | undefined;

    service.executeTrades([TRADE]).subscribe((value) => {
      result = value;
    });

    http.expectNone(URL);
    expect(result).toEqual({
      ok: false,
      error: { kind: 'request', status: undefined, message: 'Trade bridge client failed: getItem blocked' },
    });
  });

  it('returns a typed request failure when the token prompt throws', () => {
    (storage.getItem as jasmine.Spy).and.returnValue(null);
    prompt.and.throwError(new Error('prompt blocked'));
    let result: TradeBridgeClientResult | undefined;

    service.executeTrades([TRADE]).subscribe((value) => {
      result = value;
    });

    http.expectNone(URL);
    expect(result).toEqual({
      ok: false,
      error: { kind: 'request', status: undefined, message: 'Trade bridge client failed: prompt blocked' },
    });
  });

  it('returns a typed request failure when storing a prompted token throws', () => {
    (storage.getItem as jasmine.Spy).and.returnValue(null);
    prompt.and.returnValue(TOKEN);
    (storage.setItem as jasmine.Spy).and.throwError(new Error('setItem blocked'));
    let result: TradeBridgeClientResult | undefined;

    service.executeTrades([TRADE]).subscribe((value) => {
      result = value;
    });

    http.expectNone(URL);
    expect(result).toEqual({
      ok: false,
      error: { kind: 'request', status: undefined, message: 'Trade bridge client failed: setItem blocked' },
    });
  });

  it('returns a typed request failure when clearing a stale token throws', () => {
    (storage.getItem as jasmine.Spy).and.returnValue(TOKEN);
    (storage.removeItem as jasmine.Spy).and.throwError(new Error('removeItem blocked'));
    let result: TradeBridgeClientResult | undefined;

    service.executeTrades([TRADE]).subscribe((value) => {
      result = value;
    });

    const request = http.expectOne(URL);
    request.flush({ error: 'Invalid trade bridge token' }, { status: 401, statusText: 'Unauthorized' });

    expect(result).toEqual({
      ok: false,
      error: { kind: 'request', status: 401, message: 'Trade bridge client failed: removeItem blocked' },
    });
  });
});
```

## `src/app/features/rs/services/robinhood-trade.service.ts`

```typescript
/**
 * Robinhood Trade Service
 *
 * Generates copy-pasteable trade prompts for Claude Code.
 * Interim solution until direct API access is available.
 */
import { Injectable } from '@angular/core';

export enum TradeSide {
  BUY = 'buy',
  SELL = 'sell',
}

export enum TradeOrderType {
  MARKET = 'market',
  LIMIT = 'limit',
}

export interface TradePrompt {
  symbol: string;
  side: TradeSide;
  amount: number;
  orderType: TradeOrderType;
  limitPrice?: number;
  promptText: string;
  estimatedShares?: number;
}

export interface TradeBatch {
  trades: TradePrompt[];
  totalAmount: number;
  batchPrompt: string;
}

@Injectable({
  providedIn: 'root'
})
export class RobinhoodTradeService {

  private readonly AGENTIC_ACCOUNT = '••••6245';

  /**
   * Generate a single trade prompt
   */
  generateTradePrompt(
    symbol: string,
    side: TradeSide,
    amount: number,
    orderType: TradeOrderType = TradeOrderType.MARKET,
    limitPrice?: number
  ): TradePrompt {
    const promptText = this.buildPrompt(symbol, side, amount, orderType, limitPrice);

    return {
      symbol: symbol.toUpperCase(),
      side,
      amount,
      orderType,
      limitPrice,
      promptText,
    };
  }

  /**
   * Generate a batch trade prompt for multiple orders
   */
  generateBatchPrompt(trades: Array<Omit<TradePrompt, 'promptText'>>): TradeBatch {
    const tradePrompts = trades.map(t => this.buildPrompt(
      t.symbol, t.side, t.amount, t.orderType, t.limitPrice
    ));

    const batchPrompt = `Execute these trades in my Agentic account (${this.AGENTIC_ACCOUNT}):

${tradePrompts.map((p, i) => `${i + 1}. ${p}`).join('\n')}

Please confirm each order after review and place them sequentially.`;

    const totalAmount = trades.reduce((sum, t) => sum + t.amount, 0);

    return {
      trades: trades.map((t, i) => ({
        ...t,
        promptText: tradePrompts[i]
      })),
      totalAmount,
      batchPrompt
    };
  }

  /**
   * Build the Claude Code prompt text
   */
  private buildPrompt(
    symbol: string,
    side: TradeSide,
    amount: number,
    orderType: TradeOrderType,
    limitPrice?: number
  ): string {
    const lines = [
      `Place a ${orderType} ${side} order for $${amount.toFixed(2)} of ${symbol.toUpperCase()}`,
      `Account: Agentic (${this.AGENTIC_ACCOUNT})`,
      `Order Type: ${orderType.toUpperCase()}`
    ];

    if (orderType === TradeOrderType.LIMIT && limitPrice) {
      lines.push(`Limit Price: $${limitPrice.toFixed(2)}`);
    }

    lines.push(`Time in Force: GFD (Good for Day)`);

    return lines.join('\n');
  }

  /**
   * Copy text to clipboard
   */
  async copyToClipboard(text: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      console.error('Failed to copy:', err);
      return false;
    }
  }

  /**
   * Generate prompt from a trade signal
   * (Integrates with your existing signal system)
   */
  generateFromSignal(signal: {
    symbol: string;
    action: TradeSide;
    allocation: number; // percentage of portfolio
    portfolioValue: number;
  }): TradePrompt {
    const amount = (signal.portfolioValue * signal.allocation) / 100;

    return this.generateTradePrompt(
      signal.symbol,
      signal.action,
      Math.round(amount),
      TradeOrderType.MARKET
    );
  }
}
```

## `src/app/features/rs/components/robinhood-trade-panel.component.ts`

```typescript
/**
 * Robinhood Trade Panel Component
 *
 * Displays trade prompts ready to copy-paste into Claude Code.
 */
import { Component, Input, Output, EventEmitter, Optional, Inject, signal, computed } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { RobinhoodTradeService, TradePrompt, TradeBatch } from '../services/robinhood-trade.service';

@Component({
  selector: 'app-robinhood-trade-panel',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatSnackBarModule,
  ],
  templateUrl: './robinhood-trade-panel.component.html',
  styleUrl: './robinhood-trade-panel.component.scss',
})
export class RobinhoodTradePanelComponent {
  @Input() singleTrade?: TradePrompt;
  @Input() batch?: TradeBatch | null;
  @Output() copied = new EventEmitter<void>();
  @Output() tradeRemoved = new EventEmitter<string>(); // Emits symbol to remove

  // Mutable list of trades for dynamic removal
  private removedSymbols = signal<Set<string>>(new Set());

  // Computed visible trades (excluding removed)
  visibleTrades = computed(() => {
    const batch = this.batch || this.dialogData?.batch;
    if (!batch) return [];
    const removed = this.removedSymbols();
    return batch.trades.filter(t => !removed.has(t.symbol));
  });

  // Computed batch prompt with only visible trades
  computedBatchPrompt = computed(() => {
    const trades = this.visibleTrades();
    if (trades.length === 0) return '';
    const total = trades.reduce((sum, t) => sum + t.amount, 0);
    const tradeList = trades.map((t, i) => 
      `${i + 1}. Place a market buy order for $${t.amount.toFixed(2)} of ${t.symbol}\nAccount: Agentic (••••6245)\nOrder Type: MARKET\nTime in Force: GFD (Good for Day)`
    ).join('\n\n');
    return `Execute these trades in my Agentic account (••••6245):\n\n${tradeList}\n\nTotal: $${total.toFixed(2)} for ${trades.length} orders`;
  });

  // Computed total amount
  computedTotalAmount = computed(() => {
    return this.visibleTrades().reduce((sum, t) => sum + t.amount, 0);
  });

  constructor(
    private tradeService: RobinhoodTradeService,
    private snackBar: MatSnackBar,
    @Optional() @Inject(MAT_DIALOG_DATA) private dialogData?: { batch?: TradeBatch },
    @Optional() private dialogRef?: MatDialogRef<RobinhoodTradePanelComponent>
  ) {}

  closeDialog(): void {
    this.dialogRef?.close();
  }

  // Get original batch from either @Input or dialog data
  get effectiveBatch(): TradeBatch | null | undefined {
    return this.batch || this.dialogData?.batch;
  }

  async copyTrade(trade: TradePrompt): Promise<void> {
    const success = await this.tradeService.copyToClipboard(trade.promptText);
    this.showResult(success, `Copied: ${trade.side.toUpperCase()} $${trade.amount} ${trade.symbol}`);
  }

  async copyBatch(): Promise<void> {
    const prompt = this.computedBatchPrompt();
    if (!prompt) return;
    const trades = this.visibleTrades();
    const success = await this.tradeService.copyToClipboard(prompt);
    this.showResult(success, `Copied batch of ${trades.length} trades`);
  }

  removeTrade(symbol: string): void {
    // Add to removed set (updates computed signals)
    this.removedSymbols.update(set => {
      const newSet = new Set(set);
      newSet.add(symbol);
      return newSet;
    });
    this.tradeRemoved.emit(symbol);
    this.snackBar.open(`Removed ${symbol} from batch (moved to Considered)`, 'Dismiss', { duration: 2000 });
  }

  private showResult(success: boolean, message: string): void {
    if (success) {
      this.snackBar.open(message, 'Dismiss', { duration: 3000 });
      this.copied.emit();
    } else {
      this.snackBar.open('Failed to copy. Please copy manually.', 'Dismiss', { duration: 5000 });
    }
  }
}
```

## `src/app/features/rs/components/robinhood-trade-panel.component.html`

```html
<mat-card class="trade-panel">
  <mat-card-header>
    <mat-card-title>
      <mat-icon>account_balance</mat-icon>
      Robinhood Trades (Agentic Account)
    </mat-card-title>
    <mat-card-subtitle>Copy-paste into Claude Code</mat-card-subtitle>
    
    <!-- Copy Button in Header -->
    <button
      mat-raised-button
      color="primary"
      class="header-copy-btn"
      (click)="singleTrade ? copyTrade(singleTrade) : copyBatch()"
      matTooltip="Copy to clipboard">
      <mat-icon>content_copy</mat-icon>
      Copy
    </button>
    
    <button
      mat-icon-button
      class="close-btn"
      (click)="closeDialog()"
      matTooltip="Close">
      <mat-icon>close</mat-icon>
    </button>
  </mat-card-header>

  <mat-card-content>
    <!-- Scrollable Container -->
    <div class="scrollable-content">
      <!-- Single Trade Mode -->
      @if (singleTrade) {
        <div class="trade-section">
          <h3>Single Trade</h3>
          <div class="prompt-box">
            <pre>{{ singleTrade.promptText }}</pre>
          </div>
        </div>
      }
      <!-- Batch Trade Mode -->
      @if (effectiveBatch) {
        <div class="trade-section">
          <h3>Batch Trade ({{ visibleTrades().length }} orders, ${{ computedTotalAmount() }})</h3>
          
          <div class="individual-trades">
            @for (trade of visibleTrades(); track $index) {
              <div class="trade-item">
                <span class="trade-number">{{ $index + 1 }}.</span>
                <span class="trade-details">
                  {{ trade.side.toUpperCase() }} ${{ trade.amount }} {{ trade.symbol }}
                </span>
                <button
                  mat-icon-button
                  class="remove-btn"
                  (click)="removeTrade(trade.symbol)"
                  matTooltip="Remove from batch (move to Considered)">
                  <mat-icon>close</mat-icon>
                </button>
              </div>
            }
          </div>

          <div class="prompt-box batch">
            <pre>{{ computedBatchPrompt() }}</pre>
          </div>
        </div>
      }

      <!-- Instructions -->
      <div class="instructions">
        <h4>Next Steps:</h4>
        <ol>
          <li>Click "Copy" button in the header</li>
          <li>Open Claude Code (should already have robinhood-trading MCP connected)</li>
          <li>Paste and press Enter</li>
          <li>Claude will review and place the order(s)</li>
          <li>Check your Robinhood Agentic account for confirmation</li>
        </ol>
      </div>
    </div>
  </mat-card-content>
</mat-card>
```

## `src/app/features/rs/components/robinhood-trade-panel.component.scss`

```scss
.trade-panel {
  max-width: 600px;
  margin: 0;
  position: relative;
  display: flex;
  flex-direction: column;
  max-height: 80vh; // Dialog max height
}

mat-card-header {
  display: flex;
  align-items: center;
  padding-right: 40px; // Space for close button
  flex-shrink: 0;

  .header-copy-btn {
    margin-left: auto;
    margin-right: 8px;
    height: 36px;
    font-size: 12px;
    padding: 0 12px;

    mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
      margin-right: 4px;
    }
  }

  .close-btn {
    position: absolute;
    top: 8px;
    right: 8px;
    width: 36px;
    height: 36px;
    padding: 0;
    opacity: 0.6;
    display: flex;
    align-items: center;
    justify-content: center;

    &:hover {
      opacity: 1;
      background: var(--mat-sys-surface-container-high);
    }

    ::ng-deep .mat-mdc-button-touch-target {
      width: 36px;
      height: 36px;
    }

    mat-icon {
      font-size: 20px;
      width: 20px;
      height: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
  }
}

mat-card-content {
  display: flex;
  flex-direction: column;
  overflow: hidden; // Don't scroll here
  padding: 16px;
}

// Scrollable container - holds trades, prompt, copy button, instructions
.scrollable-content {
  display: flex;
  flex-direction: column;
  overflow-y: auto; // Scrollbar here
  flex: 1;
  min-height: 0;
  gap: 12px;
}

mat-card-title {
  display: flex;
  align-items: center;
  gap: 8px;
}

.trade-section {
  display: flex;
  flex-direction: column;
  margin: 0;

  h3 {
    margin: 0 0 12px 0;
    flex-shrink: 0;
  }
}

.individual-trades {
  margin: 0 0 12px 0;
  padding: 12px;
  background: #fafafa;
  border-radius: 4px;
  flex-shrink: 0;
}

.prompt-box {
  background: #f5f5f5;
  border: 1px solid #ddd;
  border-radius: 4px;
  padding: 16px;
  margin: 0 0 12px 0;
  flex-shrink: 0;
}

.prompt-box pre {
  margin: 0;
  white-space: pre-wrap;
  font-family: 'Courier New', monospace;
  font-size: 14px;
}

.trade-item {
  display: flex;
  gap: 8px;
  padding: 4px 0;
  align-items: center;

  .remove-btn {
    width: 28px;
    height: 28px;
    line-height: 28px;
    padding: 0;
    margin-left: auto;
    opacity: 0.6;
    display: flex;
    align-items: center;
    justify-content: center;

    &:hover {
      opacity: 1;
      color: var(--mat-sys-error);
      background: rgba(244, 67, 54, 0.1);
    }

    ::ng-deep .mat-mdc-button-touch-target {
      width: 28px;
      height: 28px;
    }

    mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
  }
}

.trade-number {
  font-weight: bold;
  color: #666;
  min-width: 24px;
}

.instructions {
  margin-top: 12px;
  padding: 12px;
  background: #e3f2fd;
  border-radius: 4px;
  flex-shrink: 0;
  font-size: 13px;

  h4 {
    margin: 0 0 8px 0;
    font-size: 14px;
  }

  ol {
    margin: 0;
    padding-left: 16px;
  }

  li {
    margin: 4px 0;
  }
}

```

## `src/app/features/rh-agent/components/execution-panel/execution-panel.component.ts`

```typescript
/**
 * Execution Panel Component
 *
 * Displays decision counts and trade generation controls.
 */
import { Component, inject, ChangeDetectionStrategy, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';

import { RhAgentDashboardStore } from '../../stores/rh-agent-dashboard.store';
import { RobinhoodTradePanelComponent } from '../../../rs/components/robinhood-trade-panel.component';
import { TradeBatch } from '../../../rs/services/robinhood-trade.service';

@Component({
  selector: 'app-execution-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatCardModule, MatIconModule, RobinhoodTradePanelComponent],
  templateUrl: './execution-panel.component.html',
  styleUrl: './execution-panel.component.scss',
})
export class ExecutionPanelComponent {
  readonly uiStore = inject(RhAgentDashboardStore);

  tradeBatch = input<TradeBatch | null>(null);
  hasAcceptedSignals = input<boolean>(false);

  acceptedCount(): number {
    const currentRun = this.uiStore.currentRun();
    if (!currentRun) return 0;
    return this.uiStore.getSignalsByStatus(currentRun.id, 'ACCEPTED').length;
  }

  consideredCount(): number {
    const currentRun = this.uiStore.currentRun();
    if (!currentRun) return 0;
    return this.uiStore.getSignalsByStatus(currentRun.id, 'CONSIDERED').length;
  }

  rejectedCount(): number {
    const currentRun = this.uiStore.currentRun();
    if (!currentRun) return 0;
    return this.uiStore.getSignalsByStatus(currentRun.id, 'REJECTED').length;
  }
}
```

## `src/app/features/rh-agent/components/execution-panel/execution-panel.component.html`

```html
<div class="execution-panel">
  <div class="execution-header">
    <h3>
      <mat-icon>assignment_turned_in</mat-icon>
      Decisions
    </h3>
    <div class="decision-counts">
      <span class="count accepted">
        <mat-icon>check_circle</mat-icon>
        {{ acceptedCount() }} Accepted
      </span>
      <span class="count considered">
        <mat-icon>help</mat-icon>
        {{ consideredCount() }} Considered
      </span>
      <span class="count rejected">
        <mat-icon>cancel</mat-icon>
        {{ rejectedCount() }} Rejected
      </span>
    </div>
  </div>

  @if (hasAcceptedSignals()) {
    <app-robinhood-trade-panel [batch]="tradeBatch()"></app-robinhood-trade-panel>
  }
</div>
```

## `src/app/features/rh-agent/components/execution-panel/execution-panel.component.scss`

```scss
.execution-panel {
  background: var(--mat-sys-surface-container);
  border-radius: 8px;
  padding: 16px;
}

.execution-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;

  h3 {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    font-size: 14px;
    font-weight: 500;

    mat-icon {
      color: var(--mat-sys-primary);
    }
  }
}

.decision-counts {
  display: flex;
  gap: 20px;

  .count {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 13px;

    mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }

    &.accepted {
      color: var(--mat-sys-success);
    }

    &.considered {
      color: var(--mat-sys-tertiary);
    }

    &.rejected {
      color: var(--mat-sys-error);
    }
  }
}
```

## `tests/functions/trade-bridge-security.test.ts`

```typescript
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  TRADE_BRIDGE_MAX_BATCH_SIZE,
  TRADE_BRIDGE_MAX_BODY_BYTES,
  TRADE_BRIDGE_MAX_TRADE_AMOUNT,
  TRADE_BRIDGE_MIN_TRADE_AMOUNT,
  TradeBridgeExecutionGate,
  TradeBridgeRequestError,
  assertBodySize,
  isAllowedOrigin,
  isJsonContentType,
  isValidBridgeToken,
  parseTradeRequest,
} from "../../functions/src/rh-agent/trade-bridge-security";

const allowedOrigins = ["http://localhost:4200", "https://savanttrader.com"];

function expectRequestError(action: () => unknown, statusCode: number, message: RegExp): void {
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof TradeBridgeRequestError);
    assert.equal(error.statusCode, statusCode);
    assert.match(error.message, message);
    return true;
  });
}

describe("trade bridge origin and token security", () => {
  it("accepts only configured origins", () => {
    assert.equal(isAllowedOrigin("http://localhost:4200", allowedOrigins), true);
    assert.equal(isAllowedOrigin("https://savanttrader.com", allowedOrigins), true);
    assert.equal(isAllowedOrigin("https://malicious.example", allowedOrigins), false);
    assert.equal(isAllowedOrigin(undefined, allowedOrigins), false);
  });

  it("requires an exact bridge token", () => {
    const expected = "a".repeat(43);
    assert.equal(isValidBridgeToken(expected, expected), true);
    assert.equal(isValidBridgeToken(undefined, expected), false);
    assert.equal(isValidBridgeToken("b".repeat(43), expected), false);
    assert.equal(isValidBridgeToken("short", expected), false);
  });

  it("accepts only JSON content types", () => {
    assert.equal(isJsonContentType("application/json"), true);
    assert.equal(isJsonContentType("Application/JSON; charset=utf-8"), true);
    assert.equal(isJsonContentType("text/plain"), false);
    assert.equal(isJsonContentType(undefined), false);
  });

  it("permits only one active execution", () => {
    const gate = new TradeBridgeExecutionGate();
    assert.equal(gate.tryAcquire(), true);
    assert.equal(gate.isActive(), true);
    assert.equal(gate.tryAcquire(), false);
    gate.release();
    assert.equal(gate.isActive(), false);
    assert.equal(gate.tryAcquire(), true);
  });
});

describe("trade bridge artifact safety", () => {
  it("ignores legacy prompt and execution-result artifacts", () => {
    const rules = new Set(readFileSync(new URL("../../functions/.gitignore", import.meta.url), "utf-8")
      .split(/\r?\n/)
      .map((rule) => rule.trim()));

    assert.equal(rules.has(".trade-results.json"), true);
    assert.equal(rules.has(".trade-prompt.txt"), true);
  });

  it("does not persist prompts or execution results", () => {
    const source = readFileSync(
      new URL("../../functions/src/rh-agent/trade-bridge-server.ts", import.meta.url),
      "utf-8",
    );

    assert.doesNotMatch(source, /from ["'](?:node:)?fs["']/);
    assert.doesNotMatch(source, /\.trade-results\.json|\.trade-prompt\.txt/);
    assert.doesNotMatch(source, /writeFile|appendFile/);
  });
});

describe("trade bridge body limits", () => {
  it("accepts the maximum body size", () => {
    assert.doesNotThrow(() => assertBodySize(TRADE_BRIDGE_MAX_BODY_BYTES));
  });

  it("rejects an oversized body", () => {
    expectRequestError(
      () => assertBodySize(TRADE_BRIDGE_MAX_BODY_BYTES + 1),
      413,
      /too large/,
    );
  });
});

describe("trade bridge request validation", () => {
  it("normalizes and accepts the minimum and maximum market-order amounts", () => {
    assert.deepEqual(
      parseTradeRequest(JSON.stringify({ symbol: "aapl", side: "buy", amount: TRADE_BRIDGE_MIN_TRADE_AMOUNT })),
      [{ symbol: "AAPL", side: "buy", amount: 1, orderType: "market" }],
    );
    assert.deepEqual(
      parseTradeRequest(JSON.stringify({ symbol: "aapl", side: "buy", amount: TRADE_BRIDGE_MAX_TRADE_AMOUNT })),
      [{ symbol: "AAPL", side: "buy", amount: 100, orderType: "market" }],
    );
  });

  it("accepts a valid limit order", () => {
    assert.deepEqual(
      parseTradeRequest(JSON.stringify({ symbol: "BRK.B", side: "sell", amount: 50, orderType: "limit", limitPrice: 500 })),
      [{ symbol: "BRK.B", side: "sell", amount: 50, orderType: "limit", limitPrice: 500 }],
    );
  });

  it("rejects malformed JSON and unsupported fields", () => {
    expectRequestError(() => parseTradeRequest("{"), 400, /valid JSON/);
    expectRequestError(
      () => parseTradeRequest(JSON.stringify({ symbol: "AAPL", side: "buy", amount: 50, dryRun: true })),
      400,
      /unsupported field/,
    );
    expectRequestError(
      () => parseTradeRequest(JSON.stringify({ trades: [], account: "123" })),
      400,
      /unsupported field/,
    );
  });

  it("rejects invalid symbols and sides", () => {
    expectRequestError(
      () => parseTradeRequest(JSON.stringify({ symbol: "AAPL;DROP", side: "buy", amount: 50 })),
      400,
      /invalid symbol/,
    );
    expectRequestError(
      () => parseTradeRequest(JSON.stringify({ symbol: "AAPL", side: "hold", amount: 50 })),
      400,
      /side must be/,
    );
  });

  it("rejects invalid amounts", () => {
    for (const amount of [0.99, 0, -1, Number.NaN, Number.POSITIVE_INFINITY, TRADE_BRIDGE_MAX_TRADE_AMOUNT + 1]) {
      expectRequestError(
        () => parseTradeRequest(JSON.stringify({ symbol: "AAPL", side: "buy", amount })),
        400,
        /amount must be/,
      );
    }
  });

  it("enforces limit-price invariants", () => {
    expectRequestError(
      () => parseTradeRequest(JSON.stringify({ symbol: "AAPL", side: "buy", amount: 50, orderType: "limit" })),
      400,
      /requires a positive limitPrice/,
    );
    expectRequestError(
      () => parseTradeRequest(JSON.stringify({ symbol: "AAPL", side: "buy", amount: 50, limitPrice: 10 })),
      400,
      /cannot set limitPrice/,
    );
  });

  it("rejects empty and oversized batches", () => {
    expectRequestError(() => parseTradeRequest(JSON.stringify({ trades: [] })), 400, /At least one/);

    const oversizedBatch = Array.from({ length: TRADE_BRIDGE_MAX_BATCH_SIZE + 1 }, (_, index) => ({
      symbol: `A${index}`,
      side: "buy",
      amount: 1,
    }));
    expectRequestError(
      () => parseTradeRequest(JSON.stringify({ trades: oversizedBatch })),
      400,
      /cannot exceed/,
    );
  });

  it("rejects every repeated symbol regardless of trade details", () => {
    const duplicateBatches = [
      [
        { symbol: "AAPL", side: "buy", amount: 50 },
        { symbol: "aapl", side: "buy", amount: 75 },
      ],
      [
        { symbol: "AAPL", side: "buy", amount: 50 },
        { symbol: "AAPL", side: "sell", amount: 50 },
      ],
      [
        { symbol: "AAPL", side: "buy", amount: 50 },
        { symbol: "AAPL", side: "buy", amount: 50, orderType: "limit", limitPrice: 200 },
      ],
      [
        { symbol: "AAPL", side: "buy", amount: 50, orderType: "limit", limitPrice: 200 },
        { symbol: "AAPL", side: "buy", amount: 50, orderType: "limit", limitPrice: 201 },
      ],
    ];

    for (const trades of duplicateBatches) {
      expectRequestError(
        () => parseTradeRequest(JSON.stringify({ trades })),
        400,
        /Duplicate trade symbol in batch: AAPL/,
      );
    }
  });
});
```

## `tests/functions/trade-bridge-http.test.ts`

```typescript
import assert from "node:assert/strict";
import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, it } from "node:test";
import {
  TRADE_BRIDGE_HOST,
  createTradeBridgeServer,
  formatTradeBridgeStartupMessages,
  listenTradeBridgeServer,
  type TradeBridgeServerOptions,
  type TradeExecutionResult,
} from "../../functions/src/rh-agent/trade-bridge-server";
import {
  TRADE_BRIDGE_MAX_BODY_BYTES,
  TRADE_BRIDGE_TOKEN_HEADER,
  type TradeRequest,
} from "../../functions/src/rh-agent/trade-bridge-security";

const ALLOWED_ORIGIN = "http://localhost:4200";
const DENIED_ORIGIN = "https://malicious.example";
const TOKEN = "a".repeat(43);
const servers = new Set<Server>();

afterEach(async () => {
  await Promise.all([...servers].map(closeServer));
  servers.clear();
});

function confirmedResult(trade: TradeRequest): TradeExecutionResult {
  return {
    trade,
    output: "",
    parsed: {
      confirmed: true,
      orderId: `fake-${trade.symbol}`,
      state: "queued",
      raw: "",
    },
  };
}

async function startServer(
  overrides: Partial<TradeBridgeServerOptions> = {},
): Promise<{ server: Server; baseUrl: string }> {
  const server = createTradeBridgeServer({
    expectedToken: TOKEN,
    allowedOrigins: [ALLOWED_ORIGIN],
    executeTrade: async (trade) => confirmedResult(trade),
    ...overrides,
  });
  servers.add(server);
  listenTradeBridgeServer(server, 0);
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return {
    server,
    baseUrl: `http://${TRADE_BRIDGE_HOST}:${address.port}`,
  };
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

function authorizedHeaders(contentType = "application/json"): Record<string, string> {
  return {
    Origin: ALLOWED_ORIGIN,
    [TRADE_BRIDGE_TOKEN_HEADER]: TOKEN,
    "Content-Type": contentType,
  };
}

function validBody(symbol = "AAPL", amount = 1): string {
  return JSON.stringify({ symbol, side: "buy", amount });
}

describe("trade bridge startup output", () => {
  it("prints the generated token once and uses placeholders in curl examples", () => {
    const output = formatTradeBridgeStartupMessages(TOKEN).join("\n");

    assert.equal(output.split(TOKEN).length - 1, 1);
    assert.equal(output.match(/X-Trade-Bridge-Token: <SESSION_TOKEN>/g)?.length, 2);
    assert.equal(output.includes(`X-Trade-Bridge-Token: ${TOKEN}`), false);
  });
});

describe("trade bridge HTTP boundary", () => {
  it("routes health before the not-found response without invoking the executor", async () => {
    let executorCalls = 0;
    const now = new Date("2026-07-16T23:00:00.000Z");
    const { baseUrl } = await startServer({
      now: () => now,
      executeTrade: async (trade) => {
        executorCalls += 1;
        return confirmedResult(trade);
      },
    });

    const health = await fetch(`${baseUrl}/health`);
    const missing = await fetch(`${baseUrl}/missing`);

    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), {
      status: "ok",
      acceptingTrades: true,
      timestamp: now.toISOString(),
    });
    assert.equal(missing.status, 404);
    assert.equal(executorCalls, 0);
  });

  it("uses the production loopback listener and returns exact approved preflight headers", async () => {
    const { server, baseUrl } = await startServer();
    const address = server.address() as AddressInfo;
    assert.equal(address.address, TRADE_BRIDGE_HOST);

    const response = await fetch(`${baseUrl}/trade`, {
      method: "OPTIONS",
      headers: {
        Origin: ALLOWED_ORIGIN,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": `content-type,${TRADE_BRIDGE_TOKEN_HEADER}`,
        "Access-Control-Request-Private-Network": "true",
      },
    });

    assert.equal(response.status, 204);
    assert.equal(response.headers.get("access-control-allow-origin"), ALLOWED_ORIGIN);
    assert.equal(response.headers.get("access-control-allow-methods"), "POST, OPTIONS");
    assert.equal(
      response.headers.get("access-control-allow-headers"),
      `Content-Type, ${TRADE_BRIDGE_TOKEN_HEADER}`,
    );
    assert.equal(response.headers.get("access-control-allow-private-network"), "true");
    assert.equal(response.headers.get("vary"), "Origin, Access-Control-Request-Private-Network");
  });

  it("rejects missing and denied origins without invoking the executor", async () => {
    let executorCalls = 0;
    const { baseUrl } = await startServer({
      executeTrade: async (trade) => {
        executorCalls += 1;
        return confirmedResult(trade);
      },
    });

    const missing = await fetch(`${baseUrl}/trade`, {
      method: "POST",
      headers: {
        [TRADE_BRIDGE_TOKEN_HEADER]: TOKEN,
        "Content-Type": "application/json",
      },
      body: validBody(),
    });
    const denied = await fetch(`${baseUrl}/trade`, {
      method: "POST",
      headers: {
        Origin: DENIED_ORIGIN,
        [TRADE_BRIDGE_TOKEN_HEADER]: TOKEN,
        "Content-Type": "application/json",
      },
      body: validBody(),
    });

    assert.equal(missing.status, 403);
    assert.equal(denied.status, 403);
    assert.equal(denied.headers.get("access-control-allow-origin"), null);
    assert.equal(executorCalls, 0);
  });

  it("rejects missing and invalid tokens without invoking the executor", async () => {
    let executorCalls = 0;
    const { baseUrl } = await startServer({
      executeTrade: async (trade) => {
        executorCalls += 1;
        return confirmedResult(trade);
      },
    });

    const missing = await fetch(`${baseUrl}/trade`, {
      method: "POST",
      headers: { Origin: ALLOWED_ORIGIN, "Content-Type": "application/json" },
      body: validBody(),
    });
    const invalid = await fetch(`${baseUrl}/trade`, {
      method: "POST",
      headers: {
        Origin: ALLOWED_ORIGIN,
        [TRADE_BRIDGE_TOKEN_HEADER]: "b".repeat(43),
        "Content-Type": "application/json",
      },
      body: validBody(),
    });

    assert.equal(missing.status, 401);
    assert.equal(invalid.status, 401);
    assert.equal(executorCalls, 0);
  });

  it("rejects conflicting same-symbol orders without invoking the executor", async () => {
    let executorCalls = 0;
    const { baseUrl } = await startServer({
      executeTrade: async (trade) => {
        executorCalls += 1;
        return confirmedResult(trade);
      },
    });

    const response = await fetch(`${baseUrl}/trade`, {
      method: "POST",
      headers: authorizedHeaders(),
      body: JSON.stringify({
        trades: [
          { symbol: "AAPL", side: "buy", amount: 10 },
          { symbol: "aapl", side: "sell", amount: 10 },
        ],
      }),
    });

    assert.equal(response.status, 400);
    assert.equal(executorCalls, 0);
  });

  it("rejects a trade below the $1 minimum without invoking the executor", async () => {
    let executorCalls = 0;
    const { baseUrl } = await startServer({
      executeTrade: async (trade) => {
        executorCalls += 1;
        return confirmedResult(trade);
      },
    });

    const response = await fetch(`${baseUrl}/trade`, {
      method: "POST",
      headers: authorizedHeaders(),
      body: validBody("AAPL", 0.99),
    });

    assert.equal(response.status, 400);
    assert.equal(executorCalls, 0);
  });

  it("rejects invalid content type and oversized streamed bodies without invoking the executor", async () => {
    let executorCalls = 0;
    const { baseUrl } = await startServer({
      executeTrade: async (trade) => {
        executorCalls += 1;
        return confirmedResult(trade);
      },
    });

    const invalidContentType = await fetch(`${baseUrl}/trade`, {
      method: "POST",
      headers: authorizedHeaders("text/plain"),
      body: validBody(),
    });
    const oversized = await fetch(`${baseUrl}/trade`, {
      method: "POST",
      headers: authorizedHeaders(),
      body: "x".repeat(TRADE_BRIDGE_MAX_BODY_BYTES + 1),
    });

    assert.equal(invalidContentType.status, 415);
    assert.equal(oversized.status, 413);
    assert.equal(executorCalls, 0);
  });

  it("rejects a concurrent request while the first fake execution is active", async () => {
    let releaseExecution: (() => void) | undefined;
    let signalStarted: (() => void) | undefined;
    const executionReleased = new Promise<void>((resolve) => {
      releaseExecution = resolve;
    });
    const executionStarted = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    let executorCalls = 0;
    const { baseUrl } = await startServer({
      executeTrade: async (trade) => {
        executorCalls += 1;
        signalStarted?.();
        await executionReleased;
        return confirmedResult(trade);
      },
    });

    const firstRequest = fetch(`${baseUrl}/trade`, {
      method: "POST",
      headers: authorizedHeaders(),
      body: validBody("AAPL"),
    });
    await executionStarted;

    const concurrent = await fetch(`${baseUrl}/trade`, {
      method: "POST",
      headers: authorizedHeaders(),
      body: validBody("MSFT"),
    });
    assert.equal(concurrent.status, 409);
    assert.equal(executorCalls, 1);

    releaseExecution?.();
    const first = await firstRequest;
    assert.equal(first.status, 200);
  });

  it("releases the gate after validation and executor failures", async () => {
    let executorCalls = 0;
    const { baseUrl } = await startServer({
      executeTrade: async (trade) => {
        executorCalls += 1;
        if (executorCalls === 1) throw new Error("fake executor failure");
        return confirmedResult(trade);
      },
    });

    const invalid = await fetch(`${baseUrl}/trade`, {
      method: "POST",
      headers: authorizedHeaders(),
      body: "{",
    });
    const failedExecution = await fetch(`${baseUrl}/trade`, {
      method: "POST",
      headers: authorizedHeaders(),
      body: validBody("AAPL"),
    });
    const recovered = await fetch(`${baseUrl}/trade`, {
      method: "POST",
      headers: authorizedHeaders(),
      body: validBody("MSFT"),
    });

    assert.equal(invalid.status, 400);
    assert.equal(failedExecution.status, 200);
    assert.equal((await failedExecution.json() as { success: boolean }).success, false);
    assert.equal(recovered.status, 200);
    assert.equal((await recovered.json() as { success: boolean }).success, true);
    assert.equal(executorCalls, 2);
  });
});
```

## `tsconfig.trade-bridge-client.spec.json`

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "types": ["jasmine", "node"]
  },
  "files": [
    "src/app/features/rh-agent/services/trade-bridge-client.service.spec.ts"
  ],
  "include": [
    "**/*.d.ts"
  ]
}
```

## `functions/package.json`

```json
{
  "name": "functions",
  "scripts": {
    "lint": "eslint --ext .js,.ts src",
    "build": "esbuild src/index.ts --bundle --platform=node --target=node20 --format=esm --outfile=lib/index.js --external:firebase-admin --external:firebase-functions --external:google-auth-library --external:busboy --external:node-fetch --external:@anthropic-ai/sdk",
    "build:watch": "npm run build -- --watch",
    "typecheck": "tsc --noEmit",
    "test:trade-bridge": "tsx --test ../tests/functions/trade-bridge-security.test.ts ../tests/functions/trade-bridge-http.test.ts",
    "serve": "npm run build && firebase emulators:start --only functions",
    "shell": "npm run build && firebase functions:shell",
    "start": "npm run shell",
    "deploy": "firebase deploy --only functions",
    "logs": "firebase functions:log",
    "dev": "npx tsx src/rh-agent/index.ts",
    "seed:rh-agent": "npx tsx scripts/seed-rh-agent-from-prod.ts"
  },
  "type": "module",
  "engines": {
    "node": "20"
  },
  "main": "lib/index.js",
  "dependencies": {
    "@anthropic-ai/sdk": "^0.39.0",
    "@modelcontextprotocol/sdk": "^1.12.1",
    "busboy": "^1.6.0",
    "dotenv": "^16.4.0",
    "firebase-admin": "^12.7.0",
    "firebase-functions": "^7.0.3",
    "google-auth-library": "^9.14.2"
  },
  "devDependencies": {
    "@types/busboy": "^1.5.4",
    "@types/node": "^22.0.0",
    "@typescript-eslint/eslint-plugin": "^5.12.0",
    "@typescript-eslint/parser": "^5.12.0",
    "esbuild": "^0.28.1",
    "eslint": "^8.9.0",
    "eslint-config-google": "^0.14.0",
    "eslint-plugin-import": "^2.25.4",
    "firebase-functions-test": "^3.3.0",
    "tsx": "^4.0.0",
    "typescript": "^5.8.0"
  },
  "private": true
}
```

## `package.json`

```json
{
  "name": "rel-str",
  "version": "0.0.0",
  "scripts": {
    "ng": "ng",
    "start": "ng serve",
    "prebuild": "node scripts/gen-syncfusion-license.js",
    "build": "ng build",
    "watch": "ng build --watch --configuration development",
    "build:functions": "npm --prefix functions run build",
    "test:trade-bridge": "npm --prefix functions run test:trade-bridge",
    "test:trade-bridge-client": "ng test --watch=false --browsers=ChromeHeadless --ts-config=tsconfig.trade-bridge-client.spec.json --include=src/app/features/rh-agent/services/trade-bridge-client.service.spec.ts",
    "test:signal-list": "ng test --watch=false --browsers=ChromeHeadless --ts-config=tsconfig.signal-list.spec.json --include=src/app/features/rh-agent/components/signal-list/signal-list.component.spec.ts",
    "validate": "npm run build -- --configuration development --no-progress && npm --prefix functions run typecheck && npm run test:trade-bridge-client && npm run test:signal-list && npm run test:trade-bridge",
    "emulators:start": "npm run build:functions && firebase emulators:start --only auth,functions,firestore,pubsub,storage --import=.firebase/emulator-data --export-on-exit",
    "emulators:export": "npx firebase emulators:export .firebase/emulator-data --force",
    "emulators:stop": "npm run emulators:export && powershell -NoProfile -ExecutionPolicy Bypass -Command \"$exportDir='.firebase\\emulator-data'; $hubUp = (Get-NetTCPConnection -LocalPort 4410 -ErrorAction SilentlyContinue); if($hubUp){ Write-Output 'Emulator Hub detected on 4410. Attempting export via Hub REST...'; $exportOk=$false; $attempt=1; $max=2; while(-not $exportOk -and $attempt -le $max){ try { $body = @{ path = $exportDir } | ConvertTo-Json; $resp = Invoke-RestMethod -Uri 'http://127.0.0.1:4410/_admin/export' -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 15; if($resp){ Write-Output 'Export succeeded.'; $exportOk=$true } } catch { Write-Output ('Export attempt ' + $attempt + ' failed via Hub REST; retrying...') } $attempt++ } if(-not $exportOk){ Write-Output 'Export failed after retries; proceeding to stop.' } } else { Write-Output 'Emulator Hub not detected on 4410; skipping export.' } ; $ports=@(4210,9100,5002,8088,8087,9200,4410,4010,4510); $maxAttempts=3; for($a=1; $a -le $maxAttempts; $a++){ Write-Output ('Kill attempt ' + $a + ' ...'); foreach($p in $ports){ try { $conns=Get-NetTCPConnection -LocalPort $p -ErrorAction SilentlyContinue; if($conns){ ($conns | Select-Object -ExpandProperty OwningProcess | Sort-Object -Unique | Where-Object { $_ -gt 0 }) | ForEach-Object { try { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue; Write-Output ('Killed PID ' + $_ + ' on port ' + $p) } catch { Write-Output ('Failed to kill PID ' + $_ + ' on port ' + $p) } } } else { Write-Output ('No process on port ' + $p) } } catch { Write-Output ('Query failed for port ' + $p + ': ' + $_) } } Start-Sleep -Seconds 1 } $stillOpen=@(); foreach($p in $ports){ $conns=Get-NetTCPConnection -LocalPort $p -ErrorAction SilentlyContinue; if($conns){ $stillOpen += $p } } if($stillOpen.Count -gt 0){ Write-Output ('Ports still open after attempts: ' + ($stillOpen -join ', ')) } else { Write-Output 'All emulator ports are closed.' }\"",
    "ports:kill": "powershell -NoProfile -ExecutionPolicy Bypass -Command \"$ports=@(9100,5002,8088,8087,9200,4410,4010,4510); foreach($p in $ports){ $conns=Get-NetTCPConnection -LocalPort $p -ErrorAction SilentlyContinue; if($conns){ ($conns | Select-Object -ExpandProperty OwningProcess | Sort-Object -Unique | Where-Object { $_ -gt 0 }) | ForEach-Object { try { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue; Write-Output ('Killed PID ' + $_ + ' on port ' + $p) } catch { Write-Output ('Failed to kill PID ' + $_ + ' on port ' + $p) } } } else { Write-Output ('No process on port ' + $p) } }\"",
    "emulators": "firebase emulators:start --only auth,functions,firestore --import=.firebase/emulator-data --export-on-exit",
    "e2e": "cypress open",
    "e2e:run": "cypress run",
    "pubsub:topic": "powershell -NoProfile -ExecutionPolicy Bypass -Command \"Invoke-RestMethod -Uri 'http://127.0.0.1:8087/v1/projects/rel-str/topics/partner-data-ready' -Method Put | ConvertTo-Json -Depth 5\"",
    "pubsub:list:topics": "powershell -NoProfile -ExecutionPolicy Bypass -Command \"Invoke-RestMethod -Uri 'http://127.0.0.1:8087/v1/projects/rel-str/topics' -Method Get | ConvertTo-Json -Depth 5\"",
    "pubsub:list:subs": "powershell -NoProfile -ExecutionPolicy Bypass -Command \"Invoke-RestMethod -Uri 'http://127.0.0.1:8087/v1/projects/rel-str/subscriptions' -Method Get | ConvertTo-Json -Depth 5\"",
    "pubsub:hb": "powershell -NoProfile -ExecutionPolicy Bypass -Command \"$body = @{ messages = @(@{ attributes = @{ runType = 'heartbeat'; heartbeat = 'true' }; data = 'e30=' }) } | ConvertTo-Json -Depth 5; Invoke-RestMethod -Uri 'http://127.0.0.1:8087/v1/projects/rel-str/topics/partner-data-ready:publish' -Method Post -ContentType 'application/json' -Body $body | ConvertTo-Json -Depth 5\"",
    "pubsub:run": "powershell -NoProfile -ExecutionPolicy Bypass -Command \"$runId = 'local-' + (Get-Date -Format 'yyyyMMdd-HHmmss'); $msg = @{ messages = @(@{ attributes = @{ runType = 'ts_daily_post'; runId = $runId }; data = 'e30=' }) } | ConvertTo-Json -Depth 5; Invoke-RestMethod -Uri 'http://127.0.0.1:8087/v1/projects/rel-str/topics/partner-data-ready:publish' -Method Post -ContentType 'application/json' -Body $msg | ConvertTo-Json -Depth 5\"",
    "diag:pairs:emu": "powershell -NoProfile -ExecutionPolicy Bypass -Command \"$body = @{ env = 'emu' } | ConvertTo-Json -Depth 5; Invoke-RestMethod -Uri 'http://127.0.0.1:5002/rel-str/us-central1/diagnosePairArchivesAdmin' -Method Post -ContentType 'application/json' -Headers @{ Authorization = 'Bearer local-admin' } -Body $body | ConvertTo-Json -Depth 5\"",
    "diag:pairs:prod": "powershell -NoProfile -ExecutionPolicy Bypass -Command \"$token = $env:ADMIN_BACKFILL_TOKEN; if(-not $token){ Write-Error 'ADMIN_BACKFILL_TOKEN env var is not set.'; exit 1 }; $body = @{ env = 'prod' } | ConvertTo-Json -Depth 5; Invoke-RestMethod -Uri 'https://us-central1-rel-str.cloudfunctions.net/diagnosePairArchivesAdmin' -Method Post -ContentType 'application/json' -Headers @{ Authorization = ('Bearer ' + $token) } -Body $body | ConvertTo-Json -Depth 5\"",
    "backfill:symbol-data:trades:emu": "powershell -NoProfile -ExecutionPolicy Bypass -Command \"Invoke-RestMethod -Uri 'http://127.0.0.1:5002/rel-str/us-central1/backfillSymbolDataFromTradesAdmin' -Method Post -Headers @{ Authorization = 'Bearer local-admin' } | ConvertTo-Json -Depth 5\"",
    "backfill:symbol-data:trades:prod": "powershell -NoProfile -ExecutionPolicy Bypass -Command \"$token = $env:ADMIN_BACKFILL_TOKEN; if(-not $token){ Write-Error 'ADMIN_BACKFILL_TOKEN env var is not set.'; exit 1 }; Invoke-RestMethod -Uri 'https://us-central1-rel-str.cloudfunctions.net/backfillSymbolDataFromTradesAdmin' -Method Post -Headers @{ Authorization = ('Bearer ' + $token) } | ConvertTo-Json -Depth 5\""
  },
  "overrides": {
    "firebase": "11.10.0"
  },
  "private": true,
  "dependencies": {
    "@angular/animations": "^21.2.17",
    "@angular/cdk": "^20.2.14",
    "@angular/common": "^21.2.17",
    "@angular/compiler": "^21.2.17",
    "@angular/core": "^21.2.17",
    "@angular/fire": "^20.0.1",
    "@angular/forms": "^21.2.17",
    "@angular/material": "^20.2.14",
    "@angular/platform-browser": "^21.2.17",
    "@angular/platform-browser-dynamic": "^21.2.17",
    "@angular/router": "^21.2.17",
    "@ngrx/signals": "21.1.1",
    "@syncfusion/ej2-angular-base": "^33.2.10",
    "@syncfusion/ej2-angular-charts": "^30.2.7",
    "@syncfusion/ej2-base": "^30.2.6",
    "@syncfusion/ej2-charts": "^30.2.7",
    "javascript-color-gradient": "^2.5.0",
    "rxjs": "~7.8.0",
    "tslib": "^2.3.0",
    "zone.js": "~0.15.1"
  },
  "devDependencies": {
    "@angular-devkit/build-angular": "^21.2.15",
    "@angular/cli": "^21.2.15",
    "@angular/compiler-cli": "^21.2.17",
    "@types/jasmine": "~5.1.0",
    "@types/javascript-color-gradient": "^2.4.2",
    "@types/node": "^18.18.0",
    "dotenv": "^17.2.2",
    "jasmine-core": "~5.1.0",
    "karma": "~6.4.0",
    "karma-chrome-launcher": "~3.2.0",
    "karma-coverage": "~2.2.0",
    "karma-jasmine": "~5.1.0",
    "karma-jasmine-html-reporter": "~2.1.0",
    "typescript": "~5.9.3"
  },
  "prettier": {
    "printWidth": 1600,
    "trailingComma": "es5",
    "tabWidth": 4,
    "useTabs": true,
    "semi": true,
    "singleQuote": true,
    "bracketSameLine": false
  }
}
```

# Last Hardened Integrated Bridge Snapshot

**Source commit:** `44b9ca3712774a3df8beddc6b3990449567286f0`

These files preserve the exact final Order-page integration, legacy execution/trade persistence, deployment exports, and Firestore configuration before retirement. Combined with the preceding residual-source snapshot, they provide the complete historical implementation record.


## `44b9ca3:firestore.indexes.json`

```json
{
  "indexes": [
    {
      "collectionGroup": "items",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "pair", "order": "ASCENDING" },
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "exitDay", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "items",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "pair", "order": "ASCENDING" },
        { "fieldPath": "entryDay", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "rh-agent-symbols",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "enabled", "order": "ASCENDING" },
        { "fieldPath": "lastDailySignalDate", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "rh-agent-symbols",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "enabled", "order": "ASCENDING" },
        { "fieldPath": "lastWeeklySignalDate", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "rh-agent-symbols",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "enabled", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "rh-agent-symbols",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "enabled", "order": "ASCENDING" },
        { "fieldPath": "source", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "signals",
      "queryScope": "COLLECTION_GROUP",
      "fields": [
        { "fieldPath": "timeframe", "order": "ASCENDING" },
        { "fieldPath": "marketDate", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "signals",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "timeframe", "order": "ASCENDING" },
        { "fieldPath": "marketDate", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "rh-agent-triage-decisions",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "userId", "order": "ASCENDING" },
        { "fieldPath": "date", "order": "DESCENDING" },
        { "fieldPath": "symbol", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "rh-agent-triage-decisions",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "userId", "order": "ASCENDING" },
        { "fieldPath": "date", "order": "ASCENDING" },
        { "fieldPath": "status", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "rh-agent-symbol-meta",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "userId", "order": "ASCENDING" },
        { "fieldPath": "symbol", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "rh-agent-occurrence-decisions",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "userId", "order": "ASCENDING" },
        { "fieldPath": "runId", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "rh-agent-occurrence-decisions",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "userId", "order": "ASCENDING" },
        { "fieldPath": "runId", "order": "ASCENDING" },
        { "fieldPath": "isCurrentInLatestRun", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "rh-agent-occurrence-decisions",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "userId", "order": "ASCENDING" },
        { "fieldPath": "isCurrentInLatestRun", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "rh-agent-occurrence-decisions",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "userId", "order": "ASCENDING" },
        { "fieldPath": "symbol", "order": "ASCENDING" },
        { "fieldPath": "isCurrentInLatestRun", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "rh-agent-occurrence-decisions",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "userId", "order": "ASCENDING" },
        { "fieldPath": "marketDate", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "trades",
      "queryScope": "COLLECTION_GROUP",
      "fields": [
        { "fieldPath": "userId", "order": "ASCENDING" },
        { "fieldPath": "runId", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "rh-agent-symbol-lists",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "userId", "order": "ASCENDING" },
        { "fieldPath": "name", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "run-ids",
      "queryScope": "COLLECTION_GROUP",
      "fields": [
        { "fieldPath": "runId", "order": "ASCENDING" },
        { "fieldPath": "marketDate", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "signal-history",
      "queryScope": "COLLECTION_GROUP",
      "fields": [
        { "fieldPath": "date", "order": "ASCENDING" },
        { "fieldPath": "symbol", "order": "ASCENDING" }
      ]
    }
  ],
  "fieldOverrides": [
    {
      "collectionGroup": "run-ids",
      "fieldPath": "runId",
      "indexes": [
        { "order": "ASCENDING", "queryScope": "COLLECTION_GROUP" }
      ]
    }
  ]
}
```

## `44b9ca3:firestore.rules`

```javascript
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    // Helper functions
    function partnerCallerEmail() {
      return "rel-str-partner-caller-prod@rel-str.iam.gserviceaccount.com";
    }
    function isPartnerCaller() {
      return request.auth != null && request.auth.token.email == partnerCallerEmail();
    }
    // DEV-ONLY: whitelist a local developer account to seed data in emulator/dev
    function isDevUser() {
      return request.auth != null && request.auth.token.email in [
        "test@user.com"
      ];
    }

    // Authenticated read of tracked symbols for UI symbol pickers (no writes)
    match /tracked-symbols/{id} {
      allow read: if request.auth != null;
      allow write: if false;
    }

    // Authenticated read of pairs-data written by backend; FE is read-only
    match /pairs-data/{pairId} {
      allow read: if request.auth != null;
      allow write: if false;

      // Per-pair canonical signals (year shards with opens/closes subcollections)
      // - pairs-data/{PAIR}/signals/{YYYY}/opens/{signalId}
      // - pairs-data/{PAIR}/signals/{YYYY}/closes/{signalId}
      match /signals/{year}/{subcol}/{docId} {
        allow read: if request.auth != null && year.matches('^\\d{4}$');
        allow write: if false;
      }

      // Per-pair signals-daily (year-closed shards only)
      // - pairs-data/{PAIR}/signals-daily/{YYYY}/days/{day}
      match /signals-daily/{bucket} {
        allow read: if request.auth != null && bucket.matches('^\\d{4}$');
        allow write: if false;
        match /days/{day} {
          allow read: if request.auth != null;
          allow write: if false;
        }
      }

      // Archive: year-sharded per-day docs under dynamic collections
      // - archive-YYYY (daily)
      // - archive-weekly-YYYY (weekly)
      // - archive-monthly-YYYY (monthly)
      match /{archiveCol}/{docId} {
        allow read: if request.auth != null
          && archiveCol.matches('^(archive|archive-weekly|archive-monthly)-\\d{4}$');
        allow write: if false; // backend-only writes via functions
      }
    }

    // Symbol-level mirrors (e.g., currentPrice) written by backend; FE is read-only
    match /symbol-data/{symbolId} {
      allow read: if request.auth != null;
      allow write: if false;

      // Year-sharded daily bars — symbol-data schema (RS-BARS-STORAGE-2607-01)
      match /daily/{year} {
        allow read: if request.auth != null;
        allow write: if false;
      }

      // Flat weekly bars — single doc at weekly/all
      match /weekly/{docId} {
        allow read: if request.auth != null;
        allow write: if false;
      }

      // Flat monthly bars — single doc at monthly/all
      match /monthly/{docId} {
        allow read: if request.auth != null;
        allow write: if false;
      }
    }

    // Heatmap snapshots for dashboard v3 (viewport docs), backend-written, FE read-only
    match /heatmap-snapshots/{snapshotId} {
      allow read: if request.auth != null;
      allow write: if false;
    }

    // Partner events (backend refresh runs) for header status
    match /partner-events/{eventId} {
      allow read: if request.auth != null;
      allow write: if false;
    }

    match /app/refresh-status {
      allow read: if request.auth != null;
      // Allow writes from Functions SA in prod, and a dev user in local dev only
      allow create, update: if isPartnerCaller() || isDevUser();
      allow delete: if false;
    }

    // RS warning events persisted by backend for UI visibility
    match /rs-warnings/{docId} {
      allow read: if request.auth != null;
      allow write: if false; // backend-only writes via functions
    }

    // Positions single-root open + year-closed shards
    // - positions/open/items/{id}
    // - positions/{YYYY}-closed/items/{id}
    match /positions/{bucket} {
      // legacy doc id path: positions/{id}
      allow read: if request.auth != null;
      allow write: if false;
      match /items/{id} {
        allow read: if request.auth != null;
        allow write: if false;
      }
    }

    // Root signals-daily mirror (doc-per-day only)
    // - signals-daily/{YYYY}/days/{day}
    match /signals-daily/{year} {
      allow read: if request.auth != null;
      allow write: if false;
      match /days/{day} {
        allow read: if request.auth != null;
        allow write: if false;
      }
    }

    // Authenticated user profile root: allow user to read/write only their own doc
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;

      // User lists: restrict to owner as well
      match /lists/{listId} {
        allow read, write: if request.auth != null && request.auth.uid == userId;
      }

      // Trade journal entries for this user
      match /trades/{tradeId} {
        allow read, write: if request.auth != null && request.auth.uid == userId;
      }
    }

    // RH Agent symbol list — authenticated read, backend-only write
    match /rh-agent-symbols/{symbol} {
      allow read: if request.auth != null;
      allow write: if false;

      // Per-symbol signal dates (date-centric path — kept for backward compatibility)
      match /signal-dates/{barDate} {
        allow read: if request.auth != null;
        allow write: if false;
      }

      // Per-symbol run-ids (run-centric real-time path — one doc per run per symbol)
      match /run-ids/{runId} {
        allow read: if request.auth != null;
        allow write: if false;
      }

      // Per-symbol signal history (canonical EOD records written by nightly run)
      match /signal-history/{date} {
        allow read: if request.auth != null;
        allow write: if false;
      }

      // Per-symbol signal history (deprecated — kept for migration period)
      match /signals/{signalId} {
        allow read: if request.auth != null;
        allow write: if false;
      }
    }

    // RH Agent opportunities (legacy collection — not deleted yet)
    match /rh-agent-opportunities/{docId} {
      allow read: if request.auth != null;
      allow write: if false;
    }

    // RH Agent run history
    match /rh-agent-runs/{runId} {
      allow read: if request.auth != null;
      allow write: if false;
    }

    // RH Agent PACR triage decisions — user-scoped read/write
    match /rh-agent-triage-decisions/{decisionId} {
      allow read: if request.auth != null && (resource == null || request.auth.uid == resource.data.userId);
      allow create: if request.auth != null && request.auth.uid == request.resource.data.userId;
      allow update: if request.auth != null && request.auth.uid == resource.data.userId;
      allow delete: if request.auth != null && request.auth.uid == resource.data.userId;
    }

    // RH Agent occurrence-level decisions — user-scoped read/write
    // Keyed by runId + symbol + timeframe + signalType so multiple intraday
    // occurrences do not overwrite one another.
    match /rh-agent-occurrence-decisions/{decisionId} {
      allow read: if request.auth != null && (resource == null || request.auth.uid == resource.data.userId);
      allow create: if request.auth != null && request.auth.uid == request.resource.data.userId;
      allow update: if request.auth != null && request.auth.uid == resource.data.userId;
      allow delete: if request.auth != null && request.auth.uid == resource.data.userId;
    }

    // RH Agent trades — user-scoped read/write
    // Trades live under symbol docs: rh-agent-trades/{symbol}/trades/{tradeId}.
    // The tradeId is human-readable: symbol_marketDate_timeframe_signalType.
    match /rh-agent-trades/{symbol}/trades/{tradeId} {
      allow read: if request.auth != null && (resource == null || request.auth.uid == resource.data.userId);
      allow create: if request.auth != null && request.auth.uid == request.resource.data.userId;
      allow update: if request.auth != null && request.auth.uid == resource.data.userId;
      allow delete: if request.auth != null && request.auth.uid == resource.data.userId;
    }

    // RH Agent symbol meta — user-scoped read/write
    match /rh-agent-symbol-meta/{symbol} {
      allow read: if request.auth != null && (resource == null || request.auth.uid == resource.data.userId);
      allow create: if request.auth != null && request.auth.uid == request.resource.data.userId;
      allow update: if request.auth != null && request.auth.uid == resource.data.userId;
      allow delete: if request.auth != null && request.auth.uid == resource.data.userId;
    }

    // RH Agent symbol lists — user-scoped read/write
    match /rh-agent-symbol-lists/{listId} {
      allow read: if request.auth != null && (resource == null || request.auth.uid == resource.data.userId);
      allow create: if request.auth != null && request.auth.uid == request.resource.data.userId;
      allow update: if request.auth != null && request.auth.uid == resource.data.userId;
      allow delete: if request.auth != null && request.auth.uid == resource.data.userId;
    }

    // Default deny for all other collections
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

## `44b9ca3:functions/src/index.ts`

```typescript
import './init';

export {partnerProxyTest, getTrackedSymbols} from "./partner-proxy";

/**
 * Cloud Functions below are intentionally commented out.
 *
 * - processSymbolsReady and processSymbolsReadyHttpTest implement the
 *   symbol-driven RS ingestion pipeline based on partner-symbols-ready
 *   notifications.
 * - That pipeline previously caused ordering/sync issues and has been
 *   parked in favor of the pair-centric, partner-data-ready driven
 *   processDataReadyRunV2 path.
 * - The .env flag USE_SYMBOL_DRIVEN_PIPELINE is currently set to false;
 *   re-enabling this symbol-driven pipeline would require both uncommenting
 *   these exports and setting USE_SYMBOL_DRIVEN_PIPELINE=true.
 *
 * The exports are left here (commented) to make re-enabling explicit if we
 * ever decide to revive the symbol-driven pipeline in the future.
 */
// export { processDataReadyRunV2, processSymbolsReady, processSymbolsReadyHttpTest } from "./webhooks/partner-webhooks";

export { processDataReadyRunV2 } from "./webhooks/partner-webhooks";

export {
  recomputeRegisteredBackfill,
  diagnosePairDays,
  diagnosePairDaysAdmin,
  diagnoseRegisteredRangeAdmin,
  autoDiagnoseAndFixDaily,
  backfillSignalsPipelineAdmin,
  cleanupIntraperiodBar,
  purgePairSignalsAndActivityAllHttp,
  refreshMarketHolidaysAdmin,
  ingestStaticPairsAdmin,
  normalizePairRegistryAdmin,
} from "./webhooks/admin-tasks";

export { recomputeRsBackfillAdmin } from './rs/time-series/rs-backfill-admin';
export { drainRsBackfillRunAdmin } from './rs/time-series/rs-time-series-jobs.drain-admin';
export { processRsJobTask } from './rs/time-series/rs-time-series-jobs.worker';

export {
  diagnosePairArchives,
  diagnosePairArchivesAdmin,
} from './webhooks/diagnostics';

export * from './webhooks/registry-actions';

export { getPairRSArchive } from './archive';

export { rebuildHeatmapSnapshotAdmin } from './rs/heatmap/heatmap-snapshots';
export { updateHeatmapSnapshotTask } from './rs/heatmap/heatmap-snapshots';
export { migrateHeatmapDocIdsAdmin } from './rs/heatmap/heatmap-snapshots';
export { bulkRebuildShardsAdmin } from './rs/heatmap/heatmap-snapshots';
export { deleteHeatmapSnapshotsAdmin } from './rs/heatmap/heatmap-snapshots';
export { rebuildHeatmapSnapshotsHttpAdmin } from './rs/heatmap/rebuild-heatmap-http-admin';

export { tradeJournalManager } from './trade-journal-manager';

// RS chart / OHLC bars callable
export { getPairDailyBars } from './rs-chart-bars.callables';

// RsSignalHistory callable exports
export {
  getPairSignals,
  getPnLSummary,
  updatePositionActuals,
} from './rs-signal-history.callables';

// Admin cleanup callables
export {
  purgePairsDataRootDataField,
  purgeNonYearShardRootDocs,
  purgeMisShardedPositionItems,
  purgePairSignalsAll,
  purgePairSignalsActivityAll,
  purgePairSignalsAndActivityAll,
  backfillPositionsBucketMetadata,
  purgeAllPositions,
} from './cleanup.callables';

export { backfillSymbolDataFromPairsAdmin } from './admin/backfill-symbol-data-from-pairs';
export { backfillSymbolDataFromTradesAdmin, backfillSymbolDataForTradesDaily } from './admin/backfill-symbol-data-from-trades';
export { syncTrackedSymbolsDaily } from './scheduled/sync-tracked-symbols';
export { cleanupRsBackfillRuns } from './scheduled/cleanup-rs-backfill-runs';

// RH Agent (Robinhood Trading Agent) exports - Event-driven daily scan architecture
export { rhAgentPdrTrigger, rhAgentTriggerDaily } from './rh-agent-cloud-function/rh-agent-trigger';
export { rhAgentProcessSymbol } from './rh-agent-cloud-function/rh-agent-worker';

// RH Agent Admin utilities
export {
  clearRhAgentSymbolsAdmin,
  seedAllSymbolsFromPartner,
} from './rh-agent-cloud-function/rh-agent-seed-admin';

// RH Agent Callables (for frontend dashboard)
export {
  rhAgentGetSymbolsWithSignals,
  rhAgentGetSymbolSignalHistory,
} from './rh-agent-cloud-function/rh-agent-dashboard-callables';

// RH Agent Indicator Series callable
export { rhAgentGetSymbolIndicatorSeriesV2 } from './rh-agent-cloud-function/rh-agent-indicator-series';

// RH Agent Manual Run + status + run history callables
export {
  rhAgentManualRun,
  rhAgentGetStatus,
  rhAgentGetRunHistory,
} from './rh-agent-cloud-function/rh-agent-callables';

// RH Agent Company Overview Sync (Phase 1)
export {
  rhAgentOverviewSyncWeekly,
  rhAgentOverviewSyncAdmin,
} from './rh-agent-cloud-function/rh-agent-overview-sync-orchestrator';
export { rhAgentOverviewSyncSymbol } from './rh-agent-cloud-function/rh-agent-overview-sync-worker';

// Symbol-data nightly sync — single source of truth for OHLCV bars
export { symbolDataSyncNightly, symbolDataSyncAdminHttp, symbolDataSyncSymbol } from './symbol-data-sync/symbol-data-sync';

// Symbol-data onboarding consumer — backfills new symbols emitted by partner
export { processSymbolAdded } from './symbol-data-sync/symbol-data-symbol-added';

// RH Agent Trade Executor (MCP direct integration)
export {
  rhExecuteTrade,
  rhGetAccountSummary,
} from './rh-agent-cloud-function/rh-agent-executor';
```

## `44b9ca3:src/app/core/common/constants.ts`

```typescript
import { NavItem } from "./interfaces";

export const NAV_MENU_ITEMS: NavItem[] = [
    // {
    //     name: 'documentation',
    //     text: 'documentation',
    //     href: 'documentation',
    //     mobileOnly: false,
    //     external: true,
    //     target: '_self',
    // },
    // {
    //     name: 'contact',
    //     text: 'contact',
    //     href: 'contact',
    //     mobileOnly: false,
    //     external: true,
    //     target: '_self',
    // },
    {
        name: 'symbols',
        text: 'symbols',
        href: '',
        mobileOnly: false,
        external: true,
        target: '_self',
    },
    
    {
        name: 'signup',
        text: 'signup',
        href: 'signup',
        mobileOnly: false,
        external: true,
        target: '_self',
    },
    {
        name: 'login',
        text: 'login',
        href: 'login',
        mobileOnly: false,
        external: true,
        target: '_self',
    },
    {
        name: 'dashboard',
        text: 'dashboard',
        href: 'dashboard',
        mobileOnly: false,
        external: false,
        target: '_self',
    },
    {
        name: 'dashboard-v2',
        text: 'dashboard-v2',
        href: 'dashboard-v2',
        mobileOnly: false,
        external: false,
        target: '_self',
    },
    {
        name: 'dashboard-v3',
        text: 'dashboard-v3',
        href: 'dashboard-v3',
        mobileOnly: false,
        external: false,
        target: '_self',
    },  
    {
        name: 'decision-board',
        text: 'decision board',
        href: 'decision-board',
        mobileOnly: false,
        external: false,
        target: '_self',
    },
    {
        name: 'positions',
        text: 'positions',
        href: 'positions-view',
        mobileOnly: false,
        external: false,
        target: '_self',
    },
    {
        name: 'trade-journal',
        text: 'trade journal',
        href: 'trade-journal',
        mobileOnly: false,
        external: false,
        target: '_self',
    },
    {
        name: 'heatmap',
        text: 'heatmap',
        href: 'heatmap-view',
        mobileOnly: false,
        external: false,
        target: '_self',
    },
    {
        name: 'heatmap-chart',
        text: 'heatmap chart',
        href: 'heatmap-chart/SPY/AAPL',
        mobileOnly: false,
        external: false,
        target: '_self',
    },
    {
        name: 'rs-chart',
        text: 'rs-chart',
        href: 'rs-chart',
        mobileOnly: false,
        external: false,
        target: '_self',
    },
    {
        name: 'sync-chart',
        text: 'sync-chart',
        href: 'sync-chart',
        mobileOnly: false,
        external: false,
        target: '_self',
    },
    {
        name: 'rs-table',
        text: 'rs-table',
        href: 'rs-table',
        mobileOnly: false,
        external: false,
        target: '_self',
    },
    {
        name: 'rh-agent',
        text: 'RH Agent',
        href: 'rh-agent',
        mobileOnly: false,
        external: false,
        target: '_self',
    },
    {
        name: 'history',
        text: 'history',
        href: 'history',
        mobileOnly: false,
        external: false,
        target: '_self',
    },
    {
        name: 'logout',
        text: 'logout',
        href: '',
        mobileOnly: false,
        external: false,
        target: '_self',
    },
    // {
    //     name: 'chart',
    //     text: '',
    //     href: '/',
    //     mobileOnly: false,
    //     target: '_self',
    // },
    // {
    //     name: '',
    //     text: '',
    //     target: '',
    //     mobileOnly: false,
    //     children: [
    //         {
    //             name: '',
    //             text: '',
    //             href: '',
    //             target: '_self',
    //         },
    //
    // ]
]

export const NUM_HEATMAP_MIDPOINTS = 11;

// =============================
// Firebase/Firestore constants
// =============================

/** Canonical callable function names used by the FE. */
export enum CallableName {
  GET_TRACKED_SYMBOLS = 'getTrackedSymbols',
  VALIDATE_AND_REGISTER_PAIRS = 'validateAndRegisterPairs',
  UNREGISTER_PAIRS = 'unregisterPairs',
  // RsSignalHistory
  GET_PAIR_SIGNALS = 'getPairSignals',
  GET_DAILY_SIGNALS = 'getDailySignals',
  GET_PNL_SUMMARY = 'getPnLSummary',
  UPDATE_POSITION_ACTUALS = 'updatePositionActuals',
  /** Diagnose and optionally auto-fix missing pair-day RS entries */
  DIAGNOSE_PAIR_DAYS = 'diagnosePairDays',
  /** RS chart: daily OHLCV bars via SavantAPI */
  GET_PAIR_DAILY_BARS = 'getPairDailyBars',
}

/** Top-level Firestore collections used by the FE. */
export enum Collection {
  TRACKED_SYMBOLS = 'tracked-symbols',
  PAIR_REGISTRY = 'pair-registry',
  PAIRS_DATA = 'pairs-data',
  USERS = 'users',
  ADMIN = 'admin',
  APP = 'app',
  POSITIONS = 'positions',
  SYMBOL_DATA = 'symbol-data',
  RH_TRIAGE_DECISIONS = 'rh-agent-triage-decisions',
  RH_OCCURRENCE_DECISIONS = 'rh-agent-occurrence-decisions',
  RH_TRADES = 'rh-agent-trades',
  RH_REVIEW_FLAGS = 'rh-agent-review-flags',
  RH_SYMBOL_LISTS = 'rh-agent-symbol-lists',
  RH_SYMBOL_META = 'rh-agent-symbol-meta',
  RH_RUNS = 'rh-agent-runs',
}

/** Known subcollection names under a user document. */
export enum Subcollection {
  LISTS = 'lists',
  REFRESH_STATUS = 'refresh-status',
  ITEMS = 'items',
  TRADES = 'trades',
}

/** Bucket document ids used under certain root collections (e.g., positions/open). */
export enum BucketDocId {
  OPEN = 'open',
}

// =============================
// Trade journal enums
// =============================

export enum TradeDirection {
  LONG = 'LONG',
  SHORT = 'SHORT',
}

export enum TradeStatus {
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
  CANCELED = 'CANCELED',
  QUEUED = 'QUEUED',
  SETUP = 'SETUP',
}

/** Helper to produce the lists collection path for a user. */
export const userListsPath = (uid: string) => `${Collection.USERS}/${uid}/${Subcollection.LISTS}`;
```

## `44b9ca3:src/app/features/rh-agent/common/rh-agent.constants.ts`

```typescript
/**
 * Shared RH Agent constants and enums.
 *
 * Keep cross-cutting RH Agent types here so they can be imported by
 * stores, services, and components without circular dependencies.
 */

import { SignalDirection } from '../../shared/constants/signal-direction';
export { SignalDirection };

/** Daily PACR review status for a symbol. */
export enum RhAgentReviewDecision {
  PENDING        = 'PENDING',
  REVIEW         = 'REVIEW',
  ACCEPT         = 'ACCEPT',
  CONSIDER       = 'CONSIDER',
  REJECT         = 'REJECT',
  EXCLUDE        = 'EXCLUDE',
  LOW_TRADABILITY = 'LOW_TRADABILITY',
  WATCH          = 'WATCH',
  EXECUTED       = 'EXECUTED',
}

/** All PACR review statuses in display order. */
export const ALL_REVIEW_STATUSES: RhAgentReviewDecision[] = [
  RhAgentReviewDecision.PENDING,
  RhAgentReviewDecision.REVIEW,
  RhAgentReviewDecision.ACCEPT,
  RhAgentReviewDecision.CONSIDER,
  RhAgentReviewDecision.REJECT,
  RhAgentReviewDecision.EXCLUDE,
  RhAgentReviewDecision.LOW_TRADABILITY,
  RhAgentReviewDecision.WATCH,
  RhAgentReviewDecision.EXECUTED,
];

/** Concrete count shape so templates can use dot access (e.g. counts.REVIEW). */
export type StatusCounts = {
  PENDING: number;
  REVIEW: number;
  ACCEPT: number;
  CONSIDER: number;
  REJECT: number;
  EXCLUDE: number;
  LOW_TRADABILITY: number;
  WATCH: number;
  EXECUTED: number;
};

/** Canonical names for the built-in user-managed symbol lists. */
export enum RhSymbolListName {
  NONE = 'NONE',
  PRIMARY = 'PRIMARY',
  SECONDARY = 'SECONDARY',
  NEUTRAL = 'NEUTRAL',
  AVOID = 'AVOID',
  HIDE = 'HIDE',
  PAST_SIGNALS = 'PAST_SIGNALS',
}

/** All built-in symbol list names in display order. */
export const ALL_SYMBOL_LIST_NAMES: RhSymbolListName[] = [
  RhSymbolListName.PRIMARY,
  RhSymbolListName.SECONDARY,
  RhSymbolListName.NEUTRAL,
  RhSymbolListName.AVOID,
  RhSymbolListName.HIDE,
  RhSymbolListName.PAST_SIGNALS,
];

/** Symbol type classification for the trading universe. */
export type SymbolType = 'STOCK' | 'ETF' | 'FUTURE' | 'FOREX' | 'CRYPTO' | 'OTHER';

/** Dimensions available for grouping the symbol list in the grouped review. */
export enum GroupDimension {
  SECTOR = 'sector',
  INDUSTRY = 'industry',
  MARKET_CAP_TIER = 'marketCapTier',
}

/** Signal timeframe filter options. */
export enum SignalTimeframe {
  ALL = 'ALL',
  DAILY = 'D',
  WEEKLY = 'W',
}

/** Signal persistence status. */
export enum SignalStatus {
  INTERIM = 'INTERIM',
  CONFIRMED = 'CONFIRMED',
}

/** Persisted trade status. */
export enum RhAgentTradeStatus {
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
}

/** Active timeframe + direction filter for the signal review page. */
export interface SignalFilter {
  timeframe: SignalTimeframe;
  direction: SignalDirection;
}

export const SIGNAL_FILTER_ALL: SignalFilter = {
  timeframe: SignalTimeframe.ALL,
  direction: SignalDirection.ALL,
};

/** Filter by who triggered the run. */
export enum RhAgentRunTriggerFilter {
  ALL      = 'all',
  MANUAL   = 'manual',
  PDR      = 'pdr',
  NIGHTLY  = 'nightly',
}

/** Filter by run date range. */
export enum RhAgentRunDateFilter {
  TODAY = 'today',
  WEEK  = 'week',
  ALL   = 'all',
}

/** Filter by run status. */
export enum RhAgentRunStatusFilter {
  ALL     = 'all',
  RUNNING = 'running',
  SUCCESS = 'success',
  FAILED  = 'failed',
  PARTIAL = 'partial',
}

/** Viewport mode for the chart-review sidebar. */
export type ViewportMode = 'signals' | 'browse';
```

## `44b9ca3:src/app/features/rh-agent/components/status-summary-chips/status-summary-chips.component.html`

```html
<div class="status-summary">
  @if (counts().REVIEW > 0) {
    <span class="status-chip review">↑ {{ counts().REVIEW }}</span>
  }
  @if (counts().ACCEPT > 0) {
    <span class="status-chip accept">✓ {{ counts().ACCEPT }}</span>
  }
  @if (counts().CONSIDER > 0) {
    <span class="status-chip consider">? {{ counts().CONSIDER }}</span>
  }
  @if (counts().REJECT > 0) {
    <span class="status-chip reject">✕ {{ counts().REJECT }}</span>
  }
  @if (counts().EXCLUDE > 0) {
    <span class="status-chip exclude">✕ {{ counts().EXCLUDE }}</span>
  }
  @if (counts().LOW_TRADABILITY > 0) {
    <span class="status-chip low-tradability">↓ {{ counts().LOW_TRADABILITY }}</span>
  }
  @if (counts().WATCH > 0) {
    <span class="status-chip watch">👁 {{ counts().WATCH }}</span>
  }
  @if (counts().EXECUTED > 0) {
    <span class="status-chip executed">$ {{ counts().EXECUTED }}</span>
  }
</div>
```

## `44b9ca3:src/app/features/rh-agent/components/trade-row/trade-row.component.html`

```html
<div class="trade-row" [class.disabled]="!row().enabled" [class.executed]="row().executed">
  <span class="col-go">
    <mat-slide-toggle
      [checked]="row().enabled"
      [disabled]="row().executed || !isActionableRun()"
      (change)="toggleEnabled.emit(row().symbol)">
    </mat-slide-toggle>
  </span>
  <span class="col-symbol">{{ row().symbol }}</span>
  <span class="col-direction dir-{{ row().direction.toLowerCase() }}">{{ row().direction }}</span>
  <span class="col-signal">{{ row().signalType }}</span>
  <span class="col-size">
    <input type="number"
      [value]="row().positionSize"
      (change)="onPositionSizeChange(+$any($event).target.value)"
      min="1"
      [max]="maxPositionSize()"
      [disabled]="row().executed || !row().enabled">
  </span>
  <span class="col-stop">
    <input type="number"
      [value]="row().stopLossPercent"
      (change)="onStopLossChange(+$any($event).target.value)"
      min="0"
      max="100"
      [disabled]="row().executed || !row().enabled">
  </span>
  <span class="col-total">${{ row().enabled ? row().positionSize : 0 }}</span>
  <span class="col-actions">
    @if (row().executed) {
      <mat-icon class="executed-badge" matTooltip="Trade placed">done_all</mat-icon>
    } @else {
      <button type="button" mat-icon-button
        (click)="markExecuted.emit(row().symbol)"
        matTooltip="Mark trade as executed"
        [disabled]="!isActionableRun() || !row().enabled || isExecuting()">
        <mat-icon>done</mat-icon>
      </button>
    }
    <button type="button" mat-icon-button
      (click)="copyTrade.emit(row())"
      matTooltip="Copy single trade prompt"
      [disabled]="row().executed || !row().enabled">
      <mat-icon>content_copy</mat-icon>
    </button>
    <button type="button" mat-icon-button
      [disabled]="row().executed || !isActionableRun()"
      (click)="remove.emit(row().symbol)"
      matTooltip="Move back to Review">
      <mat-icon>undo</mat-icon>
    </button>
  </span>
</div>
```

## `44b9ca3:src/app/features/rh-agent/components/trade-row/trade-row.component.scss`

```scss
.trade-row {
  display: grid;
  grid-template-columns: 50px 100px 80px 140px 90px 70px 80px 80px;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  font-size: 12px;
  border-bottom: 1px solid var(--mat-sys-outline-variant);

  &:last-child { border-bottom: none; }

  &.header {
    background: var(--mat-sys-surface-container-high);
    font-weight: 600;
    font-size: 11px;
    color: var(--mat-sys-on-surface-variant);
  }

  &.footer {
    background: var(--mat-sys-surface-container-high);
    font-weight: 600;
  }

  &.disabled { opacity: 0.5; }

  &.executed {
    background: var(--mat-sys-surface-container-highest);
  }
}

.col-go,
.col-symbol,
.col-direction,
.col-signal,
.col-size,
.col-stop,
.col-total,
.col-actions {
  display: flex;
  align-items: center;
}

.col-direction {
  font-weight: 600;

  &.dir-long  { color: #2e7d32; }
  &.dir-short { color: var(--mat-sys-error); }
}

.col-signal {
  color: var(--mat-sys-on-surface-variant);
  font-size: 10px;
}

.col-size,
.col-stop {
  input {
    width: 60px;
    height: 26px;
    padding: 0 6px;
    border: 1px solid var(--mat-sys-outline);
    border-radius: 4px;
    background: var(--mat-sys-surface);
    color: var(--mat-sys-on-surface);
    font-size: 12px;
    outline: none;

    &:focus    { border-color: var(--mat-sys-primary); }
    &:disabled { opacity: 0.5; }
  }
}

.col-total {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.col-actions {
  display: flex;
  gap: 2px;
  justify-content: flex-end;

  .executed-badge {
    color: var(--mat-sys-primary);
    font-size: 24px;
    width: 24px;
    height: 24px;
  }
}
```

## `44b9ca3:src/app/features/rh-agent/components/trade-row/trade-row.component.ts`

```typescript
/**
 * Trade Row
 *
 * A single row in the RH Agent order page: toggle, symbol, direction, signal,
 * editable size/stop, and row actions.
 */
import { Component, inject, ChangeDetectionStrategy, OnInit, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { SignalDirection, RhAgentSignalItem } from '../../services/rh-agent.types';
import { SignalTimeframe } from '../../common/rh-agent.constants';
import { RhAgentSignalService } from '../../services/rh-agent-signal.service';

export interface TradeRow {
  symbol: string;
  direction: SignalDirection;
  signalType: string;
  barDate: string;
  timeframe: SignalTimeframe;
  positionSize: number;
  stopLossPercent: number;
  entryPrice: number;
  enabled: boolean;
  executed: boolean;
  signal?: RhAgentSignalItem;
}

@Component({
  selector: 'app-trade-row',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatIconModule, MatButtonModule, MatSlideToggleModule, MatTooltipModule],
  templateUrl: './trade-row.component.html',
  styleUrl: './trade-row.component.scss',
})
export class TradeRowComponent implements OnInit {
  private readonly signalService = inject(RhAgentSignalService);

  row = input.required<TradeRow>();
  maxPositionSize = input(100000);
  /** When false, mutation controls are disabled for this historical order row. */
  isActionableRun = input(true);
  /** When true, execute controls are disabled because a batch is in flight. */
  isExecuting = input(false);

  toggleEnabled = output<string>();
  positionSizeChange = output<{ symbol: string; value: number }>();
  stopLossChange = output<{ symbol: string; value: number }>();
  copyTrade = output<TradeRow>();
  markExecuted = output<string>();
  remove = output<string>();
  signalLoaded = output<{ symbol: string; signal: RhAgentSignalItem | null }>();

  /** Load the latest signal for this row if it was not provided by the parent. */
  ngOnInit(): void {
    const symbol = this.row().symbol;
    if (this.row().signal) return;
    this.signalService.getSymbolSignalHistoryFromHistory(symbol).subscribe({
      next: (signals) => this.signalLoaded.emit({ symbol, signal: this.findLatestSignal(signals) }),
      error: () => this.signalLoaded.emit({ symbol, signal: null }),
    });
  }

  /** Return the most recent signal by barDate. */
  private findLatestSignal(signals: RhAgentSignalItem[]): RhAgentSignalItem | null {
    if (!signals?.length) return null;
    return signals.reduce((latest, s) => (s.barDate > latest.barDate ? s : latest));
  }

  /** Clamp position size and emit the change to the parent. */
  onPositionSizeChange(value: number): void {
    const clamped = Math.max(1, Math.min(value, this.maxPositionSize()));
    this.positionSizeChange.emit({ symbol: this.row().symbol, value: clamped });
  }

  /** Clamp stop loss percentage and emit the change to the parent. */
  onStopLossChange(value: number): void {
    const clamped = Math.max(0, Math.min(value, 100));
    this.stopLossChange.emit({ symbol: this.row().symbol, value: clamped });
  }
}
```

## `44b9ca3:src/app/features/rh-agent/pages/agent-order/rh-agent-order.component.html`

```html
<div class="order-page">
  <!-- Header -->
  <div class="order-header">
    <button mat-icon-button class="back-btn" (click)="goBack()" matTooltip="Back to grouped review">
      <mat-icon>arrow_back</mat-icon>
    </button>

    <h1 class="order-title">
      <mat-icon>account_balance</mat-icon>
      Order
    </h1>

    <span class="order-subtitle">
      {{ triageStore.acceptedCount() }} accepted symbol{{ triageStore.acceptedCount() === 1 ? '' : 's' }}
    </span>

    <div class="header-spacer"></div>

    <button type="button" class="pill-btn review"
      [disabled]="triageStore.reviewCount() === 0"
      (click)="goToReview()"
      matTooltip="Back to review">
      <mat-icon>visibility</mat-icon>
      Review {{ triageStore.reviewCount() }}
    </button>

    <button mat-raised-button color="accent"
      (click)="generateBatch()"
      [disabled]="enabledRows().length === 0 || !isActionableRun()"
      matTooltip="Generate trade prompt batch">
      <mat-icon>psychology</mat-icon>
      Generate
    </button>

    <button mat-raised-button color="primary"
      (click)="copyBatch()"
      [disabled]="!hasGeneratedBatch()"
      matTooltip="Copy batch prompt to clipboard">
      <mat-icon>content_copy</mat-icon>
      Copy
    </button>

    <button mat-raised-button color="accent"
      (click)="openInClaude()"
      [disabled]="!hasGeneratedBatch()"
      matTooltip="Open batch prompt in Claude web chat">
      <mat-icon>open_in_new</mat-icon>
      Open in Claude
    </button>

    <button mat-raised-button color="warn"
      (click)="executeViaBridge()"
      [disabled]="enabledUnexecutedRows().length === 0 || bridgeExecuting() || !isActionableRun()"
      matTooltip="Send enabled rows to the local trade bridge (Claude Code + Robinhood MCP)">
      <mat-icon>account_balance</mat-icon>
      Execute via Bridge
    </button>

    <button mat-raised-button
      (click)="onMarkAllExecuted()"
      [disabled]="enabledUnexecutedRows().length === 0 || !isActionableRun() || executionStore.executing()"
      matTooltip="Mark all enabled rows as executed after trades are placed">
      <mat-icon>done_all</mat-icon>
      Mark Executed
    </button>
  </div>

  <!-- Empty -->
  @if (tradeRows().length === 0) {
    <div class="empty-state">
      <mat-icon>inbox</mat-icon>
      <p>No accepted symbols</p>
      <p class="hint">Accept symbols in Grouped Review or Review, then return here.</p>
      <pre class="debug">
Latest run: {{ agentStore.latestCompletedRun()?.id }} ({{ agentStore.latestCompletedRun()?.marketDate }})
Decisions loaded: {{ debugDecisionCount() }} | Active order: {{ debugActiveOrderCount() }} | Accepted count: {{ debugAcceptedCount() }}
Error: {{ occurrenceStore.decisionsError() ?? 'none' }}
      </pre>
    </div>
  }

  <!-- Trade table -->
  @if (tradeRows().length > 0) {
    <div class="order-body">
      <div class="trade-table">
        <div class="trade-row header">
          <span class="col-go">Go</span>
          <span class="col-symbol">Symbol</span>
          <span class="col-direction">Direction</span>
          <span class="col-signal">Signal</span>
          <span class="col-size">Size ($)</span>
          <span class="col-stop">Stop %</span>
          <span class="col-total">Total</span>
          <span class="col-actions"></span>
        </div>

        @for (row of tradeRows(); track row.symbol) {
          <app-trade-row
            [row]="row"
            [maxPositionSize]="maxTradeAmount"
            [isActionableRun]="isActionableRun()"
            [isExecuting]="executionStore.executing()"
            (toggleEnabled)="onToggleEnabled($event)"
            (positionSizeChange)="onPositionSizeChange($event)"
            (stopLossChange)="onStopLossChange($event)"
            (copyTrade)="copyTrade($event)"
            (markExecuted)="onMarkExecuted($event)"
            (remove)="onRemoveSymbol($event)"
            (signalLoaded)="onSignalLoaded($event)">
          </app-trade-row>
        }

        <div class="trade-row footer">
          <span class="col-go"></span>
          <span class="col-symbol"></span>
          <span class="col-direction"></span>
          <span class="col-signal"></span>
          <span class="col-size"></span>
          <span class="col-stop">Enabled total</span>
          <span class="col-total">${{ totalAmount() }}</span>
          <span class="col-actions"></span>
        </div>
      </div>

      <!-- Generated batch prompt -->
      @if (generatedBatch(); as batch) {
        <div class="batch-prompt">
          <div class="batch-prompt-header">
            <span class="batch-title">Batch Prompt</span>
            <span class="batch-meta">{{ batch.trades.length }} trades · ${{ batch.totalAmount.toFixed(2) }}</span>
          </div>
          <pre>{{ batch.batchPrompt }}</pre>
        </div>
      }
    </div>
  }
</div>
```

## `44b9ca3:src/app/features/rh-agent/pages/agent-order/rh-agent-order.component.ts`

```typescript
/**
 * RH Agent Order Component
 *
 * Final trade parameter configuration and prompt generation for ACCEPTED symbols.
 * Reads accepted occurrences from the shared RhAgentOccurrenceDecisionStore.
 * URL: /rh-agent/order
 */
import {
  Component,
  inject,
  OnInit,
  signal,
  computed,
  effect,
  untracked,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { finalize } from 'rxjs';

import { RhAgentTriageStore } from '../../stores/rh-agent-triage.store';
import { RhAgentOccurrenceDecisionStore } from '../../stores/rh-agent-occurrence-decision.store';
import { RhAgentTradeStore } from '../../stores/rh-agent-trade.store';
import { RhAgentExecutionStore } from '../../stores/rh-agent-execution.store';
import { RhAgentStore } from '../../stores/rh-agent.store';

import {
  RhAgentSignalItem,
  RhAgentOccurrenceDecision,
  RH_AGENT_MAX_TRADE_AMOUNT,
  SignalDirection,
} from '../../services/rh-agent.types';
import { RhAgentReviewDecision, SignalTimeframe } from '../../common/rh-agent.constants';
import {
  RobinhoodTradeService,
  TradeBatch,
  TradePrompt,
  TradeSide,
  TradeOrderType,
} from '../../../rs/services/robinhood-trade.service';
import { UiStateService } from '../../../../core/services/ui-state.service';
import { TradeRowComponent, TradeRow } from '../../components/trade-row/trade-row.component';
import { TradeBridgeClientService, TradeBridgeTrade } from '../../services/trade-bridge-client.service';

@Component({
  selector: 'app-rh-agent-order',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, MatButtonModule, MatIconModule, MatInputModule, MatFormFieldModule, MatSlideToggleModule, MatTooltipModule, TradeRowComponent],
  templateUrl: './rh-agent-order.component.html',
  styleUrl: './rh-agent-order.component.scss',
})
export class RhAgentOrderComponent implements OnInit {
  readonly triageStore = inject(RhAgentTriageStore);
  readonly occurrenceStore = inject(RhAgentOccurrenceDecisionStore);
  readonly tradeStore = inject(RhAgentTradeStore);
  readonly executionStore = inject(RhAgentExecutionStore);
  readonly agentStore = inject(RhAgentStore);
  readonly tradeService = inject(RobinhoodTradeService);
  readonly snackBar = inject(MatSnackBar);
  readonly uiState = inject(UiStateService);
  private readonly router = inject(Router);
  private readonly bridgeClient = inject(TradeBridgeClientService);

  readonly bridgeExecuting = signal(false);

  readonly tradeRows = signal<TradeRow[]>([]);
  readonly generatedBatch = signal<TradeBatch | null>(null);
  readonly maxTradeAmount = RH_AGENT_MAX_TRADE_AMOUNT;

  /** Tracks the last run whose decisions/trades were loaded so we don't reload on every signal change. */
  private loadedRunId: string | null = null;

  /** Rows that are currently enabled for trade generation. */
  readonly enabledRows = computed(() =>
    this.tradeRows().filter((r) => r.enabled)
  );

  /** Sum of position sizes for all enabled rows. */
  readonly totalAmount = computed(() =>
    this.enabledRows().reduce((sum, r) => sum + r.positionSize, 0)
  );

  /** Enabled rows that have not yet been marked executed. */
  readonly enabledUnexecutedRows = computed(() =>
    this.enabledRows().filter((r) => !r.executed)
  );

  /** Whether a trade batch has already been generated. */
  readonly hasGeneratedBatch = computed(() => !!this.generatedBatch());

  /** Order always operates on the latest completed run, regardless of the currently viewed run. */
  readonly orderMarketDate = computed(() => this.agentStore.latestCompletedRun()?.marketDate ?? null);

  /** True when the latest completed run is known and actionable. */
  readonly isActionableRun = computed(() => !!this.orderMarketDate());

  /** Diagnostic counts to surface load/run mismatches. */
  readonly debugDecisionCount = computed(() => Object.values(this.occurrenceStore.occurrenceDecisions()).length);
  readonly debugActiveOrderCount = computed(() => this.occurrenceStore.activeOrderDecisions().length);
  readonly debugAcceptedCount = computed(() => this.occurrenceStore.acceptedCount());

  constructor() {
    // Keep trade rows in sync with active order symbols while preserving user edits for symbols still present.
    effect(() => this.syncTradeRowsWithActiveOrderSymbols());

    // Load decisions/trades when the latest completed run becomes known. This handles
    // direct navigation or refresh where agentStore hasn't yet fetched runs.
    effect(() => {
      const latestRun = this.agentStore.latestCompletedRun();
      if (!latestRun) return;
      if (this.loadedRunId === latestRun.id) return;
      this.loadedRunId = latestRun.id;
      this.occurrenceStore.loadDecisionsForRun(latestRun.id);
      this.tradeStore.loadTradesForRun(latestRun.id);
    });
  }

  /** Initialize the page and load accepted current-run occurrences and trades. */
  ngOnInit(): void {
    this.uiState.setFullscreen(true);
    this.agentStore.loadData();
  }

  /** Merge active order symbols with existing trade rows, preserving edits for symbols still present. */
  private syncTradeRowsWithActiveOrderSymbols(): void {
    const decisions = this.occurrenceStore.activeOrderDecisions();

    const existing = untracked(() => this.tradeRows());
    const existingBySymbol = new Map(existing.map((r) => [r.symbol, r]));

    const decisionBySymbol = new Map<string, RhAgentOccurrenceDecision>();
    for (const d of decisions) {
      const current = decisionBySymbol.get(d.symbol);
      if (!current || d.barDate > current.barDate) {
        decisionBySymbol.set(d.symbol, d);
      }
    }

    const symbols = this.occurrenceStore.activeOrderSymbols();
    const next: TradeRow[] = symbols.map((symbol) => {
      const row = existingBySymbol.get(symbol);
      if (row) return row;
      const decision = decisionBySymbol.get(symbol);
      if (!decision) {
        throw new Error(`[RhAgentOrderComponent] No accepted occurrence decision for symbol ${symbol}`);
      }
      return {
        symbol,
        direction: decision.direction,
        signalType: decision.signalType,
        barDate: decision.barDate,
        timeframe: decision.timeframe,
        positionSize: RH_AGENT_MAX_TRADE_AMOUNT,
        stopLossPercent: 8,
        entryPrice: 0,
        enabled: true,
        executed: false,
      };
    });

    this.tradeRows.set(next);
  }

  /** Update a trade row's cached signal and entry price from the backend. */
  onSignalLoaded(event: { symbol: string; signal: RhAgentSignalItem | null }): void {
    const latest = event.signal;
    const patch: Partial<TradeRow> = { signal: latest ?? undefined };
    if (latest?.closePrice !== undefined && !Number.isNaN(latest.closePrice)) {
      patch.entryPrice = latest.closePrice;
    }
    this.patchRow(event.symbol, patch);
  }

  /** Toggle whether a symbol is included in the generated trade batch. */
  onToggleEnabled(symbol: string): void {
    const row = this.tradeRows().find((r) => r.symbol === symbol);
    if (row) {
      this.patchRow(symbol, { enabled: !row.enabled });
    }
  }

  /** Update a row's dollar position size. */
  onPositionSizeChange(event: { symbol: string; value: number }): void {
    this.patchRow(event.symbol, { positionSize: event.value });
  }

  /** Update a row's stop-loss percentage. */
  onStopLossChange(event: { symbol: string; value: number }): void {
    this.patchRow(event.symbol, { stopLossPercent: event.value });
  }

  /** Mark the accepted occurrence decisions for a symbol as executed after a real trade is placed. */
  onMarkExecuted(symbol: string): void {
    const latestRun = this.agentStore.latestCompletedRun();
    if (!latestRun?.marketDate) return;
    const row = this.tradeRows().find((r) => r.symbol === symbol);
    if (!row) return;
    this.executeRows(latestRun.id, latestRun.marketDate, [row]);
  }

  /** Mark all enabled, unexecuted rows as executed. */
  onMarkAllExecuted(): void {
    const latestRun = this.agentStore.latestCompletedRun();
    if (!latestRun?.marketDate) return;
    const rows = this.enabledUnexecutedRows();
    if (rows.length === 0) return;
    this.executeRows(latestRun.id, latestRun.marketDate, rows);
  }

  /** Execute the given rows: create trade records and mark their source decisions executed. */
  private executeRows(runId: string, marketDate: string, rows: TradeRow[]): void {
    const inputs = this.buildExecutionInputs(runId, rows);
    if (inputs.length === 0) return;

    this.executionStore.executeTradeRows(runId, marketDate, inputs);
  }

  /** Pair each row with its exact current-run ACCEPT occurrence decision. */
  private buildExecutionInputs(
    runId: string,
    rows: TradeRow[]
  ): { row: TradeRow; occurrenceDecisionId: string }[] {
    const decisionsByKey = new Map<string, RhAgentOccurrenceDecision>();
    for (const d of Object.values(this.occurrenceStore.occurrenceDecisions())) {
      if (
        d.runId === runId &&
        d.decisionType === RhAgentReviewDecision.ACCEPT &&
        d.isCurrentInLatestRun
      ) {
        decisionsByKey.set(`${d.symbol}:${d.timeframe}:${d.signalType}`, d);
      }
    }

    const inputs: { row: TradeRow; occurrenceDecisionId: string }[] = [];
    for (const row of rows) {
      const key = `${row.symbol.toUpperCase()}:${row.timeframe}:${row.signalType}`;
      const decision = decisionsByKey.get(key);
      if (!decision) {
        console.warn('[RhAgentOrderComponent] No matching decision for row:', row.symbol);
        continue;
      }
      inputs.push({ row, occurrenceDecisionId: decision.id });
    }
    return inputs;
  }

  /** Remove a symbol from the order page: delete occurrence decisions and re-flag for review. */
  onRemoveSymbol(symbol: string): void {
    const latestRun = this.agentStore.latestCompletedRun();
    if (!latestRun) return;
    this.occurrenceStore.resetSymbol(symbol, latestRun.id);
    this.triageStore.markForReview(symbol);
    this.tradeRows.update((rows) => rows.filter((r) => r.symbol !== symbol));
  }

  /** Apply a partial update to a single trade row by symbol. */
  private patchRow(symbol: string, patch: Partial<TradeRow>): void {
    this.tradeRows.update((rows) =>
      rows.map((r) => (r.symbol === symbol ? { ...r, ...patch } : r))
    );
  }

  /** Generate a trade batch prompt from all enabled rows. */
  generateBatch(): void {
    const enabled = this.enabledRows();
    if (enabled.length === 0) {
      this.snackBar.open('No enabled symbols to trade', 'Dismiss', { duration: 3000 });
      this.generatedBatch.set(null);
      return;
    }

    const trades: TradePrompt[] = enabled.map((row) => ({
      symbol: row.symbol,
      side: row.direction === SignalDirection.SHORT ? TradeSide.SELL : TradeSide.BUY,
      amount: row.positionSize,
      orderType: TradeOrderType.MARKET,
      promptText: '',
    }));

    const batch = this.tradeService.generateBatchPrompt(trades);
    this.generatedBatch.set(batch);
  }

  /** Copy the generated batch prompt to the clipboard. */
  async copyBatch(): Promise<void> {
    const batch = this.generatedBatch();
    if (!batch) return;
    const success = await this.tradeService.copyToClipboard(batch.batchPrompt);
    this.showCopyResult(success, `Copied batch of ${batch.trades.length} trades`);
  }

  /** Open the generated batch prompt in Claude web chat. */
  openInClaude(): void {
    const batch = this.generatedBatch();
    if (!batch) return;
    const url = `https://claude.ai/new?q=${encodeURIComponent(batch.batchPrompt)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  /** Send the enabled batch to the local trade bridge server, which calls Claude Code + the Robinhood MCP. */
  executeViaBridge(): void {
    const enabled = this.enabledUnexecutedRows();
    if (enabled.length === 0) {
      this.snackBar.open('No enabled, unexecuted rows to trade', 'Dismiss', { duration: 3000 });
      return;
    }

    const latestRun = this.agentStore.latestCompletedRun();
    const marketDate = latestRun?.marketDate;
    if (!latestRun || !marketDate) {
      this.snackBar.open('No actionable run', 'Dismiss', { duration: 3000 });
      return;
    }

    const trades: TradeBridgeTrade[] = enabled.map((row) => ({
      symbol: row.symbol,
      side: row.direction === SignalDirection.SHORT ? 'sell' : 'buy',
      amount: row.positionSize,
      orderType: 'market',
    }));

    this.bridgeExecuting.set(true);
    this.bridgeClient.executeTrades(trades).pipe(
      finalize(() => this.bridgeExecuting.set(false))
    ).subscribe((result) => {
      if (!result.ok) {
        if (result.error.kind !== 'cancelled') {
          this.snackBar.open(result.error.message, 'Dismiss', { duration: 5000 });
        }
        return;
      }

      const res = result.response;
      const confirmedSymbols = new Set(res.results
        .filter((item) => item.parsed.confirmed && !!item.parsed.orderId && !!item.parsed.state)
        .map((item) => item.trade.symbol.toUpperCase()));
      const confirmedRows = enabled.filter((row) => confirmedSymbols.has(row.symbol.toUpperCase()));
      if (confirmedRows.length > 0) this.executeRows(latestRun.id, marketDate, confirmedRows);

      if (res.success) {
        this.snackBar.open(`Trade bridge executed ${res.count} order(s)`, 'Dismiss', { duration: 4000 });
      } else if (confirmedRows.length > 0) {
        this.snackBar.open(`Executed ${confirmedRows.length} of ${res.requestedCount} order(s); remaining orders were not attempted`, 'Dismiss', { duration: 6000 });
      } else {
        const message = res.results.find((item) => item.parsed.error)?.parsed.error ?? 'No orders were confirmed by the trade bridge';
        this.snackBar.open(message, 'Dismiss', { duration: 6000 });
      }
    });
  }

  /** Copy a single trade's prompt to the clipboard. */
  async copyTrade(row: TradeRow): Promise<void> {
    if (!row.enabled) return;
    const trade = this.tradeService.generateTradePrompt(
      row.symbol,
      row.direction === SignalDirection.SHORT ? TradeSide.SELL : TradeSide.BUY,
      row.positionSize,
      TradeOrderType.MARKET
    );
    const success = await this.tradeService.copyToClipboard(trade.promptText);
    this.showCopyResult(success, `Copied: ${trade.side.toUpperCase()} $${trade.amount} ${trade.symbol}`);
  }

  /** Show a snackbar confirming or warning about a clipboard copy. */
  private showCopyResult(success: boolean, message: string): void {
    if (success) {
      this.snackBar.open(message, 'Dismiss', { duration: 3000 });
    } else {
      this.snackBar.open('Failed to copy. Please copy manually.', 'Dismiss', { duration: 5000 });
    }
  }

  /** Navigate back to the signal review page. */
  goBack(): void {
    this.router.navigate(['/signal-review']);
  }

  /** Navigate to the review page. */
  goToReview(): void {
    this.router.navigate(['/chart-review']);
  }
}
```

## `44b9ca3:src/app/features/rh-agent/services/rh-agent-execution.service.ts`

```typescript
/**
 * RH Agent Execution Service
 *
 * Orchestrates the single logical action of "executing" accepted occurrence
 * decisions: it atomically creates a trade record and stamps the source
 * occurrence decision as executed. Keeping this in one place prevents the
 * Order page from owning transaction choreography and avoids half-applied
 * state if one of the two writes fails.
 */
import { Injectable, inject, EnvironmentInjector, runInInjectionContext } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import {
  Firestore,
  doc,
  runTransaction,
} from '@angular/fire/firestore';
import { Observable, from, of } from 'rxjs';
import { map, switchMap, take } from 'rxjs/operators';

import { Collection, Subcollection } from '../../../core/common/constants';
import { requireUserId, buildRhAgentTradeId } from './rh-agent-firestore-helpers';
import { RhAgentTrade, RhAgentTradeStatus, TradeInputRow } from './rh-agent.types';
import { buildStopPrice } from '../utils/rh-agent.utils';

export interface ExecutionRowInput {
  /** The row being executed. */
  row: TradeInputRow;
  /** Exact occurrence decision ID that produced this row. */
  occurrenceDecisionId: string;
}

export interface ExecutionResult {
  /** Trades that were created. */
  trades: RhAgentTrade[];
  /** Occurrence decision IDs that were marked executed. */
  decisionIds: string[];
}

@Injectable({
  providedIn: 'root',
})
export class RhAgentExecutionService {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(Auth);
  private readonly injector = inject(EnvironmentInjector);

  /**
   * Atomically create trade records and mark the linked occurrence decisions
   * as executed. Both operations live in the same Firestore transaction so the
   * system cannot end up with an executed decision but no trade, or vice versa.
   */
  executeTradeRows(
    runId: string,
    marketDate: string,
    inputs: ExecutionRowInput[]
  ): Observable<ExecutionResult> {
    if (inputs.length === 0) return of({ trades: [], decisionIds: [] });

    return requireUserId(this.auth, this.injector).pipe(
      take(1),
      switchMap((userId) =>
        from(
          runInInjectionContext(this.injector, async () => {
            const trades: RhAgentTrade[] = [];
            const decisionIds: string[] = [];
            const nowIso = new Date().toISOString();

            for (const input of inputs) {
              const row = input.row;
              if (row.entryPrice <= 0) {
                throw new Error(`[RhAgentExecutionService] Cannot execute ${row.symbol}: entryPrice must be positive`);
              }
              if (row.positionSize <= 0) {
                throw new Error(`[RhAgentExecutionService] Cannot execute ${row.symbol}: positionSize must be positive`);
              }
              if (row.stopLossPercent < 0) {
                throw new Error(`[RhAgentExecutionService] Cannot execute ${row.symbol}: stopLossPercent must be non-negative`);
              }
              if (!input.occurrenceDecisionId) {
                throw new Error(`[RhAgentExecutionService] Cannot execute ${row.symbol}: missing occurrenceDecisionId`);
              }
            }

            await runTransaction(this.firestore, async (transaction) => {
              for (const input of inputs) {
                const row = input.row;
                const symbol = row.symbol.toUpperCase();
                const tradeId = buildRhAgentTradeId(symbol, marketDate, row.timeframe, row.signalType);
                const tradeDocRef = doc(
                  this.firestore,
                  Collection.RH_TRADES,
                  symbol,
                  Subcollection.TRADES,
                  tradeId
                );
                const decisionDocRef = doc(
                  this.firestore,
                  Collection.RH_OCCURRENCE_DECISIONS,
                  input.occurrenceDecisionId
                );

                const quantity = row.entryPrice > 0
                  ? Math.floor(row.positionSize / row.entryPrice)
                  : 0;

                const trade: RhAgentTrade = {
                  id: tradeId,
                  userId,
                  runId,
                  marketDate,
                  occurrenceDecisionId: input.occurrenceDecisionId,
                  symbol,
                  direction: row.direction,
                  timeframe: row.timeframe,
                  signalType: row.signalType,
                  barDate: row.barDate,
                  status: RhAgentTradeStatus.OPEN,
                  entryAt: nowIso,
                  entryPrice: row.entryPrice,
                  positionSize: row.positionSize,
                  quantity,
                  stopPrice: buildStopPrice(row.entryPrice, row.stopLossPercent, row.direction),
                  createdAt: nowIso,
                };

                transaction.set(tradeDocRef, { ...trade, updatedAt: nowIso });
                transaction.update(decisionDocRef, {
                  executedAt: nowIso,
                  updatedAt: nowIso,
                });

                trades.push(trade);
                decisionIds.push(input.occurrenceDecisionId);
              }
            });

            return { trades, decisionIds };
          })
        )
      )
    );
  }
}
```

## `44b9ca3:src/app/features/rh-agent/services/rh-agent-firestore-helpers.ts`

```typescript
/**
 * RH Agent Firestore Helpers
 *
 * Shared, low-level helpers used by the RH Agent frontend services.
 * These were duplicated across triage, symbol-list, and symbol-meta services.
 */
import { EnvironmentInjector, runInInjectionContext } from '@angular/core';
import { Auth, authState } from '@angular/fire/auth';
import { DocumentData, DocumentReference, getDoc, Timestamp } from '@angular/fire/firestore';
import { Observable, map, take } from 'rxjs';

/** Return the current user ID or throw if not authenticated. */
export function requireUserId(auth: Auth, injector: EnvironmentInjector): Observable<string> {
  return runInInjectionContext(injector, () => authState(auth)).pipe(
    take(1),
    map((user) => {
      if (!user?.uid) throw new Error('Authentication required');
      return user.uid;
    }),
  );
}

/**
 * Fetch a single doc's data as a typed object.
 * Returns null if the doc does not exist.
 */
export async function getDocData<T extends DocumentData>(docRef: DocumentReference<T>): Promise<T | null> {
  const snap = await getDoc(docRef);
  return snap.exists() ? snap.data() : null;
}

/**
 * Split an array into chunks of a given size.
 * Used to keep Firestore `in` queries under the 30-document limit.
 */
export function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/** Shape returned by getDocData when only the createdAt timestamp is needed. */
export interface CreatedAtDoc {
  createdAt?: Timestamp;
}

/** Build a stable doc id for an occurrence-level decision. */
export function buildRhAgentOccurrenceDecisionId(
  runId: string,
  symbol: string,
  timeframe: string,
  signalType: string
): string {
  return `${runId}_${symbol.toUpperCase()}_${timeframe}_${signalType}`;
}

/** Build a human-readable doc id for a trade placed from an occurrence. */
export function buildRhAgentTradeId(
  symbol: string,
  marketDate: string,
  timeframe: string,
  signalType: string
): string {
  return `${symbol.toUpperCase()}_${marketDate}_${timeframe}_${signalType}`;
}
```

## `44b9ca3:src/app/features/rh-agent/services/rh-agent-occurrence-decision.service.ts`

```typescript
/**
 * RH Agent Occurrence Decision Service
 *
 * Persists durable user decisions (ACCEPT / REJECT) for specific signal
 * occurrences and records when an accepted occurrence is executed.
 * Each decision is keyed by the source run, symbol, timeframe, and signal type
 * so multiple intraday occurrences do not overwrite one another.
 */
import { Injectable, inject, EnvironmentInjector, runInInjectionContext } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import {
  Firestore,
  collection,
  doc,
  getDocs,
  query,
  where,
  writeBatch,
  onSnapshot,
  Query,
  QueryDocumentSnapshot,
  DocumentData,
} from '@angular/fire/firestore';
import { Observable, from, of } from 'rxjs';
import { map, switchMap, take } from 'rxjs/operators';

import { Collection } from '../../../core/common/constants';
import {
  RhAgentSignalItem,
  RhAgentOccurrenceDecision,
  DurableDecisionType,
} from './rh-agent.types';
import { requireUserId, buildRhAgentOccurrenceDecisionId } from './rh-agent-firestore-helpers';
import { RhAgentReviewDecision, SignalDirection, SignalTimeframe } from '../common/rh-agent.constants';

export interface PersistOccurrenceDecisionInput {
  runId: string;
  marketDate: string;
  signal: RhAgentSignalItem;
  decisionType: DurableDecisionType;
  notes?: string;
}

@Injectable({
  providedIn: 'root',
})
export class RhAgentOccurrenceDecisionService {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(Auth);
  private readonly injector = inject(EnvironmentInjector);

  private readonly decisionsCollection = collection(this.firestore, Collection.RH_OCCURRENCE_DECISIONS);

  /** Persist a decision for a single signal occurrence. */
  persistDecision(input: PersistOccurrenceDecisionInput): Observable<void> {
    return requireUserId(this.auth, this.injector).pipe(
      take(1),
      switchMap((userId) => runInInjectionContext(this.injector, async () => {
        const symbol = input.signal.symbol.toUpperCase();
        const id = buildRhAgentOccurrenceDecisionId(input.runId, symbol, input.signal.timeframe, input.signal.signalType);
        const docRef = doc(this.firestore, Collection.RH_OCCURRENCE_DECISIONS, id);

        const nowIso = new Date().toISOString();

        await writeBatch(this.firestore)
          .set(docRef, {
            userId,
            runId: input.runId,
            marketDate: input.marketDate,
            symbol,
            timeframe: input.signal.timeframe,
            direction: input.signal.direction,
            signalType: input.signal.signalType,
            barDate: input.signal.barDate,
            decisionType: input.decisionType,
            decidedAt: nowIso,
            isCurrentInLatestRun: true,
            notes: input.notes ?? null,
            indicators: input.signal.indicators ?? {},
            updatedAt: nowIso,
          }, { merge: true })
          .commit();
      })),
      map(() => undefined)
    );
  }

  /** Persist the same decision type for multiple signal occurrences in one batch. */
  persistDecisionsBatch(runId: string, marketDate: string, signals: RhAgentSignalItem[], decisionType: DurableDecisionType): Observable<void> {
    if (signals.length === 0) return of(undefined);
    return requireUserId(this.auth, this.injector).pipe(
      take(1),
      switchMap((userId) => runInInjectionContext(this.injector, async () => {
        const nowIso = new Date().toISOString();
        const batch = writeBatch(this.firestore);
        for (const signal of signals) {
          const symbol = signal.symbol.toUpperCase();
          const id = buildRhAgentOccurrenceDecisionId(runId, symbol, signal.timeframe, signal.signalType);
          const docRef = doc(this.firestore, Collection.RH_OCCURRENCE_DECISIONS, id);
          batch.set(docRef, {
            userId,
            runId,
            marketDate,
            symbol,
            timeframe: signal.timeframe,
            direction: signal.direction,
            signalType: signal.signalType,
            barDate: signal.barDate,
            decisionType,
            decidedAt: nowIso,
            isCurrentInLatestRun: true,
            notes: null,
            indicators: signal.indicators ?? {},
            updatedAt: nowIso,
          }, { merge: true });
        }
        await batch.commit();
      })),
      map(() => undefined)
    );
  }

  /** Delete a decision for a specific occurrence. */
  deleteDecision(runId: string, symbol: string, timeframe: SignalTimeframe, signalType: string): Observable<void> {
    return this.deleteDecisionsBatch(runId, [{ symbol, timeframe, signalType }]);
  }

  /** Delete occurrence decisions by their full Firestore doc IDs. */
  deleteDecisionIds(ids: string[]): Observable<void> {
    if (ids.length === 0) return of(undefined);
    return requireUserId(this.auth, this.injector).pipe(
      take(1),
      switchMap(() => runInInjectionContext(this.injector, async () => {
        const batch = writeBatch(this.firestore);
        for (const id of ids) {
          const docRef = doc(this.firestore, Collection.RH_OCCURRENCE_DECISIONS, id);
          batch.delete(docRef);
        }
        await batch.commit();
      })),
      map(() => undefined)
    );
  }

  /** Delete decisions for multiple occurrences of the same run. */
  deleteDecisionsBatch(
    runId: string,
    keys: { symbol: string; timeframe: SignalTimeframe; signalType: string }[]
  ): Observable<void> {
    if (keys.length === 0) return of(undefined);
    return requireUserId(this.auth, this.injector).pipe(
      take(1),
      switchMap(() => runInInjectionContext(this.injector, async () => {
        const batch = writeBatch(this.firestore);
        for (const key of keys) {
          const symbol = key.symbol.toUpperCase();
          const id = buildRhAgentOccurrenceDecisionId(runId, symbol, key.timeframe, key.signalType);
          const docRef = doc(this.firestore, Collection.RH_OCCURRENCE_DECISIONS, id);
          batch.delete(docRef);
        }
        await batch.commit();
      })),
      map(() => undefined)
    );
  }

  /** Load all occurrence decisions for a specific source run, sorted by symbol/timeframe/signalType. */
  loadDecisionsForRun(runId: string): Observable<RhAgentOccurrenceDecision[]> {
    return requireUserId(this.auth, this.injector).pipe(
      take(1),
      switchMap((userId) => {
        const q = query(
          this.decisionsCollection,
          where('userId', '==', userId),
          where('runId', '==', runId)
        );
        return this.runQuery(q);
      }),
      map((decisions) => decisions.sort(this.sortDecisions))
    );
  }

  /** Load all decisions that are still current in the latest completed run, optionally filtered by symbol. */
  loadCurrentDecisions(symbol?: string): Observable<RhAgentOccurrenceDecision[]> {
    return requireUserId(this.auth, this.injector).pipe(
      take(1),
      switchMap((userId) => {
        const constraints: ReturnType<typeof where>[] = [
          where('userId', '==', userId),
          where('isCurrentInLatestRun', '==', true),
        ];
        if (symbol) {
          constraints.push(where('symbol', '==', symbol.toUpperCase()));
        }
        const q = query(this.decisionsCollection, ...constraints);
        return this.runQuery(q);
      }),
      map((decisions) => decisions.sort(this.sortDecisions))
    );
  }

  /**
   * Mark every decision for the given source run as no longer current.
   * Called when a newer run becomes the latest completed run.
   */
  markRunDecisionsNotCurrent(runId: string): Observable<void> {
    return requireUserId(this.auth, this.injector).pipe(
      take(1),
      switchMap((userId) => runInInjectionContext(this.injector, async () => {
        const q = query(
          this.decisionsCollection,
          where('userId', '==', userId),
          where('runId', '==', runId),
          where('isCurrentInLatestRun', '==', true)
        );
        const snapshot = await getDocs(q);
        if (snapshot.empty) return;
        const nowIso = new Date().toISOString();
        const batch = writeBatch(this.firestore);
        snapshot.docs.forEach((d) => batch.update(d.ref, { isCurrentInLatestRun: false, updatedAt: nowIso }));
        await batch.commit();
      })),
      map(() => undefined)
    );
  }

  /** Load occurrence decisions across a market-date range. */
  loadDecisionsForDateRange(startDate: string, endDate: string): Observable<RhAgentOccurrenceDecision[]> {
    return requireUserId(this.auth, this.injector).pipe(
      take(1),
      switchMap((userId) => {
        const q = query(
          this.decisionsCollection,
          where('userId', '==', userId),
          where('marketDate', '>=', startDate),
          where('marketDate', '<=', endDate)
        );
        return this.runQuery(q);
      }),
      map((decisions) => decisions.sort(this.sortDecisions))
    );
  }

  /** Subscribe to real-time updates for decisions in a specific run. */
  listenToDecisionsForRun(runId: string): Observable<RhAgentOccurrenceDecision[]> {
    return requireUserId(this.auth, this.injector).pipe(
      switchMap((userId) => {
        const q = query(
          this.decisionsCollection,
          where('userId', '==', userId),
          where('runId', '==', runId)
        );
        return new Observable<RhAgentOccurrenceDecision[]>((subscriber) => {
          const unsubscribe = onSnapshot(q, (snapshot) => {
            subscriber.next(this.toDecisions(snapshot.docs).sort(this.sortDecisions));
          }, (error) => subscriber.error(error));
          return () => unsubscribe();
        });
      })
    );
  }

  private sortDecisions(a: RhAgentOccurrenceDecision, b: RhAgentOccurrenceDecision): number {
    return (
      a.symbol.localeCompare(b.symbol) ||
      a.timeframe.localeCompare(b.timeframe) ||
      a.signalType.localeCompare(b.signalType)
    );
  }

  private runQuery(q: Query<DocumentData>): Observable<RhAgentOccurrenceDecision[]> {
    return from(runInInjectionContext(this.injector, () => getDocs(q))).pipe(
      map((snapshot) => this.toDecisions(snapshot.docs))
    );
  }

  private toDecisions(docs: QueryDocumentSnapshot<DocumentData>[]): RhAgentOccurrenceDecision[] {
    return docs.map((d) => parseOccurrenceDecision(d.data(), d.id));
  }
}

function isDurableDecisionType(value: unknown): value is DurableDecisionType {
  return value === RhAgentReviewDecision.ACCEPT || value === RhAgentReviewDecision.REJECT;
}

function isIndicatorRecord(value: unknown): value is Record<string, number | string | null> {
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value as Record<string, unknown>).every(
    ([, v]) => v === null || typeof v === 'number' || typeof v === 'string'
  );
}

function parseOccurrenceDecision(data: DocumentData, id: string): RhAgentOccurrenceDecision {
  const requireString = (field: string) => {
    const value = data[field];
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`[OccurrenceDecisionService] Decision doc ${id} is missing or invalid required field "${field}"`);
    }
  };
  const optionalString = (field: string) => {
    const value = data[field];
    if (value !== undefined && (typeof value !== 'string' || value.length === 0)) {
      throw new Error(`[OccurrenceDecisionService] Decision doc ${id} has invalid optional field "${field}"`);
    }
  };

  requireString('runId');
  requireString('marketDate');
  requireString('symbol');
  requireString('signalType');
  requireString('barDate');
  requireString('decidedAt');

  const timeframe = data['timeframe'];
  if (timeframe !== SignalTimeframe.DAILY && timeframe !== SignalTimeframe.WEEKLY) {
    throw new Error(`[OccurrenceDecisionService] Decision doc ${id} has invalid "timeframe": ${String(timeframe)}`);
  }

  const direction = data['direction'];
  if (direction !== SignalDirection.LONG && direction !== SignalDirection.SHORT) {
    throw new Error(`[OccurrenceDecisionService] Decision doc ${id} has invalid "direction": ${String(direction)}`);
  }

  const decisionType = data['decisionType'];
  if (!isDurableDecisionType(decisionType)) {
    throw new Error(`[OccurrenceDecisionService] Decision doc ${id} has invalid "decisionType": ${String(decisionType)}`);
  }

  const isCurrent = data['isCurrentInLatestRun'];
  if (typeof isCurrent !== 'boolean') {
    throw new Error(`[OccurrenceDecisionService] Decision doc ${id} has invalid "isCurrentInLatestRun": ${String(isCurrent)}`);
  }

  const executedAt = data['executedAt'];
  if (executedAt !== undefined && (typeof executedAt !== 'string' || executedAt.length === 0)) {
    throw new Error(`[OccurrenceDecisionService] Decision doc ${id} has invalid "executedAt"`);
  }

  optionalString('userId');
  optionalString('notes');

  const indicators = data['indicators'];
  if (indicators !== undefined && !isIndicatorRecord(indicators)) {
    throw new Error(`[OccurrenceDecisionService] Decision doc ${id} has invalid "indicators"`);
  }

  return {
    id,
    runId: data['runId'] as string,
    marketDate: data['marketDate'] as string,
    symbol: data['symbol'] as string,
    timeframe,
    direction,
    signalType: data['signalType'] as string,
    barDate: data['barDate'] as string,
    decisionType,
    decidedAt: data['decidedAt'] as string,
    executedAt,
    isCurrentInLatestRun: isCurrent,
    userId: data['userId'] as string | undefined,
    notes: data['notes'] as string | undefined,
    indicators: indicators as Record<string, number | string | null> | undefined,
  };
}
```

## `44b9ca3:src/app/features/rh-agent/services/rh-agent-trade.service.ts`

```typescript
/**
 * RH Agent Trade Service
 *
 * Persists real trades placed from accepted RH Agent occurrences.
 * Each trade record captures entry, size, stop, and eventual exit/outcome data,
 * keeping execution details separate from review decisions and generated signals.
 */
import { Injectable, inject, EnvironmentInjector, runInInjectionContext } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import {
  Firestore,
  collectionGroup,
  getDocs,
  query,
  where,
  onSnapshot,
  Query,
  QueryDocumentSnapshot,
  DocumentData,
  type FirestoreDataConverter,
} from '@angular/fire/firestore';
import { Observable, from } from 'rxjs';
import { map, switchMap, take } from 'rxjs/operators';

import { Subcollection } from '../../../core/common/constants';
import { requireUserId } from './rh-agent-firestore-helpers';
import { RhAgentTrade, RhAgentTradeDoc, RhAgentTradeStatus, SignalDirection } from './rh-agent.types';
import { SignalTimeframe } from '../common/rh-agent.constants';

@Injectable({
  providedIn: 'root',
})
export class RhAgentTradeService {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(Auth);
  private readonly injector = inject(EnvironmentInjector);

  /** Load all trades for a specific source run across all symbol subcollections. */
  loadTradesForRun(runId: string): Observable<RhAgentTrade[]> {
    return requireUserId(this.auth, this.injector).pipe(
      take(1),
      switchMap((userId) => {
        const q = query(
          collectionGroup(this.firestore, Subcollection.TRADES).withConverter(tradeConverter),
          where('userId', '==', userId),
          where('runId', '==', runId)
        );
        return this.runQuery(q);
      })
    );
  }

  /** Subscribe to real-time trade updates for a specific run. */
  listenToTradesForRun(runId: string): Observable<RhAgentTrade[]> {
    return requireUserId(this.auth, this.injector).pipe(
      switchMap((userId) => {
        const q = query(
          collectionGroup(this.firestore, Subcollection.TRADES).withConverter(tradeConverter),
          where('userId', '==', userId),
          where('runId', '==', runId)
        );
        return new Observable<RhAgentTrade[]>((subscriber) => {
          const unsubscribe = onSnapshot(q, (snapshot) => {
            subscriber.next(this.toTrades(snapshot.docs));
          }, (error) => subscriber.error(error));
          return () => unsubscribe();
        });
      })
    );
  }

  private runQuery(q: Query<RhAgentTradeDoc>): Observable<RhAgentTrade[]> {
    return from(runInInjectionContext(this.injector, () => getDocs(q))).pipe(
      map((snapshot) => this.toTrades(snapshot.docs))
    );
  }

  private toTrades(docs: QueryDocumentSnapshot<RhAgentTradeDoc>[]): RhAgentTrade[] {
    return docs.map((d) => this.toTrade(d));
  }

  private toTrade(d: QueryDocumentSnapshot<RhAgentTradeDoc>): RhAgentTrade {
    const data = d.data();
    return {
      id: d.id,
      userId: data.userId,
      runId: data.runId,
      marketDate: data.marketDate,
      occurrenceDecisionId: data.occurrenceDecisionId,
      symbol: data.symbol,
      direction: data.direction,
      timeframe: data.timeframe,
      signalType: data.signalType,
      barDate: data.barDate,
      status: data.status,
      entryAt: data.entryAt,
      entryPrice: data.entryPrice,
      positionSize: data.positionSize,
      quantity: data.quantity,
      stopPrice: data.stopPrice,
      exitAt: data.exitAt,
      exitPrice: data.exitPrice,
      realizedPnl: data.realizedPnl,
      notes: data.notes,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    };
  }
}

const tradeConverter: FirestoreDataConverter<RhAgentTradeDoc> = {
  toFirestore(modelObject: RhAgentTradeDoc): DocumentData {
    const { id, ...rest } = modelObject as RhAgentTrade;
    return rest;
  },
  fromFirestore(snapshot: QueryDocumentSnapshot<DocumentData>): RhAgentTradeDoc {
    const data = snapshot.data();
    assertTradeDoc(data, snapshot.id);
    return data;
  },
};

function assertTradeDoc(data: DocumentData, docId: string): asserts data is RhAgentTradeDoc {
  const requireString = (field: string) => {
    const value = data[field];
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`[TradeService] Trade doc ${docId} is missing or invalid required field "${field}"`);
    }
  };
  const requireNumber = (field: string) => {
    const value = data[field];
    if (typeof value !== 'number' || Number.isNaN(value)) {
      throw new Error(`[TradeService] Trade doc ${docId} is missing or invalid required numeric field "${field}"`);
    }
  };
  const optionalString = (field: string) => {
    const value = data[field];
    if (value !== undefined && (typeof value !== 'string' || value.length === 0)) {
      throw new Error(`[TradeService] Trade doc ${docId} has invalid optional field "${field}"`);
    }
  };
  const optionalNumber = (field: string) => {
    const value = data[field];
    if (value !== undefined && (typeof value !== 'number' || Number.isNaN(value))) {
      throw new Error(`[TradeService] Trade doc ${docId} has invalid optional numeric field "${field}"`);
    }
  };

  requireString('runId');
  requireString('marketDate');
  requireString('symbol');
  requireString('signalType');
  requireString('barDate');
  requireString('entryAt');
  requireString('createdAt');
  requireNumber('entryPrice');
  requireNumber('positionSize');
  requireNumber('quantity');

  const status = data['status'];
  if (status !== RhAgentTradeStatus.OPEN && status !== RhAgentTradeStatus.CLOSED) {
    throw new Error(`[TradeService] Trade doc ${docId} has invalid "status": ${String(status)}`);
  }

  const direction = data['direction'];
  if (direction !== SignalDirection.LONG && direction !== SignalDirection.SHORT) {
    throw new Error(`[TradeService] Trade doc ${docId} has invalid "direction": ${String(direction)}`);
  }

  const timeframe = data['timeframe'];
  if (timeframe !== SignalTimeframe.DAILY && timeframe !== SignalTimeframe.WEEKLY) {
    throw new Error(`[TradeService] Trade doc ${docId} has invalid "timeframe": ${String(timeframe)}`);
  }

  optionalString('userId');
  optionalString('occurrenceDecisionId');
  optionalString('exitAt');
  optionalString('notes');
  optionalString('updatedAt');
  optionalNumber('stopPrice');
  optionalNumber('exitPrice');
  optionalNumber('realizedPnl');
}
```

## `44b9ca3:src/app/features/rh-agent/services/rh-agent.types.ts`

```typescript
/**
 * RH Agent shared types and constants.
 *
 * These were extracted from rh-agent.service.ts so the new focused services
 * can share them without circular dependencies.
 */

import { RhAgentReviewDecision, RhAgentTradeStatus, SignalDirection, SignalStatus, SignalTimeframe } from '../common/rh-agent.constants';

/**
 * Cron expression for the RH Agent daily scheduler (UTC).
 * Must stay in sync with functions/src/rh-agent-cloud-function/rh-agent-trigger.ts
 */
export const RH_AGENT_SCHEDULE_CRON = '0 1 * * 2-6'; // 1 AM UTC = 6 PM PT, Mon-Fri

/**
 * Maximum dollar amount per trade to prevent oversized positions.
 */
export const RH_AGENT_MAX_TRADE_AMOUNT = 100;

export interface RhAgentStatus {
  isEnabled: boolean;
  lastRunAt?: string;
  lastRunStatus?: string;
  totalRuns: number;
  totalSignalsGenerated: number;
  symbolsMonitored: string[]; // Always defined, empty array if none
  schedule?: string;
}

export interface RhAgentRun {
  id: string;
  status: string;
  startedAt: string;
  completedAt?: string;
  strategy?: string;
  marketDate?: string;
  symbolsProcessed?: number;
  totalSymbols?: number;
  processedCount?: number;
  signalsGenerated?: number;
  summary?: string;
  triggeredBy?: 'manual' | 'pdr' | 'nightly' | 'symbol-added';
}

/** Market cap tiers derived from SA overview data. */
export type MarketCapTier = 'mega' | 'large' | 'mid' | 'small' | 'micro';

export { SignalDirection, RhAgentTradeStatus } from '../common/rh-agent.constants';

/** Known source values for how a symbol entered the RH Agent tracked universe. */
export enum RhAgentSymbolSource {
  MANUAL_ADD = 'manual-add',
  PARTNER_UNIVERSE = 'partner-universe',
}

/**
 * Symbol profile returned by rhAgentGetSymbolsWithSignals.
 * Includes config fields and company overview (after Phase 1 sync).
 */
export interface RhAgentSymbolProfile {
  symbol: string;
  enabled: boolean;
  createdAt: string;
  /** How this symbol entered the tracked universe (one of RhAgentSymbolSource). */
  source?: RhAgentSymbolSource;
  lastAnalyzedAt?: string;
  lastDailySignalDate?: string;
  lastWeeklySignalDate?: string;
  lastDailySignalDirection?: string;
  lastWeeklySignalDirection?: string;
  // Company overview (populated by Phase 1 SA sync)
  name?: string;
  sector?: string;
  industry?: string;
  exchange?: string;
  marketCap?: number;
  marketCapTier?: MarketCapTier;
  beta?: number;
  peRatio?: number;
  week52High?: number;
  week52Low?: number;
  ma200?: number;
  ma50?: number;
  dividendYield?: number;
}

/**
 * A single signal entry stored in run-ids or signal-history docs.
 */
export interface RhAgentSignalItem {
  id: string; // barDate (doc ID)
  symbol: string;
  barDate: string; // YYYY-MM-DD — the bar that fired
  marketDate: string; // YYYY-MM-DD — the run date
  runId: string;
  timeframe: SignalTimeframe;
  direction: SignalDirection;
  signalType: string;
  status: SignalStatus;
  indicators: Record<string, number | string | null>;
  /** Closing price for the bar that fired the signal, if available. */
  closePrice?: number;
}

/** UI row shape used as input when opening trades from the Order page. */
export interface TradeInputRow {
  symbol: string;
  direction: SignalDirection;
  signalType: string;
  barDate: string;
  timeframe: SignalTimeframe;
  positionSize: number;
  stopLossPercent: number;
  entryPrice: number;
}

/** A real trade placed from an accepted RH Agent occurrence. */
export interface RhAgentTrade {
  id: string;
  userId?: string;
  runId: string;
  marketDate: string;
  /** Optional link back to the occurrence decision that generated this trade. */
  occurrenceDecisionId?: string;
  symbol: string;
  direction: SignalDirection;
  timeframe: SignalTimeframe;
  signalType: string;
  barDate: string;
  status: RhAgentTradeStatus;
  /** Timestamp when the trade was opened (when the user marked it executed). */
  entryAt: string;
  /** Entry price, typically the close price of the signal bar. */
  entryPrice: number;
  /** Dollar amount committed. */
  positionSize: number;
  /** Whole-share quantity derived from positionSize / entryPrice. */
  quantity: number;
  /** Stop-loss price derived from the configured stop-loss percentage. */
  stopPrice?: number;
  /** Timestamp when the trade was closed, if applicable. */
  exitAt?: string;
  /** Exit price, if the trade has been closed. */
  exitPrice?: number;
  /** Realized P&L in dollars, if the trade has been closed. */
  realizedPnl?: number;
  /** Optional user-facing notes. */
  notes?: string;
  createdAt: string;
  updatedAt?: string;
}

/** Firestore document shape for a trade record (the trade ID is the doc ID). */
export interface RhAgentTradeDoc extends Omit<RhAgentTrade, 'id'> {}

/** Subset of review decisions that are persisted as durable occurrence decisions. */
export type DurableDecisionType =
  | RhAgentReviewDecision.ACCEPT
  | RhAgentReviewDecision.REJECT;

export interface RhAgentOccurrenceDecision {
  /** Stable identity for the decision doc. */
  id: string;
  /** User who made the decision. Optional when the object is built optimistically; the service stamps it. */
  userId?: string;
  /** Source run that produced the occurrence. */
  runId: string;
  /** Market date of the source run. */
  marketDate: string;
  /** Symbol ticker. */
  symbol: string;
  /** Timeframe of the signal: D or W. */
  timeframe: SignalTimeframe;
  /** LONG or SHORT direction of the signal. */
  direction: SignalDirection;
  /** Concrete signal type (e.g., D_ZONE_V1_UPTICK). */
  signalType: string;
  /** Bar date that fired the signal. */
  barDate: string;
  /** Decision type. */
  decisionType: DurableDecisionType;
  /** Timestamp when the user decision was recorded. */
  decidedAt: string;
  /** Timestamp when the associated trade was actually placed, if applicable. */
  executedAt?: string;
  /** Whether this decision still appears in the latest completed run. */
  isCurrentInLatestRun: boolean;
  /** Optional user-facing notes. */
  notes?: string;
  /** Indicator payload snapshot from the source signal. */
  indicators?: Record<string, number | string | null>;
}

export interface ManualRunRequest {
  symbols?: string[]; // Optional: specific symbols to run, or all enabled
  strategy?: string; // Optional: specific strategy to run
  date?: string; // Optional: override market date (YYYY-MM-DD)
}

export interface ManualRunResponse {
  runId: string;
  status: string;
  totalSymbols: number;
  enqueued: number;
  failed: number;
  message: string;
}
```

## `44b9ca3:src/app/features/rh-agent/stores/rh-agent-execution.store.ts`

```typescript
/**
 * RH Agent Execution Store
 *
 * Canonical orchestration layer for "executing" accepted occurrence decisions.
 * A single call here creates the trade record, marks the occurrence decision
 * executed, and updates both local caches. This keeps the Order page free of
 * transaction choreography and avoids half-applied state.
 */
import { inject } from '@angular/core';
import {
  signalStore,
  withState,
  withMethods,
  patchState,
} from '@ngrx/signals';
import { MatSnackBar } from '@angular/material/snack-bar';

import { RhAgentExecutionService, type ExecutionRowInput } from '../services/rh-agent-execution.service';
import { RhAgentTradeStore } from './rh-agent-trade.store';
import { RhAgentOccurrenceDecisionStore } from './rh-agent-occurrence-decision.store';

export interface RhAgentExecutionState {
  /** True while an execute-batch call is in flight. */
  executing: boolean;
  /** Error from the last execute call, if any. */
  executeError: string | null;
}

const initialState: RhAgentExecutionState = {
  executing: false,
  executeError: null,
};

export const RhAgentExecutionStore = signalStore(
  { providedIn: 'root' },

  withState(initialState),

  withMethods((
    state,
    executionService = inject(RhAgentExecutionService),
    tradeStore = inject(RhAgentTradeStore),
    occurrenceStore = inject(RhAgentOccurrenceDecisionStore),
    snackBar = inject(MatSnackBar),
  ) => ({
    /**
     * Execute a batch of accepted rows atomically.
     * Creates trade records and marks the linked occurrence decisions executed in
     * a single transaction, then updates both local caches.
     */
    executeTradeRows(
      runId: string,
      marketDate: string,
      inputs: ExecutionRowInput[]
    ): void {
      if (inputs.length === 0) return;
      patchState(state, { executing: true, executeError: null });

      executionService.executeTradeRows(runId, marketDate, inputs).subscribe({
        next: ({ trades, decisionIds }) => {
          tradeStore.addTrades(trades);
          occurrenceStore.patchExecutedByIds(decisionIds);
          patchState(state, { executing: false });
        },
        error: (err: unknown) => {
          console.error('[ExecutionStore] Failed to execute trades:', err);
          const message = err instanceof Error ? err.message : String(err ?? 'Execution failed');
          patchState(state, { executing: false, executeError: message });
          snackBar.open(message, 'Dismiss', { duration: 4000 });
        },
      });
    },
  }))
);
```

## `44b9ca3:src/app/features/rh-agent/stores/rh-agent-group.store.ts`

```typescript
/**
 * RH Agent Group Store
 *
 * Manages the symbol-centric grouped review state.
 * Primary data model for Phase 5 grouped review UI.
 *
 * Responsibilities:
 * - Load symbols with signals for a given run ID
 * - Group symbols by the selected dimension (sector, industry, marketCapTier)
 * - Track selected symbol for the detail panel
 * - Track quick-chart symbol and show-all mode
 */
import { inject, effect, computed, DestroyRef } from '@angular/core';
import {
  signalStore,
  withState,
  withComputed,
  withMethods,
  withHooks,
  patchState,
} from '@ngrx/signals';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { forkJoin } from 'rxjs';
import { MatSnackBar } from '@angular/material/snack-bar';

import {
  type RhAgentSymbolProfile,
  type RhAgentSignalItem,
  type RhAgentRun,
} from '../services/rh-agent.types';
import { RhAgentSignalService } from '../services/rh-agent-signal.service';
import { RhAgentStore } from './rh-agent.store';
import { RhAgentTriageStore } from './rh-agent-triage.store';
import { RhAgentSymbolListStore } from './rh-agent-symbol-list.store';
import { RhAgentSymbolHistoryStore } from './rh-agent-symbol-history.store';
import { RhAgentOccurrenceDecisionStore } from './rh-agent-occurrence-decision.store';
import {
  GroupDimension,
  RhAgentReviewDecision,
  SignalTimeframe,
  SignalDirection,
} from '../common/rh-agent.constants';
import {
  buildFilteredCandidates,
  buildSymbolGroups,
  computeProfileCounts,
  profileMatchesSignalFilter,
} from '../utils/rh-agent.utils';
import { SignalReviewUiStore } from './signal-review-ui.store';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A symbol row in the grouped list — profile + triage state. */
export interface RhSymbolRow {
  profile: RhAgentSymbolProfile;
  /** True if the symbol has a signal for the active run. */
  hasSignal: boolean;
  signals?: RhAgentSignalItem[];
  signalsLoading?: boolean;
  reviewStatus: RhAgentReviewDecision;
}

/** A rendered group in the expansion panel list. */
export interface RhSymbolGroup {
  /** Group key — e.g. 'Technology', 'large', 'NASDAQ' */
  key: string;
  rows: RhSymbolRow[];
  /** Long signal count for the active timeframe. */
  longCount: number;
  /** Short signal count for the active timeframe. */
  shortCount: number;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface RhAgentGroupState {
  /** Active run ID being reviewed. */
  activeRunId: string | null;
  /** Cached market date of the active run (YYYY-MM-DD). Prefer the canonical value from viewedRun(). */
  _activeRunMarketDate: string | null;
  /** Current grouping dimension. */
  groupDimension: GroupDimension;
  /** All signal symbols returned from the callable (W + D merged). */
  signalSymbols: RhAgentSymbolProfile[];
  /** Loading state for the main symbol list query. */
  symbolsLoading: boolean;
  symbolsError: string | null;
  /** Currently selected symbol for the detail panel. */
  selectedSymbol: string | null;
  /** Symbol currently displayed in the quick-charts panel. */
  quickChartSymbol: string | null;
  /** Whether the "show all symbols" mode is active. */
  showAllSymbols: boolean;
  /** All enabled symbols — loaded on demand when showAllSymbols is toggled on. */
  allSymbols: RhAgentSymbolProfile[];
  /** Loading state for the all-symbols query. */
  allSymbolsLoading: boolean;
}

const initialState: RhAgentGroupState = {
  activeRunId: null,
  _activeRunMarketDate: null,
  groupDimension: GroupDimension.SECTOR,
  signalSymbols: [],
  symbolsLoading: false,
  symbolsError: null,
  selectedSymbol: null,
  quickChartSymbol: null,
  showAllSymbols: false,
  allSymbols: [],
  allSymbolsLoading: false,
};

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const RhAgentGroupStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),

  withMethods((
    state,
    signalService = inject(RhAgentSignalService),
    snackBar = inject(MatSnackBar),
    destroyRef = inject(DestroyRef),
    triageStore = inject(RhAgentTriageStore),
    occurrenceStore = inject(RhAgentOccurrenceDecisionStore),
    symbolListStore = inject(RhAgentSymbolListStore),
    historyStore = inject(RhAgentSymbolHistoryStore),
  ) => ({
    /** Set the active run, clear in-memory triage state, load durable occurrence decisions, and reload symbols. */
    setActiveRun(runId: string, marketDate: string): void {
      patchState(state, { activeRunId: runId, _activeRunMarketDate: marketDate, signalSymbols: [], selectedSymbol: null });
      triageStore.resetForRun();
      occurrenceStore.clearDecisions();
      occurrenceStore.loadDecisionsForRun(runId);
      this.loadSymbolsWithSignals();
    },

    /** Change group dimension (no reload needed — regrouping is computed). */
    setGroupDimension(dimension: GroupDimension): void {
      patchState(state, { groupDimension: dimension });
    },

    /**
     * Load signal symbols for current marketDate — fetches both W and D,
     * merges by symbol (union). A symbol appears if it has either timeframe signal.
     * Profile fields from the W result take precedence (arbitrary — they're the same doc).
     */
    loadSymbolsWithSignals(): void {
      const runId = state.activeRunId();
      if (!runId) return;
      patchState(state, { symbolsLoading: true, symbolsError: null });

      // Fetch both timeframes in parallel and merge
      const w$ = signalService.getSymbolsWithSignals(runId, SignalTimeframe.WEEKLY);
      const d$ = signalService.getSymbolsWithSignals(runId, SignalTimeframe.DAILY);

      forkJoin([w$, d$])
        .pipe(takeUntilDestroyed(destroyRef))
        .subscribe({
          next: ([weeklySymbols, dailySymbols]) => {
            // Merge: build map keyed by symbol, W first then D overlay
            const map = new Map<string, RhAgentSymbolProfile>();
            for (const s of weeklySymbols) map.set(s.symbol, s);
            for (const s of dailySymbols) {
              if (!map.has(s.symbol)) map.set(s.symbol, s);
            }
            const symbols = [...map.values()];
            patchState(state, { signalSymbols: symbols, symbolsLoading: false });
            symbolListStore.loadSymbolLists();
            const runId = state.activeRunId();
            if (runId) {
              for (const s of symbols) {
                historyStore.loadSignalHistoryForRun(s.symbol, runId);
              }
            }
          },
          error: (err: unknown) => {
            const message = err instanceof Error ? err.message : 'Load failed';
            patchState(state, { symbolsLoading: false, symbolsError: message });
            snackBar.open('Failed to load symbols', 'Dismiss', { duration: 5000 });
          },
        });
    },

    /** Select a symbol — delegates signal history loading to the history store. */
    selectSymbol(symbol: string): void {
      patchState(state, { selectedSymbol: symbol });
      historyStore.loadSignalHistory(symbol);
    },

    /** Clear selected symbol. */
    clearSelectedSymbol(): void {
      patchState(state, { selectedSymbol: null });
    },

    /** Toggle show-all-symbols mode. Loads all symbols on first activation. */
    toggleShowAllSymbols(): void {
      const next = !state.showAllSymbols();
      patchState(state, { showAllSymbols: next });
      if (next && state.allSymbols().length === 0) {
        this.loadAllSymbols();
      }
    },

    /** Load all enabled symbols from Firestore (no callable). */
    loadAllSymbols(): void {
      patchState(state, { allSymbolsLoading: true });
      signalService.getAllSymbols()
        .pipe(takeUntilDestroyed(destroyRef))
        .subscribe({
          next: (symbols) => {
            patchState(state, { allSymbols: symbols, allSymbolsLoading: false });
            symbolListStore.loadSymbolLists();
          },
          error: (err: unknown) => {
            patchState(state, { allSymbolsLoading: false });
            snackBar.open('Failed to load all symbols', 'Dismiss', { duration: 5000 });
            console.error('[RhAgentGroupStore] Failed to load all symbols:', err);
          },
        });
    },

    /** Set the symbol shown in the quick-charts panel. */
    setQuickChartSymbol(symbol: string | null): void {
      patchState(state, { quickChartSymbol: symbol });
    },
  })),

  withComputed((state, triageStore = inject(RhAgentTriageStore), symbolListStore = inject(RhAgentSymbolListStore), historyStore = inject(RhAgentSymbolHistoryStore), uiStore = inject(SignalReviewUiStore)) => ({
    /**
     * Grouped view — groups built from signalSymbols, sorted by marketCap desc within group.
     * Reads signalFilter directly from SignalReviewUiStore — single source of truth, no copy.
     * When showAllSymbols is true, non-signal symbols are included; otherwise only signal symbols.
     */
    groups: computed((): RhSymbolGroup[] =>
      buildSymbolGroups({
        signalSymbols: state.signalSymbols(),
        allSymbols: state.allSymbols(),
        showAll: state.showAllSymbols(),
        dimension: state.groupDimension(),
        symbolLists: symbolListStore.symbolLists(),
        activeListFilter: symbolListStore.activeListFilter(),
        statuses: triageStore.statuses(),
        historyCache: historyStore.signalHistoryCache(),
        historyLoading: historyStore.signalHistoryLoading(),
        activeRunId: state.activeRunId(),
        signalFilter: uiStore.signalFilter(),
      })
    ),
  })),

  withComputed((state, symbolListStore = inject(RhAgentSymbolListStore), uiStore = inject(SignalReviewUiStore)) => ({
    /**
     * Profiles that pass the active list and signal filters, using profile data.
     * Kept separate from the history-backed `groups()` so header counts and the
     * flat symbol list are stable while per-symbol signal histories finish loading.
     */
    filteredProfiles: computed((): RhAgentSymbolProfile[] => {
      const candidates = buildFilteredCandidates({
        signalSymbols: state.signalSymbols(),
        allSymbols: state.allSymbols(),
        showAll: state.showAllSymbols(),
        symbolLists: symbolListStore.symbolLists(),
        activeListFilter: symbolListStore.activeListFilter(),
      });
      return candidates.filter((p) => profileMatchesSignalFilter(p, uiStore.signalFilter()));
    }),
  })),

  withComputed((state, uiStore = inject(SignalReviewUiStore)) => ({
    /**
     * Counts derived from the stable profile-filtered set.
     * These update only when the symbol list, list filter, or signal filter changes.
     */
    filteredProfileCounts: computed(() =>
      computeProfileCounts(state.filteredProfiles(), uiStore.signalFilter())
    ),

    /**
     * Stable flat list of visible symbols for prev/next navigation.
     * Derived from profile-filtered data so it does not flicker while histories load.
     */
    flatFilteredSymbols: computed((): string[] =>
      state.filteredProfiles().map((p) => p.symbol).sort()
    ),
  })),

  withComputed((state, historyStore = inject(RhAgentSymbolHistoryStore)) => ({
    /** Total visible symbol count across all groups. */
    totalSignalCount: computed(() => state.filteredProfileCounts().total),

    /** Count of visible symbols with a weekly signal. */
    weeklySignalCount: computed(() => state.filteredProfileCounts().weekly),

    /** Count of visible symbols with a daily signal. */
    dailySignalCount: computed(() => state.filteredProfileCounts().daily),

    /** Long/short breakdown across visible rows. */
    longCount: computed(() => state.filteredProfileCounts().long),

    shortCount: computed(() => state.filteredProfileCounts().short),

    /** Currently selected symbol's loaded signals (from the history store cache). */
    selectedSymbolSignals: computed((): RhAgentSignalItem[] => {
      const sym = state.selectedSymbol();
      if (!sym) return [];
      return historyStore.signalHistoryCache()[sym] ?? [];
    }),

    /** Profile of the currently selected symbol. */
    selectedSymbolProfile: computed((): RhAgentSymbolProfile | null => {
      const sym = state.selectedSymbol();
      if (!sym) return null;
      return state.signalSymbols().find((p) => p.symbol === sym) ?? null;
    }),
  })),

  withComputed((state, agentStore = inject(RhAgentStore)) => ({
    /** The full run document for the currently viewed run, if available in the runs stream. */
    viewedRun: computed((): RhAgentRun | null => {
      const id = state.activeRunId();
      if (!id) return null;
      return agentStore.runs().find((r) => r.id === id) ?? null;
    }),
  })),

  withComputed((state, agentStore = inject(RhAgentStore)) => ({
    /**
     * Market date of the viewed run.
     * Derived from canonical run metadata when available; falls back to the cached value set by setActiveRun.
     */
    activeRunMarketDate: computed((): string | null =>
      state.viewedRun()?.marketDate ?? state._activeRunMarketDate()
    ),

    /** True when the viewed run is the latest completed actionable run. */
    isActionableRun: computed(() => {
      const viewedId = state.activeRunId();
      const latestId = agentStore.latestCompletedRun()?.id;
      return !!viewedId && !!latestId && viewedId === latestId;
    }),
  })),

  withHooks((store, agentStore = inject(RhAgentStore), uiStore = inject(SignalReviewUiStore), triageStore = inject(RhAgentTriageStore), occurrenceStore = inject(RhAgentOccurrenceDecisionStore)) => {
    /** Tracks the previous latest completed run ID to detect new-run transitions. */
    let previousLatestRunId: string | null = null;

    return {
      onInit() {
        /**
         * When a newer completed run becomes latest and the viewed run was the
         * previous latest, clear only ephemeral screening state. Historical research
         * and navigation remain available.
         */
        effect(() => {
          const latestId = agentStore.latestCompletedRun()?.id ?? null;
          const previousId = previousLatestRunId;
          previousLatestRunId = latestId;

          if (!latestId || !previousId || latestId === previousId) return;

          // Durable decisions for the previous latest run are no longer current,
          // regardless of which run is currently being viewed.
          occurrenceStore.markRunNotCurrent(previousId);

          const viewedId = store.activeRunId();
          if (viewedId !== previousId) return;

          uiStore.setTimeframeFilter(SignalTimeframe.ALL);
          uiStore.setDirectionFilter(SignalDirection.ALL);
          uiStore.setAllExpanded(false, []);
          patchState(store, { selectedSymbol: null, quickChartSymbol: null });
          triageStore.clearEphemeralScreeningState();
        });

        effect(() => {
          const runId = store.activeRunId();
          const decisions = occurrenceStore.occurrenceDecisions();
          if (!runId) return;

          // Aggregate per-symbol status from possibly multiple occurrences.
          // EXECUTED wins over ACCEPT, which wins over REJECT.
          const ranked = [
            RhAgentReviewDecision.EXECUTED,
            RhAgentReviewDecision.ACCEPT,
            RhAgentReviewDecision.REJECT,
          ];
          const statusMap: Record<string, RhAgentReviewDecision> = {};
          for (const decision of Object.values(decisions)) {
            if (decision.runId !== runId) continue;
            const current = statusMap[decision.symbol];
            const next = decision.executedAt
              ? RhAgentReviewDecision.EXECUTED
              : decision.decisionType;
            if (!current) {
              statusMap[decision.symbol] = next;
            } else if (ranked.indexOf(next) < ranked.indexOf(current)) {
              statusMap[decision.symbol] = next;
            }
          }
          triageStore.setStatuses(statusMap);
        });
      },
    };
  }),
);
```

## `44b9ca3:src/app/features/rh-agent/stores/rh-agent-occurrence-decision.store.ts`

```typescript
/**
 * RH Agent Occurrence Decision Store
 *
 * Durable source-specific ACCEPT / REJECT decisions for individual signal
 * occurrences. Decisions are keyed by runId + symbol + timeframe + signalType
 * so multiple intraday occurrences do not overwrite one another.
 *
 * This store is intentionally separate from the ephemeral screening state in
 * RhAgentTriageStore.
 */
import { computed, inject } from '@angular/core';
import {
  signalStore,
  withState,
  withComputed,
  withMethods,
  patchState,
} from '@ngrx/signals';
import { MatSnackBar } from '@angular/material/snack-bar';

import {
  RhAgentOccurrenceDecisionService,
} from '../services/rh-agent-occurrence-decision.service';
import {
  RhAgentSignalItem,
  RhAgentOccurrenceDecision,
  DurableDecisionType,
} from '../services/rh-agent.types';
import { RhAgentReviewDecision } from '../common/rh-agent.constants';
import { buildRhAgentOccurrenceDecisionId } from '../services/rh-agent-firestore-helpers';

export interface RhAgentOccurrenceDecisionState {
  /** Durable occurrence-level decisions keyed by decision id. */
  occurrenceDecisions: Record<string, RhAgentOccurrenceDecision>;
  /** True while decisions for the active run are loading. */
  decisionsLoading: boolean;
  /** Error from loading or persisting decisions. */
  decisionsError: string | null;
}

const initialState: RhAgentOccurrenceDecisionState = {
  occurrenceDecisions: {},
  decisionsLoading: false,
  decisionsError: null,
};

function decisionId(runId: string, symbol: string, timeframe: string, signalType: string): string {
  return buildRhAgentOccurrenceDecisionId(runId, symbol, timeframe, signalType);
}

function buildDecision(
  runId: string,
  marketDate: string,
  signal: RhAgentSignalItem,
  decisionType: DurableDecisionType,
): RhAgentOccurrenceDecision {
  return {
    id: decisionId(runId, signal.symbol, signal.timeframe, signal.signalType),
    runId,
    marketDate,
    symbol: signal.symbol.toUpperCase(),
    timeframe: signal.timeframe,
    direction: signal.direction,
    signalType: signal.signalType,
    barDate: signal.barDate,
    decisionType,
    decidedAt: new Date().toISOString(),
    isCurrentInLatestRun: true,
    indicators: signal.indicators ?? {},
  };
}

export const RhAgentOccurrenceDecisionStore = signalStore(
  { providedIn: 'root' },

  withState(initialState),

  withComputed((state) => {
    const acceptedSymbols = computed((): string[] =>
      Array.from(
        new Set(
          Object.values(state.occurrenceDecisions())
            .filter((d) => d.decisionType === RhAgentReviewDecision.ACCEPT && d.isCurrentInLatestRun)
            .map((d) => d.symbol)
        )
      )
    );

    const activeOrderDecisions = computed((): RhAgentOccurrenceDecision[] =>
      Object.values(state.occurrenceDecisions())
        .filter(
          (d) =>
            d.decisionType === RhAgentReviewDecision.ACCEPT &&
            d.isCurrentInLatestRun &&
            !d.executedAt
        )
        .sort((a, b) => a.symbol.localeCompare(b.symbol))
    );

    const activeOrderSymbols = computed((): string[] =>
      Array.from(new Set(activeOrderDecisions().map((d) => d.symbol)))
    );

    return {
      acceptedSymbols,

      /** Accepted, current-run, unexecuted occurrence decisions. */
      activeOrderDecisions,

      /** Accepted symbols that have not yet been executed, suitable for the active Order page. */
      activeOrderSymbols,

      /** Count of symbols with an accepted current-run occurrence. */
      acceptedCount: computed((): number => acceptedSymbols().length),

      /** True while decisions are loading. */
      loading: computed((): boolean => state.decisionsLoading()),
    };
  }),

  withMethods((
    state,
    occurrenceService = inject(RhAgentOccurrenceDecisionService),
    snackBar = inject(MatSnackBar),
  ) => ({
    /** Persist ACCEPT decisions for the given signal occurrences in the active run. */
    acceptSignals(signals: RhAgentSignalItem[], runId: string, marketDate: string): void {
      this.persistSignalDecisions(signals, runId, marketDate, RhAgentReviewDecision.ACCEPT);
    },

    /** Persist REJECT decisions for the given signal occurrences in the active run. */
    rejectSignals(signals: RhAgentSignalItem[], runId: string, marketDate: string): void {
      this.persistSignalDecisions(signals, runId, marketDate, RhAgentReviewDecision.REJECT);
    },

    /** Delete durable decisions for the given signal occurrences. */
    resetSignals(signals: RhAgentSignalItem[], runId: string): void {
      if (signals.length === 0) return;
      const previousDecisions = state.occurrenceDecisions();
      const next = { ...previousDecisions };
      for (const signal of signals) {
        delete next[decisionId(runId, signal.symbol, signal.timeframe, signal.signalType)];
      }
      patchState(state, { occurrenceDecisions: next });

      occurrenceService.deleteDecisionsBatch(
        runId,
        signals.map((s) => ({ symbol: s.symbol, timeframe: s.timeframe, signalType: s.signalType }))
      ).subscribe({
        error: (err: unknown) => {
          console.error('[OccurrenceDecisionStore] Failed to reset decisions:', err);
          const message = err instanceof Error ? err.message : String(err ?? 'Reset failed');
          patchState(state, { occurrenceDecisions: previousDecisions, decisionsError: message });
          snackBar.open('Failed to reset decisions — reverted', 'Dismiss', { duration: 4000 });
        },
      });
    },

    /** Delete all durable occurrence decisions for a symbol in the given run. */
    resetSymbol(symbol: string, runId: string): void {
      const previousDecisions = state.occurrenceDecisions();
      const next = { ...previousDecisions };
      const idsToDelete: string[] = [];
      const normalized = symbol.toUpperCase();
      for (const [id, d] of Object.entries(previousDecisions)) {
        if (d.runId === runId && d.symbol === normalized) {
          idsToDelete.push(id);
          delete next[id];
        }
      }
      if (idsToDelete.length === 0) return;
      patchState(state, { occurrenceDecisions: next });

      occurrenceService.deleteDecisionIds(idsToDelete).subscribe({
        error: (err: unknown) => {
          console.error('[OccurrenceDecisionStore] Failed to reset symbol:', err);
          const message = err instanceof Error ? err.message : String(err ?? 'Reset failed');
          patchState(state, { occurrenceDecisions: previousDecisions, decisionsError: message });
          snackBar.open('Failed to reset decisions — reverted', 'Dismiss', { duration: 4000 });
        },
      });
    },

    /** Load durable decisions for a specific source run. */
    loadDecisionsForRun(runId: string): void {
      patchState(state, { decisionsLoading: true, decisionsError: null });
      occurrenceService.loadDecisionsForRun(runId).subscribe({
        next: (decisions) => {
          const map: Record<string, RhAgentOccurrenceDecision> = {};
          for (const d of decisions) {
            map[d.id] = d;
          }
          patchState(state, { occurrenceDecisions: map, decisionsLoading: false });
        },
        error: (err: unknown) => {
          console.error('[OccurrenceDecisionStore] Failed to load decisions:', err);
          const message = err instanceof Error ? err.message : String(err ?? 'Load failed');
          patchState(state, { decisionsLoading: false, decisionsError: message });
        },
      });
    },

    /**
     * Patch the local cache to reflect that the given occurrence decision IDs
     * have been executed. Persistence is handled by the execution service; this
     * method only updates the in-memory state.
     */
    patchExecutedByIds(ids: string[]): void {
      if (ids.length === 0) return;
      const decisions = state.occurrenceDecisions();
      const next: Record<string, RhAgentOccurrenceDecision> = { ...decisions };
      const now = new Date().toISOString();
      for (const id of ids) {
        const d = decisions[id];
        if (d && !d.executedAt) {
          next[id] = { ...d, executedAt: now };
        }
      }
      patchState(state, { occurrenceDecisions: next });
    },

    /** Mark every decision for the given source run as no longer current in the latest run. */
    markRunNotCurrent(runId: string): void {
      const previousDecisions = state.occurrenceDecisions();
      const next: Record<string, RhAgentOccurrenceDecision> = {};
      for (const [id, d] of Object.entries(previousDecisions)) {
        if (d.runId === runId) {
          next[id] = { ...d, isCurrentInLatestRun: false };
        } else {
          next[id] = d;
        }
      }
      patchState(state, { occurrenceDecisions: next });
      occurrenceService.markRunDecisionsNotCurrent(runId).subscribe({
        error: (err: unknown) => {
          console.error('[OccurrenceDecisionStore] Failed to mark run not current:', err);
          const message = err instanceof Error ? err.message : String(err ?? 'Update failed');
          patchState(state, { occurrenceDecisions: previousDecisions, decisionsError: message });
        },
      });
    },

    /** Drop all loaded decisions. Called when switching to a different run. */
    clearDecisions(): void {
      patchState(state, { occurrenceDecisions: {} });
    },

    persistSignalDecisions(
      signals: RhAgentSignalItem[],
      runId: string,
      marketDate: string,
      decisionType: DurableDecisionType
    ): void {
      if (signals.length === 0) return;
      // userId is provided by the service, so the optimistic local object leaves it empty.
      const previousDecisions = state.occurrenceDecisions();
      const next = { ...previousDecisions };
      for (const signal of signals) {
        const d = buildDecision(runId, marketDate, signal, decisionType);
        next[d.id] = d;
      }
      patchState(state, { occurrenceDecisions: next });

      occurrenceService.persistDecisionsBatch(runId, marketDate, signals, decisionType).subscribe({
        error: (err: unknown) => {
          console.error('[OccurrenceDecisionStore] Failed to persist decisions:', err);
          const message = err instanceof Error ? err.message : String(err ?? 'Persist failed');
          patchState(state, { occurrenceDecisions: previousDecisions, decisionsError: message });
          snackBar.open(`Failed to save ${decisionType.toLowerCase()} decisions`, 'Dismiss', { duration: 4000 });
        },
      });
    },
  })),

);
```

## `44b9ca3:src/app/features/rh-agent/stores/rh-agent-trade.store.ts`

```typescript
/**
 * RH Agent Trade Store
 *
 * In-memory cache of real trades placed from accepted RH Agent occurrences.
 * Tracks active and closed trades separately from screening/triage state and
 * from the durable occurrence decisions that produced them.
 */
import { computed, inject } from '@angular/core';
import {
  signalStore,
  withState,
  withComputed,
  withMethods,
  patchState,
} from '@ngrx/signals';
import { RhAgentTradeService } from '../services/rh-agent-trade.service';
import { RhAgentTrade } from '../services/rh-agent.types';
import { RhAgentTradeStatus } from '../common/rh-agent.constants';

export interface RhAgentTradeState {
  /** Trades keyed by trade id. */
  trades: Record<string, RhAgentTrade>;
  /** True while trades for the active run are loading. */
  tradesLoading: boolean;
}

const initialState: RhAgentTradeState = {
  trades: {},
  tradesLoading: false,
};

export const RhAgentTradeStore = signalStore(
  { providedIn: 'root' },

  withState(initialState),

  withComputed((state) => {
    const activeTrades = computed((): RhAgentTrade[] =>
      Object.values(state.trades()).filter((t) => t.status === RhAgentTradeStatus.OPEN)
    );

    const closedTrades = computed((): RhAgentTrade[] =>
      Object.values(state.trades()).filter((t) => t.status === RhAgentTradeStatus.CLOSED)
    );

    return {
      activeTrades,
      closedTrades,
      activeSymbols: computed((): string[] =>
        Array.from(new Set(activeTrades().map((t) => t.symbol)))
      ),
      activeCount: computed((): number => activeTrades().length),
      closedCount: computed((): number => closedTrades().length),
      loading: computed((): boolean => state.tradesLoading()),
    };
  }),

  withMethods((
    state,
    tradeService = inject(RhAgentTradeService),
  ) => ({
    /** Load all trades for a specific source run. */
    loadTradesForRun(runId: string): void {
      patchState(state, { tradesLoading: true });
      tradeService.loadTradesForRun(runId).subscribe({
        next: (trades) => {
          const map: Record<string, RhAgentTrade> = {};
          for (const t of trades) {
            map[t.id] = t;
          }
          patchState(state, { trades: map, tradesLoading: false });
        },
        error: (err: unknown) => {
          console.error('[TradeStore] Failed to load trades:', err);
          patchState(state, { tradesLoading: false });
        },
      });
    },

    /** Add one or more trades to the in-memory cache. */
    addTrades(trades: RhAgentTrade[]): void {
      if (trades.length === 0) return;
      const next = { ...state.trades() };
      for (const t of trades) {
        next[t.id] = t;
      }
      patchState(state, { trades: next });
    },

    /** Drop all loaded trades. */
    clearTrades(): void {
      patchState(state, { trades: {} });
    },
  }))
);
```

## `44b9ca3:functions/package.json`

```json
{
  "name": "functions",
  "scripts": {
    "lint": "eslint --ext .js,.ts .",
    "build": "esbuild src/index.ts --bundle --platform=node --target=node20 --format=esm --outfile=lib/index.js --external:firebase-admin --external:firebase-functions --external:google-auth-library --external:busboy --external:node-fetch --external:@anthropic-ai/sdk",
    "build:watch": "npm run build -- --watch",
    "typecheck": "tsc --noEmit",
    "test:trade-bridge": "tsx --test ../tests/functions/trade-bridge-security.test.ts ../tests/functions/trade-bridge-http.test.ts",
    "serve": "npm run build && firebase emulators:start --only functions",
    "shell": "npm run build && firebase functions:shell",
    "start": "npm run shell",
    "deploy": "firebase deploy --only functions",
    "logs": "firebase functions:log",
    "dev": "npx tsx src/rh-agent/index.ts",
    "seed:rh-agent": "npx tsx scripts/seed-rh-agent-from-prod.ts"
  },
  "type": "module",
  "engines": {
    "node": "20"
  },
  "main": "lib/index.js",
  "dependencies": {
    "@anthropic-ai/sdk": "^0.39.0",
    "@modelcontextprotocol/sdk": "^1.12.1",
    "busboy": "^1.6.0",
    "dotenv": "^16.4.0",
    "firebase-admin": "^12.7.0",
    "firebase-functions": "^7.0.3",
    "google-auth-library": "^9.14.2"
  },
  "devDependencies": {
    "@types/busboy": "^1.5.4",
    "@types/node": "^22.0.0",
    "@typescript-eslint/eslint-plugin": "^5.12.0",
    "@typescript-eslint/parser": "^5.12.0",
    "esbuild": "^0.28.1",
    "eslint": "^8.9.0",
    "eslint-config-google": "^0.14.0",
    "eslint-plugin-import": "^2.25.4",
    "firebase-functions-test": "^3.3.0",
    "tsx": "^4.0.0",
    "typescript": "^5.8.0"
  },
  "private": true
}
```

## `44b9ca3:package.json`

```json
{
  "name": "rel-str",
  "version": "0.0.0",
  "scripts": {
    "ng": "ng",
    "start": "ng serve",
    "prebuild": "node scripts/gen-syncfusion-license.js",
    "build": "ng build",
    "watch": "ng build --watch --configuration development",
    "build:functions": "npm --prefix functions run build",
    "test:trade-bridge": "npm --prefix functions run test:trade-bridge",
    "test:trade-bridge-client": "ng test --watch=false --browsers=ChromeHeadless --ts-config=tsconfig.trade-bridge-client.spec.json --include=src/app/features/rh-agent/services/trade-bridge-client.service.spec.ts",
    "validate": "npm run build -- --configuration development --no-progress && npm --prefix functions run typecheck && npm run test:trade-bridge-client && npm run test:trade-bridge",
    "emulators:start": "npm run build:functions && firebase emulators:start --only auth,functions,firestore,pubsub,storage --import=.firebase/emulator-data --export-on-exit",
    "emulators:export": "npx firebase emulators:export .firebase/emulator-data --force",
    "emulators:stop": "npm run emulators:export && powershell -NoProfile -ExecutionPolicy Bypass -Command \"$exportDir='.firebase\\emulator-data'; $hubUp = (Get-NetTCPConnection -LocalPort 4410 -ErrorAction SilentlyContinue); if($hubUp){ Write-Output 'Emulator Hub detected on 4410. Attempting export via Hub REST...'; $exportOk=$false; $attempt=1; $max=2; while(-not $exportOk -and $attempt -le $max){ try { $body = @{ path = $exportDir } | ConvertTo-Json; $resp = Invoke-RestMethod -Uri 'http://127.0.0.1:4410/_admin/export' -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 15; if($resp){ Write-Output 'Export succeeded.'; $exportOk=$true } } catch { Write-Output ('Export attempt ' + $attempt + ' failed via Hub REST; retrying...') } $attempt++ } if(-not $exportOk){ Write-Output 'Export failed after retries; proceeding to stop.' } } else { Write-Output 'Emulator Hub not detected on 4410; skipping export.' } ; $ports=@(4210,9100,5002,8088,8087,9200,4410,4010,4510); $maxAttempts=3; for($a=1; $a -le $maxAttempts; $a++){ Write-Output ('Kill attempt ' + $a + ' ...'); foreach($p in $ports){ try { $conns=Get-NetTCPConnection -LocalPort $p -ErrorAction SilentlyContinue; if($conns){ ($conns | Select-Object -ExpandProperty OwningProcess | Sort-Object -Unique | Where-Object { $_ -gt 0 }) | ForEach-Object { try { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue; Write-Output ('Killed PID ' + $_ + ' on port ' + $p) } catch { Write-Output ('Failed to kill PID ' + $_ + ' on port ' + $p) } } } else { Write-Output ('No process on port ' + $p) } } catch { Write-Output ('Query failed for port ' + $p + ': ' + $_) } } Start-Sleep -Seconds 1 } $stillOpen=@(); foreach($p in $ports){ $conns=Get-NetTCPConnection -LocalPort $p -ErrorAction SilentlyContinue; if($conns){ $stillOpen += $p } } if($stillOpen.Count -gt 0){ Write-Output ('Ports still open after attempts: ' + ($stillOpen -join ', ')) } else { Write-Output 'All emulator ports are closed.' }\"",
    "ports:kill": "powershell -NoProfile -ExecutionPolicy Bypass -Command \"$ports=@(9100,5002,8088,8087,9200,4410,4010,4510); foreach($p in $ports){ $conns=Get-NetTCPConnection -LocalPort $p -ErrorAction SilentlyContinue; if($conns){ ($conns | Select-Object -ExpandProperty OwningProcess | Sort-Object -Unique | Where-Object { $_ -gt 0 }) | ForEach-Object { try { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue; Write-Output ('Killed PID ' + $_ + ' on port ' + $p) } catch { Write-Output ('Failed to kill PID ' + $_ + ' on port ' + $p) } } } else { Write-Output ('No process on port ' + $p) } }\"",
    "emulators": "firebase emulators:start --only auth,functions,firestore --import=.firebase/emulator-data --export-on-exit",
    "e2e": "cypress open",
    "e2e:run": "cypress run",
    "pubsub:topic": "powershell -NoProfile -ExecutionPolicy Bypass -Command \"Invoke-RestMethod -Uri 'http://127.0.0.1:8087/v1/projects/rel-str/topics/partner-data-ready' -Method Put | ConvertTo-Json -Depth 5\"",
    "pubsub:list:topics": "powershell -NoProfile -ExecutionPolicy Bypass -Command \"Invoke-RestMethod -Uri 'http://127.0.0.1:8087/v1/projects/rel-str/topics' -Method Get | ConvertTo-Json -Depth 5\"",
    "pubsub:list:subs": "powershell -NoProfile -ExecutionPolicy Bypass -Command \"Invoke-RestMethod -Uri 'http://127.0.0.1:8087/v1/projects/rel-str/subscriptions' -Method Get | ConvertTo-Json -Depth 5\"",
    "pubsub:hb": "powershell -NoProfile -ExecutionPolicy Bypass -Command \"$body = @{ messages = @(@{ attributes = @{ runType = 'heartbeat'; heartbeat = 'true' }; data = 'e30=' }) } | ConvertTo-Json -Depth 5; Invoke-RestMethod -Uri 'http://127.0.0.1:8087/v1/projects/rel-str/topics/partner-data-ready:publish' -Method Post -ContentType 'application/json' -Body $body | ConvertTo-Json -Depth 5\"",
    "pubsub:run": "powershell -NoProfile -ExecutionPolicy Bypass -Command \"$runId = 'local-' + (Get-Date -Format 'yyyyMMdd-HHmmss'); $msg = @{ messages = @(@{ attributes = @{ runType = 'ts_daily_post'; runId = $runId }; data = 'e30=' }) } | ConvertTo-Json -Depth 5; Invoke-RestMethod -Uri 'http://127.0.0.1:8087/v1/projects/rel-str/topics/partner-data-ready:publish' -Method Post -ContentType 'application/json' -Body $msg | ConvertTo-Json -Depth 5\"",
    "diag:pairs:emu": "powershell -NoProfile -ExecutionPolicy Bypass -Command \"$body = @{ env = 'emu' } | ConvertTo-Json -Depth 5; Invoke-RestMethod -Uri 'http://127.0.0.1:5002/rel-str/us-central1/diagnosePairArchivesAdmin' -Method Post -ContentType 'application/json' -Headers @{ Authorization = 'Bearer local-admin' } -Body $body | ConvertTo-Json -Depth 5\"",
    "diag:pairs:prod": "powershell -NoProfile -ExecutionPolicy Bypass -Command \"$token = $env:ADMIN_BACKFILL_TOKEN; if(-not $token){ Write-Error 'ADMIN_BACKFILL_TOKEN env var is not set.'; exit 1 }; $body = @{ env = 'prod' } | ConvertTo-Json -Depth 5; Invoke-RestMethod -Uri 'https://us-central1-rel-str.cloudfunctions.net/diagnosePairArchivesAdmin' -Method Post -ContentType 'application/json' -Headers @{ Authorization = ('Bearer ' + $token) } -Body $body | ConvertTo-Json -Depth 5\"",
    "backfill:symbol-data:trades:emu": "powershell -NoProfile -ExecutionPolicy Bypass -Command \"Invoke-RestMethod -Uri 'http://127.0.0.1:5002/rel-str/us-central1/backfillSymbolDataFromTradesAdmin' -Method Post -Headers @{ Authorization = 'Bearer local-admin' } | ConvertTo-Json -Depth 5\"",
    "backfill:symbol-data:trades:prod": "powershell -NoProfile -ExecutionPolicy Bypass -Command \"$token = $env:ADMIN_BACKFILL_TOKEN; if(-not $token){ Write-Error 'ADMIN_BACKFILL_TOKEN env var is not set.'; exit 1 }; Invoke-RestMethod -Uri 'https://us-central1-rel-str.cloudfunctions.net/backfillSymbolDataFromTradesAdmin' -Method Post -Headers @{ Authorization = ('Bearer ' + $token) } | ConvertTo-Json -Depth 5\""
  },
  "overrides": {
    "firebase": "11.10.0"
  },
  "private": true,
  "dependencies": {
    "@angular/animations": "^21.2.17",
    "@angular/cdk": "^20.2.14",
    "@angular/common": "^21.2.17",
    "@angular/compiler": "^21.2.17",
    "@angular/core": "^21.2.17",
    "@angular/fire": "^20.0.1",
    "@angular/forms": "^21.2.17",
    "@angular/material": "^20.2.14",
    "@angular/platform-browser": "^21.2.17",
    "@angular/platform-browser-dynamic": "^21.2.17",
    "@angular/router": "^21.2.17",
    "@ngrx/signals": "21.1.1",
    "@syncfusion/ej2-angular-base": "^33.2.10",
    "@syncfusion/ej2-angular-charts": "^30.2.7",
    "@syncfusion/ej2-base": "^30.2.6",
    "@syncfusion/ej2-charts": "^30.2.7",
    "javascript-color-gradient": "^2.5.0",
    "rxjs": "~7.8.0",
    "tslib": "^2.3.0",
    "zone.js": "~0.15.1"
  },
  "devDependencies": {
    "@angular-devkit/build-angular": "^21.2.15",
    "@angular/cli": "^21.2.15",
    "@angular/compiler-cli": "^21.2.17",
    "@types/jasmine": "~5.1.0",
    "@types/javascript-color-gradient": "^2.4.2",
    "@types/node": "^18.18.0",
    "dotenv": "^17.2.2",
    "jasmine-core": "~5.1.0",
    "karma": "~6.4.0",
    "karma-chrome-launcher": "~3.2.0",
    "karma-coverage": "~2.2.0",
    "karma-jasmine": "~5.1.0",
    "karma-jasmine-html-reporter": "~2.1.0",
    "typescript": "~5.9.3"
  },
  "prettier": {
    "printWidth": 1600,
    "trailingComma": "es5",
    "tabWidth": 4,
    "useTabs": true,
    "semi": true,
    "singleQuote": true,
    "bracketSameLine": false
  }
}
```
