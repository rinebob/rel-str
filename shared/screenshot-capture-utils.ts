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
 * `st-trade-screenshots/{SYMBOL}/[{groupId}/]{date}-{time}-{event}-{positionType}[-{ref6}]-{interval}.{ext}`
 * e.g. `st-trade-screenshots/GOOG/2026-10-03-143022-order-filled-stock-ord123-daily.png`
 * or `st-trade-screenshots/GOOG/cohort-1/2026-10-03-143022-order-filled-stock-ord123-daily.png`.
 * The time segment makes same-day collisions impossible; refId adds a
 * caller-supplied lookup key when present; groupId groups a campaign's
 * captures under one prefix for enumeration.
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
  return `${SCREENSHOT_STORAGE_PREFIX}/${symbol}/${groupSegment}${spec.date}-${spec.time}-${spec.event}-${spec.positionType}${refSegment}-${spec.interval}.${spec.ext}`;
}

// ── Result assembly ────────────────────────────────────────────────────────

/**
 * Single sanctioned constructor for `CaptureChartResult` — derives `svg` and
 * `paths` from `artifacts` so the denormalized fields cannot disagree with
 * the canonical payload.
 */
export function buildCaptureChartResult(artifacts: CaptureArtifact[]): CaptureChartResult {
  return {
    svg: artifacts[0]?.svg ?? '',
    paths: artifacts.flatMap((a) =>
      [a.svgPath, a.pngPath].filter((p): p is string => !!p),
    ),
    artifacts,
  };
}
