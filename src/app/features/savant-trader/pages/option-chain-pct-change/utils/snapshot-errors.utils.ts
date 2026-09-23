/**
 * Snapshot-fetch error formatting — shared by the manual run path and the
 * swing-compare ensureSnapshots path so a partner/callable failure reads
 * the same everywhere.
 *
 * Callable errors carry a `functions/<code>` on `.code`; the callable also
 * embeds a recognized partner body code as `code=<NAME>` in the message.
 * `OPTIONS_NOT_ENABLED` (surfaced as `failed-precondition`) means the symbol
 * is outside SA's enabled options universe — render that as a plain
 * "not available" message, not a technical failure.
 */

const PARTNER_CODE_RE = /(?:code=|"code"\s*:\s*")([A-Z_]+)/;
const MAX_DETAIL_LEN = 120;

/** Human-readable description of a chain-snapshot fetch failure. */
export function describeSnapshotError(err: unknown, symbol: string): string {
  const code = (err as { code?: string })?.code?.replace('functions/', '');
  const msg = err instanceof Error ? err.message : String(err);
  const partnerCode = PARTNER_CODE_RE.exec(msg)?.[1];
  if (partnerCode === 'OPTIONS_NOT_ENABLED' || code === 'failed-precondition') {
    return `Options analysis is not available for ${symbol}`;
  }
  const detail = partnerCode ?? (msg.length > MAX_DETAIL_LEN ? `${msg.slice(0, MAX_DETAIL_LEN)}…` : msg);
  return code ? `${code}: ${detail}` : detail;
}
