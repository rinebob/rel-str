/**
 * Flex Chart Calculations
 *
 * Indicator calculation utilities for the flexible chart component.
 */

import type { PriceBar, IndicatorCalculator, ComputedIndicatorSeries, IndicatorConfig } from './flex-chart.types';

/** Calculate Simple Moving Average */
function calculateSMA(bars: PriceBar[], period: number): { x: Date; y: number }[] {
  if (period <= 0 || bars.length < period) return [];

  const result: { x: Date; y: number }[] = [];

  for (let i = period - 1; i < bars.length; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) {
      sum += bars[i - j].close;
    }
    result.push({
      x: bars[i].x,
      y: sum / period,
    });
  }

  return result;
}

/** Calculate Exponential Moving Average */
function calculateEMA(bars: PriceBar[], period: number): { x: Date; y: number }[] {
  if (period <= 0 || bars.length < period) return [];

  const k = 2 / (period + 1);
  const result: { x: Date; y: number }[] = [];

  // First EMA is SMA
  let ema = 0;
  for (let i = 0; i < period; i++) {
    ema += bars[i].close;
  }
  ema /= period;

  result.push({ x: bars[period - 1].x, y: ema });

  // Calculate subsequent EMAs
  for (let i = period; i < bars.length; i++) {
    ema = bars[i].close * k + ema * (1 - k);
    result.push({ x: bars[i].x, y: ema });
  }

  return result;
}

/** Calculate RSI */
function calculateRSI(bars: PriceBar[], period: number = 14): { x: Date; y: number }[] {
  if (period <= 0 || bars.length < period + 1) return [];

  const result: { x: Date; y: number }[] = [];
  let gains = 0;
  let losses = 0;

  // Calculate initial average gain/loss
  for (let i = 1; i <= period; i++) {
    const change = bars[i].close - bars[i - 1].close;
    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  // First RSI
  let rs = avgGain / avgLoss;
  let rsi = 100 - 100 / (1 + rs);
  result.push({ x: bars[period].x, y: Math.round(rsi * 100) / 100 });

  // Calculate subsequent RSIs using smoothed averages
  for (let i = period + 1; i < bars.length; i++) {
    const change = bars[i].close - bars[i - 1].close;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    rs = avgGain / avgLoss;
    rsi = 100 - 100 / (1 + rs);
    result.push({ x: bars[i].x, y: Math.round(rsi * 100) / 100 });
  }

  return result;
}

/** Calculate MACD */
function calculateMACD(
  bars: PriceBar[],
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9
): { x: Date; y: number; y2?: number }[] {
  if (bars.length < slowPeriod + signalPeriod) return [];

  // Calculate EMAs for all bars first
  const fastEMA = calculateEMA(bars, fastPeriod);
  const slowEMA = calculateEMA(bars, slowPeriod);

  // Align the arrays (both start at different indices)
  const macdLine: { x: Date; y: number }[] = [];
  const slowStartIndex = slowPeriod - 1;

  for (let i = 0; i < fastEMA.length; i++) {
    const fastIndex = fastPeriod - 1 + i;
    if (fastIndex >= slowStartIndex) {
      const slowIndex = fastIndex - slowStartIndex;
      if (slowIndex < slowEMA.length) {
        macdLine.push({
          x: fastEMA[i].x,
          y: fastEMA[i].y - slowEMA[slowIndex].y,
        });
      }
    }
  }

  // Calculate signal line (EMA of MACD line)
  const signalLine = calculateEMAFromValues(macdLine, signalPeriod);

  // Combine MACD and signal
  const result: { x: Date; y: number; y2?: number }[] = [];
  const signalStartIndex = signalPeriod - 1;

  for (let i = signalStartIndex; i < macdLine.length; i++) {
    const signalIndex = i - signalStartIndex;
    if (signalIndex < signalLine.length) {
      result.push({
        x: macdLine[i].x,
        y: Math.round(macdLine[i].y * 100) / 100,
        y2: Math.round(signalLine[signalIndex].y * 100) / 100,
      });
    }
  }

  return result;
}

/** Calculate EMA from value series */
function calculateEMAFromValues(
  values: { x: Date; y: number }[],
  period: number
): { x: Date; y: number }[] {
  if (period <= 0 || values.length < period) return [];

  const k = 2 / (period + 1);
  const result: { x: Date; y: number }[] = [];

  let ema = 0;
  for (let i = 0; i < period; i++) {
    ema += values[i].y;
  }
  ema /= period;

  result.push({ x: values[period - 1].x, y: ema });

  for (let i = period; i < values.length; i++) {
    ema = values[i].y * k + ema * (1 - k);
    result.push({ x: values[i].x, y: ema });
  }

  return result;
}

/** Calculate Bollinger Bands */
function calculateBollinger(
  bars: PriceBar[],
  period: number = 20,
  stdDev: number = 2
): { x: Date; y: number; y2?: number }[] {
  if (period <= 0 || bars.length < period) return [];

  const result: { x: Date; y: number; y2?: number }[] = [];

  for (let i = period - 1; i < bars.length; i++) {
    // Calculate SMA
    let sum = 0;
    for (let j = 0; j < period; j++) {
      sum += bars[i - j].close;
    }
    const sma = sum / period;

    // Calculate standard deviation
    let variance = 0;
    for (let j = 0; j < period; j++) {
      variance += Math.pow(bars[i - j].close - sma, 2);
    }
    const standardDev = Math.sqrt(variance / period);

    const upperBand = sma + standardDev * stdDev;
    const lowerBand = sma - standardDev * stdDev;

    // Store middle band as y, upper and lower as y2 for band rendering
    result.push({
      x: bars[i].x,
      y: Math.round(sma * 100) / 100,
      y2: Math.round(upperBand * 100) / 100,
      // Lower band could be stored separately if needed
    } as any);
  }

  return result;
}

/** Calculate Average Directional Index (ADX) */
function calculateADX(bars: PriceBar[], period: number = 14): { x: Date; y: number }[] {
  if (period <= 0 || bars.length < period + 1) return [];

  const trValues: number[] = [];
  const plusDMValues: number[] = [];
  const minusDMValues: number[] = [];

  // Calculate TR, +DM, -DM
  for (let i = 1; i < bars.length; i++) {
    const high = bars[i].high;
    const low = bars[i].low;
    const prevHigh = bars[i - 1].high;
    const prevLow = bars[i - 1].low;
    const prevClose = bars[i - 1].close;

    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    const plusDM = high - prevHigh > prevLow - low ? Math.max(high - prevHigh, 0) : 0;
    const minusDM = prevLow - low > high - prevHigh ? Math.max(prevLow - low, 0) : 0;

    trValues.push(tr);
    plusDMValues.push(plusDM);
    minusDMValues.push(minusDM);
  }

  // Calculate smoothed averages
  let atr = 0;
  let plusDI = 0;
  let minusDI = 0;

  for (let i = 0; i < period; i++) {
    atr += trValues[i];
    plusDI += plusDMValues[i];
    minusDI += minusDMValues[i];
  }

  atr /= period;
  plusDI /= period;
  minusDI /= period;

  const result: { x: Date; y: number }[] = [];

  // Calculate DX and ADX
  for (let i = period; i < trValues.length; i++) {
    atr = (atr * (period - 1) + trValues[i]) / period;
    plusDI = (plusDI * (period - 1) + plusDMValues[i]) / period;
    minusDI = (minusDI * (period - 1) + minusDMValues[i]) / period;

    const plusDIValue = (plusDI / atr) * 100;
    const minusDIValue = (minusDI / atr) * 100;
    const dx = (Math.abs(plusDIValue - minusDIValue) / (plusDIValue + minusDIValue)) * 100;

    // Simple smoothing for ADX (simplified)
    let adx = dx;
    if (result.length > 0) {
      adx = (result[result.length - 1].y * (period - 1) + dx) / period;
    }

    result.push({ x: bars[i + 1].x, y: Math.round(adx * 100) / 100 });
  }

  return result;
}

/** Map of indicator calculators */
export const indicatorCalculators: Record<string, IndicatorCalculator> = {
  sma: (bars, params) => calculateSMA(bars, Number(params['period']) || 20),
  ema: (bars, params) => calculateEMA(bars, Number(params['period']) || 20),
  rsi: (bars, params) => calculateRSI(bars, Number(params['period']) || 14),
  macd: (bars, params) =>
    calculateMACD(
      bars,
      Number(params['fastPeriod']) || 12,
      Number(params['slowPeriod']) || 26,
      Number(params['signalPeriod']) || 9
    ),
  bollinger: (bars, params) =>
    calculateBollinger(bars, Number(params['period']) || 20, Number(params['stdDev']) || 2),
  adx: (bars, params) => calculateADX(bars, Number(params['period']) || 14),
  volume: (bars) => bars.map((b) => ({ x: b.x, y: b.volume ?? 0 })),
  custom: (_, params) => (params['data'] as unknown as any[]) || [],
};

/** Compute all indicators for a given configuration */
export function computeIndicators(
  bars: PriceBar[],
  configs: IndicatorConfig[]
): ComputedIndicatorSeries[] {
  return configs.map((config) => {
    // If pre-calculated data is provided, use it
    if (config.data && config.data.length > 0) {
      return { id: config.id, config, data: config.data };
    }

    // Otherwise calculate from bars
    const calculator = indicatorCalculators[config.type];
    if (!calculator) {
      console.warn(`[FlexChart] No calculator for indicator type: ${config.type}`);
      return { id: config.id, config, data: [] };
    }

    const data = calculator(bars, config.params);
    return { id: config.id, config, data };
  });
}

/** Group indicators by pane */
export function groupIndicatorsByPane(
  series: ComputedIndicatorSeries[]
): Record<string, ComputedIndicatorSeries[]> {
  const grouped: Record<string, ComputedIndicatorSeries[]> = {};

  for (const s of series) {
    const pane = s.config.pane;
    if (!grouped[pane]) {
      grouped[pane] = [];
    }
    grouped[pane].push(s);
  }

  return grouped;
}
