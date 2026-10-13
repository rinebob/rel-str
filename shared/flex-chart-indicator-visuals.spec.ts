import {
  isTriggerBandsSignalType,
  ST_TRIGGER_BANDS_DOT_COLORS,
  TRIGGER_BANDS_SIGNAL_TYPES,
} from './flex-chart-indicator-visuals';

describe('TRIGGER_BANDS_SIGNAL_TYPES (#932)', () => {
  it('pins the four wire values the backend emits for Trigger Bands dot markers', () => {
    expect(TRIGGER_BANDS_SIGNAL_TYPES).toEqual({
      LONG_PULLBACK: 'TRIGGER_BANDS_LONG_PULLBACK',
      SHORT_PULLBACK: 'TRIGGER_BANDS_SHORT_PULLBACK',
      LONG_BREAKOUT: 'TRIGGER_BANDS_LONG_BREAKOUT',
      SHORT_BREAKOUT: 'TRIGGER_BANDS_SHORT_BREAKOUT',
    });
  });

  it('provides a dot colour for every signal type and nothing else', () => {
    expect(Object.keys(ST_TRIGGER_BANDS_DOT_COLORS).sort()).toEqual(
      Object.values(TRIGGER_BANDS_SIGNAL_TYPES).sort(),
    );
  });

  it('isTriggerBandsSignalType narrows only the four wire values', () => {
    for (const v of Object.values(TRIGGER_BANDS_SIGNAL_TYPES)) {
      expect(isTriggerBandsSignalType(v)).toBe(true);
    }
    expect(isTriggerBandsSignalType('SOMETHING_ELSE')).toBe(false);
    expect(isTriggerBandsSignalType('')).toBe(false);
  });
});
