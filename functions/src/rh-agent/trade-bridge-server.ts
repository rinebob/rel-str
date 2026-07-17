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
