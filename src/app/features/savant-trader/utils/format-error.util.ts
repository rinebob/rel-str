/**
 * Format an unknown error value into a human-readable string.
 *
 * Handles common error shapes: Error instances, string, { error: string },
 * { message: string }, { status, statusText }, and arbitrary objects
 * (serialized as JSON).
 */
export function formatError(err: unknown): string {
  if (!err) return 'Unknown error';
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (typeof err === 'object') {
    const rec = err as Record<string, unknown>;
    if (rec['error'] && typeof rec['error'] === 'string') return rec['error'];
    if (rec['error'] && typeof rec['error'] === 'object') return formatError(rec['error']);
    if (rec['message'] && typeof rec['message'] === 'string') return rec['message'];
    if (rec['statusText'] && typeof rec['statusText'] === 'string') {
      const status = rec['status'] ? `${rec['status']} ` : '';
      return `${status}${rec['statusText']}`;
    }
    try {
      return JSON.stringify(err);
    } catch {
      /* ignore */
    }
  }
  return String(err);
}
