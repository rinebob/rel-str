/**
 *
 * Closed-form Black-Scholes option pricing and Greeks.
 *
 * All inputs are annualized decimals (e.g. 0.20 for 20% volatility, 0.05 for 5%
 * risk-free rate). Outputs are per-contract, with theta expressed as the daily
 * change in option mark.
 */

import { OptionType } from '@options/common';

const ONE_OVER_SQRT_2PI = 1 / Math.sqrt(2 * Math.PI);
const SQRT2 = Math.sqrt(2);

function erfAbramowitzStegun(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x >= 0 ? 1 : -1;
  const t = 1 / (1 + p * Math.abs(x));
  const y =
    1 -
    (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) *
      Math.exp(-(x * x));

  return sign * y;
}

/**
 * Standard normal CDF using the Abramowitz & Stegun error function
 * approximation: Phi(x) = 0.5 * (1 + erf(x / sqrt(2))).
 */
export function normalCdf(x: number): number {
  if (x === -Infinity) return 0;
  if (x === Infinity) return 1;
  return 0.5 * (1 + erfAbramowitzStegun(x / SQRT2));
}

function normalPdf(x: number): number {
  return ONE_OVER_SQRT_2PI * Math.exp(-(x * x) / 2);
}

export interface BlackScholesInputs {
  underlying: number;
  strike: number;
  timeToExpirationYears: number;
  riskFreeRate: number;
  volatility: number;
  optionType: OptionType;
}

export interface BlackScholesOutputs {
  mark: number;
  delta: number;
  theta: number;
}

function d1AndD2(
  S: number,
  K: number,
  T: number,
  r: number,
  sigma: number,
): { d1: number; d2: number } {
  if (S <= 0 || K <= 0 || T <= 0 || sigma <= 0) {
    return { d1: NaN, d2: NaN };
  }

  const lnSK = Math.log(S / K);
  const v2 = sigma * sigma;
  const d1 = (lnSK + (r + v2 / 2) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);
  return { d1, d2 };
}

/**
 * Price a single option with closed-form Black-Scholes.
 *
 * Returns mark, delta, and daily theta. If any input is degenerate
 * (non-positive spot, strike, T, or vol) the function returns NaN values
 * rather than throwing, so the caller can decide how to report the gap.
 */
export function blackScholes(inputs: BlackScholesInputs): BlackScholesOutputs {
  const { d1, d2 } = d1AndD2(
    inputs.underlying,
    inputs.strike,
    inputs.timeToExpirationYears,
    inputs.riskFreeRate,
    inputs.volatility,
  );

  if (Number.isNaN(d1) || Number.isNaN(d2)) {
    return { mark: NaN, delta: NaN, theta: NaN };
  }

  const S = inputs.underlying;
  const K = inputs.strike;
  const T = inputs.timeToExpirationYears;
  const r = inputs.riskFreeRate;
  const sigma = inputs.volatility;
  const sqrtT = Math.sqrt(T);
  const discount = Math.exp(-r * T);
  const Nd1 = normalCdf(d1);
  const Nd2 = normalCdf(d2);
  const pdf1 = normalPdf(d1);

  let mark = 0;
  let delta = 0;
  let thetaPerYear = 0;

  if (inputs.optionType === OptionType.CALL) {
    mark = S * Nd1 - K * discount * Nd2;
    delta = Nd1;
    thetaPerYear =
      -(S * pdf1 * sigma) / (2 * sqrtT) -
      r * K * discount * Nd2;
  } else {
    mark = K * discount * (1 - Nd2) - S * (1 - Nd1);
    delta = Nd1 - 1;
    thetaPerYear =
      -(S * pdf1 * sigma) / (2 * sqrtT) +
      r * K * discount * (1 - Nd2);
  }

  // Convert annual theta to a daily value.
  const theta = thetaPerYear / 365;

  return { mark, delta, theta };
}
