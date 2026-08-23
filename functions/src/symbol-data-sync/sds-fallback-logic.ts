/**
 * Pure functions for the SDS fallback timer.
 *
 * No side effects, no dependencies — testable in isolation.
 */

import { TERMINAL_SEQ } from './sds-completion';

export interface SequenceSummary {
  marketDate: string;
  sequence: string;
  status: string;
}

/**
 * Statuses that indicate a POST A sequence already synced data.
 *
 * `TERMINAL_SEQ` covers completed/forced_complete/completed_but_not_dispatched
 * (data was synced). We also include `processing` because a sequence that is
 * currently running means the PDR already arrived — the fallback should not
 * create a duplicate.
 */
const ACTIVE_STATUSES = [...TERMINAL_SEQ, 'processing'] as readonly string[];

/**
 * Determine whether the fallback timer should create a synthetic POST A run.
 *
 * Returns true only if NO POST A sequence exists for today's marketDate
 * with a status indicating the data was synced or is being synced.
 */
export function shouldFallbackRun(
  sequences: SequenceSummary[],
  marketDate: string,
): boolean {
  const hasPostA = sequences.some(
    (s) =>
      s.marketDate === marketDate &&
      s.sequence === 'A' &&
      ACTIVE_STATUSES.includes(s.status),
  );

  return !hasPostA;
}
