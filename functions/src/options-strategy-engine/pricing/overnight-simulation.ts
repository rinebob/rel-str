/**
 * @topic #114 — Options Strategy Engine — Hybrid Quote Provider
 *
 * Overnight delta simulation for the selected EOD candidate.
 *
 * Builds a symmetric grid of underlying price moves and runs closed-form
 * Black-Scholes at each point. The result is stored on the strategy instance's
 * `daily-analysis/{date}` document.
 */

import type {
  OptionQuote,
  OvernightDeltaGridPoint,
  OvernightDeltaSimulation,
  StrategyInstanceConfig,
} from '@options-strategy-engine/contracts';
import { blackScholes } from './black-scholes';

const DEFAULT_RISK_FREE_RATE = 0.05;

function roundMovePct(pct: number, stepPct: number): number {
  // Avoid floating point noise by rounding to the nearest step.
  return Math.round(pct / stepPct) * stepPct;
}

function generateGridMovePcts(rangePct: number, stepPct: number): number[] {
  const points: number[] = [];
  const steps = Math.round(rangePct / stepPct);
  for (let i = -steps; i <= steps; i++) {
    points.push(roundMovePct(i * stepPct, stepPct));
  }
  return points;
}

function annualizeVolatility(iv: number | undefined): number {
  if (iv === undefined || !Number.isFinite(iv)) {
    throw new Error(
      'Overnight simulation requires impliedVolatility on the candidate OptionQuote',
    );
  }
  return iv;
}

/**
 * Compute the `OvernightDeltaSimulation` grid for a selected candidate.
 *
 * @param quote The selected EOD quote (must include `impliedVolatility`).
 * @param underlyingClose Prior-session underlying close.
 * @param dte Days to expiration of the selected contract.
 * @param config Strategy instance config (supplies grid radius/step; falls back
 *               to defaults).
 */
export function computeOvernightDeltaSimulation(
  quote: OptionQuote,
  underlyingClose: number,
  dte: number,
  config: StrategyInstanceConfig,
): OvernightDeltaSimulation {
  const rangePct =
    config.overnightGridRangePct ?? 0.025;
  const stepPct =
    config.overnightGridStepPct ?? 0.005;

  const grid: OvernightDeltaGridPoint[] = [];
  const movePcts = generateGridMovePcts(rangePct, stepPct);
  const volatility = annualizeVolatility(quote.impliedVolatility);
  const timeToExpiration = dte / 365;

  for (const movePct of movePcts) {
    const underlyingPrice = underlyingClose * (1 + movePct);
    const result = blackScholes({
      underlying: underlyingPrice,
      strike: quote.strike,
      timeToExpirationYears: timeToExpiration,
      riskFreeRate: DEFAULT_RISK_FREE_RATE,
      volatility,
      optionType: quote.type,
    });

    grid.push({
      underlyingMovePct: movePct,
      underlyingPrice,
      delta: Number.isFinite(result.delta) ? result.delta : 0,
      mark: Number.isFinite(result.mark) ? result.mark : 0,
      theta: Number.isFinite(result.theta) ? result.theta : 0,
    });
  }

  return {
    baseUnderlyingPrice: underlyingClose,
    baseContractID: quote.contractID,
    rangePct,
    stepPct,
    grid,
    computedAt: new Date().toISOString(),
  };
}
