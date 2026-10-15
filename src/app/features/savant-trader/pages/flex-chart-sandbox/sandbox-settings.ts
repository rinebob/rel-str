/**
 * Sandbox settings — persisted state for the flex-chart sandbox (#934).
 *
 * One versioned JSON blob under a sandbox-scoped localStorage key holds every
 * control on the page: symbol, interval, log scale, data mode, synthetic
 * preset, TB-dots toggle, the enabled indicator set, and per-indicator param
 * overrides (sparse — only keys that differ from the declared defaults).
 *
 * Loading is tolerant by design: unknown indicator ids and param keys are
 * dropped, numbers are clamped to their declared min/max, missing fields fall
 * back to defaults, and a malformed blob or version mismatch is discarded
 * wholesale. All localStorage access is wrapped — private-mode or disabled
 * storage degrades to defaults instead of throwing.
 *
 * Pure functions — no Angular dependencies.
 */
import {
  ChartIntervalKey,
  StIndicator,
  type IndicatorOption,
  type IndicatorParamDef,
} from '../../../shared/components/flex-chart/flex-chart.types';
import { ST_SIGNAL_DOTS_INDICATOR } from '../../../shared/components/flex-chart/indicators/st-signal-dots.indicator';
import {
  ST_ZONE_V1_UPTICK_DOTS_INDICATOR,
  ST_ZONE_V2_UPTICK_DOTS_INDICATOR,
} from '../../../shared/components/flex-chart/indicators/st-trend-rider-dots.indicator';
import { SYNTHETIC_PRESETS, type SyntheticPreset } from './synthetic-data';

export const SANDBOX_SETTINGS_KEY = 'flex-chart-sandbox-settings';
export const SANDBOX_SETTINGS_VERSION = 1;

export type SandboxDataMode = 'real' | 'synthetic';

export interface SandboxSettings {
  version: number;
  symbol: string;
  interval: ChartIntervalKey;
  logScale: boolean;
  dataMode: SandboxDataMode;
  preset: SyntheticPreset;
  triggerBandsDots: boolean;
  /** Option ids — stored as an array (JSON-safe); the component rebuilds a Set. */
  enabledIndicators: string[];
  /** optionId → paramKey → value. Sparse: absent keys mean "declared default". */
  paramOverrides: Record<string, Record<string, number | string | boolean>>;
}

export const DEFAULT_SANDBOX_SYMBOL = 'QQQ';

/** Default enabled set — the core ST suite (same set the picker starts with). */
export const DEFAULT_SANDBOX_INDICATORS: readonly string[] = [
  StIndicator.TREND_BANDS,
  StIndicator.TREND_STRENGTH,
  StIndicator.ZONE,
  StIndicator.ZONE_V2,
  ST_SIGNAL_DOTS_INDICATOR.id,
  ST_ZONE_V1_UPTICK_DOTS_INDICATOR.id,
  ST_ZONE_V2_UPTICK_DOTS_INDICATOR.id,
];

export function defaultSandboxSettings(): SandboxSettings {
  return {
    version: SANDBOX_SETTINGS_VERSION,
    symbol: DEFAULT_SANDBOX_SYMBOL,
    interval: ChartIntervalKey.DAILY,
    logScale: true,
    dataMode: 'real',
    preset: 'wide-ratio',
    triggerBandsDots: false,
    enabledIndicators: [...DEFAULT_SANDBOX_INDICATORS],
    paramOverrides: {},
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const INTERVALS = new Set<string>(Object.values(ChartIntervalKey));
const PRESETS = new Set<string>(SYNTHETIC_PRESETS.map((p) => p.value));

function sanitizeParamValue(val: unknown, def: IndicatorParamDef): number | string | boolean | undefined {
  switch (typeof def.default) {
    case 'number': {
      const n = typeof val === 'number' ? val : NaN;
      if (!Number.isFinite(n)) return undefined;
      if (def.min !== undefined && n < def.min) return def.min;
      if (def.max !== undefined && n > def.max) return def.max;
      return n;
    }
    case 'boolean':
      return typeof val === 'boolean' ? val : undefined;
    case 'string':
      if (typeof val !== 'string') return undefined;
      if (def.options && !def.options.includes(val)) return undefined;
      return val;
  }
}

function sanitizeOverrides(
  raw: unknown,
  optById: Map<string, IndicatorOption>,
): SandboxSettings['paramOverrides'] {
  if (!isRecord(raw)) return {};
  const out: SandboxSettings['paramOverrides'] = {};
  for (const [optionId, overrides] of Object.entries(raw)) {
    const option = optById.get(optionId);
    if (!option || !isRecord(overrides)) continue;
    const defByKey = new Map(option.params.map((p) => [p.key, p]));
    const clean: Record<string, number | string | boolean> = {};
    for (const [key, val] of Object.entries(overrides)) {
      const def = defByKey.get(key);
      const v = def ? sanitizeParamValue(val, def) : undefined;
      if (v !== undefined) clean[key] = v;
    }
    if (Object.keys(clean).length > 0) out[optionId] = clean;
  }
  return out;
}

/**
 * Parse + validate a stored blob against the live option registry. Never
 * throws — anything unusable falls back to the corresponding default.
 */
export function loadSandboxSettings(
  raw: string | null,
  options: readonly IndicatorOption[],
): SandboxSettings {
  const defaults = defaultSandboxSettings();
  if (!raw) return defaults;
  let blob: unknown;
  try {
    blob = JSON.parse(raw);
  } catch {
    return defaults;
  }
  if (!isRecord(blob) || blob['version'] !== SANDBOX_SETTINGS_VERSION) return defaults;

  const optById = new Map(options.map((o) => [o.id, o]));
  const b = blob;
  return {
    version: SANDBOX_SETTINGS_VERSION,
    // Symbols normalize the same way the control commits them (trim + upper),
    // so a hand-edited blob can't smuggle '  msft ' into loadCharts.
    symbol: typeof b['symbol'] === 'string' && b['symbol'].trim() !== ''
      ? b['symbol'].trim().toUpperCase()
      : defaults.symbol,
    interval: INTERVALS.has(b['interval'] as string) ? (b['interval'] as ChartIntervalKey) : defaults.interval,
    logScale: typeof b['logScale'] === 'boolean' ? b['logScale'] : defaults.logScale,
    dataMode: b['dataMode'] === 'real' || b['dataMode'] === 'synthetic' ? b['dataMode'] : defaults.dataMode,
    preset: PRESETS.has(b['preset'] as string) ? (b['preset'] as SyntheticPreset) : defaults.preset,
    triggerBandsDots: typeof b['triggerBandsDots'] === 'boolean' ? b['triggerBandsDots'] : defaults.triggerBandsDots,
    enabledIndicators: Array.isArray(b['enabledIndicators'])
      ? b['enabledIndicators'].filter((id): id is string => typeof id === 'string' && optById.has(id))
      : defaults.enabledIndicators,
    paramOverrides: sanitizeOverrides(b['paramOverrides'], optById),
  };
}

/** Read + validate the stored blob; absent or unreadable storage → defaults. */
export function readSandboxSettings(options: readonly IndicatorOption[]): SandboxSettings {
  try {
    return loadSandboxSettings(localStorage.getItem(SANDBOX_SETTINGS_KEY), options);
  } catch {
    return defaultSandboxSettings();
  }
}

export function saveSandboxSettings(settings: SandboxSettings): void {
  try {
    localStorage.setItem(SANDBOX_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Storage unavailable (private mode, quota) — persistence silently off.
  }
}

export function clearSandboxSettings(): void {
  try {
    localStorage.removeItem(SANDBOX_SETTINGS_KEY);
  } catch {
    // Storage unavailable — nothing to clear.
  }
}
