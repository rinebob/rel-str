/**
 * Backtest UI display utilities.
 *
 * Pure helpers for formatting backtest run data and mapping statuses to
 * Material icons/colors. Kept in the backtest sub-feature.
 */
import type { BacktestPermutationStatus, BacktestRunStatus } from '../common/backtest.types';
import { formatTimestampPT } from '../../utils/rh-agent.utils';

export interface BacktestStatusVisuals {
  color: string;
  icon: string;
}

type BacktestAnyStatus = BacktestRunStatus | BacktestPermutationStatus;

const STATUS_VISUALS: Record<BacktestAnyStatus, BacktestStatusVisuals> = {
  completed: { color: 'var(--mat-sys-success)', icon: 'check_circle' },
  success: { color: 'var(--mat-sys-success)', icon: 'check_circle' },
  failed: { color: 'var(--mat-sys-error)', icon: 'error' },
  running: { color: 'var(--mat-sys-primary)', icon: 'pending' },
  cancelled: { color: 'var(--mat-sys-warning)', icon: 'cancel' },
  pending: { color: '', icon: 'schedule' },
};

/** CSS color + Material icon for a run or permutation status. */
export function getBacktestStatusVisuals(status: BacktestAnyStatus): BacktestStatusVisuals {
  return STATUS_VISUALS[status] ?? { color: '', icon: 'schedule' };
}

/** Format an ISO timestamp as a PT date+time string. */
export function formatBacktestTimestamp(iso: string | undefined): string {
  if (!iso) return '—';
  return formatTimestampPT(iso);
}

/** Extract the PT calendar date (YYYY-MM-DD) from an ISO timestamp. */
export function toBacktestPtDate(iso: string | undefined): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date(iso));
}

const RUN_ID_PATTERN = /^(\d{4})-(\d{2})-(\d{2})_(\w{3})_(\d{2})(\d{2})(\d{2})_/;

/** Format a PT-derived runId (YYYY-MM-DD_dow_HHMMSS_...) into a readable PT datetime. */
export function formatBacktestRunId(runId: string): string {
  const match = runId.match(RUN_ID_PATTERN);
  if (!match) return runId;
  const [, year, month, day, dow, hours, minutes, seconds] = match;
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds} ${dow.toUpperCase()}`;
}

/** Format a duration between two ISO timestamps as mm:ss or h:mm:ss. */
export function formatBacktestDuration(startIso?: string, endIso?: string): string {
  if (!startIso) return '—';
  const start = new Date(startIso).getTime();
  const end = endIso ? new Date(endIso).getTime() : Date.now();
  if (Number.isNaN(start) || Number.isNaN(end)) return '—';

  const ms = Math.max(0, end - start);
  const seconds = Math.floor(ms / 1000) % 60;
  const minutes = Math.floor(ms / (1000 * 60)) % 60;
  const hours = Math.floor(ms / (1000 * 60 * 60));

  const ss = String(seconds).padStart(2, '0');
  const mm = String(minutes).padStart(2, '0');
  if (hours > 0) {
    return `${hours}:${mm}:${ss}`;
  }
  return `${minutes}:${ss}`;
}
