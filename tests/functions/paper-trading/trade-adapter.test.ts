/**
 * @topic #553 — Paper Trading Infra (task #562)
 *
 * Unit tests for the Position ↔ PaperTrade adapters that let the engine
 * passes keep their existing view while storage lives on `paper-trading`
 * collections.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { OptionType } from '../../../shared/options-common';
import { TradeSide } from '../../../shared/common';
import {
  PaperTradeStatus,
  PaperTradeSource,
  PaperTradingKind,
  type PaperTrade,
} from '../../../shared/paper-trading-contracts';
import {
  expressionForLeg,
  legacyToPaperStatus,
  paperLegToPositionLeg,
  paperToLegacyStatus,
  positionLegToPaper,
  positionToTrade,
  tradeToPosition,
} from '../../../functions/src/paper-trading/engine/trade-adapter';
import {
  LegOutcome,
  PositionStatus,
  type DailyUpdate,
  type Position,
  type PositionLeg,
} from '../../../functions/src/paper-trading/engine/types';

function makePosition(overrides: Partial<Position> = {}): Position {
  return {
    id: '260820-QQQM-CSP-020-30-D-1200',
    instanceId: 'inst-1',
    symbol: 'QQQM',
    status: PositionStatus.OPEN,
    premiumCollected: 210,
    capitalRequired: 9750,
    openDate: '2026-08-20',
    currentValue: 210,
    currentValueAsOf: '2026-08-20T19:30:00Z',
    unrealizedPnl: 0,
    ...overrides,
  };
}

function makeLeg(overrides: Partial<PositionLeg> = {}): PositionLeg {
  return {
    id: 'PUT-97.50-2026-09-26',
    type: OptionType.PUT,
    side: TradeSide.SHORT,
    strike: 97.5,
    expiration: '2026-09-26',
    openDate: '2026-08-20',
    contractID: 'QQQM260926P00097500',
    premium: 2.1,
    ...overrides,
  };
}

describe('status mapping', () => {
  it('maps every legacy status to a paper status and back', () => {
    assert.equal(legacyToPaperStatus(PositionStatus.OPEN), PaperTradeStatus.OPEN);
    assert.equal(legacyToPaperStatus(PositionStatus.COVERED_CALL_OPEN), PaperTradeStatus.OPEN);
    assert.equal(legacyToPaperStatus(PositionStatus.EXPIRED_WORTHLESS), PaperTradeStatus.EXPIRED);
    assert.equal(legacyToPaperStatus(PositionStatus.ASSIGNED_HOLDING_SHARES), PaperTradeStatus.ASSIGNED);
    assert.equal(legacyToPaperStatus(PositionStatus.CLOSED), PaperTradeStatus.CLOSED);

    assert.equal(paperToLegacyStatus(PaperTradeStatus.OPEN), PositionStatus.OPEN);
    assert.equal(paperToLegacyStatus(PaperTradeStatus.EXPIRED), PositionStatus.EXPIRED_WORTHLESS);
    assert.equal(paperToLegacyStatus(PaperTradeStatus.ASSIGNED), PositionStatus.ASSIGNED_HOLDING_SHARES);
    assert.equal(paperToLegacyStatus(PaperTradeStatus.CLOSED), PositionStatus.CLOSED);
  });
});

describe('positionToTrade', () => {
  it('produces a PaperTrade with embedded legs + synthesized entry fill', () => {
    const trade = positionToTrade(makePosition(), [makeLeg()], []);
    assert.equal(trade.kind, PaperTradingKind.TRADE);
    assert.equal(trade.source, PaperTradeSource.STRATEGY);
    assert.equal(trade.status, PaperTradeStatus.OPEN);
    assert.equal(trade.strategyInstanceId, 'inst-1');
    assert.equal(trade.expression, 'CSP');
    assert.equal(trade.fills.length, 1);
    assert.equal(trade.fills[0].role, 'entry');
    assert.equal(trade.fills[0].price, 2.1);
    assert.equal(trade.fills[0].date, '2026-08-20');
    assert.equal(trade.legs[0].kind, 'option');
    assert.equal(trade.legs[0].strike, 97.5);
    assert.equal(trade.legs[0].entryMark, 2.1);
    assert.equal(trade.capitalRequired, 9750);
  });

  it('merges daily-updates into marks and keeps the latest mark', () => {
    const dus: DailyUpdate[] = [
      { date: '2026-08-21', underlyingClose: 99.1 },
      { date: '2026-08-22', underlyingClose: 98.7, markPrice: 1.8 },
    ];
    const pos = makePosition({ currentValueAsOf: '2026-08-22T20:00:00Z', currentValue: 180 });
    const trade = positionToTrade(pos, [makeLeg()], dus);
    assert.equal(trade.marks['2026-08-21'].underlyingClose, 99.1);
    assert.equal(trade.marks['2026-08-22'].underlyingClose, 98.7);
    // latest mark = currentValue / 100 overwrites that date's mark
    assert.equal(trade.marks['2026-08-22'].mark, 1.8);
  });

  it('carries assignment + shares for assigned positions', () => {
    const pos = makePosition({
      status: PositionStatus.ASSIGNED_HOLDING_SHARES,
      assignment: { strikePrice: 97.5, underlyingCloseAtExpiration: 95, assignedAt: '2026-09-26' },
      shares: { quantity: 1, costBasis: 97.5 },
    });
    const trade = positionToTrade(pos, [makeLeg({ outcome: LegOutcome.ASSIGNED, closeDate: '2026-09-26' })], []);
    assert.equal(trade.status, PaperTradeStatus.ASSIGNED);
    assert.equal(trade.assignment?.strikePrice, 97.5);
    assert.equal(trade.shares?.quantity, 1);
    assert.equal(trade.legs[0].outcome, 'ASSIGNED');
  });
});

describe('positionToTrade realized P&L + legacy status', () => {
  it('maps realizedPnl from premium for expired positions', () => {
    const trade = positionToTrade(
      makePosition({ status: PositionStatus.EXPIRED_WORTHLESS, unrealizedPnl: 210 }),
      [makeLeg({ outcome: LegOutcome.EXPIRED_WORTHLESS, closeDate: '2026-09-26' })],
      [],
    );
    assert.equal(trade.realizedPnl, 210);
    assert.equal(trade.status, PaperTradeStatus.EXPIRED);
    assert.equal(trade.legacyStatus, 'EXPIRED_WORTHLESS');
  });

  it('maps realizedPnl from unrealized-at-close for CLOSED positions', () => {
    const trade = positionToTrade(
      makePosition({ status: PositionStatus.CLOSED, unrealizedPnl: 95 }),
      [makeLeg()],
      [],
    );
    assert.equal(trade.realizedPnl, 95);
  });

  it('preserves COVERED_CALL_OPEN through the round-trip via legacyStatus', () => {
    const trade = positionToTrade(
      makePosition({ status: PositionStatus.COVERED_CALL_OPEN }),
      [makeLeg({ type: OptionType.CALL })],
      [],
    );
    assert.equal(trade.status, PaperTradeStatus.OPEN);
    assert.equal(trade.legacyStatus, 'COVERED_CALL_OPEN');
    const back = tradeToPosition(trade);
    assert.equal(back.status, PositionStatus.COVERED_CALL_OPEN);
  });
});

describe('tradeToPosition', () => {
  it('derives premiumCollected and capitalRequired for a SHORT trade', () => {
    const trade = positionToTrade(makePosition(), [makeLeg()], []);
    const back = tradeToPosition(trade);
    assert.equal(back.premiumCollected, 210);
    assert.equal(back.capitalRequired, 9750);
    assert.equal(back.unrealizedPnl, 0);
    assert.equal(back.openDate, '2026-08-20');
    assert.equal(back.status, PositionStatus.OPEN);
  });

  it('derives currentValue from embedded leg lastMark', () => {
    const trade = positionToTrade(makePosition(), [makeLeg()], []);
    const marked: PaperTrade = {
      ...trade,
      legs: trade.legs.map((l) => ({ ...l, lastMark: 1.5 })),
    };
    const back = tradeToPosition(marked);
    assert.equal(back.currentValue, 150);
  });
});

describe('round-trip', () => {
  it('preserves the P&L-relevant fields through position → trade → position', () => {
    const pos = makePosition({ unrealizedPnl: 60 });
    const leg = makeLeg();
    const back = tradeToPosition(positionToTrade(pos, [leg], []));
    assert.equal(back.premiumCollected, pos.premiumCollected);
    assert.equal(back.capitalRequired, pos.capitalRequired);
    assert.equal(back.unrealizedPnl, pos.unrealizedPnl);
    assert.equal(back.openDate, pos.openDate);
    assert.equal(back.instanceId, pos.instanceId);
    assert.equal(back.symbol, pos.symbol);
    assert.equal(back.status, pos.status);
  });

  it('preserves leg fields through positionLegToPaper → paperLegToPositionLeg', () => {
    const leg = makeLeg({ outcome: LegOutcome.EXPIRED_WORTHLESS, closeDate: '2026-09-26' });
    const back = paperLegToPositionLeg(positionLegToPaper(leg));
    assert.equal(back.id, leg.id);
    assert.equal(back.type, leg.type);
    assert.equal(back.strike, leg.strike);
    assert.equal(back.premium, leg.premium);
    assert.equal(back.contractID, leg.contractID);
    assert.equal(back.outcome, LegOutcome.EXPIRED_WORTHLESS);
    assert.equal(back.closeDate, '2026-09-26');
  });
});

describe('expressionForLeg', () => {
  it('maps short put → CSP, long call → CC', () => {
    assert.equal(
      expressionForLeg(positionLegToPaper(makeLeg())),
      'CSP',
    );
    assert.equal(
      expressionForLeg(positionLegToPaper(makeLeg({ type: OptionType.CALL, side: TradeSide.LONG }))),
      'CC',
    );
  });
});
