import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  BrokerOrderLifecycleState,
  BrokerOrderRole,
  TradingCaseStatus,
  TradingInstrumentType,
  validateEquityOrderTerms,
} from '../../shared/trading-case-contracts.ts';
import type {
  BrokerOrderMirror,
  EquityOrderTerms,
  OrderTicket,
  ReconciliationSnapshot,
  SymbolPosition,
  TradingCase,
  UnmatchedBrokerOrder,
} from '../../shared/trading-case-contracts.ts';

describe('trading-case snapshot and lifecycle contracts', () => {
  it('supports unmatched broker orders without local metadata', () => {
    const unmatched: UnmatchedBrokerOrder = {
      brokerOrderId: 'rh-orphan-1',
      accountNumber: 'acct',
      instrumentType: TradingInstrumentType.EQUITY,
      symbol: 'SCHB',
      side: 'buy',
      type: 'market',
      rawState: 'filled',
      role: BrokerOrderRole.UNMATCHED,
    };
    assert.equal(unmatched.role, BrokerOrderRole.UNMATCHED);
    assert.equal(unmatched.brokerOrderId, 'rh-orphan-1');
  });

  it('retains raw broker response on mirror records', () => {
    const rawResponse = { id: 'rh-uuid-1', state: 'filled', executions: [{ price: '100', quantity: '10' }] };
    const mirror: BrokerOrderMirror = {
      kind: 'broker-order-mirror',
      id: 'SCHB-ENTRY-260904-FRI-0851PT',
      caseId: 'case-1',
      brokerOrderId: 'rh-uuid-1',
      role: BrokerOrderRole.ENTRY,
      accountNumber: 'acct',
      instrumentType: TradingInstrumentType.EQUITY,
      symbol: 'SCHB',
      side: 'buy',
      type: 'market',
      rawState: 'filled',
      derivedState: BrokerOrderLifecycleState.FILLED,
      rawResponse,
      executions: rawResponse.executions,
      updatedAt: '2026-09-04T15:51:00Z',
      lastObservedAt: '2026-09-04T15:52:00Z',
      mirrorVersion: 1,
    };
    assert.deepEqual(mirror.rawResponse, rawResponse);
    assert.equal(mirror.rawState, 'filled');
    assert.equal(mirror.derivedState, BrokerOrderLifecycleState.FILLED);
  });

  it('target-exit stub remains non-executable', () => {
    const caseWithTargetExit: TradingCase = {
      id: 'SCHB-BUY-260904-FRI-0851PT',
      accountNumber: 'acct',
      rootOrderTicket: {
        id: 'SCHB-BUY-260904-FRI-0851PT',
        caseId: 'SCHB-BUY-260904-FRI-0851PT',
        accountNumber: 'acct',
        refId: 'ref-1',
        source: 'signal_pipeline',
        proposedTerms: {
          instrumentType: TradingInstrumentType.EQUITY,
          symbol: 'SCHB',
          side: 'buy',
          orderType: 'market',
          timeInForce: 'gfd',
          marketHours: 'regular_hours',
        },
        createdAt: '2026-09-04T15:51:00Z',
        updatedAt: '2026-09-04T15:51:00Z',
      },
      summary: {
        currentStatus: TradingCaseStatus.ACTIVE,
        activeBrokerOrderIds: ['rh-1'],
        entryState: BrokerOrderLifecycleState.FILLED,
        targetExitState: undefined,
        targetExitBrokerOrderId: undefined,
      },
      createdAt: '2026-09-04T15:51:00Z',
      updatedAt: '2026-09-04T15:51:00Z',
    };
    assert.equal(caseWithTargetExit.summary.targetExitState, undefined);
    assert.equal(caseWithTargetExit.summary.targetExitBrokerOrderId, undefined);
    assert.equal(BrokerOrderRole.FUTURE_TARGET_EXIT, 'future_target_exit');
  });

  it('supports case closure rules', () => {
    const closedCase: TradingCase = {
      id: 'SCHB-BUY-260904-FRI-0851PT',
      accountNumber: 'acct',
      rootOrderTicket: {
        id: 'SCHB-BUY-260904-FRI-0851PT',
        caseId: 'SCHB-BUY-260904-FRI-0851PT',
        accountNumber: 'acct',
        refId: 'ref-1',
        source: 'signal_pipeline',
        proposedTerms: {
          instrumentType: TradingInstrumentType.EQUITY,
          symbol: 'SCHB',
          side: 'buy',
          orderType: 'market',
          timeInForce: 'gfd',
          marketHours: 'regular_hours',
        },
        createdAt: '2026-09-04T15:51:00Z',
        updatedAt: '2026-09-04T16:00:00Z',
      },
      summary: {
        currentStatus: TradingCaseStatus.CLOSED,
        activeBrokerOrderIds: [],
        entryState: BrokerOrderLifecycleState.FILLED,
        filledQuantity: '10',
        remainingQuantity: '0',
        caseProgress: 'closed',
      },
      createdAt: '2026-09-04T15:51:00Z',
      updatedAt: '2026-09-04T16:00:00Z',
    };
    assert.equal(closedCase.summary.currentStatus, TradingCaseStatus.CLOSED);
    assert.equal(closedCase.summary.activeBrokerOrderIds.length, 0);
    assert.equal(closedCase.summary.remainingQuantity, '0');
  });

  it('supports position_management as a trading case source', () => {
    const ticket: OrderTicket = {
      id: 'SCHB-SELL-260904-FRI-1000PT',
      caseId: 'SCHB-SELL-260904-FRI-1000PT',
      accountNumber: 'acct',
      refId: 'ref-pm-1',
      source: 'position_management',
      proposedTerms: {
        instrumentType: TradingInstrumentType.EQUITY,
        symbol: 'SCHB',
        side: 'sell',
        orderType: 'market',
        timeInForce: 'gfd',
        marketHours: 'regular_hours',
      },
      createdAt: '2026-09-04T10:00:00Z',
      updatedAt: '2026-09-04T10:00:00Z',
    };
    assert.equal(ticket.source, 'position_management');
  });

  it('supports instrument-neutral broker order with option details', () => {
    const optionOrder: BrokerOrderMirror = {
      kind: 'broker-order-mirror',
      id: 'SPY-OPTION-260904-FRI-1000PT',
      caseId: 'case-opt-1',
      brokerOrderId: 'rh-opt-1',
      role: BrokerOrderRole.ENTRY,
      accountNumber: 'acct',
      instrumentType: TradingInstrumentType.OPTION,
      side: 'buy',
      type: 'limit',
      rawState: 'confirmed',
      derivedState: BrokerOrderLifecycleState.RESTING,
      updatedAt: '2026-09-04T10:00:00Z',
      lastObservedAt: '2026-09-04T10:01:00Z',
      mirrorVersion: 1,
      instrumentSpecific: {
        kind: 'option',
        underlyingSymbol: 'SPY',
        legs: [{ side: 'buy', contractId: 'SPY241220C00500000', quantity: '1' }],
      },
    };
    assert.equal(optionOrder.instrumentSpecific?.kind, 'option');
  });

  it('validates equity order terms coherency', () => {
    const valid: EquityOrderTerms = {
      instrumentType: TradingInstrumentType.EQUITY,
      symbol: 'SCHB',
      side: 'buy',
      orderType: 'limit',
      quantity: '10',
      limitPrice: '100.50',
      timeInForce: 'gtc',
      marketHours: 'regular_hours',
    };
    assert.equal(validateEquityOrderTerms(valid), null);

    const missingLimit: EquityOrderTerms = { ...valid, limitPrice: undefined };
    assert.ok(validateEquityOrderTerms(missingLimit));

    const missingSize: EquityOrderTerms = {
      instrumentType: TradingInstrumentType.EQUITY,
      symbol: 'SCHB',
      side: 'buy',
      orderType: 'market',
      timeInForce: 'gfd',
      marketHours: 'regular_hours',
    };
    assert.ok(validateEquityOrderTerms(missingSize));

    const bothSize: EquityOrderTerms = { ...valid, dollarAmount: '1000' };
    assert.ok(validateEquityOrderTerms(bothSize));

    const stopLimitMissingStop: EquityOrderTerms = {
      instrumentType: TradingInstrumentType.EQUITY,
      symbol: 'SCHB',
      side: 'buy',
      orderType: 'stop_limit',
      quantity: '10',
      limitPrice: '100.50',
      timeInForce: 'gtc',
      marketHours: 'regular_hours',
    };
    assert.ok(validateEquityOrderTerms(stopLimitMissingStop));

    // Negative coherency: incoherent extra fields
    const marketWithLimit: EquityOrderTerms = {
      instrumentType: TradingInstrumentType.EQUITY,
      symbol: 'SCHB',
      side: 'buy',
      orderType: 'market',
      quantity: '10',
      limitPrice: '100.50',
      timeInForce: 'gfd',
      marketHours: 'regular_hours',
    };
    assert.ok(validateEquityOrderTerms(marketWithLimit));

    const marketWithStop: EquityOrderTerms = {
      instrumentType: TradingInstrumentType.EQUITY,
      symbol: 'SCHB',
      side: 'buy',
      orderType: 'market',
      quantity: '10',
      stopPrice: '99.00',
      timeInForce: 'gfd',
      marketHours: 'regular_hours',
    };
    assert.ok(validateEquityOrderTerms(marketWithStop));

    const limitWithStop: EquityOrderTerms = { ...valid, stopPrice: '99.00' };
    assert.ok(validateEquityOrderTerms(limitWithStop));

    const stopMarketWithLimit: EquityOrderTerms = {
      instrumentType: TradingInstrumentType.EQUITY,
      symbol: 'SCHB',
      side: 'buy',
      orderType: 'stop_market',
      quantity: '10',
      stopPrice: '99.00',
      limitPrice: '100.50',
      timeInForce: 'gtc',
      marketHours: 'regular_hours',
    };
    assert.ok(validateEquityOrderTerms(stopMarketWithLimit));
  });

  it('populates full ReconciliationSnapshot with positions and unmatched orders', () => {
    const position: SymbolPosition = {
      accountNumber: 'acct',
      symbol: 'SCHB',
      instrumentType: TradingInstrumentType.EQUITY,
      quantity: '10',
      observedAt: '2026-09-04T15:52:00Z',
      caseIds: ['case-1'],
      protectionState: 'protected',
    };
    const unmatched: UnmatchedBrokerOrder = {
      brokerOrderId: 'rh-orphan-1',
      accountNumber: 'acct',
      instrumentType: TradingInstrumentType.EQUITY,
      symbol: 'SCHB',
      side: 'buy',
      type: 'market',
      rawState: 'filled',
      role: BrokerOrderRole.UNMATCHED,
    };
    const snapshot: ReconciliationSnapshot = {
      orderRows: [],
      positionRows: [position],
      unmatchedBrokerOrders: [unmatched],
      ambiguousLocalTickets: [],
      syncMetadata: {
        tickets: 'available',
        brokerOrders: 'stale',
        positions: 'available',
        observedAt: '2026-09-04T16:00:00Z',
      },
    };
    assert.equal(snapshot.positionRows[0]?.quantity, '10');
    assert.equal(snapshot.positionRows[0]?.caseIds[0], 'case-1');
    assert.equal(snapshot.positionRows[0]?.protectionState, 'protected');
    assert.equal(snapshot.unmatchedBrokerOrders[0]?.brokerOrderId, 'rh-orphan-1');
    assert.equal(snapshot.unmatchedBrokerOrders[0]?.role, BrokerOrderRole.UNMATCHED);
    assert.equal(snapshot.syncMetadata.brokerOrders, 'stale');
  });
});
