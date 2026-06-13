import "dotenv/config";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  auth,
  type OAuthClientProvider,
  type AuthResult,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientMetadata,
  OAuthClientInformationMixed,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import { exec } from "child_process";
import { runAgent } from "./agent.js";
import { listStrategies, getStrategy, runRsiOversold, runMacdCrossover } from "./strategies.js";
import { startScheduler } from "./scheduler.js";
import { watchlist } from "./watchlist.js";

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
