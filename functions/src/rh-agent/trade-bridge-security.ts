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
