# Implementation Plan — SHARED: RH Scanner contracts

**Topic:** RH Scanner  
**Topic Slug:** rh-scanner  
**Thread:** RH Scanner Page  
**Thread Slug:** rh-scanner-page  
**Issue:** #1125  
**Thread Parent:** #1099  
**Topic Parent:** #1098  
**Domain:** SAVANT-TRADER  
**Type:** IMPL  
**Status:** Draft  
**Created:** 2026-10-20  
**Last Updated:** 2026-10-20  

## 1. Scope

Shared contracts for the Scanner page: `preview_scan` wire types, Scan
Recipe + Curation Proposal types, `st-scanner` collection paths, and the
firestore.rules block. No runtime code beyond pure helpers — both FE and
the functions verify relay consume these.

## 2. File changes

| File | Change |
|---|---|
| `shared/robinhood-mcp-contracts.ts` | EDIT — scanner types appended |
| `shared/st-collections.ts` | EDIT — `st-scanner` root + proposal paths |
| `shared/scanner-contracts.ts` | NEW — recipe/proposal types + bucket helpers |
| `shared/scanner-contracts.spec.ts` | NEW — path + shape specs |
| `firestore.rules` | EDIT — `st-scanner` match block |

## 3. `preview_scan` wire types — `robinhood-mcp-contracts.ts`

Verified against live captures (`docs/topics/657-rh-mcp/captures/dep-prev-scan-*.json`):

```ts
/** Enum-shaped filter (get_scanner_filter_specs catalog). */
export interface ScanEnumFilter {
  filter_type: string;            // FILTER_TYPE_*
  predicate: string;              // '>' '>=' '<' '<=' 'BETWEEN' 'OUTSIDE' '=' 'ANY_OF' '!='
  values: string[];               // stringified values incl. numbers
  interval?: string;              // technical filters
  length?: number;
  plot?: string;
}

/** Expression filter — predicate is always '=' with values ['True']. */
export interface ScanExpressionFilter {
  expression: string;             // e.g. 'fundamental.returnOnEquity >= 0.15'
  predicate: '=';
  values: ['True'];
  display_title?: string;
}

export type ScanFilter = ScanEnumFilter | ScanExpressionFilter;

export interface ScanColumn {
  display_name: string;           // standard column, or label for expression
  expression?: string;            // present ⇒ expression column
}

export interface PreviewScanArgs {
  filters: ScanFilter[];
  columns?: ScanColumn[];
}
// NOTE (verified against the bundled catalog schema): preview_scan accepts
// filters + columns ONLY — no sort, no limit. Sorting is saved-scan-only
// (update_scan_config sorting_column/sorting_direction); ScanSort is
// therefore a domain type in scanner-contracts.ts — the FE post-sorts rows.
// sorted_by on the response is a display string ("Last desc").

export interface ScanAppliedFilter {
  filter_type: string;            // display name, e.g. 'Asset type'
  filter_type_enum: string;       // 'FILTER_TYPE_*' ('FILTER_TYPE_CUSTOM' for expressions)
  predicate: string;
  values: string[];
  expression?: string;
}

/** Result rows stringify every column value — '758092.93' not 758092.93. */
export interface ScanResultRow {
  ticker: string;
  instrument_id: string;
  instrument_type: string;        // 'EQUITY' | 'ETF' | 'CRYPTO' | 'FUTURE' | ...
  columns: Record<string, string>;
}

export interface PreviewScanResult {
  total_items: number;            // capped (~400 observed on MCP path)
  results: ScanResultRow[];       // ≤200 rows
  sorted_by?: string;
  filters_applied?: ScanAppliedFilter[];
}

/** Top-level parsed payload: { data: { result }, guide }. */
export interface PreviewScanResponse {
  data: { result: PreviewScanResult };
  guide?: string;
}

export const PREVIEW_SCAN_ROW_CAP = 200;
```

## 4. Scanner domain contracts — `scanner-contracts.ts`

```ts
/** Scan Recipe — a code-versioned preview_scan bundle (CONTEXT.md). */
export interface ScanRecipe {
  id: string;                     // 'quality-large', 'ivr-high', …
  title: string;
  blurb: string;                  // one-line menu description
  filters: ScanFilter[];
  columns: ScanColumn[];
  sort?: ScanSort;
  /** Optional default ANY_OF/IN_LIST scope baked into filters. */
}

/** Proposal buckets — the compare-run artifact (CONTEXT.md). */
export interface CurationProposalBuckets {
  addCandidates: string[];        // matched ∧ untracked
  dropCandidates: string[];       // tracked ∧ failed (with failingValues below)
  deadSymbols: string[];          // tracked ∧ absent from scanner
  noDataSymbols: string[];        // tracked ∧ returned-but-blank
}

export interface CurationProposal extends CurationProposalBuckets {
  recipeId: string;
  ranAt: string;                  // ISO
  universeSize: number;
  matchedCount: number;
  truncated: boolean;             // total_items ≥ cap or results === 200
  /** drop candidates with the column values that failed them. */
  dropDetail?: Record<string, Record<string, string>>;
}
```

Helpers (pure): `chunkSymbols(symbols, size)` for ANY_OF batching,
`isExpressionFilter(f)` / `isEnumFilter(f)` narrowing, `isScanTruncated(result)`,
`serializeCurationProposal` / `parseCurationProposal` (Firestore doc round-trip,
throws on shape drift).

## 5. Collection constants — `st-collections.ts`

```ts
export const ST_SCANNER_ROOT = 'st-scanner';
export type StScannerKind = 'proposals';
export const ST_SCANNER_PROPOSALS_ANCHOR = 'proposals';
export function stScannerProposalsPath(): string;        // 'st-scanner/proposals/items'
export function stScannerProposalDocPath(id): string;    // 'st-scanner/proposals/items/{id}'
```

Anchor-pattern per AGENTS.md; indexes land on collectionGroup `items` like
the other anchored roots.

## 6. firestore.rules

```text
match /st-scanner/{anchor}/items/{docId} {
  allow read: if request.auth != null;
  allow create, update, delete: if anchor == 'proposals' && request.auth != null;
}
```

Matches the established single-user pattern (cf. analysis-slices block).

## 7. Verification

- `tsx --test shared/scanner-contracts.spec.ts` — path helpers, narrowing,
  chunk math (925 → 7×150 → ≤20-call batch headroom), proposal shape.
- FE `RobinhoodMcpClient.previewScan` parses a captured response fixture
  verbatim — types proven against real wire data.
