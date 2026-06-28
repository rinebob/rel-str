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
import * as path from "path";
import * as fs from "fs";

const PORT = 3001;
const CLAUDE_CMD = "claude";
const RESULTS_FILE = path.join(process.cwd(), ".trade-results.json");

interface TradeRequest {
  symbol: string;
  side: "buy" | "sell";
  amount: number;
  orderType?: "market" | "limit";
  limitPrice?: number;
}

// CORS headers
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

// Execute trade via Claude Code
async function executeViaClaude(trade: TradeRequest): Promise<string> {
  const prompt = `Execute this trade in my Agentic account (••••6245):
- Symbol: ${trade.symbol.toUpperCase()}
- Side: ${trade.side}
- Amount: $${trade.amount}
- Type: ${trade.orderType || "market"}
${trade.limitPrice ? `- Limit Price: $${trade.limitPrice}` : ""}

Use the robinhood-trading MCP to place this order. Return the order ID, state, and estimated shares as JSON.`;

  // Write prompt to temp file
  const promptFile = path.join(process.cwd(), ".trade-prompt.txt");
  fs.writeFileSync(promptFile, prompt, "utf-8");

  return new Promise((resolve, reject) => {
    // Run claude with the prompt
    const cmd = `${CLAUDE_CMD} --print "$(cat ${promptFile})"`;
    
    exec(cmd, { timeout: 60000 }, (error, stdout, stderr) => {
      // Clean up prompt file
      try { fs.unlinkSync(promptFile); } catch {}

      if (error) {
        reject(new Error(`Claude execution failed: ${error.message}`));
        return;
      }

      resolve(stdout);
    });
  });
}

// Parse Claude's response to extract order details
function parseOrderResult(output: string): any {
  // Try to find JSON in the output
  const jsonMatch = output.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch {
      // Not valid JSON, return raw
    }
  }

  // Extract order ID if present
  const orderIdMatch = output.match(/order[_\s]?id[:\s]+([a-f0-9-]+)/i);
  const stateMatch = output.match(/state[:\s]+(\w+)/i);
  
  return {
    raw: output,
    orderId: orderIdMatch?.[1],
    state: stateMatch?.[1],
    parsed: false,
  };
}

// HTTP server
const server = http.createServer(async (req, res) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  // Only accept POST to /trade
  if (req.method !== "POST" || req.url !== "/trade") {
    res.writeHead(404, corsHeaders);
    res.end(JSON.stringify({ error: "Not found" }));
    return;
  }

  // Read body
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", async () => {
    try {
      const trade: TradeRequest = JSON.parse(body);

      // Validate
      if (!trade.symbol || !trade.side || !trade.amount) {
        res.writeHead(400, corsHeaders);
        res.end(JSON.stringify({ error: "Missing required fields" }));
        return;
      }

      console.log(`\n[${new Date().toISOString()}] Trade request:`, trade);

      // Execute via Claude
      const startTime = Date.now();
      const claudeOutput = await executeViaClaude(trade);
      const duration = Date.now() - startTime;

      const result = parseOrderResult(claudeOutput);

      console.log(`Completed in ${duration}ms:`, result);

      // Save to results log
      const logEntry = {
        timestamp: new Date().toISOString(),
        request: trade,
        result,
        duration,
      };
      
      let logs: any[] = [];
      if (fs.existsSync(RESULTS_FILE)) {
        logs = JSON.parse(fs.readFileSync(RESULTS_FILE, "utf-8"));
      }
      logs.push(logEntry);
      fs.writeFileSync(RESULTS_FILE, JSON.stringify(logs, null, 2));

      res.writeHead(200, corsHeaders);
      res.end(JSON.stringify({
        success: true,
        result,
        duration,
      }));

    } catch (error: any) {
      console.error("Trade execution error:", error);
      res.writeHead(500, corsHeaders);
      res.end(JSON.stringify({
        success: false,
        error: error.message,
      }));
    }
  });
});

// Health check endpoint
server.on("request", (req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, corsHeaders);
    res.end(JSON.stringify({
      status: "ok",
      claudeAvailable: true,
      timestamp: new Date().toISOString(),
    }));
  }
});

server.listen(PORT, () => {
  console.log(`\n🚀 Trade Bridge Server running on http://localhost:${PORT}`);
  console.log(`\nEndpoints:`);
  console.log(`  POST http://localhost:${PORT}/trade  - Execute trade`);
  console.log(`  GET  http://localhost:${PORT}/health - Health check`);
  console.log(`\nPrerequisites:`);
  console.log(`  - Claude Code must be running with robinhood-trading MCP connected`);
  console.log(`  - Agentic account (••••6245) must have buying power`);
  console.log("\nExample request:");
  console.log(`  curl -X POST http://localhost:${PORT}/trade \\`);
  console.log('    -H "Content-Type: application/json" \\');
  console.log('    -d \'{"symbol":"AAPL","side":"buy","amount":100}\'');
  console.log("\nPress Ctrl+C to stop\n");
});

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\n\nShutting down...");
  server.close(() => process.exit(0));
});
