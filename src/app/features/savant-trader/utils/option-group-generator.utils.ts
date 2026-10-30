/**
 * Option group generator — pure functions (#1337).
 *
 * Query assembly (FE state → `ContractAvailabilityRequest`), client-side
 * refine filtering on returned contract records, and `date,id` pair-line
 * emission for the plotted-set input. No Angular dependencies.
 */
import type {
  ContractAvailabilityEntry,
  ContractAvailabilityRequest,
} from '../../../../../shared/options-contract-contracts';

/** The drawer's option-type selection; 'BOTH' means no wire param. */
export type GeneratorOptionType = 'C' | 'P' | 'BOTH';

/** Query-builder state — axis inputs as the user typed them. */
export interface GeneratorQueryState {
  expirationGte?: string;
  expirationLte?: string;
  /** Explicit expiry list — overrides the range when non-empty. */
  expirations?: string[];
  strikeGte?: number;
  strikeLte?: number;
  strikeStep?: number;
  type: GeneratorOptionType;
  firstObservedGte?: string;
  firstObservedLte?: string;
}

/** An inclusive study window dragged on the chart, in YYYY-MM-DD. */
export interface StudyRange {
  start: string;
  end: string;
}

/** Client-side refine state — same axes as the query plus the
 *  alive-across-range bound. Every set field must hold (AND). */
export interface GeneratorRefineState {
  strikeGte?: number;
  strikeLte?: number;
  /** Keep only strikes that are an exact multiple of the step. */
  strikeStep?: number;
  expirationGte?: string;
  expirationLte?: string;
  /** Explicit expiry list — membership filter, not a range. */
  expirations?: string[];
  type?: 'call' | 'put';
  firstObservedGte?: string;
  /** Keep only contracts whose firstObserved is ≤ this date. */
  firstObservedLte?: string;
  /** Keep only contracts observed across the whole study window. */
  aliveRange?: StudyRange;
}

/**
 * FE query state → wire request. An explicit expirations list (non-empty
 * after trimming) wins over the range — matching the endpoint's own
 * overrides-range semantics so the wire matches intent, not both.
 */
export function toAvailabilityQuery(
  symbol: string,
  q: GeneratorQueryState,
): ContractAvailabilityRequest {
  const req: ContractAvailabilityRequest = { symbol: symbol.trim().toUpperCase() };
  const expirations = (q.expirations ?? [])
    .map((d) => d.trim())
    .filter((d) => d !== '');
  if (expirations.length > 0) {
    req.expirations = expirations;
  } else {
    if (q.expirationGte !== undefined) req.expirationGte = q.expirationGte;
    if (q.expirationLte !== undefined) req.expirationLte = q.expirationLte;
  }
  if (q.strikeGte !== undefined) req.strikeGte = q.strikeGte;
  if (q.strikeLte !== undefined) req.strikeLte = q.strikeLte;
  // 0 means "no step" in the form — only a positive step goes on the wire.
  if (q.strikeStep !== undefined && q.strikeStep > 0) req.strikeStep = q.strikeStep;
  if (q.type !== 'BOTH') req.type = q.type;
  if (q.firstObservedGte !== undefined) req.firstObservedGte = q.firstObservedGte;
  if (q.firstObservedLte !== undefined) req.firstObservedLte = q.firstObservedLte;
  return req;
}

/**
 * Client-side narrowing on returned records — every set field must hold
 * (AND composition). ISO dates compare lexicographically. The
 * alive-across-range bound requires the contract observed on or before the
 * range start AND still observed on or after the range end.
 */
export function refineContracts(
  records: readonly ContractAvailabilityEntry[],
  r: GeneratorRefineState,
): ContractAvailabilityEntry[] {
  const expiryList = (r.expirations ?? []).map((d) => d.trim()).filter((d) => d !== '');
  const expirySet = expiryList.length ? new Set(expiryList) : undefined;
  return records.filter(
    (c) =>
      (r.strikeGte === undefined || c.strike >= r.strikeGte) &&
      (r.strikeLte === undefined || c.strike <= r.strikeLte) &&
      (r.strikeStep === undefined || r.strikeStep === 0 || c.strike % r.strikeStep === 0) &&
      (r.expirationGte === undefined || c.expiration >= r.expirationGte) &&
      (r.expirationLte === undefined || c.expiration <= r.expirationLte) &&
      (expirySet === undefined || expirySet.has(c.expiration)) &&
      (r.type === undefined || c.type === r.type) &&
      (r.firstObservedGte === undefined || c.firstObserved >= r.firstObservedGte) &&
      (r.firstObservedLte === undefined || c.firstObserved <= r.firstObservedLte) &&
      (r.aliveRange === undefined ||
        (c.firstObserved <= r.aliveRange.start && c.lastObserved >= r.aliveRange.end)),
  );
}

/** True when both range bounds are set and the lower exceeds the upper —
 *  the form's reject condition (endpoint 400s inverted ranges). */
export function isInvertedRange(gte: string | undefined, lte: string | undefined): boolean {
  return gte !== undefined && lte !== undefined && gte > lte;
}

/**
 * Emit the pasted-pair format for `loadPlotted`: `YYYY-MM-DD,ID` when an
 * open date is supplied, bare `ID` otherwise. Deterministic order matching
 * the endpoint's sort — expiration asc → strike asc → contractId asc.
 */
export function toPairLines(
  records: readonly ContractAvailabilityEntry[],
  openDate?: string,
): string[] {
  const date = openDate?.trim();
  return [...records]
    .sort(
      (a, b) =>
        a.expiration.localeCompare(b.expiration) ||
        a.strike - b.strike ||
        a.contractId.localeCompare(b.contractId),
    )
    .map((c) => (date ? `${date},${c.contractId}` : c.contractId));
}
