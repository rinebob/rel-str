/**
 * @topic #1243 — Option Contract Time-Series Viewer | @task #1337
 *
 * Per-symbol generator persistence — versioned `rs-optgen:{SYMBOL}`
 * localStorage blob (sandbox-settings pattern, IMPL FE-1).
 */
import {
  clearGeneratorSettings,
  defaultGeneratorSettings,
  loadGeneratorSettings,
  readGeneratorSettings,
  saveGeneratorSettings,
  GENERATOR_SETTINGS_PREFIX,
  GENERATOR_SETTINGS_VERSION,
  type GeneratorSettings,
} from './option-generator-settings';

const settings = (over: Partial<GeneratorSettings> = {}): GeneratorSettings => ({
  ...defaultGeneratorSettings(),
  ...over,
});

describe('loadGeneratorSettings', () => {
  it('null/garbage/unknown-version blobs → defaults', () => {
    const d = defaultGeneratorSettings();
    expect(loadGeneratorSettings(null)).toEqual(d);
    expect(loadGeneratorSettings('not json')).toEqual(d);
    expect(loadGeneratorSettings('{"version":99}')).toEqual(d);
    expect(loadGeneratorSettings('[1,2]')).toEqual(d);
  });

  it('a valid blob round-trips query + refine + toggle fields', () => {
    const s = settings({
      query: { strikeGte: 500, strikeLte: 600, strikeStep: 10, type: 'C', expirationGte: '2026-05-01' },
      refine: { type: 'call', firstObservedLte: '2026-03-01', aliveRange: { start: '2026-02-01', end: '2026-05-01' } },
      useRangeAsOpenDate: true,
    });
    expect(loadGeneratorSettings(JSON.stringify(s))).toEqual(s);
  });

  it('untrusted fields sanitize — bad types fall back to defaults', () => {
    const blob = {
      version: GENERATOR_SETTINGS_VERSION,
      query: { strikeGte: 'five-hundred', type: 'X', strikeStep: 10 },
      refine: { aliveRange: 'a-string' },
      useRangeAsOpenDate: 'yes',
    };
    const s = loadGeneratorSettings(JSON.stringify(blob));
    expect(s.query).toEqual({ strikeStep: 10, type: 'BOTH' });
    expect(s.refine).toEqual({});
    expect(s.useRangeAsOpenDate).toBe(false);
  });

  it('an openDate key in the blob is dropped — open dates are never persisted', () => {
    const blob = { version: GENERATOR_SETTINGS_VERSION, openDate: '2026-03-01' };
    const s = loadGeneratorSettings(JSON.stringify(blob));
    expect('openDate' in s).toBe(false);
  });

  it('an inverted aliveRange is dropped like any other bad field', () => {
    const blob = {
      version: GENERATOR_SETTINGS_VERSION,
      refine: { aliveRange: { start: '2026-05-01', end: '2026-02-01' }, strikeGte: 500 },
    };
    const s = loadGeneratorSettings(JSON.stringify(blob));
    expect(s.refine).toEqual({ strikeGte: 500 });
  });
});

describe('storage wrapper (jsdom localStorage)', () => {
  const KEY = `${GENERATOR_SETTINGS_PREFIX}QQQ`;
  afterEach(() => {
    clearGeneratorSettings('QQQ');
    clearGeneratorSettings('SPY');
  });

  it('save + read round-trips under the symbol-scoped key', () => {
    const s = settings({ query: { strikeStep: 25, type: 'P' } });
    saveGeneratorSettings('QQQ', s);
    expect(localStorage.getItem(KEY)).not.toBeNull();
    expect(readGeneratorSettings('QQQ')).toEqual(s);
  });

  it('symbols keep separate blobs', () => {
    saveGeneratorSettings('QQQ', settings({ query: { strikeStep: 10, type: 'BOTH' } }));
    saveGeneratorSettings('SPY', settings({ query: { strikeStep: 5, type: 'BOTH' } }));
    expect(readGeneratorSettings('QQQ').query.strikeStep).toBe(10);
    expect(readGeneratorSettings('SPY').query.strikeStep).toBe(5);
  });

  it('the storage key normalizes the symbol — qqq and QQQ share one blob', () => {
    saveGeneratorSettings(' qqq ', settings({ query: { strikeStep: 15, type: 'BOTH' } }));
    expect(localStorage.getItem(`${GENERATOR_SETTINGS_PREFIX}QQQ`)).not.toBeNull();
    expect(readGeneratorSettings('QQQ').query.strikeStep).toBe(15);
  });

  it('save pins the blob version — a caller-crafted wrong version cannot persist', () => {
    saveGeneratorSettings('QQQ', { ...settings(), version: 99 });
    expect(readGeneratorSettings('QQQ').version).toBe(GENERATOR_SETTINGS_VERSION);
  });

  it('a throwing storage degrades to defaults instead of propagating', () => {
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    expect(readGeneratorSettings('QQQ')).toEqual(defaultGeneratorSettings());
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    expect(() => saveGeneratorSettings('QQQ', settings())).not.toThrow();
    jest.restoreAllMocks();
  });

  it('read with no blob → defaults; clear removes only that symbol', () => {
    saveGeneratorSettings('QQQ', settings());
    clearGeneratorSettings('QQQ');
    expect(readGeneratorSettings('QQQ')).toEqual(defaultGeneratorSettings());
    expect(localStorage.getItem(KEY)).toBeNull();
  });
});
