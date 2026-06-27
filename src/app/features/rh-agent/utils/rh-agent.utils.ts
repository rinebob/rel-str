/**
 * RH Agent UI Utilities
 *
 * Small, pure helpers used across the RH Agent feature components.
 */
import { RhAgentSignalItem } from '../services/rh-agent.service';
import { RhSymbolRow } from '../stores/rh-agent-group.store';

/** Market cap tier display label. */
export function tierLabel(tier: string | undefined): string {
  const map: Record<string, string> = {
    mega: 'MEGA', large: 'LG', mid: 'MID', small: 'SM', micro: 'µ',
  };
  return tier ? (map[tier] ?? tier.toUpperCase()) : '';
}

/** Direction label from signal items. */
export function signalDirections(signals: RhAgentSignalItem[] | undefined): string {
  if (!signals?.length) return '';
  const dirs = [...new Set(signals.map((s) => s.direction))];
  return dirs.join('/');
}

/** Most recent signals for a row — shown as inline badges in the header. */
export function latestSignals(row: RhSymbolRow): RhAgentSignalItem[] {
  if (!row.signals?.length) return [];
  const latest = row.signals[0];
  if (!isRecentSignalDate(latest.barDate)) return [];
  return row.signals.filter((s) => s.barDate === latest.barDate);
}

/** Format a Date as a local ISO date string (YYYY-MM-DD). */
export function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Return true if the bar date is today or yesterday in local time. */
export function isRecentSignalDate(barDate: string): boolean {
  const now = new Date();
  const today = formatLocalDate(now);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const yesterdayStr = formatLocalDate(yesterday);
  return barDate === today || barDate === yesterdayStr;
}
