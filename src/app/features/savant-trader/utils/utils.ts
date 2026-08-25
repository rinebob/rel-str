/**
 * Savant Trader UI Utilities
 *
 * Small, pure helpers used across the Savant Trader feature components.
 */
import { MarketCapTier, StSignalItem, StSymbolProfile, ST_SCHEDULE_CRON, StSymbolSource } from '../services/types';
import { SymbolRow, SymbolGroup } from '../stores/group.store';
import { GroupDimension, ReviewDecision, SignalFilter, SignalTimeframe, SignalDirection } from '../common/constants';

/** Format a YYYY-MM-DD date string as a UTC date with the given Intl options. */
export function formatUtcDate(dateStr: string, options: Intl.DateTimeFormatOptions): string {
  const date = new Date(dateStr + 'T00:00:00.000Z');
  if (isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString('en-US', { ...options, timeZone: 'UTC' });
}

/** Build a stop price from entry price, stop-loss percent, and direction. */
export function buildStopPrice(entryPrice: number, stopLossPercent: number, direction: SignalDirection): number | undefined {
  if (entryPrice <= 0 || stopLossPercent < 0) return undefined;
  const multiplier = direction === SignalDirection.LONG ? 1 - stopLossPercent / 100 : 1 + stopLossPercent / 100;
  return Number((entryPrice * multiplier).toFixed(4));
}

/** True if a Firestore Timestamp duck-type is present. */
function isTimestamp(value: unknown): value is { toDate: () => Date } {
  return (
    value !== null &&
    typeof value === 'object' &&
    'toDate' in value &&
    typeof (value as { toDate?: unknown }).toDate === 'function'
  );
}

function getTimestampOrStringIso(value: unknown): string | undefined {
  if (isTimestamp(value)) {
    return value.toDate().toISOString();
  }
  return typeof value === 'string' ? value : undefined;
}

function getOptionalString(raw: Record<string, unknown>, key: string): string | undefined {
  const value = raw[key];
  return typeof value === 'string' ? value : undefined;
}

function getOptionalNumber(raw: Record<string, unknown>, key: string): number | undefined {
  const value = raw[key];
  return typeof value === 'number' ? value : undefined;
}

function getOptionalMarketCapTier(raw: Record<string, unknown>): MarketCapTier | undefined {
  const value = raw['marketCapTier'];
  if (
    value === 'mega' ||
    value === 'large' ||
    value === 'mid' ||
    value === 'small' ||
    value === 'micro'
  ) {
    return value;
  }
  return undefined;
}

function getOptionalSource(raw: Record<string, unknown>): StSymbolSource | undefined {
  const value = raw['source'];
  if (value === StSymbolSource.MANUAL_ADD || value === StSymbolSource.PARTNER_UNIVERSE) {
    return value;
  }
  return undefined;
}

/**
 * Map a raw Firestore savant-trader/data/symbols doc into the client symbol profile shape.
 * Timestamp fields are converted to ISO strings; missing fields are left undefined.
 */
export function mapSymbolProfile(raw: Record<string, unknown>): StSymbolProfile {
  return {
    symbol: String(raw.symbol ?? ''),
    enabled: Boolean(raw.enabled ?? true),
    createdAt: getTimestampOrStringIso(raw.createdAt) ?? '',
    source: getOptionalSource(raw),
    lastAnalyzedAt: getTimestampOrStringIso(raw.lastAnalyzedAt),
    lastDailySignalDate: getOptionalString(raw, 'lastDailySignalDate'),
    lastWeeklySignalDate: getOptionalString(raw, 'lastWeeklySignalDate'),
    lastDailySignalDirection: getOptionalString(raw, 'lastDailySignalDirection'),
    lastWeeklySignalDirection: getOptionalString(raw, 'lastWeeklySignalDirection'),
    name: getOptionalString(raw, 'name'),
    sector: getOptionalString(raw, 'sector'),
    industry: getOptionalString(raw, 'industry'),
    exchange: getOptionalString(raw, 'exchange'),
    marketCap: getOptionalNumber(raw, 'marketCap'),
    marketCapTier: getOptionalMarketCapTier(raw),
    beta: getOptionalNumber(raw, 'beta'),
    peRatio: getOptionalNumber(raw, 'peRatio'),
    week52High: getOptionalNumber(raw, 'week52High'),
    week52Low: getOptionalNumber(raw, 'week52Low'),
    ma200: getOptionalNumber(raw, 'ma200'),
    ma50: getOptionalNumber(raw, 'ma50'),
    dividendYield: getOptionalNumber(raw, 'dividendYield'),
  };
}

/** Today in Pacific Time as YYYY-MM-DD. */
export function todayDate(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
}

/** Fallback group name for symbols missing the active dimension value. */
export const UNKNOWN_GROUP = '(Unknown)';

/** Build the group key for a symbol profile under the chosen dimension. */
export function getGroupKey(profile: StSymbolProfile, dimension: GroupDimension): string {
  switch (dimension) {
    case GroupDimension.SECTOR:        return profile.sector        || UNKNOWN_GROUP;
    case GroupDimension.INDUSTRY:      return profile.industry      || UNKNOWN_GROUP;
    case GroupDimension.MARKET_CAP_TIER: return profile.marketCapTier || UNKNOWN_GROUP;
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
    mega: 'MEGA', large: 'LG', mid: 'MID', small: 'SM', micro: 'Âµ',
  };
  return tier ? (map[tier] ?? tier.toUpperCase()) : '';
}

/** Direction label from signal items. */
export function signalDirections(signals: StSignalItem[] | undefined): string {
  if (!signals?.length) return '';
  const dirs = [...new Set(signals.map((s) => s.direction))];
  return dirs.join('/');
}

/**
 * Returns true if a signal passes the active timeframe and direction filter.
 */
export function matchesSignalFilter(
  signal: StSignalItem,
  filter: SignalFilter
): boolean {
  const { timeframe: tf, direction: dir } = filter;
  return (
    (tf === SignalTimeframe.ALL || signal.timeframe === tf) &&
    (dir === SignalDirection.ALL || signal.direction === dir)
  );
}

/**
 * Filter an array of signals by timeframe and direction.
 */
export function filterSignals(
  signals: StSignalItem[],
  filter: SignalFilter
): StSignalItem[] {
  return signals.filter((s) => matchesSignalFilter(s, filter));
}

/**
 * Fallback row-inclusion check when a row has no loaded signal history.
 * Treats the symbol profile's last known signal directions as a signal proxy.
 */
export function profileMatchesSignalFilter(
  profile: StSymbolProfile,
  filter: SignalFilter
): boolean {
  const { timeframe: tf, direction: dir } = filter;

  const tfOk =
    tf === SignalTimeframe.ALL ||
    (tf === SignalTimeframe.DAILY
      ? !!profile.lastDailySignalDirection
      : !!profile.lastWeeklySignalDirection);
  if (!tfOk) return false;

  if (dir === SignalDirection.ALL) return true;

  return (
    profile.lastDailySignalDirection === dir ||
    profile.lastWeeklySignalDirection === dir
  );
}

/**
 * Determine whether a symbol is visible under the active signal filter.
 * Uses loaded signals when available, otherwise falls back to profile fields.
 */
export function symbolMatchesSignalFilter(
  profile: StSymbolProfile,
  signals: StSignalItem[] | undefined,
  filter: SignalFilter
): boolean {
  if (signals?.length) {
    return signals.some((s) => matchesSignalFilter(s, filter));
  }
  return profileMatchesSignalFilter(profile, filter);
}

/**
 * Determine whether a row is visible under the active signal filter.
 * Uses loaded signals when available, otherwise falls back to profile fields.
 */
export function rowMatchesSignalFilter(
  row: SymbolRow,
  filter: SignalFilter
): boolean {
  return symbolMatchesSignalFilter(row.profile, row.signals, filter);
}

/**
 * Determine whether a row has any signal with the given direction,
 * falling back to the symbol profile's last signal directions when
 * the row's signal history has not been loaded.
 */
export function rowHasDirection(
  row: SymbolRow,
  direction: SignalDirection
): boolean {
  const signals = row.signals;
  if (signals?.length) {
    return signals.some((s) => s.direction === direction);
  }
  return (
    row.profile.lastDailySignalDirection === direction ||
    row.profile.lastWeeklySignalDirection === direction
  );
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
export function yesterdayPt(): string {
  return daysAgoPt(1);
}

/** N days ago in Pacific Time as YYYY-MM-DD. */
export function daysAgoPt(days: number): string {
  const today = todayDate();
  const [year, month, day] = today.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  d.setUTCDate(d.getUTCDate() - days);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(d);
}

/**
 * Convert a YYYY-MM-DD calendar string into a Date object that represents
 * midnight in Pacific Time. Useful for chart axes that format Date values in
 * the browser's local timezone, ensuring the displayed date matches the PT
 * calendar date used by the backend.
 */
export function toDatePt(dateStr: string): Date {
  return toDateTimePt(dateStr, 0, 0) ?? new Date(`${dateStr}T00:00:00`);
}

/** Convert a PT calendar date + hour/minute into a Date object. Returns undefined if no offset matches. */
function toDateTimePt(dateStr: string, hourPt: number, minutePt: number): Date | undefined {
  const [year, month, day] = dateStr.split('-').map(Number);
  // PT is either UTC-7 (PDT) or UTC-8 (PST).
  for (const offset of [7, 8]) {
    const candidate = new Date(Date.UTC(year, month - 1, day, hourPt + offset, minutePt, 0));
    const ptDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(candidate);
    const ptHour = parseInt(
      new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', hour12: false }).format(candidate),
      10
    );
    if (ptDate === dateStr && ptHour === hourPt) return candidate;
  }
  return undefined;
}

/** Format a UTC timestamp as a PT date+time string. */
export function formatTimestampPT(ts: Date | string | number): string {
  const d = ts instanceof Date ? ts : new Date(ts);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d);
}

/** Format a UTC timestamp as a PT time-only string. */
export function formatTimePt(ts: Date | string | number): string {
  const d = ts instanceof Date ? ts : new Date(ts);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d);
}

/** Day-of-week (0=Sun...6=Sat) for a PT calendar date string. */
function getPtDayOfWeek(dateStr: string): number {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0)).getUTCDay();
}

/** Find the next PT PDR window (8/10/12 AM/PM) that is at least 1 minute in the future. */
export function getNextPdrWindowPt(now = new Date()): Date | undefined {
  const dateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' });
  const windows = [8, 10, 12];
  for (let i = 0; i < 7; i++) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() + i);
    const dateStr = dateFmt.format(d);
    const dayOfWeek = getPtDayOfWeek(dateStr);
    if (dayOfWeek === 0 || dayOfWeek === 6) continue;
    for (const hour of windows) {
      const candidate = toDateTimePt(dateStr, hour, 0);
      if (candidate && candidate.getTime() > now.getTime() + 60 * 1000) return candidate;
    }
  }
  return undefined;
}

/** Find the next nightly run time (6 PM PT on a weekday) that is at least 1 minute in the future. */
export function getNextNightlyPt(now = new Date()): Date | undefined {
  const dateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' });
  for (let i = 0; i < 7; i++) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() + i);
    const dateStr = dateFmt.format(d);
    const dayOfWeek = getPtDayOfWeek(dateStr);
    if (dayOfWeek === 0 || dayOfWeek === 6) continue;
    const candidate = toDateTimePt(dateStr, 18, 0);
    if (candidate && candidate.getTime() > now.getTime() + 60 * 1000) return candidate;
  }
  return undefined;
}

/** Build a tooltip showing the last run, next PDR window, and next nightly run. */
export function getRunScheduleTooltip(
  lastRunAt: string | Date | null | undefined,
  lastRunType: string | null | undefined,
  now = new Date()
): string {
  const lines: string[] = [];

  if (lastRunAt) {
    const time = formatTimestampPT(lastRunAt);
    const type = (lastRunType ?? 'nightly').toLowerCase();
    lines.push(`Last run: ${time} (${type})`);
  }

  const nextPdr = getNextPdrWindowPt(now);
  if (nextPdr) lines.push(`Next PDR: ${formatTimestampPT(nextPdr)}`);

  const nextNightly = getNextNightlyPt(now);
  if (nextNightly) lines.push(`Next nightly: ${formatTimestampPT(nextNightly)}`);

  return lines.join('\n') || 'No scheduled runs';
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
export function getScheduleDescription(cron = ST_SCHEDULE_CRON): string {
  if (!cron) return 'Not scheduled';

  // Known Savant Trader schedules: 1 AM UTC Tue-Sat == 6 PM PT Mon-Fri (PDT).
  if (cron === '0 1 * * 2-6') return '6 PM PT, Monday-Friday';

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
  else if (dayOfWeek === '1-5' || dayOfWeek === '2-6') days = 'Monday-Friday';
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

/** Build the cache key for a symbol's signal history given an optional run ID. */
export function getCacheKey(symbol: string, runId: string | null): string {
  return runId ? `${symbol}::${runId}` : symbol;
}

/** True if a profile's stored direction matches the filter direction. */
function profileDirectionMatches(
  direction: string | null | undefined,
  filterDirection: SignalDirection
): boolean {
  return filterDirection === SignalDirection.ALL || direction === filterDirection;
}

/** Compute header counts from a profile list already filtered by profileMatchesSignalFilter. */
export function computeProfileCounts(
  profiles: StSymbolProfile[],
  filter: SignalFilter
): { total: number; weekly: number; daily: number; long: number; short: number } {
  const counts = { total: profiles.length, weekly: 0, daily: 0, long: 0, short: 0 };

  for (const p of profiles) {
    const wDir = p.lastWeeklySignalDirection;
    const dDir = p.lastDailySignalDirection;

    if (filter.timeframe !== SignalTimeframe.DAILY && profileDirectionMatches(wDir, filter.direction)) {
      counts.weekly++;
    }
    if (filter.timeframe !== SignalTimeframe.WEEKLY && profileDirectionMatches(dDir, filter.direction)) {
      counts.daily++;
    }

    if (filter.timeframe === SignalTimeframe.WEEKLY) {
      if (wDir === SignalDirection.LONG) counts.long++;
      if (wDir === SignalDirection.SHORT) counts.short++;
    } else if (filter.timeframe === SignalTimeframe.DAILY) {
      if (dDir === SignalDirection.LONG) counts.long++;
      if (dDir === SignalDirection.SHORT) counts.short++;
    } else {
      if (wDir === SignalDirection.LONG || dDir === SignalDirection.LONG) counts.long++;
      if (wDir === SignalDirection.SHORT || dDir === SignalDirection.SHORT) counts.short++;
    }
  }

  return counts;
}

/** Input shape for building the list of candidate profiles before signal/list filtering. */
export interface BuildFilteredCandidatesInput {
  signalSymbols: StSymbolProfile[];
  allSymbols: StSymbolProfile[];
  showAll: boolean;
  symbolLists: Record<string, string[]>;
  activeListFilter: string | 'ALL';
}

/**
 * Build the candidate profile list for the grouped review.
 * Returns signal symbols plus optional non-signal symbols, filtered by the active list filter.
 * Pure function: no store access.
 */
export function buildFilteredCandidates(input: BuildFilteredCandidatesInput): StSymbolProfile[] {
  const { signalSymbols, allSymbols, showAll, symbolLists, activeListFilter } = input;
  const signalSet = new Set(signalSymbols.map((s) => s.symbol));
  const candidates = [
    ...signalSymbols,
    ...(showAll ? allSymbols.filter((p) => !signalSet.has(p.symbol)) : []),
  ];
  return candidates.filter((p) => shouldShowInListFilter(p.symbol, symbolLists, activeListFilter));
}

/** Input shape for building a grouped view â€” kept generic so it can be computed from store state. */
export interface BuildSymbolGroupsInput {
  signalSymbols: StSymbolProfile[];
  allSymbols: StSymbolProfile[];
  showAll: boolean;
  dimension: GroupDimension;
  symbolLists: Record<string, string[]>;
  activeListFilter: string | 'ALL';
  statuses: Record<string, ReviewDecision>;
  historyCache: Record<string, StSignalItem[]>;
  historyLoading: Record<string, boolean>;
  activeRunId: string | null;
  signalFilter: SignalFilter;
}

/**
 * Build the grouped view used by the grouped review page.
 * Pure function: no store access, just transforms the supplied state into groups.
 */
export function buildSymbolGroups(input: BuildSymbolGroupsInput): SymbolGroup[] {
  const {
    signalSymbols,
    allSymbols,
    showAll,
    dimension,
    symbolLists,
    activeListFilter,
    statuses,
    historyCache,
    historyLoading,
    activeRunId,
    signalFilter,
  } = input;

  const signalSet = new Set(signalSymbols.map((s) => s.symbol));

  const candidates = buildFilteredCandidates({
    signalSymbols,
    allSymbols,
    showAll,
    symbolLists,
    activeListFilter,
  });

  const groupMap = new Map<string, Array<{ profile: StSymbolProfile; hasSignal: boolean }>>();
  for (const profile of candidates) {
    const hasSignal = signalSet.has(profile.symbol);
    if (!showAll && !hasSignal) continue;

    const key = getGroupKey(profile, dimension);
    const cacheKey = getCacheKey(profile.symbol, activeRunId);
    const signals = historyCache[cacheKey];
    if (!symbolMatchesSignalFilter(profile, signals, signalFilter)) continue;

    const existing = groupMap.get(key) ?? [];
    existing.push({ profile, hasSignal });
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

    const rows: SymbolRow[] = sorted.map((item) => {
      const cacheKey = getCacheKey(item.profile.symbol, activeRunId);
      const rawSignals = historyCache[cacheKey];
      const signals = rawSignals ? filterSignals(rawSignals, signalFilter) : undefined;
      return {
        profile: item.profile,
        hasSignal: item.hasSignal,
        signals,
        signalsLoading: historyLoading[cacheKey] ?? false,
        reviewStatus: statuses[item.profile.symbol] ?? ReviewDecision.PENDING,
      };
    });

    const longCount = rows.filter((r) => rowHasDirection(r, SignalDirection.LONG)).length;
    const shortCount = rows.filter((r) => rowHasDirection(r, SignalDirection.SHORT)).length;

    return {
      key,
      rows,
      longCount,
      shortCount,
    };
  });
}
