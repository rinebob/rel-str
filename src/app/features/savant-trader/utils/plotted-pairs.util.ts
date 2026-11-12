import { parseOccContractId } from '@options-contract/contracts';
import type { PlottedEntry } from '@options-contract/contracts';

export type RejectedReason = 'invalid-contract' | 'invalid-date' | 'wrong-underlying';

export interface RejectedEntry {
  raw: string;
  reason: RejectedReason;
}

export interface ParsedPlottedInput {
  entries: PlottedEntry[];
  rejected: RejectedEntry[];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Strict YYYY-MM-DD validation — rejects rollovers like 2026-02-30. */
function isValidIsoDate(s: string): boolean {
  if (!ISO_DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/**
 * Parse pasted plotted-pair input: one entry per line, `YYYY-MM-DD,OCCID`
 * (comma, space, or tab separated — a spreadsheet's two columns paste in
 * directly), or a bare OCC ID. Dedupes on contractId: `openDate` keeps the
 * earliest supplied date and `markerDates` unions every supplied date (each
 * pick day draws its own dot on the span marker). When `symbol` is given,
 * contracts on a different underlying are rejected — omit it to parse
 * unconstrained and let the caller pick the underlying from the input
 * (the auto-swap path uses `dominantUnderlying` then re-rejects minority
 * underlyings itself).
 */
export function parsePlottedEntries(text: string, symbol = ''): ParsedPlottedInput {
  const expected = String(symbol || '').trim().toUpperCase();
  const entries = new Map<string, PlottedEntry>();
  const rejected: RejectedEntry[] = [];

  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const raw = rawLine.trim();
    if (!raw) continue;

    const tokens = raw.split(/[\s,;]+/).filter(Boolean);
    const occToken = tokens.find((t) => parseOccContractId(t) !== null);

    if (tokens.length > 2 || !occToken) {
      rejected.push({ raw, reason: 'invalid-contract' });
      continue;
    }

    let openDate: string | null = null;
    if (tokens.length === 2) {
      const other = tokens[0] === occToken ? tokens[1] : tokens[0];
      if (!isValidIsoDate(other)) {
        rejected.push({ raw, reason: 'invalid-date' });
        continue;
      }
      openDate = other;
    }

    const parsed = parseOccContractId(occToken)!;
    if (expected && parsed.symbol !== expected) {
      rejected.push({ raw, reason: 'wrong-underlying' });
      continue;
    }

    const existing = entries.get(parsed.contractID);
    if (!existing) {
      entries.set(parsed.contractID, {
        contractId: parsed.contractID,
        openDate,
        markerDates: openDate ? [openDate] : [],
      });
    } else if (openDate) {
      if (!existing.markerDates!.includes(openDate)) {
        existing.markerDates!.push(openDate);
      }
      if (!existing.openDate || openDate < existing.openDate) {
        existing.openDate = openDate;
      }
    }
  }

  for (const e of entries.values()) e.markerDates!.sort();
  return { entries: [...entries.values()], rejected };
}

/**
 * The underlying the input belongs to: the majority symbol across parsed
 * entries — ties resolve to the first-seen symbol (Map insertion order).
 * Drives the auto-swap: paste SPY contracts while on QQQ and the page
 * swaps to SPY instead of rejecting the input. Returns null when no
 * entry's contract id parses (defensive — parsePlottedEntries already
 * filtered those out).
 */
export function dominantUnderlying(entries: PlottedEntry[]): string | null {
  const counts = new Map<string, number>();
  for (const e of entries) {
    const sym = parseOccContractId(e.contractId)?.symbol;
    if (sym) counts.set(sym, (counts.get(sym) ?? 0) + 1);
  }
  let best: string | null = null;
  let n = 0;
  for (const [sym, c] of counts) {
    if (c > n) {
      n = c;
      best = sym;
    }
  }
  return best;
}
