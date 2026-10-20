/**
 * Scanner domain contracts — RH Scanner page (Topic #1098).
 *
 * Scan Recipe and Curation Proposal types plus pure helpers shared by the
 * Angular frontend and the functions verify relay. Wire types for the
 * preview_scan call itself live in `@robinhood-mcp/contracts`; this file is
 * the domain layer on top of them (see CONTEXT.md: Scan Recipe,
 * Curation Proposal).
 */
import { PREVIEW_SCAN_ROW_CAP } from '@robinhood-mcp/contracts';
import { isPlainObject, isStringArray } from '@robinhood-mcp/utils';
import type {
  PreviewScanResult,
  ScanColumn,
  ScanEnumFilter,
  ScanExpressionFilter,
  ScanFilter,
} from '@robinhood-mcp/contracts';

/**
 * Client-side post-sort for a recipe's results. preview_scan has no sort
 * arg (sorting is saved-scan-only via update_scan_config), so the FE sorts
 * the returned rows itself — `column` is a display-name from the recipe's
 * columns, `direction` mirrors the wire's 'asc'/'desc' vocabulary.
 */
export interface ScanSort {
  column: string;
  direction: 'asc' | 'desc';
}

/**
 * Scan Recipe — a named, code-versioned preview_scan bundle (filters,
 * result columns, and an optional client-side sort).
 */
export interface ScanRecipe {
  /** Stable kebab-case id, e.g. 'quality-large', 'ivr-high'. */
  id: string;
  title: string;
  /** One-line menu description. */
  blurb: string;
  filters: ScanFilter[];
  columns: ScanColumn[];
  sort?: ScanSort;
}

/** Proposal buckets — the compare-run artifact (CONTEXT.md). */
export interface CurationProposalBuckets {
  /** Matched by the scan and not tracked — proposed additions. */
  addCandidates: string[];
  /** Tracked and failed the scan — proposed removals. */
  dropCandidates: string[];
  /** Tracked but absent from the scanner entirely (dead tickers). */
  deadSymbols: string[];
  /** Tracked, returned by the scanner, but with blank/insufficient data. */
  noDataSymbols: string[];
}

export interface CurationProposal extends CurationProposalBuckets {
  recipeId: string;
  /** ISO-8601 run timestamp. */
  ranAt: string;
  universeSize: number;
  matchedCount: number;
  /** Results hit a scanner cap — more matches may exist beyond returned rows. */
  truncated: boolean;
  /** Drop candidates → the column values that failed them. */
  dropDetail?: Record<string, Record<string, string>>;
}

/** Narrowing guard — expression filters carry `expression`, never `filter_type`. */
export function isExpressionFilter(f: ScanFilter): f is ScanExpressionFilter {
  return 'expression' in f;
}

/** Narrowing guard — enum filters carry `filter_type`, never `expression`. */
export function isEnumFilter(f: ScanFilter): f is ScanEnumFilter {
  return 'filter_type' in f;
}

/** Chunk symbols into ANY_OF-scope batches (150 per chunk fits well under the 20-call /batch cap). */
export function chunkSymbols(symbols: string[], size: number): string[][] {
  if (size < 1) throw new Error('chunkSymbols: size must be >= 1');
  const chunks: string[][] = [];
  for (let i = 0; i < symbols.length; i += size) {
    chunks.push(symbols.slice(i, i + size));
  }
  return chunks;
}

/**
 * True when the scan result may hide matches: total exceeds returned rows,
 * or the 200-row display cap was hit (a full 200/200 page is ambiguous —
 * err toward flagging).
 */
export function isScanTruncated(result: PreviewScanResult): boolean {
  return (
    result.results.length >= PREVIEW_SCAN_ROW_CAP ||
    result.total_items > result.results.length
  );
}

const PROPOSAL_STRING_ARRAY_KEYS = [
  'addCandidates',
  'dropCandidates',
  'deadSymbols',
  'noDataSymbols',
] as const;

/** Firestore-ready serialization of a Curation Proposal. */
export function serializeCurationProposal(
  p: CurationProposal,
): Record<string, unknown> {
  const doc: Record<string, unknown> = {
    recipeId: p.recipeId,
    ranAt: p.ranAt,
    universeSize: p.universeSize,
    matchedCount: p.matchedCount,
    truncated: p.truncated,
    addCandidates: p.addCandidates,
    dropCandidates: p.dropCandidates,
    deadSymbols: p.deadSymbols,
    noDataSymbols: p.noDataSymbols,
  };
  if (p.dropDetail !== undefined) {
    doc['dropDetail'] = p.dropDetail;
  }
  return doc;
}

/** Parse a Firestore doc back into a Curation Proposal; throws on shape drift. */
export function parseCurationProposal(
  data: Record<string, unknown>,
): CurationProposal {
  if (
    typeof data['recipeId'] !== 'string' ||
    typeof data['ranAt'] !== 'string' ||
    typeof data['universeSize'] !== 'number' ||
    typeof data['matchedCount'] !== 'number' ||
    typeof data['truncated'] !== 'boolean'
  ) {
    throw new Error('CurationProposal: missing or mistyped scalar fields');
  }
  const buckets = {} as Record<(typeof PROPOSAL_STRING_ARRAY_KEYS)[number], string[]>;
  for (const key of PROPOSAL_STRING_ARRAY_KEYS) {
    const v = data[key];
    if (!isStringArray(v)) {
      throw new Error(`CurationProposal: ${key} must be a string[]`);
    }
    buckets[key] = v;
  }
  const proposal: CurationProposal = {
    recipeId: data['recipeId'],
    ranAt: data['ranAt'],
    universeSize: data['universeSize'],
    matchedCount: data['matchedCount'],
    truncated: data['truncated'],
    ...buckets,
  };
  if (data['dropDetail'] !== undefined) {
    const dd = data['dropDetail'];
    if (
      !isPlainObject(dd) ||
      !Object.values(dd).every(
        (cols) => isPlainObject(cols) && Object.values(cols).every((v) => typeof v === 'string'),
      )
    ) {
      throw new Error('CurationProposal: dropDetail must be Record<string, Record<string, string>>');
    }
    proposal.dropDetail = dd as Record<string, Record<string, string>>;
  }
  return proposal;
}
