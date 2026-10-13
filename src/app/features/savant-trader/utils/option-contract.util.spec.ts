/**
 * option-contract.util — OCC paste parsing, chain/select → instrument
 * args, and premium math for the single-leg option order ticket (#961).
 */
import {
  chainsToExpirations,
  DEFAULT_OPTION_MAX_PREMIUM_CASH_PERCENT,
  fatfingerBlock,
  parseOptionPaste,
  premiumNotional,
  selectsToInstrumentArgs,
} from './option-contract.util';
import { OptionChain } from '../../../core/robinhood-mcp/types/robinhood-mcp.types';

function chain(expirationDates: string[], overrides: Partial<OptionChain> = {}): OptionChain {
  return { chainId: 'chain-1', symbol: 'AAPL', expirationDates, ...overrides };
}

describe('chainsToExpirations', () => {
  it('unions and sorts expiration dates across chains', () => {
    const out = chainsToExpirations([
      chain(['2026-11-20', '2026-10-16']),
      chain(['2026-10-16', '2027-01-15'], { chainId: 'chain-2', symbol: 'AAPL2' }),
    ]);
    expect(out).toEqual(['2026-10-16', '2026-11-20', '2027-01-15']);
  });

  it('returns [] for no chains', () => {
    expect(chainsToExpirations([])).toEqual([]);
  });
});

describe('selectsToInstrumentArgs', () => {
  it('builds getOptionInstruments filters from the select triplet', () => {
    expect(selectsToInstrumentArgs('AAPL', '2026-10-16', 150, 'call')).toEqual({
      chainSymbol: 'AAPL',
      expirationDates: ['2026-10-16'],
      strikePrice: 150,
      type: 'call',
    });
  });

  it('normalizes the chain symbol to uppercase', () => {
    expect(selectsToInstrumentArgs('aapl', '2026-10-16', 150, 'put').chainSymbol).toBe('AAPL');
  });
});

describe('parseOptionPaste', () => {
  it('parses a compact OCC contract id', () => {
    expect(parseOptionPaste('AAPL251016C00150000')).toEqual({
      symbol: 'AAPL',
      expiration: '2025-10-16',
      strike: 150,
      type: 'call',
    });
  });

  it('parses the padded OCC layout and pasted whitespace', () => {
    expect(parseOptionPaste('  AAPL  251016P00150000\n')).toEqual({
      symbol: 'AAPL',
      expiration: '2025-10-16',
      strike: 150,
      type: 'put',
    });
  });

  it('tolerates lowercase input', () => {
    expect(parseOptionPaste('qqq240719c00450000')).toEqual({
      symbol: 'QQQ',
      expiration: '2024-07-19',
      strike: 450,
      type: 'call',
    });
  });

  it('returns null on garbage', () => {
    expect(parseOptionPaste('not an option id')).toBeNull();
    expect(parseOptionPaste('')).toBeNull();
    expect(parseOptionPaste('AAPL251016X00150000')).toBeNull();
  });
});

describe('premiumNotional', () => {
  it('is qty × price × 100 rounded to cents', () => {
    expect(premiumNotional(2, 3.45)).toBe(690);
    expect(premiumNotional(3, 33.33)).toBe(9999); // 9999.0000…002 → cent-rounded
    expect(premiumNotional(0, 3.45)).toBe(0);
  });
});

describe('fatfingerBlock', () => {
  it('blocks when premium exceeds cash × percent', () => {
    // 25% of 10000 = 2500 — a 3000 premium blocks, a 2000 premium doesn't.
    expect(fatfingerBlock(3000, 10000, 25)).toBe(true);
    expect(fatfingerBlock(2000, 10000, 25)).toBe(false);
  });

  it('does not block exactly at the boundary', () => {
    expect(fatfingerBlock(2500, 10000, 25)).toBe(false);
  });

  it('defaults to 25 when the config field is absent', () => {
    expect(DEFAULT_OPTION_MAX_PREMIUM_CASH_PERCENT).toBe(25);
    expect(fatfingerBlock(2501, 10000)).toBe(true);
    expect(fatfingerBlock(2500, 10000)).toBe(false);
  });

  it('fails closed on any non-finite input — a guard must not pass garbage', () => {
    expect(fatfingerBlock(NaN, 10000, 25)).toBe(true);
    expect(fatfingerBlock(Infinity, 10000, 25)).toBe(true);
    // NaN availableCash (failed account parse) or NaN percent (Firestore
    // can persist NaN) must not silently disable the check.
    expect(fatfingerBlock(5000, NaN, 25)).toBe(true);
    expect(fatfingerBlock(5000, 10000, NaN)).toBe(true);
  });
});
