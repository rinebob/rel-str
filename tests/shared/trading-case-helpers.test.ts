import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  BrokerOrderLifecycleState,
  BrokerOrderRole,
  buildReadableBrokerOrderId,
  brokerOrderDocumentPath,
  brokerOrdersCollectionPath,
  deriveBrokerOrderState,
  getProtectionState,
  isTerminalBrokerOrderState,
  remainingQuantity,
} from '../../shared/trading-case-contracts.ts';

describe('trading-case helpers', () => {
  it('builds human-readable broker-order paths', () => {
    const caseId = 'SCHB-BUY-260904-FRI-0851PT';
    const orderId = 'SCHB-PROTECTIVE_STOP-260904-FRI-0851PT';
    assert.equal(
      brokerOrdersCollectionPath(caseId),
      'savant-trader/data/trading-cases/SCHB-BUY-260904-FRI-0851PT/broker-orders',
    );
    assert.equal(
      brokerOrderDocumentPath(caseId, orderId),
      `savant-trader/data/trading-cases/${caseId}/broker-orders/${orderId}`,
    );
  });

  it('maps only evidence-backed broker states', () => {
    assert.equal(deriveBrokerOrderState('queued'), BrokerOrderLifecycleState.QUEUED);
    assert.equal(deriveBrokerOrderState('filled'), BrokerOrderLifecycleState.FILLED);
    assert.equal(deriveBrokerOrderState('cancelled'), BrokerOrderLifecycleState.CANCELLED);
    assert.equal(deriveBrokerOrderState('canceled'), BrokerOrderLifecycleState.CANCELLED);
    assert.equal(deriveBrokerOrderState('rejected'), BrokerOrderLifecycleState.REJECTED);
    assert.equal(deriveBrokerOrderState('failed'), BrokerOrderLifecycleState.FAILED);
    assert.equal(deriveBrokerOrderState('expired'), BrokerOrderLifecycleState.EXPIRED);
    assert.equal(deriveBrokerOrderState('partially_filled'), BrokerOrderLifecycleState.PARTIALLY_FILLED);
    assert.equal(deriveBrokerOrderState('confirmed'), BrokerOrderLifecycleState.SUBMITTED);
    assert.equal(
      deriveBrokerOrderState('confirmed', { verifiedResting: true }),
      BrokerOrderLifecycleState.RESTING,
    );
    assert.equal(deriveBrokerOrderState('new'), BrokerOrderLifecycleState.UNCLASSIFIED);
    assert.equal(deriveBrokerOrderState('unconfirmed'), BrokerOrderLifecycleState.UNCLASSIFIED);
    assert.equal(deriveBrokerOrderState('voided'), BrokerOrderLifecycleState.UNCLASSIFIED);
    assert.equal(deriveBrokerOrderState('unverified_future_state'), BrokerOrderLifecycleState.UNCLASSIFIED);
    assert.equal(deriveBrokerOrderState('  FILLED  '), BrokerOrderLifecycleState.FILLED);
  });

  it('builds readable broker-order IDs with collision suffix and entropy', () => {
    const timestamp = new Date('2026-09-04T15:51:00-07:00');
    assert.equal(
      buildReadableBrokerOrderId('SCHB', BrokerOrderRole.PROTECTIVE_STOP, timestamp),
      'SCHB-PROTECTIVE_STOP-260904-FRI-1551PT',
    );
    assert.equal(
      buildReadableBrokerOrderId('SCHB', BrokerOrderRole.PROTECTIVE_STOP, timestamp, 2),
      'SCHB-PROTECTIVE_STOP-260904-FRI-1551PT-02',
    );
    assert.equal(
      buildReadableBrokerOrderId('SCHB', BrokerOrderRole.PROTECTIVE_STOP, timestamp, 1, 'a1b2'),
      'SCHB-PROTECTIVE_STOP-260904-FRI-1551PT-A1B2',
    );
  });

  it('rejects unsafe symbols in readable broker-order IDs', () => {
    const timestamp = new Date('2026-09-04T15:51:00-07:00');
    assert.throws(() => buildReadableBrokerOrderId('BAD/SYMBOL', BrokerOrderRole.ENTRY, timestamp));
    assert.throws(() => buildReadableBrokerOrderId('bad symbol', BrokerOrderRole.ENTRY, timestamp));
  });

  it('calculates remaining quantity without treating partial fill as complete', () => {
    assert.equal(remainingQuantity('10', '4'), '6');
    assert.equal(remainingQuantity('5.107278', '5'), '0.107278');
    assert.equal(remainingQuantity('10', '10'), '0');
    assert.equal(remainingQuantity('10', '15'), '0');
    assert.equal(remainingQuantity('100.123456', '0.000001'), '100.123455');
  });

  it('throws on invalid remaining quantity inputs', () => {
    assert.throws(() => remainingQuantity('abc', '4'));
    assert.throws(() => remainingQuantity('10', 'xyz'));
    assert.throws(() => remainingQuantity('', '0'));
    assert.throws(() => remainingQuantity('10', ''));
  });

  it('derives aggregate protection state', () => {
    assert.equal(getProtectionState('8', '8'), 'protected');
    assert.equal(getProtectionState('8', '3'), 'drifted');
    assert.equal(getProtectionState('8', '0'), 'unprotected');
    assert.equal(getProtectionState('0', '1'), 'unprotected');
    assert.equal(getProtectionState('-5', '3'), 'unprotected');
  });

  it('throws on invalid protection state inputs', () => {
    assert.throws(() => getProtectionState('abc', '3'));
    assert.throws(() => getProtectionState('8', 'xyz'));
    assert.throws(() => getProtectionState('8', ''));
  });

  it('throws on decimal strings exceeding 6 decimal places', () => {
    assert.throws(() => remainingQuantity('10.1234567', '0'));
    assert.throws(() => remainingQuantity('10', '0.1234567'));
    assert.throws(() => getProtectionState('10.1234567', '5'));
  });

  it('identifies terminal lifecycle states', () => {
    assert.equal(isTerminalBrokerOrderState(BrokerOrderLifecycleState.FILLED), true);
    assert.equal(isTerminalBrokerOrderState(BrokerOrderLifecycleState.CANCELLED), true);
    assert.equal(isTerminalBrokerOrderState(BrokerOrderLifecycleState.EXPIRED), true);
    assert.equal(isTerminalBrokerOrderState(BrokerOrderLifecycleState.REJECTED), true);
    assert.equal(isTerminalBrokerOrderState(BrokerOrderLifecycleState.FAILED), true);
    assert.equal(isTerminalBrokerOrderState(BrokerOrderLifecycleState.PENDING), false);
    assert.equal(isTerminalBrokerOrderState(BrokerOrderLifecycleState.UNCLASSIFIED), false);
    assert.equal(isTerminalBrokerOrderState(BrokerOrderLifecycleState.RESTING), false);
  });
});
