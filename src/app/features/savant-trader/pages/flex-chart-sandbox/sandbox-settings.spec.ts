/// <reference types="jest" />
/**
 * Tests for sandbox-settings — the versioned localStorage blob behind the
 * flex-chart sandbox's persisted controls (Topic #213, task #934).
 *
 * Pure-function seam: no Angular, no TestBed. `readSandboxSettings` /
 * `saveSandboxSettings` / `clearSandboxSettings` exercise jsdom localStorage.
 */
import {
  SANDBOX_SETTINGS_KEY,
  SANDBOX_SETTINGS_VERSION,
  defaultSandboxSettings,
  loadSandboxSettings,
  readSandboxSettings,
  saveSandboxSettings,
  clearSandboxSettings,
  type SandboxSettings,
} from './sandbox-settings';
import { ChartIntervalKey } from '../../../shared/components/flex-chart/flex-chart.types';
import {
  ST_INDICATOR_OPTIONS,
  ST_DEV_INDICATOR_OPTIONS,
} from '../../../shared/components/flex-chart/indicators/indicator-registry';
import { ST_ZIGZAG_INDICATOR } from '../../../shared/components/flex-chart/indicators/st-zigzag.indicator';
import { ST_STD_DEV_LINES_INDICATOR } from '../../../shared/components/flex-chart/indicators/st-std-dev-lines.indicator';

const OPTIONS = [...ST_INDICATOR_OPTIONS, ...ST_DEV_INDICATOR_OPTIONS];

function blob(overrides: Partial<SandboxSettings> = {}): SandboxSettings {
  return { ...defaultSandboxSettings(), ...overrides };
}

afterEach(() => localStorage.clear());

describe('defaultSandboxSettings', () => {
  it('returns the factory state', () => {
    const d = defaultSandboxSettings();
    expect(d.version).toBe(SANDBOX_SETTINGS_VERSION);
    expect(d.symbol).toBe('QQQ');
    expect(d.interval).toBe(ChartIntervalKey.DAILY);
    expect(d.logScale).toBe(true);
    expect(d.dataMode).toBe('real');
    expect(d.preset).toBe('wide-ratio');
    expect(d.triggerBandsDots).toBe(false);
    expect(d.enabledIndicators.length).toBeGreaterThan(0);
    expect(d.paramOverrides).toEqual({});
  });
});

describe('loadSandboxSettings — bad blobs', () => {
  it.each([null, '', 'not json', '[]', '42', '"str"'])('raw %p -> defaults', (raw) => {
    expect(loadSandboxSettings(raw as string | null, OPTIONS)).toEqual(defaultSandboxSettings());
  });

  it('version mismatch discards the whole blob', () => {
    const raw = JSON.stringify({ ...blob({ symbol: 'MSFT' }), version: 999 });
    expect(loadSandboxSettings(raw, OPTIONS)).toEqual(defaultSandboxSettings());
  });
});

describe('loadSandboxSettings — field validation', () => {
  it('restores a valid blob verbatim', () => {
    const stored = blob({
      symbol: 'MSFT',
      interval: ChartIntervalKey.WEEKLY,
      logScale: false,
      dataMode: 'synthetic',
      preset: 'penny',
      triggerBandsDots: true,
      enabledIndicators: [ST_ZIGZAG_INDICATOR.id],
      paramOverrides: { [ST_ZIGZAG_INDICATOR.id]: { devThreshold: 9 } },
    });
    expect(loadSandboxSettings(JSON.stringify(stored), OPTIONS)).toEqual(stored);
  });

  it('a partial blob restores those fields and defaults the rest', () => {
    const raw = JSON.stringify({ version: SANDBOX_SETTINGS_VERSION, symbol: 'AAPL' });
    const loaded = loadSandboxSettings(raw, OPTIONS);
    expect(loaded.symbol).toBe('AAPL');
    expect(loaded.interval).toBe(defaultSandboxSettings().interval);
    expect(loaded.enabledIndicators).toEqual(defaultSandboxSettings().enabledIndicators);
  });

  it('an explicitly-empty enabledIndicators array stays empty', () => {
    const raw = JSON.stringify(blob({ enabledIndicators: [] }));
    expect(loadSandboxSettings(raw, OPTIONS).enabledIndicators).toEqual([]);
  });

  it('drops unknown indicator ids and non-string entries', () => {
    // Untyped literal — a malformed blob is the input under test, so it
    // deliberately doesn't conform to SandboxSettings.
    const raw = JSON.stringify({
      ...defaultSandboxSettings(),
      enabledIndicators: [ST_ZIGZAG_INDICATOR.id, 'not-a-real-id', 7],
    });
    expect(loadSandboxSettings(raw, OPTIONS).enabledIndicators).toEqual([ST_ZIGZAG_INDICATOR.id]);
  });

  it('a non-array enabledIndicators falls back to the default set', () => {
    const raw = JSON.stringify({ ...defaultSandboxSettings(), enabledIndicators: 'st-zigzag' });
    expect(loadSandboxSettings(raw, OPTIONS).enabledIndicators).toEqual(
      defaultSandboxSettings().enabledIndicators,
    );
  });

  it('a blank symbol falls back; a padded lowercase symbol normalizes', () => {
    const padded = JSON.stringify({ ...defaultSandboxSettings(), symbol: '  msft ' });
    expect(loadSandboxSettings(padded, OPTIONS).symbol).toBe('MSFT');
    const blank = JSON.stringify({ ...defaultSandboxSettings(), symbol: '   ' });
    expect(loadSandboxSettings(blank, OPTIONS).symbol).toBe(defaultSandboxSettings().symbol);
  });

  it.each([
    ['interval', 'yearly'],
    ['dataMode', 'pretend'],
    ['preset', 'imaginary'],
  ])('invalid %s falls back to default', (field, bad) => {
    const raw = JSON.stringify({ ...defaultSandboxSettings(), [field]: bad });
    const loaded: Record<string, unknown> = { ...loadSandboxSettings(raw, OPTIONS) };
    const defaults: Record<string, unknown> = { ...defaultSandboxSettings() };
    expect(loaded[field]).toEqual(defaults[field]);
  });
});

describe('loadSandboxSettings — paramOverrides validation', () => {
  const ZZ = ST_ZIGZAG_INDICATOR.id;

  it('drops overrides for unknown option ids', () => {
    const raw = JSON.stringify(blob({ paramOverrides: { 'ghost-id': { devThreshold: 9 } } }));
    expect(loadSandboxSettings(raw, OPTIONS).paramOverrides).toEqual({});
  });

  it('drops unknown param keys on a known option', () => {
    const raw = JSON.stringify(blob({ paramOverrides: { [ZZ]: { notAParam: 1, devThreshold: 9 } } }));
    expect(loadSandboxSettings(raw, OPTIONS).paramOverrides).toEqual({ [ZZ]: { devThreshold: 9 } });
  });

  it('clamps numeric overrides to the declared min/max', () => {
    const raw = JSON.stringify(blob({ paramOverrides: { [ZZ]: { devThreshold: 999, leftDepth: 0 } } }));
    expect(loadSandboxSettings(raw, OPTIONS).paramOverrides).toEqual({ [ZZ]: { devThreshold: 50, leftDepth: 2 } });
  });

  it('drops wrong-typed values (string for a number param, number for a boolean param)', () => {
    const raw = JSON.stringify({
      ...defaultSandboxSettings(),
      paramOverrides: { [ZZ]: { devThreshold: 'abc', allowZigZagOnOneBar: 1, showTriggerDots: false } },
    });
    expect(loadSandboxSettings(raw, OPTIONS).paramOverrides).toEqual({ [ZZ]: { showTriggerDots: false } });
  });

  it('a non-record paramOverrides blob falls back to no overrides', () => {
    const raw = JSON.stringify({ ...defaultSandboxSettings(), paramOverrides: 5 });
    expect(loadSandboxSettings(raw, OPTIONS).paramOverrides).toEqual({});
  });

  it('enum params keep only declared options — std-dev-lines maType', () => {
    const SD = ST_STD_DEV_LINES_INDICATOR.id;
    const raw = JSON.stringify({
      ...defaultSandboxSettings(),
      paramOverrides: { [SD]: { maType: 'ema', displayMode: 'wma' } },
    });
    expect(loadSandboxSettings(raw, OPTIONS).paramOverrides).toEqual({ [SD]: { maType: 'ema' } });
  });
});

describe('storage round-trip', () => {
  it('save -> read returns the same settings', () => {
    const stored = blob({ symbol: 'TSLA', enabledIndicators: [ST_ZIGZAG_INDICATOR.id] });
    saveSandboxSettings(stored);
    expect(readSandboxSettings(OPTIONS)).toEqual(stored);
  });

  it('clear removes the key; read then falls back to defaults', () => {
    saveSandboxSettings(blob({ symbol: 'TSLA' }));
    clearSandboxSettings();
    expect(localStorage.getItem(SANDBOX_SETTINGS_KEY)).toBeNull();
    expect(readSandboxSettings(OPTIONS)).toEqual(defaultSandboxSettings());
  });

  it('degrades to defaults when localStorage throws', () => {
    const spy = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(readSandboxSettings(OPTIONS)).toEqual(defaultSandboxSettings());
    spy.mockRestore();
    const setSpy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(() => saveSandboxSettings(blob())).not.toThrow();
    setSpy.mockRestore();
  });
});
