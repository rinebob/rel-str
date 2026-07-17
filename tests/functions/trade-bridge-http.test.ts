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
