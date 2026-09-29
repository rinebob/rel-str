/**
 * Allocation Manager view types (Blueprint #582 / task #587).
 *
 * The store's selector shapes — the Cash and Unassigned rows are pseudo
 * rows derived from live positions/snapshot, never stored documents.
 */
import type {
  AllocationBucket,
  BucketStats,
  PositionAttribution,
} from '@portfolio-allocation/contracts';
import type {
  AllocationFillInput,
  AllocationPositionInput,
  CashCheck,
} from '@portfolio-allocation/utils';
import type { PortfolioSnapshot } from '../../core/robinhood-mcp/types/robinhood-mcp.types';

/** Per-account slice — everything the allocation page needs, cached per
 *  accountNumber so tab switches don't re-fetch. */
export interface AccountAllocation {
  snapshot: PortfolioSnapshot | null;
  positions: AllocationPositionInput[];
  fills: AllocationFillInput[];
  buckets: AllocationBucket[];
  attributions: PositionAttribution[];
  /** ISO timestamp of the last MCP fetch — the as-of label (PRD). */
  asOf: string | null;
  loading: boolean;
  error: string | null;
}

export type BucketRowKind = 'bucket' | 'cash' | 'unassigned';

export interface BucketRow {
  kind: BucketRowKind;
  /** Set only for kind 'bucket'. */
  bucket: AllocationBucket | null;
  /** Stats for 'bucket' and 'unassigned' rows (null for cash). */
  stats: BucketStats | null;
  /** Reconciliation detail for the 'cash' row (null otherwise). */
  cash: CashCheck | null;
}

export interface PositionRow {
  position: AllocationPositionInput;
  bucketId: string | null;
  /** Resolved display name — 'Unassigned' when bucketId is null,
   *  'Unknown bucket' when the attribution points at a deleted bucket. */
  bucketName: string;
  /** True when the attribution is dangling (bucketId set but the bucket
   *  isn't in the loaded set — deleted out-of-band). Numerically the row
   *  is unassigned (header/pseudo-row stats already fold it in) while the
   *  label still surfaces the data issue — the Unassigned filter and
   *  badge key off this + bucketId === null, matching the store. */
  unresolved?: boolean;
  /** The position's multi-leg group key, when attributed as one. */
  linkKey?: string;
}

/** Account header — value / allocated / cash remainder completeness check. */
export interface AccountHeader {
  accountValue: number | null;
  /** Gross deployed exposure — Σ|marketValue| over ALL positions. */
  allocated: number;
  /** Broker-reported cash (the allocation basis). */
  cash: number | null;
  /** Derived residual — accountValue − Σ marketValue (cross-check). */
  derivedCash: number | null;
  /** True when actual vs derived diverge beyond tolerance — warn, not block. */
  cashDiverged: boolean;
  /** Subset of `allocated` sitting in Unassigned. */
  unassignedExposure: number;
  asOf: string | null;
}

export interface BucketDetail {
  bucket: AllocationBucket;
  stats: BucketStats;
  positions: PositionRow[];
  /** Fills for the bucket's owned instruments — PRD: detail lists
   *  "attributed positions and orders". Per-position filtering happens
   *  in the dialog (fills are per-instrument, not per-position). */
  fills: AllocationFillInput[];
}

/** Whole-dollar display convention shared by the allocation surfaces —
 *  '—' for missing, tabular grouping otherwise. */
export function fmtDollars(v: number | null | undefined): string {
  // NaN (e.g. a corrupt Firestore targetPct double) renders '—' too —
  // same guard the table's overTarget fold already applies.
  return v != null && Number.isFinite(v)
    ? v.toLocaleString('en-US', { maximumFractionDigits: 0 })
    : '—';
}
