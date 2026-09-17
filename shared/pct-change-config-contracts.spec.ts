/**
 * Unit tests for shared pct-change config contracts.
 *
 * Verifies the PctChangeConfigDoc interface and related type aliases
 * compile with all required and optional fields.
 */
import { OptionType } from './options-common';
import type {
  PctChangeConfigDoc,
  TargetType,
  PctMode,
  UserDatesMode,
  PctDirection,
} from './pct-change-config-contracts';

describe('pct-change-config-contracts', () => {
  describe('TargetType', () => {
    it('accepts all three values', () => {
      const a: TargetType = 'pct-change';
      const b: TargetType = 'swing-extremes';
      const c: TargetType = 'user-dates';
      expect(a).toBe('pct-change');
      expect(b).toBe('swing-extremes');
      expect(c).toBe('user-dates');
    });
  });

  describe('PctMode', () => {
    it('accepts both values', () => {
      const a: PctMode = 'list';
      const b: PctMode = 'gradation';
      expect(a).toBe('list');
      expect(b).toBe('gradation');
    });
  });

  describe('UserDatesMode', () => {
    it('accepts both values', () => {
      const a: UserDatesMode = 'manual';
      const b: UserDatesMode = 'interval';
      expect(a).toBe('manual');
      expect(b).toBe('interval');
    });
  });

  describe('PctDirection', () => {
    it('accepts both values', () => {
      const a: PctDirection = 'up';
      const b: PctDirection = 'down';
      expect(a).toBe('up');
      expect(b).toBe('down');
    });
  });

  describe('PctChangeConfigDoc', () => {
    it('compiles with all required fields', () => {
      const doc: PctChangeConfigDoc = {
        symbol: 'QQQ',
        startDate: '2025-04-07',
        type: OptionType.CALL,
        targetType: 'pct-change',
        targetDates: ['2025-04-10', '2025-04-15'],
        filter: { type: OptionType.CALL },
      };
      expect(doc.symbol).toBe('QQQ');
      expect(doc.targetType).toBe('pct-change');
      expect(doc.targetDates.length).toBe(2);
    });

    it('compiles with pct-change list mode fields', () => {
      const doc: PctChangeConfigDoc = {
        symbol: 'QQQ',
        startDate: '2025-04-07',
        type: OptionType.CALL,
        targetType: 'pct-change',
        targetDates: ['2025-04-10'],
        pctMode: 'list',
        pctValues: [-3, 5, 10],
        filter: { type: OptionType.CALL },
      };
      expect(doc.pctMode).toBe('list');
      expect(doc.pctValues).toEqual([-3, 5, 10]);
    });

    it('compiles with pct-change gradation mode fields', () => {
      const doc: PctChangeConfigDoc = {
        symbol: 'QQQ',
        startDate: '2025-04-07',
        type: OptionType.PUT,
        targetType: 'pct-change',
        targetDates: ['2025-04-10', '2025-04-15', '2025-04-20'],
        pctMode: 'gradation',
        pctStep: 5,
        pctCount: 3,
        pctDirection: 'up',
        filter: { type: OptionType.PUT },
      };
      expect(doc.pctMode).toBe('gradation');
      expect(doc.pctStep).toBe(5);
      expect(doc.pctCount).toBe(3);
      expect(doc.pctDirection).toBe('up');
    });

    it('compiles with swing-extremes fields', () => {
      const doc: PctChangeConfigDoc = {
        symbol: 'QQQ',
        startDate: '2025-04-07',
        type: OptionType.CALL,
        targetType: 'swing-extremes',
        targetDates: [],
        zigzagDeviation: 5,
        zigzagDepth: 3,
        zigzagBackstep: 1,
        swingCount: 3,
        filter: { type: OptionType.CALL },
      };
      expect(doc.targetType).toBe('swing-extremes');
      expect(doc.zigzagDeviation).toBe(5);
      expect(doc.swingCount).toBe(3);
    });

    it('compiles with user-dates manual fields', () => {
      const doc: PctChangeConfigDoc = {
        symbol: 'QQQ',
        startDate: '2025-04-07',
        type: OptionType.CALL,
        targetType: 'user-dates',
        targetDates: ['2025-04-10', '2025-05-01'],
        userDatesMode: 'manual',
        filter: { type: OptionType.CALL },
      };
      expect(doc.userDatesMode).toBe('manual');
    });

    it('compiles with user-dates interval fields', () => {
      const doc: PctChangeConfigDoc = {
        symbol: 'QQQ',
        startDate: '2025-04-07',
        type: OptionType.CALL,
        targetType: 'user-dates',
        targetDates: ['2025-04-07', '2025-04-12', '2025-04-17'],
        userDatesMode: 'interval',
        intervalCount: 3,
        intervalDays: 5,
        filter: { type: OptionType.CALL },
      };
      expect(doc.userDatesMode).toBe('interval');
      expect(doc.intervalCount).toBe(3);
      expect(doc.intervalDays).toBe(5);
    });

    it('compiles with optional fields omitted', () => {
      const doc: PctChangeConfigDoc = {
        symbol: 'SPY',
        startDate: '2025-01-01',
        type: OptionType.PUT,
        targetType: 'user-dates',
        targetDates: [],
        filter: { type: OptionType.PUT },
      };
      expect(doc.pctMode).toBeUndefined();
      expect(doc.zigzagDeviation).toBeUndefined();
      expect(doc.userDatesMode).toBeUndefined();
    });
  });
});
