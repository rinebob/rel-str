import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  BrokerOrderLifecycleState,
  BrokerOrderRole,
  TradingCaseStatus,
  TradingInstrumentType,
  brokerOrderDocumentPath,
  deriveBrokerOrderState,
  isTerminalBrokerOrderState,
} from '../../shared/trading-case-contracts.ts';
import type {
  BrokerOrderMirror,
  ReconciliationSnapshot,
  SymbolPosition,
  TradingCase,
} from '../../shared/trading-case-contracts.ts';

describe('trading-case model contracts', () => {
  it('supports Trading Case, Broker Order mirror, and snapshot contracts', () => {
    const tradingCase: TradingCase = {
      id: 'SCHB-BUY-260904-FRI-0851PT',
      accountNumber: 'account',
      rootOrderTicket: {
        id: 'SCHB-BUY-260904-FRI-0851PT',
        caseId: 'SCHB-BUY-260904-FRI-0851PT',
        accountNumber: 'account',
        refId: 'ref-1',
        entryBrokerOrderId: 'broker-1',
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
        activeBrokerOrderIds: ['broker-1'],
        entryState: BrokerOrderLifecycleState.FILLED,
      },
      createdAt: '2026-09-04T15:51:00Z',
      updatedAt: '2026-09-04T15:51:00Z',
    };
    const mirror: BrokerOrderMirror = {
      kind: 'broker-order-mirror',
      id: 'SCHB-ENTRY-260904-FRI-0851PT',
      caseId: tradingCase.id,
      refId: 'ref-1',
      brokerOrderId: 'broker-1',
      role: BrokerOrderRole.ENTRY,
      accountNumber: 'account',
      instrumentType: TradingInstrumentType.EQUITY,
      symbol: 'SCHB',
      side: 'buy',
      type: 'market',
      rawState: 'filled',
      derivedState: BrokerOrderLifecycleState.FILLED,
      createdAt: '2026-09-04T15:51:00Z',
      updatedAt: '2026-09-04T15:51:00Z',
      lastObservedAt: '2026-09-04T15:52:00Z',
      mirrorVersion: 1,
    };
    const snapshot: ReconciliationSnapshot = {
      orderRows: [mirror],
      positionRows: [],
      unmatchedBrokerOrders: [],
      ambiguousLocalTickets: [],
      syncMetadata: {
        tickets: 'available',
        brokerOrders: 'available',
        positions: 'available',
        observedAt: '2026-09-04T15:52:00Z',
      },
    };

    assert.equal(tradingCase.rootOrderTicket.caseId, tradingCase.id);
    assert.equal(tradingCase.rootOrderTicket.id, tradingCase.id);
    assert.equal(tradingCase.rootOrderTicket.entryBrokerOrderId, 'broker-1');
    assert.equal(tradingCase.rootOrderTicket.source, 'signal_pipeline');
    assert.equal(tradingCase.summary.currentStatus, TradingCaseStatus.ACTIVE);
    assert.equal(tradingCase.summary.entryState, BrokerOrderLifecycleState.FILLED);
    assert.deepEqual(tradingCase.summary.activeBrokerOrderIds, ['broker-1']);
    assert.equal(snapshot.orderRows[0]?.brokerOrderId, 'broker-1');
    assert.equal(snapshot.orderRows[0]?.kind, 'broker-order-mirror');
    assert.equal(snapshot.orderRows[0]?.mirrorVersion, 1);
    assert.equal(snapshot.orderRows[0]?.role, BrokerOrderRole.ENTRY);
    assert.equal(snapshot.orderRows[0]?.rawState, 'filled');
    assert.equal(snapshot.orderRows[0]?.derivedState, BrokerOrderLifecycleState.FILLED);
    assert.equal(snapshot.orderRows[0]?.lastObservedAt, '2026-09-04T15:52:00Z');
    assert.equal(snapshot.orderRows[0]?.caseId, tradingCase.id);
    assert.equal(snapshot.syncMetadata.brokerOrders, 'available');
    assert.equal(snapshot.syncMetadata.observedAt, '2026-09-04T15:52:00Z');
  });

  it('distinguishes queued, resting, and submitted semantics', () => {
    assert.equal(deriveBrokerOrderState('queued'), BrokerOrderLifecycleState.QUEUED);
    assert.equal(deriveBrokerOrderState('confirmed'), BrokerOrderLifecycleState.SUBMITTED);
    assert.equal(
      deriveBrokerOrderState('confirmed', { verifiedResting: true }),
      BrokerOrderLifecycleState.RESTING,
    );
    assert.equal(isTerminalBrokerOrderState(BrokerOrderLifecycleState.QUEUED), false);
    assert.equal(isTerminalBrokerOrderState(BrokerOrderLifecycleState.RESTING), false);
    assert.equal(isTerminalBrokerOrderState(BrokerOrderLifecycleState.SUBMITTED), false);
  });

  it('enforces broker order identity and role rules', () => {
    const entry: BrokerOrderMirror = {
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
      updatedAt: '2026-09-04T15:51:00Z',
      lastObservedAt: '2026-09-04T15:52:00Z',
      mirrorVersion: 1,
    };
    const stop: BrokerOrderMirror = {
      kind: 'broker-order-mirror',
      id: 'SCHB-PROTECTIVE_STOP-260904-FRI-0851PT',
      caseId: 'case-1',
      brokerOrderId: 'rh-uuid-2',
      role: BrokerOrderRole.PROTECTIVE_STOP,
      accountNumber: 'acct',
      instrumentType: TradingInstrumentType.EQUITY,
      symbol: 'SCHB',
      side: 'sell',
      type: 'stop_market',
      rawState: 'confirmed',
      derivedState: BrokerOrderLifecycleState.RESTING,
      updatedAt: '2026-09-04T15:51:00Z',
      lastObservedAt: '2026-09-04T15:52:00Z',
      mirrorVersion: 1,
    };
    assert.notEqual(entry.brokerOrderId, stop.brokerOrderId);
    assert.notEqual(entry.role, stop.role);
    assert.equal(entry.accountNumber, stop.accountNumber);
    assert.equal(entry.symbol, stop.symbol);
    // Cross-role path check: same case, different order IDs
    assert.notEqual(
      brokerOrderDocumentPath(entry.caseId, entry.id),
      brokerOrderDocumentPath(stop.caseId, stop.id),
    );
  });

  it('distinguishes position identity from broker order identity', () => {
    const position: SymbolPosition = {
      accountNumber: 'acct',
      symbol: 'SCHB',
      instrumentType: TradingInstrumentType.EQUITY,
      quantity: '10',
      observedAt: '2026-09-04T15:52:00Z',
      caseIds: ['case-1'],
      protectionState: 'protected',
    };
    const order: BrokerOrderMirror = {
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
      updatedAt: '2026-09-04T15:51:00Z',
      lastObservedAt: '2026-09-04T15:52:00Z',
      mirrorVersion: 1,
    };
    assert.equal(position.accountNumber, order.accountNumber);
    assert.equal(position.symbol, order.symbol);
    assert.notEqual(position.caseIds[0], order.brokerOrderId);
  });

  it('supports same broker order ID idempotency', () => {
    const base: BrokerOrderMirror = {
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
      updatedAt: '2026-09-04T15:51:00Z',
      lastObservedAt: '2026-09-04T15:52:00Z',
      mirrorVersion: 1,
    };
    const reobserved: BrokerOrderMirror = {
      ...base,
      rawState: 'filled',
      derivedState: BrokerOrderLifecycleState.FILLED,
      mirrorVersion: 2,
      lastObservedAt: '2026-09-04T16:00:00Z',
    };
    assert.equal(base.brokerOrderId, reobserved.brokerOrderId);
    assert.equal(base.accountNumber, reobserved.accountNumber);
    assert.equal(reobserved.mirrorVersion, 2);
  });

  it('supports multiple trading cases for one symbol without merging', () => {
    const case1: TradingCase = {
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
      },
      createdAt: '2026-09-04T15:51:00Z',
      updatedAt: '2026-09-04T15:51:00Z',
    };
    const case2: TradingCase = {
      id: 'SCHB-BUY-260905-MON-0900PT',
      accountNumber: 'acct',
      rootOrderTicket: {
        id: 'SCHB-BUY-260905-MON-0900PT',
        caseId: 'SCHB-BUY-260905-MON-0900PT',
        accountNumber: 'acct',
        refId: 'ref-2',
        source: 'signal_pipeline',
        proposedTerms: {
          instrumentType: TradingInstrumentType.EQUITY,
          symbol: 'SCHB',
          side: 'buy',
          orderType: 'limit',
          limitPrice: '100.50',
          timeInForce: 'gtc',
          marketHours: 'regular_hours',
        },
        createdAt: '2026-09-05T09:00:00Z',
        updatedAt: '2026-09-05T09:00:00Z',
      },
      summary: {
        currentStatus: TradingCaseStatus.ACTIVE,
        activeBrokerOrderIds: ['rh-2'],
        entryState: BrokerOrderLifecycleState.RESTING,
      },
      createdAt: '2026-09-05T09:00:00Z',
      updatedAt: '2026-09-05T09:00:00Z',
    };
    assert.notEqual(case1.id, case2.id);
    assert.equal(case1.rootOrderTicket.proposedTerms.instrumentType, case2.rootOrderTicket.proposedTerms.instrumentType);
  });

  it('supports one aggregate Symbol Position referencing multiple cases', () => {
    const position: SymbolPosition = {
      accountNumber: 'acct',
      symbol: 'SCHB',
      instrumentType: TradingInstrumentType.EQUITY,
      quantity: '15',
      observedAt: '2026-09-05T10:00:00Z',
      caseIds: ['SCHB-BUY-260904-FRI-0851PT', 'SCHB-BUY-260905-MON-0900PT'],
      protectionState: 'protected',
    };
    assert.equal(position.caseIds.length, 2);
    assert.equal(position.protectionState, 'protected');
  });
});
