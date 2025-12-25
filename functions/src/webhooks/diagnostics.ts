import { logger } from 'firebase-functions/v2';
import { onCall, onRequest } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../firebase-admin-init';
import { Interval } from '../types/signal.types';
import { CanonicalCalendarYear, HolidaySet, isEndOfMonthTradingDay, isEndOfWeekTradingDay, loadCanonicalCalendarYear, loadUsHolidaySetForWindow } from './calendar';
import {
  ARCHIVE_COLLECTION_PREFIX,
  APP_COLLECTION,
  MONTHLY_ARCHIVE_COLLECTION_PREFIX,
  PAIRS_COLLECTION,
  SILENCE_ADMIN_INFO,
  WEEKLY_ARCHIVE_COLLECTION_PREFIX,
} from './webhooks-config';
import { listRegisteredPairs } from './registry';

interface IntervalDiagnostics {
  interval: Interval;
  latestArchiveDay?: string | null;
  latestArchiveDocId?: string | null;
  latestFieldDay?: string | null;
  latestFieldHasPre?: boolean;
  latestFieldHasPost?: boolean;
  issues: string[];
  invalidArchiveDocs?: Array<{ year: number; docId: string; day: string; reason: string }>;
}

interface PairDiagnosticsResult {
  pairId: string;
  baseline: string;
  target: string;
  intervals: IntervalDiagnostics[];
}

type DiagnosticsEnv = 'emu' | 'prod';

interface DiagnosticsRunWindow {
  fromDay: string; // YYYY-MM-DD
  toDay: string;   // YYYY-MM-DD
}

function fmtYMD(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function getExpectedWeeklyCloseDay(today: Date): string {
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const dow = d.getUTCDay();
  let delta: number;
  if (dow === 6) {
    // Saturday → previous Friday
    delta = -1;
  } else if (dow === 0) {
    // Sunday → previous Friday
    delta = -2;
  } else if (dow >= 1 && dow <= 4) {
    // Mon–Thu → last completed Friday
    delta = 5 - dow - 7;
  } else {
    // Friday (dow === 5) → today
    delta = 0;
  }
  d.setUTCDate(d.getUTCDate() + delta);
  return fmtYMD(d);
}

function getExpectedMonthlyCloseDay(today: Date): string {
  // Last calendar day of the previous month (approximation of last trading day).
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth();
  const lastOfPrevMonth = new Date(Date.UTC(month === 0 ? year - 1 : year, month === 0 ? 0 : month, 0));
  return fmtYMD(lastOfPrevMonth);
}

function resolveDiagnosticsEnv(raw?: unknown): DiagnosticsEnv {
  const fromReq = typeof raw === 'string' ? raw.toLowerCase() : undefined;
  if (fromReq === 'emu' || fromReq === 'emulator') return 'emu';
  if (fromReq === 'prod' || fromReq === 'production') return 'prod';
  const isEmu = String(process.env.FUNCTIONS_EMULATOR || '').toLowerCase() === 'true';
  return isEmu ? 'emu' : 'prod';
}

function getArchiveCollectionName(interval: Interval, year: number): string {
  const y = String(year);
  if (interval === Interval.DAILY) {
    return `${ARCHIVE_COLLECTION_PREFIX}${y}`;
  }
  if (interval === Interval.WEEKLY) {
    return `${WEEKLY_ARCHIVE_COLLECTION_PREFIX}${y}`;
  }
  return `${MONTHLY_ARCHIVE_COLLECTION_PREFIX}${y}`;
}

function getLatestFieldName(interval: Interval): string {
  if (interval === Interval.DAILY) return 'latestDaily';
  if (interval === Interval.WEEKLY) return 'latestWeekly';
  return 'latestMonthly';
}

async function findLatestArchiveDayForInterval(pairId: string, interval: Interval): Promise<{
  latestArchiveDay?: string;
  latestArchiveDocId?: string;
}> {
  const pairRef = db.collection(PAIRS_COLLECTION).doc(pairId);

  const today = new Date();
  const currentYear = today.getUTCFullYear();
  const START_ARCHIVE_YEAR = 2019;

  let latestArchiveDay: string | undefined;
  let latestArchiveDocId: string | undefined;

  for (let y = currentYear; y >= START_ARCHIVE_YEAR; y--) {
    const colName = getArchiveCollectionName(interval, y);
    const colRef = pairRef.collection(colName);

    // Use an indexed query to fetch only the latest doc for the year.
    const snap = await colRef.orderBy('day', 'desc').limit(1).select('day').get();
    if (snap.empty) {
      continue;
    }

    const doc = snap.docs[0];
    const data = (doc.data() as any) || {};
    const day: string | undefined = typeof data.day === 'string' && data.day.length >= 10
      ? data.day.slice(0, 10)
      : undefined;
    if (!day) {
      continue;
    }

    // Because we iterate from most recent year backwards and orderBy day desc,
    // the first non-empty result is the global latest archive day.
    latestArchiveDay = day;
    latestArchiveDocId = doc.id;
    break;
  }

  return { latestArchiveDay, latestArchiveDocId };
}

function ymdFromShardId(yyMMdd: string, year: number): string {
  const mm = yyMMdd.substring(2, 4);
  const dd = yyMMdd.substring(4, 6);
  return `${year}-${mm}-${dd}`;
}

async function findInvalidArchiveDocsForInterval(
  pairId: string,
  interval: Interval,
  window: DiagnosticsRunWindow,
): Promise<Array<{ year: number; docId: string; day: string; reason: string }>> {
  const pairRef = db.collection(PAIRS_COLLECTION).doc(pairId);
  const results: Array<{ year: number; docId: string; day: string; reason: string }> = [];

  const startYear = Number(String(window.fromDay).slice(0, 4)) || 2019;
  const endYear = Number(String(window.toDay).slice(0, 4)) || startYear;

  let holidaySet: HolidaySet | undefined;
  try {
    holidaySet = await loadUsHolidaySetForWindow(window);
  } catch (e: any) {
    try {
      logger.warn('findInvalidArchiveDocsForInterval_load_holidays_failed', {
        pairId,
        interval,
        window,
        message: e?.message,
      });
    } catch {
      // ignore logging failures
    }
  }

  // Optional canonical calendar context per-year for 2025+ so diagnostics align
  // with writer behavior when validating weekly/monthly archives.
  const canonicalByYear = new Map<number, CanonicalCalendarYear | null>();

  const getCanonicalForYear = async (year: number): Promise<CanonicalCalendarYear | null> => {
    if (canonicalByYear.has(year)) {
      return canonicalByYear.get(year) ?? null;
    }
    if (year < 2025) {
      canonicalByYear.set(year, null);
      return null;
    }
    try {
      const cal = await loadCanonicalCalendarYear(year);
      canonicalByYear.set(year, cal ?? null);
      return cal ?? null;
    } catch (e: any) {
      try {
        logger.warn('findInvalidArchiveDocsForInterval_load_canonical_failed', {
          pairId,
          interval,
          year,
          window,
          message: e?.message,
        });
      } catch {
        // ignore logging failures
      }
      canonicalByYear.set(year, null);
      return null;
    }
  };

  // Pre-compute expected weekly close days. For 2025+ years where canonical
  // calendars are available, we rely solely on weeklyLastTradingDays; for
  // earlier years or when canonical data is unavailable, we fall back to the
  // existing daily/holiday-based heuristic.
  const expectedWeeklyDays = new Set<string>();
  if (interval === Interval.WEEKLY) {
    const weeklyLastTradingDayByWeek = new Map<string, string>(); // 'YYYY-MM-DD(Mon-of-week)' -> 'YYYY-MM-DD'
    for (let y = startYear; y <= endYear; y++) {
      const yearStart = `${y}-01-01`;
      const yearEnd = `${y}-12-31`;
      const lowerBound = window.fromDay > yearStart ? window.fromDay : yearStart;
      const upperBound = window.toDay < yearEnd ? window.toDay : yearEnd;

      if (lowerBound > upperBound) {
        continue;
      }

      const canonical = await getCanonicalForYear(y);
      if (canonical) {
        // Use canonical weeklyLastTradingDays directly for this year.
        for (const [, lastDay] of Object.entries(canonical.weeklyLastTradingDays || {})) {
          if (!lastDay) continue;
          if (lastDay < lowerBound || lastDay > upperBound) continue;
          // Do not require a stored weekly doc for the in-progress week whose
          // last trading day equals the diagnostics toDay.
          if (lastDay >= window.toDay) continue;
          expectedWeeklyDays.add(lastDay);
        }
        continue;
      }

      // Fallback for pre-2025 or when canonical calendar is unavailable: use the
      // pair's own daily archive plus holidays to infer weekly closes.
      const dailyColName = getArchiveCollectionName(Interval.DAILY, y);
      const dailyColRef = pairRef.collection(dailyColName);

      const dailySnap = await dailyColRef
        .where('day', '>=', lowerBound)
        .where('day', '<=', upperBound)
        .select('day')
        .get();

      for (const doc of dailySnap.docs) {
        const raw = (doc.data() as any) || {};
        const day: string | undefined = typeof raw.day === 'string' && raw.day.length >= 10
          ? raw.day.slice(0, 10)
          : undefined;
        if (!day) continue;

        // If holiday calendar failed to load, fall back to the previous
        // heuristic of treating the max daily per week as the close.
        if (!holidaySet) {
          const dt = new Date(`${day}T00:00:00.000Z`);
          const dow = dt.getUTCDay(); // 0=Sun..6=Sat
          const offsetFromMonday = (dow + 6) % 7; // Mon=0
          dt.setUTCDate(dt.getUTCDate() - offsetFromMonday);
          const weekKey = fmtYMD(dt);
          const prev = weeklyLastTradingDayByWeek.get(weekKey);
          if (!prev || day > prev) {
            weeklyLastTradingDayByWeek.set(weekKey, day);
          }
        } else if (isEndOfWeekTradingDay(day, holidaySet)) {
          expectedWeeklyDays.add(day);
        }
      }
    }
    if (!holidaySet) {
      for (const [, lastDay] of weeklyLastTradingDayByWeek.entries()) {
        // Do not require a stored weekly doc for the in-progress week whose last
        // trading day equals the diagnostic toDay.
        if (lastDay >= window.toDay) {
          continue;
        }
        expectedWeeklyDays.add(lastDay);
      }
    }
  }

  // For monthly, we use the pair's own daily archive as the trading calendar
  // to determine the last trading day of each month.
  const monthlyLastTradingDayByMonth = new Map<string, string>(); // 'YYYY-MM' -> 'YYYY-MM-DD'
  const currentMonthKey = window.toDay.slice(0, 7); // YYYY-MM for the (possibly in-progress) current month
  if (interval === Interval.MONTHLY) {
    for (let y = startYear; y <= endYear; y++) {
      const yearStart = `${y}-01-01`;
      const yearEnd = `${y}-12-31`;
      const lowerBound = window.fromDay > yearStart ? window.fromDay : yearStart;
      const upperBound = window.toDay < yearEnd ? window.toDay : yearEnd;

      if (lowerBound > upperBound) {
        continue;
      }

      const canonical = await getCanonicalForYear(y);
      if (canonical) {
        // Use canonical monthlyLastTradingDays directly for this year.
        for (const [monthKey, lastDay] of Object.entries(canonical.monthlyLastTradingDays || {})) {
          if (!lastDay) continue;
          if (lastDay < lowerBound || lastDay > upperBound) continue;
          const key = String(monthKey).slice(0, 7);
          const prev = monthlyLastTradingDayByMonth.get(key);
          if (!prev || lastDay > prev) {
            monthlyLastTradingDayByMonth.set(key, lastDay);
          }
        }
        continue;
      }

      // Fallback for pre-2025 or when canonical calendar is unavailable: use
      // the pair's own daily archive plus holidays to infer month-end days.
      const dailyColName = getArchiveCollectionName(Interval.DAILY, y);
      const dailyColRef = pairRef.collection(dailyColName);

      const dailySnap = await dailyColRef
        .where('day', '>=', lowerBound)
        .where('day', '<=', upperBound)
        .select('day')
        .get();

      for (const doc of dailySnap.docs) {
        const raw = (doc.data() as any) || {};
        const day: string | undefined = typeof raw.day === 'string' && raw.day.length >= 10
          ? raw.day.slice(0, 10)
          : undefined;
        if (!day) continue;

        const monthKey = day.slice(0, 7); // YYYY-MM
        if (!holidaySet) {
          const prev = monthlyLastTradingDayByMonth.get(monthKey);
          if (!prev || day > prev) {
            monthlyLastTradingDayByMonth.set(monthKey, day);
          }
        } else if (isEndOfMonthTradingDay(day, holidaySet)) {
          const prev = monthlyLastTradingDayByMonth.get(monthKey);
          if (!prev || day > prev) {
            monthlyLastTradingDayByMonth.set(monthKey, day);
          }
        }
      }
    }
  }

  const seenValidMonthlyCloseDays = new Set<string>();
  const seenWeeklyCloseDays = new Set<string>();

  for (let y = startYear; y <= endYear; y++) {
    const colName = getArchiveCollectionName(interval, y);
    const colRef = pairRef.collection(colName);

    const yearStart = `${y}-01-01`;
    const yearEnd = `${y}-12-31`;
    const lowerBound = window.fromDay > yearStart ? window.fromDay : yearStart;
    const upperBound = window.toDay < yearEnd ? window.toDay : yearEnd;

    if (lowerBound > upperBound) {
      continue;
    }

    // Restrict query to the diagnostics window for this year to avoid full scans.
    const snap = await colRef
      .where('day', '>=', lowerBound)
      .where('day', '<=', upperBound)
      .get();
    if (snap.empty) continue;

    for (const doc of snap.docs) {
      const raw = (doc.data() as any) || {};
      const day: string = (typeof raw.day === 'string' && raw.day.length >= 10)
        ? raw.day.slice(0, 10)
        : ymdFromShardId(doc.id, y);

      if (!day) continue;
      if (day < window.fromDay || day > window.toDay) continue;

      const isIntervalClose = !!raw.isIntervalClose;
      const dt = new Date(`${day}T00:00:00.000Z`);

      if (interval === Interval.WEEKLY) {
        const dow = dt.getUTCDay();
        const isFriday = dow === 5;

        if (isFriday && isIntervalClose) {
          seenWeeklyCloseDays.add(day);
        }

        const reasonParts: string[] = [];
        if (!isFriday) {
          reasonParts.push('dow_not_friday');
        } else if (!expectedWeeklyDays.has(day)) {
          reasonParts.push('unexpected_weekly_archive_day');
        }
        if (!isIntervalClose) {
          reasonParts.push('interval_close_flag_missing_or_false');
        }

        if (reasonParts.length > 0) {
          results.push({ year: y, docId: doc.id, day, reason: reasonParts.join('|') || 'invalid_weekly_archive_doc' });
        }
      } else if (interval === Interval.MONTHLY) {
        const monthKey = day.slice(0, 7); // YYYY-MM
        const expectedMonthEnd = monthlyLastTradingDayByMonth.get(monthKey);

        // Only consider months strictly before the current month as eligible for a
        // valid stored month-end doc. For the current (in-progress) month, any
        // monthly docs are treated as invalid extras and should not be counted as
        // valid closes.
        if (monthKey < currentMonthKey && expectedMonthEnd && day === expectedMonthEnd && isIntervalClose) {
          seenValidMonthlyCloseDays.add(day);
        }

        const reasonParts: string[] = [];
        if (expectedMonthEnd && day !== expectedMonthEnd) {
          reasonParts.push('not_last_trading_day_of_month');
        }
        if (!isIntervalClose) {
          reasonParts.push('interval_close_flag_missing_or_false');
        }

        if (reasonParts.length > 0) {
          results.push({ year: y, docId: doc.id, day, reason: reasonParts.join('|') || 'invalid_monthly_archive_doc' });
        }
      }
    }
  }

  // After scanning existing docs, add synthetic entries for missing expected closes.
  if (interval === Interval.WEEKLY) {
    for (const day of expectedWeeklyDays) {
      if (!seenWeeklyCloseDays.has(day)) {
        const year = Number(day.slice(0, 4)) || startYear;
        results.push({
          year,
          docId: '(missing)',
          day,
          reason: 'missing_weekly_archive_for_day',
        });
      }
    }
  } else if (interval === Interval.MONTHLY) {
    for (const [monthKey, endDay] of monthlyLastTradingDayByMonth.entries()) {
      // Do not require a stored monthly doc for the current (in-progress) month.
      if (monthKey === currentMonthKey) {
        continue;
      }

      if (!seenValidMonthlyCloseDays.has(endDay)) {
        const year = Number(monthKey.slice(0, 4)) || startYear;
        results.push({
          year,
          docId: '(missing)',
          day: endDay,
          reason: 'missing_monthly_archive_for_month',
        });
      }
    }
  }

  return results;
}

async function diagnosePairArchivesForPair(
  baseline: string,
  target: string,
  intervals: Interval[],
  window: DiagnosticsRunWindow,
): Promise<PairDiagnosticsResult> {
  const pairId = `${baseline}-${target}`;
  const pairRef = db.collection(PAIRS_COLLECTION).doc(pairId);

  const snap = await pairRef.get();
  const rootData = (snap.exists ? (snap.data() as any) : {}) || {};

  const todayYmd = fmtYMD(new Date());
  const today = new Date();
  const expectedWeeklyCloseDay = getExpectedWeeklyCloseDay(today);
  const expectedMonthlyCloseDay = getExpectedMonthlyCloseDay(today);

  const out: IntervalDiagnostics[] = [];

  for (const interval of intervals) {
    const issues: string[] = [];
    const fieldName = getLatestFieldName(interval);
    const latestField = rootData[fieldName];
    const latestFieldDay: string | null = latestField?.day ? String(latestField.day).slice(0, 10) : null;
    const latestFieldHasPre = !!latestField?.pre;
    const latestFieldHasPost = !!latestField?.post;

    const { latestArchiveDay, latestArchiveDocId } = await findLatestArchiveDayForInterval(pairId, interval);

    let invalidArchiveDocs: Array<{ year: number; docId: string; day: string; reason: string }> | undefined;
    if (interval === Interval.WEEKLY || interval === Interval.MONTHLY) {
      invalidArchiveDocs = await findInvalidArchiveDocsForInterval(pairId, interval, window);
      if (invalidArchiveDocs.length > 0) {
        issues.push('invalid_archive_docs_present');
      }
    }

    if (!latestArchiveDay) {
      issues.push('archive_collection_empty_or_no_day_fields');
    }

    if (!latestField) {
      issues.push('latest_field_missing');
    } else {
      if (!latestFieldDay) {
        issues.push('latest_field_missing_day');
      }
      if (!latestFieldHasPre && !latestFieldHasPost) {
        issues.push('latest_field_missing_pre_and_post');
      }

      const branch = latestField.post || latestField.pre;
      if (branch) {
        const base = branch.base || {};
        const targetBranch = branch.target || {};
        const rsNorm = branch.rsNorm;
        const rsRaw = branch.rsRaw;

        if (!Number.isFinite(base.price) || !Number.isFinite(targetBranch.price)) {
          issues.push('latest_field_price_non_finite');
        }
        if (rsNorm !== undefined && !Number.isFinite(rsNorm)) {
          issues.push('latest_field_rsNorm_non_finite');
        }
        if (rsRaw !== undefined && !Number.isFinite(rsRaw)) {
          issues.push('latest_field_rsRaw_non_finite');
        }
      } else {
        issues.push('latest_field_missing_base_target_branch');
      }
    }

    if (interval === Interval.DAILY) {
      if (latestFieldDay && latestFieldDay !== todayYmd) {
        issues.push('latest_daily_not_today');
      }
    } else if (interval === Interval.WEEKLY) {
      if (latestArchiveDay && latestArchiveDay !== expectedWeeklyCloseDay) {
        issues.push('latest_weekly_archive_not_expected_close');
        try {
          logger.info('diagnosePairArchives_weekly_expected_mismatch', {
            pairId,
            latestArchiveDay,
            expectedWeeklyCloseDay,
          });
        } catch {}
      }
    } else if (interval === Interval.MONTHLY) {
      if (latestArchiveDay && latestArchiveDay !== expectedMonthlyCloseDay) {
        issues.push('latest_monthly_archive_not_expected_close');
        try {
          logger.info('diagnosePairArchives_monthly_expected_mismatch', {
            pairId,
            latestArchiveDay,
            expectedMonthlyCloseDay,
          });
        } catch {}
      }
    }

    if (latestArchiveDay && latestFieldDay && latestFieldDay < latestArchiveDay) {
      issues.push('latest_field_day_behind_archive');
    }

    out.push({
      interval,
      latestArchiveDay: latestArchiveDay ?? null,
      latestArchiveDocId: latestArchiveDocId ?? null,
      latestFieldDay,
      latestFieldHasPre,
      latestFieldHasPost,
      issues,
      invalidArchiveDocs,
    });
  }

  const result: PairDiagnosticsResult = {
    pairId,
    baseline,
    target,
    intervals: out,
  };

  try {
    logger.info('diagnosePairArchives_pair', result as any);
  } catch {
    // ignore logging errors
  }

  return result;
}

function normalizeIntervals(raw?: unknown): Interval[] {
  const def = [Interval.DAILY, Interval.WEEKLY, Interval.MONTHLY];
  if (!raw) return def;
  if (!Array.isArray(raw)) return def;
  const out: Interval[] = [];
  for (const v of raw) {
    const s = String(v || '').toUpperCase();
    if (s === Interval.DAILY) out.push(Interval.DAILY);
    else if (s === Interval.WEEKLY) out.push(Interval.WEEKLY);
    else if (s === Interval.MONTHLY) out.push(Interval.MONTHLY);
  }
  return out.length > 0 ? out : def;
}

async function getDiagnosticsRunWindow(
  env: DiagnosticsEnv,
  fromOverride?: string,
  toOverride?: string,
): Promise<DiagnosticsRunWindow> {
  const today = new Date();
  const fmtYMDLocal = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  const todayYmd = fmtYMDLocal(today);

  const explicitTo = toOverride && toOverride.length >= 10 ? toOverride.slice(0, 10) : undefined;
  const explicitFrom = fromOverride && fromOverride.length >= 10 ? fromOverride.slice(0, 10) : undefined;

  if (explicitFrom || explicitTo) {
    return {
      fromDay: explicitFrom || todayYmd,
      toDay: explicitTo || todayYmd,
    };
  }

  const docRef = db.collection(APP_COLLECTION).doc(`pair-diagnostics-${env}`);
  const snap = await docRef.get();
  const data = (snap.exists ? (snap.data() as any) : {}) || {};
  const lastRun = data.lastRun as { fromDay?: string; toDay?: string } | undefined;

  if (!lastRun || !lastRun.toDay) {
    const fromDate = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
    return { fromDay: fmtYMDLocal(fromDate), toDay: todayYmd };
  }

  const prevTo = String(lastRun.toDay).slice(0, 10);
  return { fromDay: prevTo, toDay: todayYmd };
}

async function recordDiagnosticsRunSummary(env: DiagnosticsEnv, window: DiagnosticsRunWindow, intervals: Interval[], pairsCount: number): Promise<void> {
  const docId = `pair-diagnostics-${env}`;
  const docRef = db.collection(APP_COLLECTION).doc(docId);
  const lastRun = {
    fromDay: window.fromDay,
    toDay: window.toDay,
    intervals,
    pairs: pairsCount,
    runAt: FieldValue.serverTimestamp(),
  };

  const runEntry = {
    fromDay: window.fromDay,
    toDay: window.toDay,
    intervals,
    pairs: pairsCount,
    runAtMillis: Date.now(),
  };

  await docRef.set(
    {
      lastRun,
      runs: FieldValue.arrayUnion(runEntry),
    },
    { merge: true },
  );

  try {
    logger.info('diagnosePairArchives_history_written', {
      env,
      docPath: `${APP_COLLECTION}/${docId}`,
      lastRun,
      runEntry,
    });
  } catch {}
}

export const diagnosePairArchives = onCall({ region: 'us-central1', timeoutSeconds: 540 }, async (req: any) => {
  try {
    const env = resolveDiagnosticsEnv(req.data?.env);
    const intervals = normalizeIntervals(req.data?.intervals);
    const pairsRaw = req.data?.pairs;
    const maxPairsRaw = req.data?.maxPairs;
    const fromDayRaw = req.data?.fromDay as string | undefined;
    const toDayRaw = req.data?.toDay as string | undefined;

    let pairs: Array<{ baseline: string; target: string }> = [];

    if (Array.isArray(pairsRaw) && pairsRaw.length > 0) {
      pairs = pairsRaw.map((p: any) => {
        if (typeof p === 'string') {
          const [baseline, target] = String(p).split('-');
          return { baseline: String(baseline || '').toUpperCase(), target: String(target || '').toUpperCase() };
        }
        return {
          baseline: String(p?.baseline || '').toUpperCase(),
          target: String(p?.target || '').toUpperCase(),
        };
      }).filter(p => p.baseline && p.target);
    }

    if (pairs.length === 0) {
      pairs = await listRegisteredPairs();
    }

    let maxPairs: number | undefined;
    if (typeof maxPairsRaw === 'number' && Number.isFinite(maxPairsRaw)) {
      maxPairs = Math.max(0, Math.floor(maxPairsRaw));
    }
    if (maxPairs && maxPairs > 0 && maxPairs < pairs.length) {
      pairs = pairs.slice(0, maxPairs);
    }

    const window = await getDiagnosticsRunWindow(env, fromDayRaw, toDayRaw);

    const totalPairs = pairs.length;
    if (!SILENCE_ADMIN_INFO) {
      logger.info('diagnosePairArchives_start', { env, pairs: totalPairs, intervals, window });
    }

    const results: PairDiagnosticsResult[] = [];
    for (let idx = 0; idx < pairs.length; idx++) {
      const p = pairs[idx];
      try {
        logger.info('diagnosePairArchives_pair_start', {
          env,
          index: idx + 1,
          total: totalPairs,
          pairId: `${p.baseline}-${p.target}`,
        });
      } catch {}
      try {
        const res = await diagnosePairArchivesForPair(p.baseline, p.target, intervals, window);
        results.push(res);
      } catch (e: any) {
        const errRes: PairDiagnosticsResult = {
          pairId: `${p.baseline}-${p.target}`,
          baseline: p.baseline,
          target: p.target,
          intervals: [
            {
              interval: Interval.DAILY,
              latestArchiveDay: null,
              latestArchiveDocId: null,
              latestFieldDay: null,
              latestFieldHasPre: false,
              latestFieldHasPost: false,
              issues: [`diagnostic_failed: ${e?.message || String(e)}`],
            },
          ],
        };
        results.push(errRes);
        logger.warn('diagnosePairArchives_pair_failed', { pairId: `${p.baseline}-${p.target}`, message: e?.message });
      }
    }

    if (!SILENCE_ADMIN_INFO) {
      logger.info('diagnosePairArchives_done', { env, pairs: results.length, window });
    }
    await recordDiagnosticsRunSummary(env, window, intervals, results.length);

    return { ok: true, env, pairs: results.length, window, results };
  } catch (e: any) {
    logger.error('diagnosePairArchives_failed', { message: e?.message });
    return { ok: false, error: e?.message || 'internal_error' };
  }
});

export const diagnosePairArchivesAdmin = onRequest({ region: 'us-central1', timeoutSeconds: 540 }, async (req: any, res: any) => {
  const token = (req.headers['authorization'] || '').toString().replace(/^Bearer\s+/i, '');
  const expected = (process.env.ADMIN_BACKFILL_TOKEN || '').trim();
  if (!expected || token !== expected) {
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return;
  }

  try {
    const envRaw = (req.body?.env ?? req.query.env) as unknown;
    const env = resolveDiagnosticsEnv(envRaw);

    const cleanupRaw = (req.body?.cleanup ?? req.query.cleanup) as any;
    const cleanup: boolean = typeof cleanupRaw === 'string'
      ? cleanupRaw.toLowerCase() === 'true'
      : !!cleanupRaw;

    const intervalsRaw = (req.body?.intervals ?? req.query.intervals) as unknown;
    let intervals: Interval[];
    if (typeof intervalsRaw === 'string') {
      intervals = normalizeIntervals(intervalsRaw.split(','));
    } else {
      intervals = normalizeIntervals(intervalsRaw);
    }

    const pairsRaw = (req.body?.pairs ?? req.query.pairs) as any;
    const maxPairsRaw = (req.body?.maxPairs ?? req.query.maxPairs) as any;
    const fromDayRaw = (req.body?.fromDay ?? req.query.fromDay) as string | undefined;
    const toDayRaw = (req.body?.toDay ?? req.query.toDay) as string | undefined;
    let pairs: Array<{ baseline: string; target: string }> = [];
    if (Array.isArray(pairsRaw) && pairsRaw.length > 0) {
      pairs = pairsRaw.map((p: any) => {
        if (typeof p === 'string') {
          const [baseline, target] = String(p).split('-');
          return { baseline: String(baseline || '').toUpperCase(), target: String(target || '').toUpperCase() };
        }
        return {
          baseline: String(p?.baseline || '').toUpperCase(),
          target: String(p?.target || '').toUpperCase(),
        };
      }).filter(p => p.baseline && p.target);
    }

    if (pairs.length === 0) {
      pairs = await listRegisteredPairs();
    }

    let maxPairs: number | undefined;
    if (typeof maxPairsRaw === 'number' && Number.isFinite(maxPairsRaw)) {
      maxPairs = Math.max(0, Math.floor(maxPairsRaw));
    } else if (typeof maxPairsRaw === 'string' && maxPairsRaw.trim() !== '') {
      const parsed = Number(maxPairsRaw);
      if (Number.isFinite(parsed)) {
        maxPairs = Math.max(0, Math.floor(parsed));
      }
    }

    if (maxPairs && maxPairs > 0 && maxPairs < pairs.length) {
      pairs = pairs.slice(0, maxPairs);
    }

    const window = await getDiagnosticsRunWindow(env, fromDayRaw, toDayRaw);

    const totalPairs = pairs.length;
    if (!SILENCE_ADMIN_INFO) {
      logger.info('diagnosePairArchivesAdmin_start', { env, pairs: totalPairs, intervals, window, cleanup });
    }

    const results: PairDiagnosticsResult[] = [];
    for (let idx = 0; idx < pairs.length; idx++) {
      const p = pairs[idx];
      try {
        logger.info('diagnosePairArchivesAdmin_pair_start', {
          env,
          index: idx + 1,
          total: totalPairs,
          pairId: `${p.baseline}-${p.target}`,
        });
      } catch {}
      try {
        const resOne = await diagnosePairArchivesForPair(p.baseline, p.target, intervals, window);
        results.push(resOne);
      } catch (e: any) {
        const errRes: PairDiagnosticsResult = {
          pairId: `${p.baseline}-${p.target}`,
          baseline: p.baseline,
          target: p.target,
          intervals: [
            {
              interval: Interval.DAILY,
              latestArchiveDay: null,
              latestArchiveDocId: null,
              latestFieldDay: null,
              latestFieldHasPre: false,
              latestFieldHasPost: false,
              issues: [`diagnostic_failed: ${e?.message || String(e)}`],
            },
          ],
        };
        results.push(errRes);
        logger.warn('diagnosePairArchivesAdmin_pair_failed', { pairId: `${p.baseline}-${p.target}`, message: e?.message });
      }
    }

    let deletedDocs = 0;
    let missingMarkers = 0;

    if (cleanup) {
      for (const pairResult of results) {
        const pairId = pairResult.pairId;
        for (const intervalResult of pairResult.intervals) {
          if (intervalResult.interval !== Interval.WEEKLY && intervalResult.interval !== Interval.MONTHLY) {
            continue;
          }
          const invalid = intervalResult.invalidArchiveDocs || [];
          for (const entry of invalid) {
            if (entry.docId === '(missing)') {
              missingMarkers++;
              continue;
            }

            const colName = getArchiveCollectionName(intervalResult.interval, entry.year);
            const docRef = db
              .collection(PAIRS_COLLECTION)
              .doc(pairId)
              .collection(colName)
              .doc(entry.docId);

            await docRef.delete();
            deletedDocs++;

            try {
              logger.info('diagnosePairArchivesAdmin_doc_deleted', {
                env,
                pairId,
                interval: intervalResult.interval,
                colName,
                docId: entry.docId,
                day: entry.day,
                reason: entry.reason,
              });
            } catch {}
          }
        }
      }
    }

    if (!SILENCE_ADMIN_INFO) {
      logger.info('diagnosePairArchivesAdmin_done', { env, pairs: results.length, window, cleanup, deletedDocs, missingMarkers });
    }

    await recordDiagnosticsRunSummary(env, window, intervals, results.length);

    res.status(200).json({ ok: true, env, pairs: results.length, window, results, cleanup, deletedDocs, missingMarkers });
  } catch (e: any) {
    logger.error('diagnosePairArchivesAdmin_failed', { message: e?.message });
    res.status(500).json({ ok: false, error: e?.message || 'internal_error' });
  }
});

