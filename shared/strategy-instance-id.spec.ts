/**
 *
 * Tests for the strategy instance ID generator.
 */

import {
  PositionSpreadType,
  StrategyFrequency,
} from './options-common';
import { generateInstanceId } from './strategy-instance-id';
import type { StrategyInstancePhase } from './options-strategy-engine-contracts';

const DEFAULT_OPEN_TIME = '12:00';

function makePhase(
  spreadType: PositionSpreadType,
  targetDelta: number,
  dteMax: number,
  dteMin = 7,
): StrategyInstancePhase {
  return { spreadType, targetDelta, dteMin, dteMax };
}

describe('generateInstanceId', () => {
  it('generates ID for cash-secured put, daily', () => {
    const id = generateInstanceId(
      new Date('2025-08-16'),
      'QQQM',
      [makePhase(PositionSpreadType.CASH_SECURED_PUT, 0.2, 28)],
      StrategyFrequency.DAILY,
      DEFAULT_OPEN_TIME,
    );
    expect(id).toBe('250816-QQQM-CSP-020-28-D-1200');
  });

  it('generates ID for covered call, daily', () => {
    const id = generateInstanceId(
      new Date('2025-08-16'),
      'QQQM',
      [makePhase(PositionSpreadType.COVERED_CALL, 0.3, 21)],
      StrategyFrequency.DAILY,
      DEFAULT_OPEN_TIME,
    );
    expect(id).toBe('250816-QQQM-CC-030-21-D-1200');
  });

  it('uses first phase for delta and DTE in multi-phase (wheel) config', () => {
    const id = generateInstanceId(
      new Date('2025-08-16'),
      'QQQM',
      [
        makePhase(PositionSpreadType.CASH_SECURED_PUT, 0.2, 28),
        makePhase(PositionSpreadType.COVERED_CALL, 0.3, 21),
      ],
      StrategyFrequency.DAILY,
      DEFAULT_OPEN_TIME,
    );
    expect(id).toBe('250816-QQQM-CSP-020-28-D-1200');
  });

  it('generates ID for weekly frequency', () => {
    const id = generateInstanceId(
      new Date('2025-08-16'),
      'SPY',
      [makePhase(PositionSpreadType.CASH_SECURED_PUT, 0.18, 7)],
      StrategyFrequency.WEEKLY,
      DEFAULT_OPEN_TIME,
    );
    expect(id).toBe('250816-SPY-CSP-018-07-W-1200');
  });

  it('formats delta as 3 digits with leading zeros', () => {
    const id = generateInstanceId(
      new Date('2025-08-16'),
      'NVDA',
      [makePhase(PositionSpreadType.CASH_SECURED_PUT, 0.05, 14)],
      StrategyFrequency.DAILY,
      DEFAULT_OPEN_TIME,
    );
    expect(id).toBe('250816-NVDA-CSP-005-14-D-1200');
  });

  it('formats DTE as 2 digits with leading zero', () => {
    const id = generateInstanceId(
      new Date('2025-08-16'),
      'SPY',
      [makePhase(PositionSpreadType.CASH_SECURED_PUT, 0.2, 7)],
      StrategyFrequency.DAILY,
      DEFAULT_OPEN_TIME,
    );
    expect(id).toBe('250816-SPY-CSP-020-07-D-1200');
  });

  it('throws on empty phases', () => {
    expect(() =>
      generateInstanceId(
        new Date('2025-08-16'),
        'QQQM',
        [],
        StrategyFrequency.DAILY,
        DEFAULT_OPEN_TIME,
      ),
    ).toThrow('phases must be non-empty');
  });

  it('uppercases the symbol', () => {
    const id = generateInstanceId(
      new Date('2025-08-16'),
      'qqqm',
      [makePhase(PositionSpreadType.CASH_SECURED_PUT, 0.2, 28)],
      StrategyFrequency.DAILY,
      DEFAULT_OPEN_TIME,
    );
    expect(id).toBe('250816-QQQM-CSP-020-28-D-1200');
  });

  it('formats delta = 0 as 000', () => {
    const id = generateInstanceId(
      new Date('2025-08-16'),
      'SPY',
      [makePhase(PositionSpreadType.CASH_SECURED_PUT, 0, 28)],
      StrategyFrequency.DAILY,
      DEFAULT_OPEN_TIME,
    );
    expect(id).toBe('250816-SPY-CSP-000-28-D-1200');
  });

  it('formats delta > 1 without rejection (form validation handles rejection)', () => {
    const id = generateInstanceId(
      new Date('2025-08-16'),
      'SPY',
      [makePhase(PositionSpreadType.CASH_SECURED_PUT, 1.5, 28)],
      StrategyFrequency.DAILY,
      DEFAULT_OPEN_TIME,
    );
    // 1.5 * 100 = 150, formatted as 150
    expect(id).toBe('250816-SPY-CSP-150-28-D-1200');
  });

  it('accepts dteMin = dteMax (single DTE target)', () => {
    const id = generateInstanceId(
      new Date('2025-08-16'),
      'SPY',
      [{ spreadType: PositionSpreadType.CASH_SECURED_PUT, targetDelta: 0.2, dteMin: 14, dteMax: 14 }],
      StrategyFrequency.DAILY,
      DEFAULT_OPEN_TIME,
    );
    expect(id).toBe('250816-SPY-CSP-020-14-D-1200');
  });

  it('includes open time in the ID to distinguish same-day strategies', () => {
    const id0730 = generateInstanceId(
      new Date('2026-08-19'),
      'SCHB',
      [makePhase(PositionSpreadType.CASH_SECURED_PUT, 0.3, 45)],
      StrategyFrequency.DAILY,
      '07:30',
    );
    const id1200 = generateInstanceId(
      new Date('2026-08-19'),
      'SCHB',
      [makePhase(PositionSpreadType.CASH_SECURED_PUT, 0.3, 45)],
      StrategyFrequency.DAILY,
      '12:00',
    );
    expect(id0730).toBe('260819-SCHB-CSP-030-45-D-0730');
    expect(id1200).toBe('260819-SCHB-CSP-030-45-D-1200');
    expect(id0730).not.toBe(id1200);
  });
});
