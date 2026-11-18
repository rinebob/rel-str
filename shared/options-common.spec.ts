/**
 * @task #1497 — selectContractAtCoordinate: SA pick-doc parity spec.
 *
 * Every pin below mirrors a line of SA's `options-delta-picker.service.ts`
 * `pickCellsForDate` (av-proxy-api, confirmed by spike #1496 + IMPL-BE
 * module 0). The parity harness
 * (`scripts/verify/options-backtest-selection-replay-1497-selection-parity.ts`)
 * is the falsifiable convergence proof over live data; these specs pin the
 * algorithm's mechanics on synthetic chains.
 */

import type { HistoricalOptionContract } from './options-contract-contracts';
import { OptionType, selectContractAtCoordinate } from './options-common';

const DATE = '2026-01-15'; // Thursday — arbitrary market date

function row(partial: Partial<HistoricalOptionContract>): HistoricalOptionContract {
  return {
    contractID: 'SPY260213P00500000',
    expiration: '2026-02-13',
    strike: '500',
    type: OptionType.PUT,
    delta: '-0.20',
    ...partial,
  };
}

describe('selectContractAtCoordinate (#1497 — SA pick-doc parity)', () => {
  const PUT_20_30 = { type: OptionType.PUT, targetDelta: -0.2, dte: 30 };

  describe('eligibility — identity fields only, no mark/liquidity filter', () => {
    it('returns null on an empty chain', () => {
      expect(selectContractAtCoordinate(DATE, [], PUT_20_30)).toBeNull();
    });

    it('rejects rows missing contractID, expiration, strike, or delta', () => {
      const chain = [
        row({ contractID: '' }),
        row({ contractID: undefined }),
        row({ expiration: undefined }),
        row({ expiration: 'not-a-date' }),
        row({ strike: undefined }),
        row({ strike: '' }),
        row({ strike: 'abc' }),
        row({ delta: undefined }),
        row({ delta: '' }), // Number('') === 0 would fabricate a 0-delta row
        row({ delta: 'x' }),
      ];
      expect(selectContractAtCoordinate(DATE, chain, PUT_20_30)).toBeNull();
    });

    it('rejects rows of the other option type', () => {
      const chain = [row({ type: OptionType.CALL, delta: '0.20', contractID: 'SPY260213C00500000' })];
      expect(selectContractAtCoordinate(DATE, chain, PUT_20_30)).toBeNull();
    });

    it('requires literal type values — non-canonical forms are not normalized (SA parity)', () => {
      // SA's filter is `row.type === 'put' | 'call'`; a 'C'/'P'/mixed-case row
      // is ineligible, not normalized. Adapters must normalize upstream.
      const weird = row({}) as Record<string, unknown>;
      weird['type'] = 'P';
      expect(
        selectContractAtCoordinate(DATE, [weird as HistoricalOptionContract], PUT_20_30),
      ).toBeNull();
      weird['type'] = 'Put';
      expect(
        selectContractAtCoordinate(DATE, [weird as HistoricalOptionContract], PUT_20_30),
      ).toBeNull();
    });

    it('rejects expirations at negative DTE; boundary DTE 0 is eligible', () => {
      const expired = row({ expiration: '2026-01-14', contractID: 'A' });
      expect(selectContractAtCoordinate(DATE, [expired], PUT_20_30)).toBeNull();

      // Impossible-calendar expiration → Date.parse normalizes, but
      // isValidIsoDate's round-trip check rejects → row ineligible (SA parity).
      const fakeDate = row({ expiration: '2026-02-30', contractID: 'FAKE' });
      expect(selectContractAtCoordinate(DATE, [fakeDate], PUT_20_30)).toBeNull();

      const sameDay = row({ expiration: '2026-01-15', contractID: 'B' });
      const sel = selectContractAtCoordinate(DATE, [sameDay], PUT_20_30);
      expect(sel?.contractId).toBe('B');
      expect(sel?.dte).toBe(0);
    });

    it('does not require a mark — unparseable quote fields are omitted, never fabricated', () => {
      const sel = selectContractAtCoordinate(DATE, [row({ mark: 'abc', bid: 'x' })], PUT_20_30);
      expect(sel?.contractId).toBe('SPY260213P00500000');
      expect(sel?.mark).toBeUndefined();
    });
  });

  describe('stage 1 — nearest listed expiration to target DTE', () => {
    const coord = { type: OptionType.PUT, targetDelta: -0.2, dte: 30 };

    it('picks the expiration whose actual DTE is nearest the target', () => {
      // DATE=2026-01-15 → dte28 = 2026-02-12 (28d), dte33 = 2026-02-17 (33d); target 30 → 28.
      const chain = [
        row({ contractID: 'FAR', expiration: '2026-02-17' }),
        row({ contractID: 'NEAR', expiration: '2026-02-12' }),
      ];
      expect(selectContractAtCoordinate(DATE, chain, coord)?.contractId).toBe('NEAR');
    });

    it('equidistant expirations pick the longer actual DTE', () => {
      // target 30 → dte28 (dist 2) and dte32 (dist 2) equidistant → 32 wins.
      const chain = [
        row({ contractID: 'SHORT', expiration: '2026-02-12' }),
        row({ contractID: 'LONG', expiration: '2026-02-16' }),
      ];
      expect(selectContractAtCoordinate(DATE, chain, coord)?.contractId).toBe('LONG');
    });

    it('never falls back to other expirations — worst contract inside the chosen expiry still wins', () => {
      const chain = [
        // Far expiry but a perfect-delta contract — must lose; expiry is chosen first.
        row({ contractID: 'PERFECT', expiration: '2026-03-20', delta: '-0.20' }),
        // Chosen expiry (dte 29, nearest to 30) with a far-from-target delta.
        row({ contractID: 'NEAR_EXP', expiration: '2026-02-13', delta: '-0.90' }),
      ];
      const sel = selectContractAtCoordinate(DATE, chain, coord);
      expect(sel?.contractId).toBe('NEAR_EXP');
      expect(sel?.delta).toBe(-0.9);
    });
  });

  describe('stage 2 — argmin |observedDelta − signedTarget| within the chosen expiry', () => {
    it('signed put target matches signed put deltas, not magnitudes', () => {
      const chain = [
        row({ contractID: 'SHALLOW', delta: '-0.05' }),
        row({ contractID: 'DEEP', delta: '-0.90' }),
      ];
      expect(selectContractAtCoordinate(DATE, chain, PUT_20_30)?.contractId).toBe('SHALLOW');
    });

    it('positive call target picks nearest positive delta', () => {
      const coord = { type: OptionType.CALL, targetDelta: 0.75, dte: 30 };
      const chain = [
        row({ type: OptionType.CALL, contractID: 'ATM', delta: '0.50' }),
        row({ type: OptionType.CALL, contractID: 'ITM', delta: '0.80' }),
      ];
      expect(selectContractAtCoordinate(DATE, chain, coord)?.contractId).toBe('ITM');
    });

    it('equidistant deltas pick the larger |delta|', () => {
      // target -0.50: -0.40 and -0.60 are both 0.10 away with IDENTICAL float
      // distance (symmetric around -0.50) → exercises the |delta| tiebreak
      // for real (-0.10/-0.30 vs -0.20 is 0.1 vs 0.0999…98 — a strict win,
      // not a tie). Larger |delta| -0.60 wins.
      const coord = { type: OptionType.PUT, targetDelta: -0.5, dte: 30 };
      const chain = [
        row({ contractID: 'SHALLOW', delta: '-0.40' }),
        row({ contractID: 'DEEP', delta: '-0.60' }),
      ];
      expect(selectContractAtCoordinate(DATE, chain, coord)?.contractId).toBe('DEEP');
    });

    it('residual tie (same distance, same |delta|) picks the lowest contractId', () => {
      // Impossible to differ in |delta| with equal distance unless sign differs —
      // same-type rows have same-sign deltas, so the residual tie is identical
      // deltas with different ids.
      const chain = [
        row({ contractID: 'SPY260213P00500000', delta: '-0.20' }),
        row({ contractID: 'SPY260213P00490000', delta: '-0.20' }),
      ];
      expect(selectContractAtCoordinate(DATE, chain, PUT_20_30)?.contractId).toBe(
        'SPY260213P00490000',
      );
    });
  });

  describe('return shape', () => {
    it('carries contractId, expiration, actual dte, strike, delta, and mark when parseable', () => {
      const sel = selectContractAtCoordinate(
        DATE,
        [row({ mark: '4.25', strike: '500', delta: '-0.20' })],
        PUT_20_30,
      );
      expect(sel).toMatchObject({
        contractId: 'SPY260213P00500000',
        expiration: '2026-02-13',
        dte: 29,
        strike: 500,
        delta: -0.2,
        mark: 4.25,
      });
      expect(sel?.contract).toBeDefined();
    });
  });

  describe('input validation', () => {
    it('throws on a malformed marketDate (mirrors SA pickCellsForDate)', () => {
      expect(() => selectContractAtCoordinate('2026-1-5', [row({})], PUT_20_30)).toThrow(
        /malformed marketDate/,
      );
      expect(() => selectContractAtCoordinate('junk', [row({})], PUT_20_30)).toThrow(
        /malformed marketDate/,
      );
      // Impossible calendar dates are malformed too — SA's isValidIsoDate
      // round-trips, so '2026-02-30'/'2026-13-40' throw rather than silently
      // normalizing to a different date.
      expect(() => selectContractAtCoordinate('2026-02-30', [row({})], PUT_20_30)).toThrow(
        /malformed marketDate/,
      );
      expect(() => selectContractAtCoordinate('2026-13-40', [row({})], PUT_20_30)).toThrow(
        /malformed marketDate/,
      );
    });
  });
});
