/**
 * Option generator settings — persisted drawer state (#1337).
 *
 * One versioned JSON blob per symbol under `rs-optgen:{SYMBOL}` holds the
 * query-builder params, the refine filter state, and the use-range-as-open-
 * date toggle — enough to restore a query after reopening the drawer or
 * reloading the page. The shared open DATE is deliberately not persisted
 * (dates go stale; params are what matter) — the `GeneratorSettings` type
 * has no field for it.
 *
 * Loading is tolerant: wrong-version, malformed, or badly-typed blobs fall
 * back to defaults field-by-field where possible. All localStorage access
 * is wrapped — private mode degrades to defaults instead of throwing.
 *
 * No Angular dependencies — `read`/`save`/`clear` are the only effectful
 * entry points; everything else is pure.
 */
import {
  isInvertedRange,
  type GeneratorQueryState,
  type GeneratorRefineState,
  type GeneratorOptionType,
} from './option-group-generator.utils';

export const GENERATOR_SETTINGS_PREFIX = 'rs-optgen:';
export const GENERATOR_SETTINGS_VERSION = 1;

export interface GeneratorSettings {
  version: number;
  query: GeneratorQueryState;
  refine: GeneratorRefineState;
  useRangeAsOpenDate: boolean;
}

export function defaultGeneratorSettings(): GeneratorSettings {
  return {
    version: GENERATOR_SETTINGS_VERSION,
    query: { type: 'BOTH' },
    refine: {},
    useRangeAsOpenDate: false,
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;
const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
const strList = (v: unknown): string[] | undefined =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined;
const type = (v: unknown): GeneratorOptionType =>
  v === 'C' || v === 'P' ? v : 'BOTH';
const callPut = (v: unknown): 'call' | 'put' | undefined =>
  v === 'call' || v === 'put' ? v : undefined;

/** Copies present-and-valid fields from a raw blob into a typed target —
 *  query and refine share the same axis-field sanitize loop. */
function copyAxisFields<T extends object>(
  raw: Record<string, unknown>,
  out: T,
  strFields: readonly (keyof T & string)[],
  numFields: readonly (keyof T & string)[],
): void {
  const o = out as Record<string, unknown>;
  for (const k of strFields) {
    const v = str(raw[k]);
    if (v !== undefined) o[k] = v;
  }
  for (const k of numFields) {
    const v = num(raw[k]);
    if (v !== undefined) o[k] = v;
  }
}

const QUERY_STR = ['expirationGte', 'expirationLte', 'firstObservedGte', 'firstObservedLte'] as const;
const QUERY_NUM = ['strikeGte', 'strikeLte', 'strikeStep'] as const;
const REFINE_STR = ['expirationGte', 'expirationLte', 'firstObservedGte', 'firstObservedLte'] as const;
const REFINE_NUM = ['strikeGte', 'strikeLte', 'strikeStep'] as const;

function sanitizeQuery(raw: unknown): GeneratorQueryState {
  if (!isRecord(raw)) return { type: 'BOTH' };
  const q: GeneratorQueryState = { type: type(raw['type']) };
  copyAxisFields(raw, q, QUERY_STR, QUERY_NUM);
  const list = strList(raw['expirations']);
  if (list !== undefined) q.expirations = list;
  return q;
}

function sanitizeRefine(raw: unknown): GeneratorRefineState {
  if (!isRecord(raw)) return {};
  const r: GeneratorRefineState = {};
  copyAxisFields(raw, r, REFINE_STR, REFINE_NUM);
  const list = strList(raw['expirations']);
  if (list !== undefined) r.expirations = list;
  const t = callPut(raw['type']);
  if (t !== undefined) r.type = t;
  const range = raw['aliveRange'];
  if (isRecord(range)) {
    const start = str(range['start']);
    const end = str(range['end']);
    if (start !== undefined && end !== undefined && !isInvertedRange(start, end)) {
      r.aliveRange = { start, end };
    }
  }
  return r;
}

/** Parse + validate a stored blob. Never throws — unusable → defaults. */
export function loadGeneratorSettings(raw: string | null): GeneratorSettings {
  const defaults = defaultGeneratorSettings();
  if (!raw) return defaults;
  let blob: unknown;
  try {
    blob = JSON.parse(raw);
  } catch {
    return defaults;
  }
  if (!isRecord(blob) || blob['version'] !== GENERATOR_SETTINGS_VERSION) return defaults;
  return {
    version: GENERATOR_SETTINGS_VERSION,
    query: sanitizeQuery(blob['query']),
    refine: sanitizeRefine(blob['refine']),
    useRangeAsOpenDate: blob['useRangeAsOpenDate'] === true,
  };
}

/** Symbol keys normalize like committed symbols elsewhere — ' qqq ' and
 *  'QQQ' address one blob. */
const keyFor = (symbol: string): string =>
  GENERATOR_SETTINGS_PREFIX + symbol.trim().toUpperCase();

/** Read + validate the symbol's blob; absent or unreadable → defaults. */
export function readGeneratorSettings(symbol: string): GeneratorSettings {
  try {
    return loadGeneratorSettings(localStorage.getItem(keyFor(symbol)));
  } catch {
    return defaultGeneratorSettings();
  }
}

export function saveGeneratorSettings(symbol: string, settings: GeneratorSettings): void {
  try {
    localStorage.setItem(
      keyFor(symbol),
      JSON.stringify({ ...settings, version: GENERATOR_SETTINGS_VERSION }),
    );
  } catch {
    // Storage unavailable (private mode, quota) — persistence silently off.
  }
}

export function clearGeneratorSettings(symbol: string): void {
  try {
    localStorage.removeItem(keyFor(symbol));
  } catch {
    // Storage unavailable — nothing to clear.
  }
}
