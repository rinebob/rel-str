/**
 *
 * Alpha Vantage EOD quote provider for the options strategy engine.
 *
 * Wraps the `partnerHistoricalOptionsV2` endpoint, maps the raw
 * `HistoricalOptionContract[]` into the normalized `OptionQuote` shape, and
 * exposes a chain fetch helper for the nightly selection pass.
 */

import type {
  HistoricalOptionContract,
  PartnerHistoricalOptionsResponse,
} from '../../types/partner';
import { callPartnerHistoricalOptions } from '../../options-contract-proxy';
import { OptionQuoteSource, OptionType } from '@options/common';
import type { OptionQuote } from '@options-strategy-engine/contracts';
import type { TradeSide } from '@common';
import { parseOccContractId, buildOccContractId } from '@options/common';
import { parseOptionalNumber } from '../../common/option-contract-selection';
import type { OptionQuoteProvider } from './option-quote-provider';

export type FetchEodChainFn = (
  symbol: string,
  asOfDate?: string,
) => Promise<PartnerHistoricalOptionsResponse>;

function resolveMark(contract: HistoricalOptionContract): number {
  const mark = parseOptionalNumber(contract.mark);
  if (Number.isFinite(mark)) {
    return mark as number;
  }

  const bid = parseOptionalNumber(contract.bid);
  const ask = parseOptionalNumber(contract.ask);
  if (Number.isFinite(bid) && Number.isFinite(ask)) {
    return ((bid as number) + (ask as number)) / 2;
  }

  const last = parseOptionalNumber(contract.last);
  if (Number.isFinite(last)) {
    return last as number;
  }

  throw new Error(
    `AV EOD provider: no price available for ${contract.contractID ?? contract.symbol}`,
  );
}

function normalizeOptionType(value: string | OptionType | undefined): OptionType {
  const raw = String(value ?? '').toLowerCase().trim();
  if (raw === 'call' || raw === 'c') {
    return OptionType.CALL;
  }
  if (raw === 'put' || raw === 'p') {
    return OptionType.PUT;
  }
  // Fallback to call so callers can still try; data-quality logging is the
  // caller's responsibility.
  return OptionType.CALL;
}

function buildContractId(contract: HistoricalOptionContract): string {
  const symbol = (contract.symbol ?? '').trim().toUpperCase();
  const expiration = contract.expiration ?? '';
  const type = normalizeOptionType(contract.type);
  const strike = parseOptionalNumber(contract.strike);

  if (!symbol || !expiration || !Number.isFinite(strike)) {
    throw new Error(
      'AV EOD provider: cannot build contract ID from incomplete contract',
    );
  }

  return buildOccContractId(symbol, expiration, type, strike as number);
}

function asEodTimestamp(date: string | null | undefined): string {
  if (!date) {
    return new Date().toISOString();
  }
  // Treat the session date as the start of that calendar day in UTC.
  return `${date}T00:00:00.000Z`;
}

/**
 * Map a raw Alpha Vantage EOD contract observation into the normalized
 * `OptionQuote` shape used by the strategy engine.
 */
export function mapAvContractToOptionQuote(
  contract: HistoricalOptionContract,
  side: TradeSide,
  sourceDate?: string,
): OptionQuote {
  const contractID =
    (contract.contractID ?? '').trim().toUpperCase() ||
    buildContractId(contract);

  const parsed = parseOccContractId(contractID);

  const symbol = (contract.symbol ?? parsed?.symbol ?? '').toUpperCase();
  const expiration = contract.expiration ?? parsed?.expiration ?? '';
  const strike =
    parseOptionalNumber(contract.strike) ?? parsed?.strike ?? NaN;
  const type =
    contract.type !== undefined
      ? normalizeOptionType(contract.type)
      : parsed?.optionType ?? normalizeOptionType(undefined);

  const mark = resolveMark(contract);

  const asOf = asEodTimestamp(sourceDate ?? contract.date);

  return {
    contractID,
    symbol,
    expiration,
    strike,
    type,
    side,
    mark,
    bid: parseOptionalNumber(contract.bid),
    ask: parseOptionalNumber(contract.ask),
    last: parseOptionalNumber(contract.last),
    volume: parseOptionalNumber(contract.volume),
    openInterest: parseOptionalNumber(contract.open_interest),
    impliedVolatility: parseOptionalNumber(contract.implied_volatility),
    delta: parseOptionalNumber(contract.delta),
    gamma: parseOptionalNumber(contract.gamma),
    theta: parseOptionalNumber(contract.theta),
    vega: parseOptionalNumber(contract.vega),
    rho: parseOptionalNumber(contract.rho),
    source: OptionQuoteSource.AV_EOD,
    asOf,
  };
}

export class AvEodOptionQuoteProvider implements OptionQuoteProvider {
  constructor(
    private readonly fetchChain: FetchEodChainFn = (symbol, asOfDate) =>
      callPartnerHistoricalOptions({ symbol, date: asOfDate }),
  ) {}

  async getQuote(
    contractID: string,
    symbol: string,
    side: TradeSide,
    asOfDate?: string,
  ): Promise<OptionQuote> {
    const target = contractID.trim().toUpperCase();
    const response = await this.fetchChain(symbol, asOfDate);
    const contracts = response?.data?.data ?? [];

    const match = contracts.find(
      (c) => (c.contractID ?? '').trim().toUpperCase() === target,
    );

    if (!match) {
      throw new Error(
        `AV EOD provider: contract ${contractID} not found in EOD chain for ${symbol}`,
      );
    }

    return mapAvContractToOptionQuote(match, side, response.date ?? match.date);
  }

  async getEodChain(
    symbol: string,
    asOfDate?: string,
  ): Promise<HistoricalOptionContract[]> {
    const response = await this.fetchChain(symbol, asOfDate);
    return response?.data?.data ?? [];
  }
}
