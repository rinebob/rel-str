/**
 * @topic #137 — Strategy Manager (task #1710)
 *
 * Pins the liquidation-space sign convention the live lifecycle passes use:
 * LONG legs +, SHORT legs −, ×multiplier×qty inside. `unrealizedPnl` is the
 * one-formula contract — `signedEntryPremium + netMark` for every posture,
 * no branching. Also pins the position-selection predicate: option-leg
 * trades in (legacy + manage + future signal options), stock trades out.
 */

import { TradeSide } from './common';
import { PaperTradeStatus } from './paper-trading-contracts';
import {
  entryNetMark,
  hasOptionLegs,
  isOpenOptionPosition,
  legValueSign,
  netMarkValue,
  signedEntryPremium,
  unrealizedPnl,
  type NetMarkLegInput,
} from './options-position-math';

// ── Leg fixtures ────────────────────────────────────────────────────────────
// mark = per-contract price; helper multiplies ×100 ×qty.

const leg = (
  side: TradeSide,
  mark: number | undefined,
  extra?: Partial<NetMarkLegInput>,
): NetMarkLegInput => ({ side, mark, ...extra });

// Call credit spread — sell 5, buy 2 → $300 credit at entry.
const CCS_ENTRY = [leg(TradeSide.SHORT, 5), leg(TradeSide.LONG, 2)];
// Put credit spread — same shape as CCS (type doesn't affect the math).
const PCS_ENTRY = [leg(TradeSide.SHORT, 4), leg(TradeSide.LONG, 1)];
// Call debit spread — buy 5, sell 3 → $200 debit at entry.
const CDS_ENTRY = [leg(TradeSide.LONG, 5), leg(TradeSide.SHORT, 3)];
// Put debit spread — same shape as CDS.
const PDS_ENTRY = [leg(TradeSide.LONG, 6), leg(TradeSide.SHORT, 2)];
// Naked strangle — both legs short.
const STRANGLE_ENTRY = [leg(TradeSide.SHORT, 4), leg(TradeSide.SHORT, 3)];
// Iron condor — long put, short put, short call, long call.
const IC_ENTRY = [
  leg(TradeSide.LONG, 1),
  leg(TradeSide.SHORT, 3),
  leg(TradeSide.SHORT, 3),
  leg(TradeSide.LONG, 1),
];

const tradeLegs = (kind: 'option' | 'share', count = 1) =>
  Array.from({ length: count }, () => ({
    kind,
    side: TradeSide.LONG,
    quantity: 1,
    multiplier: kind === 'option' ? 100 : 1,
    entryMark: 1,
    lastMark: 1,
  }));

describe('legValueSign', () => {
  it('LONG is +1 (asset), SHORT is −1 (liability)', () => {
    expect(legValueSign(TradeSide.LONG)).toBe(1);
    expect(legValueSign(TradeSide.SHORT)).toBe(-1);
  });
});

describe('netMarkValue — signed liquidation value', () => {
  it('credit spread marks negative (cost to close)', () => {
    // short worth 4, long worth 3 → pay $100 to close → netMark −100
    expect(netMarkValue([leg(TradeSide.SHORT, 4), leg(TradeSide.LONG, 3)])).toBe(-100);
  });

  it('debit spread marks positive (liquidation value)', () => {
    // long worth 7, short worth 4 → sell for $300 → netMark +300
    expect(netMarkValue([leg(TradeSide.LONG, 7), leg(TradeSide.SHORT, 4)])).toBe(300);
  });

  it('put credit spread marks negative like the call version', () => {
    // short worth 3, long worth 1 → −200 liability
    expect(netMarkValue([leg(TradeSide.SHORT, 3), leg(TradeSide.LONG, 1)])).toBe(-200);
  });

  it('put debit spread marks positive like the call version', () => {
    // long worth 8, short worth 2 → +600 liquidation
    expect(netMarkValue([leg(TradeSide.LONG, 8), leg(TradeSide.SHORT, 2)])).toBe(600);
  });

  it('naked strangle is negative gross — both legs are liabilities', () => {
    expect(netMarkValue([leg(TradeSide.SHORT, 4), leg(TradeSide.SHORT, 3)])).toBe(-700);
  });

  it('iron condor nets all four legs with ×100×qty', () => {
    // −1 +3 +3 −1 per contract → net liability 4 → −400
    expect(
      netMarkValue([
        leg(TradeSide.LONG, 1),
        leg(TradeSide.SHORT, 3),
        leg(TradeSide.SHORT, 3),
        leg(TradeSide.LONG, 1),
      ]),
    ).toBe(-400);
  });

  it('honors leg multiplier and quantity', () => {
    expect(
      netMarkValue([leg(TradeSide.LONG, 2, { multiplier: 100, quantity: 3 })]),
    ).toBe(600);
    expect(
      netMarkValue([leg(TradeSide.SHORT, 2, { multiplier: 50, quantity: 2 })]),
    ).toBe(-200);
  });

  it('returns undefined when any leg mark is missing — never fabricates', () => {
    expect(netMarkValue([leg(TradeSide.SHORT, 4), leg(TradeSide.LONG, undefined)])).toBeUndefined();
    expect(netMarkValue([])).toBeUndefined();
  });

  it('a zero mark still prices — worthless legs are priceable, not missing', () => {
    // deep-OTM short at $0: the liability is gone but the position prices
    expect(netMarkValue([leg(TradeSide.SHORT, 0), leg(TradeSide.LONG, 1)])).toBe(100);
  });
});

describe('entryNetMark / signedEntryPremium — entry cash flow', () => {
  it('credit spread: entryNetMark is a liability, premium is positive cash', () => {
    expect(entryNetMark(CCS_ENTRY)).toBe(-300);
    expect(signedEntryPremium(CCS_ENTRY)).toBe(300);
  });

  it('put credit spread: premium is positive cash', () => {
    expect(entryNetMark(PCS_ENTRY)).toBe(-300);
    expect(signedEntryPremium(PCS_ENTRY)).toBe(300);
  });

  it('debit spread: signedEntryPremium is negative (cash paid)', () => {
    expect(entryNetMark(CDS_ENTRY)).toBe(200);
    expect(signedEntryPremium(CDS_ENTRY)).toBe(-200);
  });

  it('put debit spread: premium is negative cash', () => {
    expect(entryNetMark(PDS_ENTRY)).toBe(400);
    expect(signedEntryPremium(PDS_ENTRY)).toBe(-400);
  });

  it('naked strangle collects the gross credit', () => {
    expect(signedEntryPremium(STRANGLE_ENTRY)).toBe(700);
  });

  it('iron condor collects the net credit', () => {
    expect(signedEntryPremium(IC_ENTRY)).toBe(400);
  });

  it('returns undefined when an entry mark is missing', () => {
    expect(signedEntryPremium([leg(TradeSide.SHORT, undefined)])).toBeUndefined();
  });
});

describe('unrealizedPnl — one formula, all postures', () => {
  it('credit: collected premium − cost to close', () => {
    // +300 entry, position now a −100 liability → +200
    expect(unrealizedPnl(300, -100)).toBe(200);
  });

  it('debit: liquidation value − debit paid', () => {
    // −200 entry, position now worth +300 → +100
    expect(unrealizedPnl(-200, 300)).toBe(100);
  });

  it('losing credit position goes negative', () => {
    // +300 entry, cost to close now 500 → −200
    expect(unrealizedPnl(300, -500)).toBe(-200);
  });

  it('equals netMark − entryNetMark end-to-end', () => {
    const now = [leg(TradeSide.LONG, 7), leg(TradeSide.SHORT, 4)];
    const pnl = unrealizedPnl(signedEntryPremium(CDS_ENTRY)!, netMarkValue(now)!);
    expect(pnl).toBe(netMarkValue(now)! - entryNetMark(CDS_ENTRY)!);
    expect(pnl).toBe(100);
  });
});

describe('hasOptionLegs — selection predicate', () => {
  it('option trades are in (legacy + manage share the shape)', () => {
    expect(hasOptionLegs({ legs: tradeLegs('option', 2) })).toBe(true);
  });

  it('stock signal trades are out', () => {
    expect(hasOptionLegs({ legs: tradeLegs('share') })).toBe(false);
  });

  it('empty or absent legs are out', () => {
    expect(hasOptionLegs({ legs: [] })).toBe(false);
    expect(hasOptionLegs({})).toBe(false);
    expect(hasOptionLegs({ legs: undefined })).toBe(false);
  });

  it('mixed stock+option groups count — the option legs mark here', () => {
    expect(
      hasOptionLegs({ legs: [...tradeLegs('share'), ...tradeLegs('option')] }),
    ).toBe(true);
  });
});

describe('isOpenOptionPosition — composed selection contract', () => {
  it('OPEN + option legs → lifecycle candidate', () => {
    expect(
      isOpenOptionPosition({ status: PaperTradeStatus.OPEN, legs: tradeLegs('option') }),
    ).toBe(true);
  });

  it('terminal option trades are out', () => {
    expect(
      isOpenOptionPosition({ status: PaperTradeStatus.EXPIRED, legs: tradeLegs('option') }),
    ).toBe(false);
    expect(
      isOpenOptionPosition({ status: PaperTradeStatus.CLOSED, legs: tradeLegs('option') }),
    ).toBe(false);
  });

  it('OPEN stock trades are out', () => {
    expect(
      isOpenOptionPosition({ status: PaperTradeStatus.OPEN, legs: tradeLegs('share') }),
    ).toBe(false);
  });
});
