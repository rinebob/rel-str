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
