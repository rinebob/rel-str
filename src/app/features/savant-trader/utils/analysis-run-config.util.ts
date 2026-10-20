/**
 * Run-config form helpers (Thread #1059, task #1082) — pure validation/
 * parse helpers so the analysis run-config form blocks invalid input
 * before the generateTradeDataset callable fires.
 */
import type {
  AnalysisDatasetDoc,
  AnalysisRunParams,
} from '@paper-trading/analysis';

/** Exit-registry grammar — mirrors the families the callable admits in
 *  functions/src/paper-trading/exits/registry.ts: initial-stop-{pct},
 *  trailing-{pct}, time-{N}d. (limit-stddev parses BE-side but is not a
 *  governing family — the form stays to the three.) */
export const EXIT_RULE_RE =
  /^(?:initial-stop-\d+(?:\.\d+)?|trailing-\d+(?:\.\d+)?|time-\d+d)$/;

export function isValidExitRule(s: string): boolean {
  return EXIT_RULE_RE.test(s.trim());
}

/** ISO `YYYY-MM-DD` shape — the contract's barRange format. */
export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Local Date → `YYYY-MM-DD`. Date-picker values are local-midnight —
 *  toISOString() shifts a day in negative-UTC offsets, so format from
 *  the local components. */
export function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 'amat, NVDA ,,' → ['AMAT', 'NVDA'] — trimmed, uppercased, deduped.
 *  Empty result = every symbol in scope per the contract. */
export function parseSymbolScope(input: string): string[] {
  const seen = new Set<string>();
  for (const tok of input.split(',')) {
    const s = tok.trim().toUpperCase();
    if (s) seen.add(s);
  }
  return [...seen];
}

/** 'amat, v2 ,,' → ['amat', 'v2'] — trimmed, non-empty, deduped,
 *  case-preserving (tags are display text, not symbols). */
export function parseTags(input: string): string[] {
  const seen = new Set<string>();
  for (const tok of input.split(',')) {
    const s = tok.trim();
    if (s) seen.add(s);
  }
  return [...seen];
}

/** Live-origin defaults — IMPL: 'Live snapshot: no params beyond
 *  notes/tags.' The callable still requires a full AnalysisRunParams,
 *  so the form hides run params for live and submits these: every
 *  symbol/signal type in the paper ledger from ledger inception, the
 *  canonical governing exit rule (provenance-only — the live pass does
 *  not apply it), signal-bar-close entries. */
export const LIVE_DEFAULTS: Omit<AnalysisRunParams, 'origin'> = {
  symbolScope: [],
  signalTypes: [],
  exitRule: 'trailing-8',
  barRange: { from: '2023-01-01', to: '' /* filled with today at submit */ },
  entryConvention: 'signal-bar-close',
};

/** Library search (AC1): case-insensitive substring over the dataset id
 *  (the "name"), origin, exit rule, entry convention, symbol scope,
 *  signal types, tags, and notes. */
export function matchesDatasetSearch(
  d: AnalysisDatasetDoc,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [
    d.id,
    d.origin,
    d.exitRule,
    d.entryConvention,
    ...d.symbolScope,
    ...d.signalTypes,
    ...d.tags,
    d.notes ?? '',
  ]
    .join(' ')
    .toLowerCase()
    .includes(q);
}
