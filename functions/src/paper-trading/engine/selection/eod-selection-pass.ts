/**
 *
 * Nightly AV EOD selection pass for the hybrid options quote provider.
 *
 * Fetches the prior-session EOD chain for a strategy instance's symbol, selects
 * the contract at the configured concrete leg coordinate (signed delta target +
 * one DTE value — the shared pick-doc semantics of `selectContractAtCoordinate`),
 * and returns a normalized OptionQuote plus DTE metadata for the downstream
 * simulator and instrument-map writer.
 */

import type {
  OptionQuote,
  StrategyInstanceConfig,
} from '@options-strategy-engine/contracts';
import { mapAvContractToOptionQuote } from '../quote-providers/av-eod-option-quote-provider';
import { AvEodOptionQuoteProvider } from '../quote-providers/av-eod-option-quote-provider';
import {
  selectContractAtCoordinate,
  type SelectedContractAtCoordinate,
} from '@options/common';

export interface EodSelectionPassResult {
  /** Normalized EOD quote for the selected candidate. */
  quote: OptionQuote;
  /** Days from marketDate to the candidate's expiration. */
  dte: number;
  /** Selection metadata returned by the shared coordinate selector. */
  selected: SelectedContractAtCoordinate;
}

/**
 * Run the nightly EOD selection pass for one strategy instance.
 *
 * Returns `null` when the config lacks a concrete coordinate (no `dte` or
 * `targetDelta`), when no contract is selectable at the coordinate, or when
 * the best candidate falls outside `deltaTolerance` (if configured).
 */
export async function runEodSelectionPass(
  marketDate: string,
  config: StrategyInstanceConfig,
  provider: Pick<AvEodOptionQuoteProvider, 'getEodChain'> = new AvEodOptionQuoteProvider(),
): Promise<EodSelectionPassResult | null> {
  if (config.targetDelta === undefined || config.dte === undefined) {
    return null;
  }

  const contracts = await provider.getEodChain(config.symbol, marketDate);
  const selected = selectContractAtCoordinate(marketDate, contracts, {
    type: config.optionType,
    targetDelta: config.targetDelta,
    dte: config.dte,
  });

  if (!selected) {
    return null;
  }

  // deltaTolerance applies to the delta component only — the signed distance
  // between the observed delta and the config's signed target.
  if (config.deltaTolerance !== undefined) {
    const deltaScore = Math.abs(selected.delta - config.targetDelta);
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
