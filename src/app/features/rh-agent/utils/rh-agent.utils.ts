/**
 * RH Agent UI Utilities
 *
 * Small, pure helpers used across the RH Agent feature components.
 */
import { RhAgentSignalItem, RhAgentSymbolProfile, RH_AGENT_SCHEDULE_CRON } from '../services/rh-agent.types';
import { RhSymbolRow, RhSymbolGroup } from '../stores/rh-agent-group.store';
import { GroupDimension, RhReviewStatus } from '../common/rh-agent.constants';

/** Today in Pacific Time as YYYY-MM-DD. */
export function todayDate(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
}

/** Fallback group name for symbols missing the active dimension value. */
export const UNKNOWN_GROUP = '(Unknown)';

/** Build the group key for a symbol profile under the chosen dimension. */
export function getGroupKey(profile: RhAgentSymbolProfile, dimension: GroupDimension): string {
  switch (dimension) {
    case 'sector':        return profile.sector        || UNKNOWN_GROUP;
    case 'industry':      return profile.industry      || UNKNOWN_GROUP;
    case 'marketCapTier': return profile.marketCapTier || UNKNOWN_GROUP;
  }
}

/**
 * Determine whether a symbol should appear under the active list filter.
 *
 * 'ALL' shows every symbol. Any other filter value shows only symbols that
 * belong to that named list.
 */
export function shouldShowInListFilter(symbol: string, lists: Record<string, string[]>, filter: string | 'ALL'): boolean {
  if (filter === 'ALL') return true;
  const list = lists[filter] ?? [];
  return list.includes(symbol.toUpperCase());
}

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

/** Return true if the bar date is today or yesterday in Pacific Time. */
export function isRecentSignalDate(barDate: string): boolean {
  const today = todayDate();
  const yesterday = yesterdayPt();
  return barDate === today || barDate === yesterday;
}

/** Yesterday in Pacific Time as YYYY-MM-DD. */
function yesterdayPt(): string {
  const today = todayDate();
  const [year, month, day] = today.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  d.setDate(d.getDate() - 1);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(d);
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

/** Input shape for building a grouped view — kept generic so it can be computed from store state. */
export interface BuildSymbolGroupsInput {
  signalSymbols: RhAgentSymbolProfile[];
  allSymbols: RhAgentSymbolProfile[];
  showAll: boolean;
  dimension: GroupDimension;
  symbolLists: Record<string, string[]>;
  activeListFilter: string | 'ALL';
  fullGroupToggles: Record<string, boolean>;
  statuses: Record<string, RhReviewStatus>;
  historyCache: Record<string, RhAgentSignalItem[]>;
  historyLoading: Record<string, boolean>;
  activeRunId: string | null;
}

/**
 * Build the grouped view used by the grouped review page.
 * Pure function: no store access, just transforms the supplied state into groups.
 */
export function buildSymbolGroups(input: BuildSymbolGroupsInput): RhSymbolGroup[] {
  const {
    signalSymbols,
    allSymbols,
    showAll,
    dimension,
    symbolLists,
    activeListFilter,
    fullGroupToggles,
    statuses,
    historyCache,
    historyLoading,
    activeRunId,
  } = input;

  const signalSet = new Set(signalSymbols.map((s) => s.symbol));

  const symbols: Array<{ profile: RhAgentSymbolProfile; hasSignal: boolean }> = [
    ...signalSymbols.map((p) => ({ profile: p, hasSignal: true })),
    ...(showAll
      ? allSymbols
          .filter((p) => !signalSet.has(p.symbol))
          .map((p) => ({ profile: p, hasSignal: false }))
      : []),
  ];

  const groupMap = new Map<string, Array<{ profile: RhAgentSymbolProfile; hasSignal: boolean }>>();
  for (const item of symbols) {
    if (!shouldShowInListFilter(item.profile.symbol, symbolLists, activeListFilter)) continue;

    const key = getGroupKey(item.profile, dimension);
    const existing = groupMap.get(key) ?? [];
    existing.push(item);
    groupMap.set(key, existing);
  }

  const sortedKeys = [...groupMap.keys()].sort((a, b) => {
    if (a === UNKNOWN_GROUP) return 1;
    if (b === UNKNOWN_GROUP) return -1;
    return a.localeCompare(b);
  });

  return sortedKeys.map((key) => {
    const items = groupMap.get(key)!;
    const sorted = [...items].sort(
      (a, b) => (b.profile.marketCap ?? 0) - (a.profile.marketCap ?? 0)
    );

    const rows: RhSymbolRow[] = sorted.map((item) => {
      const cacheKey = activeRunId ? `${item.profile.symbol}::${activeRunId}` : item.profile.symbol;
      return {
        profile: item.profile,
        hasSignal: item.hasSignal,
        signals: historyCache[cacheKey],
        signalsLoading: historyLoading[cacheKey] ?? false,
        reviewStatus: statuses[item.profile.symbol] ?? 'PENDING',
      };
    });

    const longCount = rows.filter(
      (r) => r.profile.lastWeeklySignalDirection === 'LONG' || r.profile.lastDailySignalDirection === 'LONG'
    ).length;
    const shortCount = rows.filter(
      (r) => r.profile.lastWeeklySignalDirection === 'SHORT' || r.profile.lastDailySignalDirection === 'SHORT'
    ).length;

    return {
      key,
      rows,
      showFullGroup: fullGroupToggles[key] ?? false,
      longCount,
      shortCount,
    };
  });
}
