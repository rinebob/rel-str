/**
 *
 * Backend quote-provider abstraction consumed by the options strategy engine.
 */

import type { OptionQuote } from '@options-strategy-engine/contracts';
import type { TradeSide } from '@common';

export interface OptionQuoteProvider {
  /**
   * Return a normalized quote for the given OCC contract ID.
   *
   * @param asOfDate Optional market-date override (YYYY-MM-DD) used by EOD providers
   *                 to fetch a specific historical session.
   */
  getQuote(
    contractID: string,
    symbol: string,
    side: TradeSide,
    asOfDate?: string,
  ): Promise<OptionQuote>;
}
