/**
 * @topic #114 — Options Strategy Engine — Hybrid Quote Provider
 *
 * Nightly AV EOD selection pass for the hybrid options quote provider.
 *
 * Fetches the prior-session EOD chain for a strategy instance's symbol, selects
 * the contract that best matches the configured delta/DTE rules, and returns a
 * normalized OptionQuote plus DTE metadata for the downstream simulator and
 * instrument-map writer.
 */

import type {
  OptionQuote,
  StrategyInstanceConfig,
} from '@options-strategy-engine/contracts';
import { mapAvContractToOptionQuote } from '../quote-providers/av-eod-option-quote-provider';
import { AvEodOptionQuoteProvider } from '../quote-providers/av-eod-option-quote-provider';
import {
  selectOptionContract,
  type OptionContractSelectionCriteria,
} from '../../common/option-contract-selection';
import type { SelectedOptionContract } from '../../common/option-contract-selection';

export interface EodSelectionPassResult {
  /** Normalized EOD quote for the selected candidate. */
  quote: OptionQuote;
  /** Days from marketDate to the candidate's expiration. */
  dte: number;
  /** Raw selection metadata returned by the scoring helper. */
  selected: SelectedOptionContract;
}

function computeTargetDte(
  dteMin: number | undefined,
  dteMax: number | undefined,
): number | undefined {
  if (dteMin !== undefined && dteMax !== undefined) {
    return Math.round((dteMin + dteMax) / 2);
  }
  return dteMin ?? dteMax;
}

function buildSelectionCriteria(
  config: StrategyInstanceConfig,
): OptionContractSelectionCriteria {
  return {
    type: config.optionType,
    targetDelta: config.targetDelta,
    targetDte: computeTargetDte(config.dteMin, config.dteMax),
    minDte: config.dteMin,
    maxDte: config.dteMax,
    requireMark: true,
    // Wheel-style selection uses an absolute delta target (e.g. 0.30 delta
    // for either a put or a call).
    useAbsoluteDelta: true,
  };
}

/**
 * Run the nightly EOD selection pass for one strategy instance.
 *
 * Returns `null` when no contract satisfies the delta/DTE rules, or when the
 * best candidate falls outside `deltaTolerance` (if configured).
 */
export async function runEodSelectionPass(
  marketDate: string,
  config: StrategyInstanceConfig,
  provider: Pick<AvEodOptionQuoteProvider, 'getEodChain'> = new AvEodOptionQuoteProvider(),
): Promise<EodSelectionPassResult | null> {
  const contracts = await provider.getEodChain(config.symbol, marketDate);
  const criteria = buildSelectionCriteria(config);
  const selected = selectOptionContract(marketDate, contracts, criteria);

  if (!selected) {
    return null;
  }

  // DTE is a hard constraint for the wheel; do not fall back to a contract
  // outside the configured band.
  if (
    config.dteMin !== undefined &&
    selected.dte < config.dteMin
  ) {
    return null;
  }
  if (
    config.dteMax !== undefined &&
    selected.dte > config.dteMax
  ) {
    return null;
  }

  // deltaTolerance applies to the delta component only, not the combined
  // delta + DTE selection score.
  if (
    config.deltaTolerance !== undefined &&
    config.targetDelta !== undefined
  ) {
    const signedDelta = selected.delta ?? 0;
    const effectiveDelta = criteria.useAbsoluteDelta
      ? Math.abs(signedDelta)
      : signedDelta;
    const deltaScore = Math.abs(effectiveDelta - config.targetDelta);
    if (deltaScore > config.deltaTolerance) {
      return null;
    }
  }

  const quote = mapAvContractToOptionQuote(
    selected.contract,
    config.side,
    marketDate,
  );

  return { quote, dte: selected.dte, selected };
}
