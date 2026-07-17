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
