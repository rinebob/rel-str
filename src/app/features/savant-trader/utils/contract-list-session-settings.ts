/**
 * Contract-list session settings — persisted picker state (#1361).
 *
 * One versioned JSON blob per symbol under `rs-optlist:{SYMBOL}` holds
 * the active list's docId, chunk preferences, and selected row keys
 * (entryDates) — enough to restore a session after reload or a symbol
 * swap. Mirrors `option-generator-settings`: tolerant reads (wrong
 * version / malformed / badly-typed → field-by-field defaults), wrapped
 * localStorage, normalized symbol keys. The list doc itself is NOT
 * persisted — restore re-reads it (regenerable, fresher).
 *
 * No Angular dependencies — `read`/`save`/`clear` are the only effectful
 * entry points; everything else is pure.
 */

export const LIST_SESSION_PREFIX = 'rs-optlist:';
export const LIST_SESSION_VERSION = 1;
export const DEFAULT_CHUNK_SIZE = 10;

export interface ListSessionSettings {
  version: number;
  /** Doc id of the symbol's active list — `null` = no session. */
  docId: string | null;
  chunkSize: number;
  /** Chunk index within the session's partition. */
  cursor: number;
  /** Selected row keys (entryDates). */
  selectionKeys: string[];
}

export function defaultListSessionSettings(): ListSessionSettings {
  return {
    version: LIST_SESSION_VERSION,
    docId: null,
    chunkSize: DEFAULT_CHUNK_SIZE,
    cursor: 0,
    selectionKeys: [],
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
const chunkSize = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v >= 1 ? Math.floor(v) : undefined;
const cursor = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : undefined;
const strList = (v: unknown): string[] | undefined =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined;

/** Parse + validate a stored blob. Never throws — unusable → defaults. */
export function loadListSessionSettings(raw: string | null): ListSessionSettings {
  const defaults = defaultListSessionSettings();
  if (!raw) return defaults;
  let blob: unknown;
  try {
    blob = JSON.parse(raw);
  } catch {
    return defaults;
  }
  if (!isRecord(blob) || blob['version'] !== LIST_SESSION_VERSION) return defaults;
  return {
    version: LIST_SESSION_VERSION,
    docId: str(blob['docId']) ?? null,
    chunkSize: chunkSize(blob['chunkSize']) ?? defaults.chunkSize,
    cursor: cursor(blob['cursor']) ?? defaults.cursor,
    selectionKeys: strList(blob['selectionKeys']) ?? defaults.selectionKeys,
  };
}

/** Symbol keys normalize like committed symbols elsewhere — ' qqq ' and
 *  'QQQ' address one blob. */
const keyFor = (symbol: string): string =>
  LIST_SESSION_PREFIX + symbol.trim().toUpperCase();

/** Read + validate the symbol's blob; absent or unreadable → defaults. */
export function readListSession(symbol: string): ListSessionSettings {
  try {
    return loadListSessionSettings(localStorage.getItem(keyFor(symbol)));
  } catch {
    return defaultListSessionSettings();
  }
}

export function saveListSession(symbol: string, settings: ListSessionSettings): void {
  try {
    localStorage.setItem(
      keyFor(symbol),
      JSON.stringify({ ...settings, version: LIST_SESSION_VERSION }),
    );
  } catch {
    // Storage unavailable (private mode, quota) — persistence silently off.
  }
}

export function clearListSession(symbol: string): void {
  try {
    localStorage.removeItem(keyFor(symbol));
  } catch {
    // Storage unavailable — nothing to clear.
  }
}
