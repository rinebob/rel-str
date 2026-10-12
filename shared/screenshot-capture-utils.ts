/**
 *
 * Builders for the screenshot-capture contracts (Topic #746 / Thread #747 /
 * task #765): the storage path convention and the result assembler. Kept in
 * a `-utils` module per the repo's contracts/builders layering precedent
 * (`portfolio-allocation-utils.ts`, `robinhood-mcp-utils.ts`) — the contracts
 * file holds shapes only.
 *
 * Import via the `@screenshot-capture/utils` path alias.
 */

import {
  CaptureEvent,
  PositionType,
  type CaptureArtifact,
  type CaptureChartResult,
  type CaptureInterval,
} from './screenshot-capture-contracts';

/** Characters allowed in a path segment: alphanumerics plus dots (BRK.B).
 *  `/` and everything else is stripped — no traversal into other prefixes. */
const PATH_SAFE_PATTERN = /[^a-zA-Z0-9.]/g;

// ── Storage path convention ────────────────────────────────────────────────

/** Dedicated top-level prefix in the default Firebase Storage bucket —
 *  kept distinct from the trade journal's `trades/.../screenshots` segment.
 *  Follows the `st-` domain-prefix convention. */
export const SCREENSHOT_STORAGE_PREFIX = 'st-trade-screenshots';

export const SCREENSHOT_REF_ID_MAX_LENGTH = 6;
export const SCREENSHOT_GROUP_ID_MAX_LENGTH = 64;

export type ScreenshotFileExt = 'svg' | 'png';

export interface ScreenshotPathSpec {
  symbol: string;
  event: CaptureEvent;
  positionType: PositionType;
  interval: CaptureInterval;
  ext: ScreenshotFileExt;
  /** `yyyy-mm-dd` — supplied by the writer so the convention stays pure. */
  date: string;
  /** `HHmmss` — guarantees same-day captures never overwrite each other. */
  time: string;
  /** Optional caller key (order id, position id, …). Sanitized to
   *  alphanumerics and truncated to {@link SCREENSHOT_REF_ID_MAX_LENGTH}. */
  refId?: string;
  /** Optional campaign-grouping id (Position Group / cohort / strategy
   *  position). Becomes a directory level `{symbol}/{groupId}/`; sanitized to
   *  alphanumerics/dots/hyphens, lowercased, truncated to
   *  {@link SCREENSHOT_GROUP_ID_MAX_LENGTH}. Omitted when it sanitizes to
   *  nothing. */
  groupId?: string;
}

/** refId → filename segment: alphanumerics/dots only, lowercased, max 6
 *  chars — empty when nothing survives so no dangling `-` segment is
 *  emitted. */
function sanitizeSegment(value: string): string {
  return value.replace(PATH_SAFE_PATTERN, '').toLowerCase().slice(0, SCREENSHOT_REF_ID_MAX_LENGTH);
}

/** Symbol → path segment (uppercased alphanumerics/dots). `''` means the
 *  symbol carries no path-safe characters — spec validation must reject it
 *  upstream (`invalid-argument`), not fail here at write time. */
export function symbolPathSegment(symbol: string): string {
  return symbol.replace(PATH_SAFE_PATTERN, '').toUpperCase();
}

/** groupId → directory segment: alphanumerics/dots/hyphens, lowercased —
 *  position/cohort ids are hyphenated, so unlike {@link sanitizeSegment}
 *  hyphens survive here. Must retain at least one alphanumeric — a bare
 *  `'..'`/`'-'`/`'.'` groupId would emit a traversal-looking directory that
 *  defeats prefix listing. Empty when nothing survives (no `//` in paths). */
function sanitizeGroupSegment(value: string): string {
  const seg = value.replace(/[^a-zA-Z0-9.-]/g, '').toLowerCase().slice(0, SCREENSHOT_GROUP_ID_MAX_LENGTH);
  return /[a-z0-9]/.test(seg) ? seg : '';
}

/**
 * `st-trade-screenshots/{SYMBOL}/[{groupId}/]{SYMBOL}-{date}-{time}-{event}-{positionType}[-{ref6}]-{interval}.{ext}`
 * e.g. `st-trade-screenshots/GOOG/GOOG-2026-10-03-143022-order-filled-stock-ord123-daily.png`
 * or `st-trade-screenshots/GOOG/cohort-1/GOOG-2026-10-03-143022-order-filled-stock-ord123-daily.png`.
 * Date/time are PT wall-clock (supplied by the writer). The time segment
 * makes same-day collisions impossible; refId adds a caller-supplied lookup
 * key when present; groupId groups a campaign's captures under one prefix
 * for enumeration. The symbol leads the filename so a flat listing stays
 * self-describing.
 */
export function buildScreenshotStoragePath(spec: ScreenshotPathSpec): string {
  const symbol = symbolPathSegment(spec.symbol);
  if (!symbol) {
    throw new Error('symbol contains no path-safe characters — spec validation must reject this upstream');
  }
  const ref = spec.refId ? sanitizeSegment(spec.refId) : '';
  const refSegment = ref ? `-${ref}` : '';
  const group = spec.groupId ? sanitizeGroupSegment(spec.groupId) : '';
  const groupSegment = group ? `${group}/` : '';
  return `${SCREENSHOT_STORAGE_PREFIX}/${symbol}/${groupSegment}${symbol}-${spec.date}-${spec.time}-${spec.event}-${spec.positionType}${refSegment}-${spec.interval}.${spec.ext}`;
}

// ── Index doc id convention ────────────────────────────────────────────────

export interface ScreenshotIndexIdSpec {
  symbol: string;
  event: CaptureEvent;
  interval: CaptureInterval;
  /** `yyyy-mm-dd` and `HHmmss`, PT wall-clock — the same segments baked
   *  into the artifact filename. */
  date: string;
  time: string;
  /** Optional caller key — same sanitize+truncate rule as the filename's
   *  ref segment (the 'hash' slot in the id). */
  refId?: string;
}

/**
 * Human-readable `st-screenshots` index doc id — one doc per artifact:
 * `{SYMBOL}-{date}-{time}-{event}[-{ref6}]-{interval}`
 * e.g. `GOOG-2026-10-03-143022-order-filled-ord123-daily`.
 *
 * Firestore doc ids forbid `/`; all inputs are already path-safe segments
 * (symbol sanitized, date/time digits, enum values, ref6) so no further
 * escaping is needed. Time is the uniqueness guard — a same-second
 * recapture of the same event+interval+refId rewrites the same doc, which
 * is correct (the artifacts overwrote too).
 */
export function buildScreenshotIndexDocId(spec: ScreenshotIndexIdSpec): string {
  const symbol = symbolPathSegment(spec.symbol);
  if (!symbol) {
    throw new Error('symbol contains no path-safe characters — spec validation must reject this upstream');
  }
  const ref = spec.refId ? sanitizeSegment(spec.refId) : '';
  const refSegment = ref ? `-${ref}` : '';
  return `${symbol}-${spec.date}-${spec.time}-${spec.event}${refSegment}-${spec.interval}`;
}

// ── Result assembly ────────────────────────────────────────────────────────

/**
 * Single sanctioned constructor for `CaptureChartResult` — derives `svg` and
 * `paths` from `artifacts` so the denormalized fields cannot disagree with
 * the canonical payload.
 */
export function buildCaptureChartResult(
  artifacts: CaptureArtifact[],
  stamp?: { date: string; time: string },
): CaptureChartResult {
  return {
    svg: artifacts[0]?.svg ?? '',
    paths: artifacts.flatMap((a) =>
      [a.svgPath, a.pngPath].filter((p): p is string => !!p),
    ),
    artifacts,
    ...(stamp ?? {}),
  };
}
