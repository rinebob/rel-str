/**
 * RH Agent UI Utilities
 *
 * Small, pure helpers used across the RH Agent feature components.
 */
import { RhAgentSignalItem, RH_AGENT_SCHEDULE_CRON } from '../services/rh-agent.service';
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

/** Expand a date range into a list of YYYY-MM-DD strings (inclusive). */
export function expandDateRange(start: Date, end: Date): string[] {
  const dates: string[] = [];
  const cur = new Date(start);
  cur.setHours(0, 0, 0, 0);
  const last = new Date(end);
  last.setHours(0, 0, 0, 0);
  while (cur <= last) {
    dates.push(formatLocalDate(new Date(cur)));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

/** Human-readable description of the agent cron schedule. */
export function getScheduleDescription(cron = RH_AGENT_SCHEDULE_CRON): string {
  if (!cron) return 'Not scheduled';
  const parts = cron.split(' ');
  if (parts.length !== 5) return cron;
  const [minute, hour, , , dayOfWeek] = parts;
  let hourNum = (parseInt(hour, 10) - 8 + 24) % 24;
  const minNum = parseInt(minute, 10);
  const ampm = hourNum >= 12 ? 'PM' : 'AM';
  const hour12 = hourNum % 12 || 12;
  const minStr = minNum === 0 ? '' : `:${minNum.toString().padStart(2, '0')}`;
  const time = `${hour12}${minStr} ${ampm}`;
  let days = '';
  if (dayOfWeek === '*') days = 'daily';
  else if (dayOfWeek === '1-5') days = 'Monday-Friday';
  else if (dayOfWeek === '0-6') days = 'daily';
  else if (dayOfWeek === '1') days = 'Mondays';
  else if (dayOfWeek === '5') days = 'Fridays';
  else days = dayOfWeek;
  return `${time} PT, ${days}`;
}

/** Material color name for a run status. */
export function getRunStatusColor(status: string): string {
  switch (status?.toLowerCase()) {
    case 'success': return 'success';
    case 'failed': return 'error';
    case 'running': return 'primary';
    case 'partial': return 'accent';
    default: return '';
  }
}

/** Material icon name for a run status. */
export function getRunStatusIcon(status: string): string {
  switch (status?.toLowerCase()) {
    case 'success': return 'check_circle';
    case 'failed': return 'error';
    case 'running': return 'pending';
    case 'partial': return 'warning';
    default: return 'help';
  }
}
