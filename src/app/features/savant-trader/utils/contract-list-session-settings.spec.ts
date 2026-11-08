/**
 * Contract-list session settings specs (#1361).
 *
 * `rs-optlist:{SYMBOL}` versioned blob — docId + chunk prefs + selected
 * row keys. Mirrors the rs-optgen posture: tolerant reads (wrong version,
 * malformed, badly-typed → defaults), wrapped localStorage, normalized
 * symbol keys.
 */
import {
  LIST_SESSION_PREFIX,
  LIST_SESSION_VERSION,
  clearListSession,
  defaultListSessionSettings,
  readListSession,
  saveListSession,
} from './contract-list-session-settings';

describe('contract-list-session-settings', () => {
  afterEach(() => {
    clearListSession('QQQ');
    clearListSession('SPY');
  });

  it('round-trips a saved blob per symbol', () => {
    saveListSession('qqq', {
      version: LIST_SESSION_VERSION,
      docId: 'run-1_QQQ',
      chunkSize: 20,
      cursor: 2,
      selectionKeys: ['2026-06-10', '2026-06-11'],
      dowDays: [1, 3],
      cadence: 'monthly',
    });

    expect(readListSession('QQQ')).toEqual({
      version: LIST_SESSION_VERSION,
      docId: 'run-1_QQQ',
      chunkSize: 20,
      cursor: 2,
      selectionKeys: ['2026-06-10', '2026-06-11'],
      dowDays: [1, 3],
      cadence: 'monthly',
    });
    // Symbols are independent blobs.
    expect(readListSession('SPY')).toEqual(defaultListSessionSettings());
  });

  it('falls back to defaults on missing, malformed, or wrong-version blobs', () => {
    expect(readListSession('QQQ')).toEqual(defaultListSessionSettings());

    localStorage.setItem(`${LIST_SESSION_PREFIX}QQQ`, '{not json');
    expect(readListSession('QQQ')).toEqual(defaultListSessionSettings());

    localStorage.setItem(
      `${LIST_SESSION_PREFIX}QQQ`,
      JSON.stringify({ version: 99, docId: 'x' }),
    );
    expect(readListSession('QQQ')).toEqual(defaultListSessionSettings());
  });

  it('sanitizes field types individually', () => {
    localStorage.setItem(
      `${LIST_SESSION_PREFIX}QQQ`,
      JSON.stringify({
        version: LIST_SESSION_VERSION,
        docId: 42,
        chunkSize: 'big',
        cursor: -3,
        selectionKeys: ['2026-06-10', 7, null],
        dowDays: [1, 7, 'x', 3.5, 2, 2],
        cadence: 'yearly',
      }),
    );

    const s = readListSession('QQQ');
    expect(s.docId).toBeNull();
    expect(s.chunkSize).toBe(defaultListSessionSettings().chunkSize);
    expect(s.cursor).toBe(0);
    expect(s.selectionKeys).toEqual(['2026-06-10']);
    // Out-of-range/non-integer weekdays drop; dupes collapse; unknown
    // cadence falls back to weekly.
    expect(s.dowDays).toEqual([1, 2]);
    expect(s.cadence).toBe('weekly');
  });

  it('clear removes the blob', () => {
    saveListSession('QQQ', { ...defaultListSessionSettings(), docId: 'x' });
    clearListSession('QQQ');
    expect(readListSession('QQQ')).toEqual(defaultListSessionSettings());
  });
});
