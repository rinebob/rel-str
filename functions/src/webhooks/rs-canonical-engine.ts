import {
  type RsSample,
  type RsThresholds,
  RsEventKind,
  PAIRS_COLLECTION,
  ARCHIVE_COLLECTION_PREFIX,
  WEEKLY_ARCHIVE_COLLECTION_PREFIX,
  MONTHLY_ARCHIVE_COLLECTION_PREFIX,
  DISABLE_SIGNALS_ACTIVITY_POSITIONS,
} from './webhooks-config';
import { db } from '../firebase-admin-init';
import { detectRsEvents } from './rs-signals-engine';
import type { PhaseSeriesPoint } from './webhooks-config';
import type { ActivityEvent } from '../types/signal.types';
import { Interval, RsDirection } from '../types/signal.types';
import type { RsWriteEvent } from './rs-events-consumer';
import {
  buildOpenWriteEvent,
  buildCloseWriteEvent,
} from './rs-write-events';
import { buildPositionId } from './id-utils';
import { generateActivityFromWrites } from './activity-from-writes';

export interface PhaseSeriesPointWithMetrics extends PhaseSeriesPoint {
  rsRaw?: number;
}

export interface IntervalSeriesContext {
  daily: PhaseSeriesPointWithMetrics[];
  weekly?: PhaseSeriesPointWithMetrics[];
  monthly?: PhaseSeriesPointWithMetrics[];
}

export interface CanonicalEngineThresholds {
  daily: RsThresholds;
  weekly: RsThresholds;
  monthly: RsThresholds;
}

export interface CanonicalEngineResult {
  writes: RsWriteEvent[];
  activity: ActivityEvent[];
}

type PositionState = 'FLAT' | 'LONG' | 'SHORT';

function scanThresholdCrossings(samples: RsSample[], thresholds: RsThresholds) {
  const { openLong, closeLong, openShort, closeShort } = thresholds;
  const events: Array<{ day: string; kind: string; y: number; t: number }> = [];

  for (let i = 1; i < samples.length; i++) {
    const y = samples[i - 1];
    const t = samples[i];
    const rsY = y.rsRaw;
    const rsT = t.rsRaw;

    const crossedOpenLong = rsY < openLong && rsT >= openLong;
    const crossedCloseLong = rsY >= closeLong && rsT < closeLong;
    const crossedOpenShort = rsY > openShort && rsT <= openShort;
    const crossedCloseShort = rsY <= closeShort && rsT > closeShort;

    if (crossedOpenLong) events.push({ day: t.day, kind: 'OPEN_LONG', y: rsY, t: rsT });
    if (crossedCloseLong) events.push({ day: t.day, kind: 'CLOSE_LONG', y: rsY, t: rsT });
    if (crossedOpenShort) events.push({ day: t.day, kind: 'OPEN_SHORT', y: rsY, t: rsT });
    if (crossedCloseShort) events.push({ day: t.day, kind: 'CLOSE_SHORT', y: rsY, t: rsT });
  }

  return events;
}

async function loadDailyRsSamplesFromArchive(
  pairId: string,
  fromDay: string,
  toDay: string,
): Promise<RsSample[]> {
  const out: RsSample[] = [];
  const pairRef = db.collection(PAIRS_COLLECTION).doc(pairId);

  const fromYear = Number(fromDay.slice(0, 4));
  const toYear = Number(toDay.slice(0, 4));

  for (let y = fromYear; y <= toYear; y++) {
    const col = `${ARCHIVE_COLLECTION_PREFIX}${y}`;
    const snap = await pairRef
      .collection(col)
      .where('day', '>=', fromDay)
      .where('day', '<=', toDay)
      .get();

    for (const doc of snap.docs) {
      const d = doc.data() as any;
      const day = String(d.day || '').slice(0, 10);
      const post = d.post as any;
      if (!day || !post) continue;

      const rsRaw = Number(post.rsRaw);
      const rsNorm = Number(post.rsNorm);
      if (!Number.isFinite(rsRaw) || !Number.isFinite(rsNorm)) continue;

      out.push({
        day,
        rsNorm,
        rsRaw,
      });
    }
  }

  out.sort((a, b) => a.day.localeCompare(b.day));
  return out;
}

async function loadIntervalRsSamplesFromArchive(
  pairId: string,
  fromDay: string,
  toDay: string,
  archivePrefix: string,
): Promise<RsSample[]> {
  const out: RsSample[] = [];
  const pairRef = db.collection(PAIRS_COLLECTION).doc(pairId);

  const fromYear = Number(fromDay.slice(0, 4));
  const toYear = Number(toDay.slice(0, 4));

  for (let y = fromYear; y <= toYear; y++) {
    const col = `${archivePrefix}${y}`;
    const snap = await pairRef
      .collection(col)
      .where('day', '>=', fromDay)
      .where('day', '<=', toDay)
      .get();

    for (const doc of snap.docs) {
      const d = doc.data() as any;
      const day = String(d.day || '').slice(0, 10);
      const post = d.post as any;
      if (!day || !post) continue;

      const rsRaw = Number(post.rsRaw);
      if (!Number.isFinite(rsRaw)) continue;

      const rsNorm = Number(post.rsNorm);
      if (!Number.isFinite(rsNorm)) continue;

      out.push({
        day,
        rsNorm,
        rsRaw,
      });
    }
  }

  out.sort((a, b) => a.day.localeCompare(b.day));
  return out;
}

export async function runCanonicalRsEngineForPair(
  pairId: string,
  baseline: string,
  symbol: string,
  logger: any,
  series: IntervalSeriesContext,
  thresholds: CanonicalEngineThresholds,
): Promise<CanonicalEngineResult> {
  if (DISABLE_SIGNALS_ACTIVITY_POSITIONS) {
    logger.info('runCanonicalRsEngineForPair_disabled', { pairId });
    return { writes: [], activity: [] };
  }

  const writes: RsWriteEvent[] = [];
  const activity: ActivityEvent[] = [];

  const [baseFromId, targetFromId] = pairId.split('-', 2);
  const base = baseFromId || baseline;
  const sym = targetFromId || symbol;

  // DAILY canonical (archive-derived RS series). Activity is derived later
  // from the canonical writes and RS samples, not from a separate pathway.
  let dailySamples: RsSample[] = [];
  let weeklySamples: RsSample[] = [];
  let monthlySamples: RsSample[] = [];
  if (series.daily && series.daily.length > 0) {
    const firstDay = String(series.daily[0].day || '').slice(0, 10);
    const lastDay = String(series.daily[series.daily.length - 1].day || '').slice(0, 10);
    if (firstDay && lastDay) {
      try {
        dailySamples = await loadDailyRsSamplesFromArchive(pairId, firstDay, lastDay);
      } catch (e: any) {
        logger.warn('canonical_engine_load_archive_failed', { pairId, firstDay, lastDay, message: e?.message });
      }
    }
  }
  if (dailySamples.length >= 2) {
    const crossings = scanThresholdCrossings(dailySamples, thresholds.daily);
    if (crossings.length > 0) {
      const first = crossings[0];
      const last = crossings[crossings.length - 1];
      logger.info('canonical_rs_threshold_crossings', {
        pairId,
        total: crossings.length,
        first,
        last,
      });
    } else {
      logger.info('canonical_rs_threshold_crossings_none', {
        pairId,
        samples: dailySamples.length,
        minRs: Math.min(...dailySamples.map((s) => s.rsRaw)),
        maxRs: Math.max(...dailySamples.map((s) => s.rsRaw)),
        thresholds: thresholds.daily,
      });
    }

    const dailyEvents = detectRsEvents(dailySamples, thresholds.daily);

    // Group events by day for deterministic daily processing of canonical
    // OPEN/CLOSE writes. Activity events will be computed later directly
    // from these writes so there is a single source of truth.
    const dailyEventsByDay = new Map<string, typeof dailyEvents>();
    for (const ev of dailyEvents) {
      const keyDay = ev.day;
      const list = dailyEventsByDay.get(keyDay) ?? [];
      list.push(ev);
      dailyEventsByDay.set(keyDay, list);
    }

    // In-memory DAILY position state (for canonical writes only, one
    // position per pair/interval in this engine). Activity does not depend
    // on this state directly.
    let dailyPositionState: PositionState = 'FLAT';
    let dailyPositionId: string | undefined;

    // Walk archive-derived daily samples in order and apply the canonical
    // state machine: closes → opens → holds.
    for (const s of dailySamples) {
      const rsRaw = s.rsRaw;
      if (!Number.isFinite(rsRaw)) continue;
      const day = s.day;

      const todaysEvents = dailyEventsByDay.get(day) ?? [];
      const ts = new Date(`${day}T00:00:00Z`).getTime();
      const interval = Interval.DAILY as Interval;

      const idx = dailySamples.findIndex((sample) => sample.day === day);
      const prev = idx > 0 ? dailySamples[idx - 1] : undefined;

      const latestPoint = series.daily.find(
        (p) => String(p.day).slice(0, 10) === day,
      );
      const price = Number((latestPoint as any)?.targetClose);

      // 1) Closes: if a matching open position exists, close it.
      const closeLong = todaysEvents.find((ev) => ev.kind === RsEventKind.CLOSE && ev.direction === RsDirection.LONG);
      const closeShort = todaysEvents.find((ev) => ev.kind === RsEventKind.CLOSE && ev.direction === RsDirection.SHORT);

      if (dailyPositionState === 'LONG' && closeLong && prev && Number.isFinite(price) && price > 0) {
        const rsYesterday = Number(prev.rsRaw);
        const rsToday = Number(rsRaw);
        const rsNormYesterday = Number(prev.rsNorm);
        const rsNormToday = Number(s.rsNorm);
        const common = {
          pair: pairId,
          baseline: base,
          symbol: sym,
          day,
          timestamp: ts,
          direction: RsDirection.LONG,
          rsYesterday,
          rsToday,
          rsNormYesterday,
          rsNormToday,
          price,
          interval,
        };
        if (dailyPositionId) {
          writes.push(
            buildCloseWriteEvent({
              ...common,
              positionId: dailyPositionId,
            }),
          );
        }
        dailyPositionState = 'FLAT';
        dailyPositionId = undefined;
      }

      if (dailyPositionState === 'SHORT' && closeShort && prev && Number.isFinite(price) && price > 0) {
        const rsYesterday = Number(prev.rsRaw);
        const rsToday = Number(rsRaw);
        const rsNormYesterday = Number(prev.rsNorm);
        const rsNormToday = Number(s.rsNorm);
        const common = {
          pair: pairId,
          baseline: base,
          symbol: sym,
          day,
          timestamp: ts,
          direction: RsDirection.SHORT,
          rsYesterday,
          rsToday,
          rsNormYesterday,
          rsNormToday,
          price,
          interval,
        };
        if (dailyPositionId) {
          writes.push(
            buildCloseWriteEvent({
              ...common,
              positionId: dailyPositionId,
            }),
          );
        }
        dailyPositionState = 'FLAT';
        dailyPositionId = undefined;
      }

      // 2) Opens: only when flat after closes.
      const openLong = todaysEvents.find((ev) => ev.kind === RsEventKind.OPEN && ev.direction === RsDirection.LONG);
      const openShort = todaysEvents.find((ev) => ev.kind === RsEventKind.OPEN && ev.direction === RsDirection.SHORT);

      if (dailyPositionState === 'FLAT' && openLong && prev && Number.isFinite(price) && price > 0) {
        const rsYesterday = Number(prev.rsRaw);
        const rsToday = Number(rsRaw);
        const rsNormYesterday = Number(prev.rsNorm);
        const rsNormToday = Number(s.rsNorm);
        const common = {
          pair: pairId,
          baseline: base,
          symbol: sym,
          day,
          timestamp: ts,
          direction: RsDirection.LONG,
          rsYesterday,
          rsToday,
          rsNormYesterday,
          rsNormToday,
          price,
          interval,
        };
        const positionId = buildPositionId(day, ts, pairId, interval, RsDirection.LONG);
        dailyPositionId = positionId;
        dailyPositionState = 'LONG';
        writes.push(
          buildOpenWriteEvent({
            ...common,
            positionId,
          }),
        );
      } else if (dailyPositionState === 'FLAT' && openShort && prev && Number.isFinite(price) && price > 0) {
        const rsYesterday = Number(prev.rsRaw);
        const rsToday = Number(rsRaw);
        const rsNormYesterday = Number(prev.rsNorm);
        const rsNormToday = Number(s.rsNorm);
        const common = {
          pair: pairId,
          baseline: base,
          symbol: sym,
          day,
          timestamp: ts,
          direction: RsDirection.SHORT,
          rsYesterday,
          rsToday,
          rsNormYesterday,
          rsNormToday,
          price,
          interval,
        };
        const positionId = buildPositionId(day, ts, pairId, interval, RsDirection.SHORT);
        dailyPositionId = positionId;
        dailyPositionState = 'SHORT';
        writes.push(
          buildOpenWriteEvent({
            ...common,
            positionId,
          }),
        );
      }

    }
  }

  // WEEKLY canonical signals from archive-weekly
  if (series.weekly && series.weekly.length > 0) {
    const firstWeekDay = String(series.weekly[0].day || '').slice(0, 10);
    const lastWeekDay = String(series.weekly[series.weekly.length - 1].day || '').slice(0, 10);
    if (firstWeekDay && lastWeekDay) {
      try {
        weeklySamples = await loadIntervalRsSamplesFromArchive(
          pairId,
          firstWeekDay,
          lastWeekDay,
          WEEKLY_ARCHIVE_COLLECTION_PREFIX,
        );

        if (weeklySamples.length >= 2) {
          logger.info('canonical_weekly_samples', {
            pairId,
            from: firstWeekDay,
            to: lastWeekDay,
            count: weeklySamples.length,
            head: weeklySamples.slice(0, 3),
            tail: weeklySamples.slice(-3),
          });
          const weeklyEvents = detectRsEvents(weeklySamples, thresholds.weekly);
          const weeklyEventsByDay = new Map<string, typeof weeklyEvents>();
          for (const ev of weeklyEvents) {
            const list = weeklyEventsByDay.get(ev.day) ?? [];
            list.push(ev);
            weeklyEventsByDay.set(ev.day, list);
          }

          const openWeeklyIds: Partial<Record<RsDirection, string>> = {};

          for (const ev of weeklyEvents) {
            if (ev.kind !== RsEventKind.OPEN && ev.kind !== RsEventKind.CLOSE) continue;

            const day = ev.day;
            const direction = ev.direction as RsDirection;

            const idx = weeklySamples.findIndex((s) => s.day === day);
            if (idx <= 0) continue;
            const prev = weeklySamples[idx - 1];
            const cur = weeklySamples[idx];

            const latestPoint = series.weekly.find(
              (p) => String(p.day).slice(0, 10) === day,
            );
            const price = Number((latestPoint as any)?.targetClose);
            if (!Number.isFinite(price) || price <= 0) continue;

            const timestamp = new Date(`${day}T00:00:00Z`).getTime();
            const rsYesterday = Number(prev.rsRaw);
            const rsToday = Number(cur.rsRaw);
            const rsNormYesterday = Number(prev.rsNorm);
            const rsNormToday = Number(cur.rsNorm);

            const interval = Interval.WEEKLY as Interval;
            const common = {
              pair: pairId,
              baseline: base,
              symbol: sym,
              day,
              timestamp,
              direction,
              rsYesterday,
              rsToday,
              rsNormYesterday,
              rsNormToday,
              price,
              interval,
            };

            if (ev.kind === RsEventKind.OPEN) {
              const positionId = buildPositionId(day, timestamp, pairId, interval, direction);
              openWeeklyIds[direction] = positionId;
              writes.push(
                buildOpenWriteEvent({
                  ...common,
                  positionId,
                }),
              );
            } else if (ev.kind === RsEventKind.CLOSE) {
              const positionId = openWeeklyIds[direction];
              if (!positionId) continue;
              openWeeklyIds[direction] = undefined;
              writes.push(
                buildCloseWriteEvent({
                  ...common,
                  positionId,
                }),
              );
            }
          }

        }
      } catch (e: any) {
        logger.warn('canonical_engine_weekly_failed', { pairId, message: e?.message });
      }
    }
  }

  // MONTHLY canonical signals from archive-monthly
  if (series.monthly && series.monthly.length > 0) {
    const firstMonthDay = String(series.monthly[0].day || '').slice(0, 10);
    const lastMonthDay = String(series.monthly[series.monthly.length - 1].day || '').slice(0, 10);
    if (firstMonthDay && lastMonthDay) {
      try {
        monthlySamples = await loadIntervalRsSamplesFromArchive(
          pairId,
          firstMonthDay,
          lastMonthDay,
          MONTHLY_ARCHIVE_COLLECTION_PREFIX,
        );

        if (monthlySamples.length >= 2) {
          logger.info('canonical_monthly_samples', {
            pairId,
            from: firstMonthDay,
            to: lastMonthDay,
            count: monthlySamples.length,
            head: monthlySamples.slice(0, 3),
            tail: monthlySamples.slice(-3),
          });
          // Precompute the last archive sample day per (year,month) so we
          // treat that as the canonical monthly close. This matches the
          // monthly archive series used by the UI instead of requiring the
          // literal calendar month-end.
          const lastSampleByMonth = new Map<string, string>(); // key: YYYY-MM, val: day
          for (const s of monthlySamples) {
            const dt = new Date(`${s.day}T00:00:00Z`);
            const y = dt.getUTCFullYear();
            const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
            const key = `${y}-${m}`;
            lastSampleByMonth.set(key, s.day);
          }

          const monthlyEvents = detectRsEvents(monthlySamples, thresholds.monthly);
          const monthlyEventsByDay = new Map<string, typeof monthlyEvents>();
          for (const ev of monthlyEvents) {
            const list = monthlyEventsByDay.get(ev.day) ?? [];
            list.push(ev);
            monthlyEventsByDay.set(ev.day, list);
          }

          const openMonthlyIds: Partial<Record<RsDirection, string>> = {};

          for (const ev of monthlyEvents) {
            if (ev.kind !== RsEventKind.OPEN && ev.kind !== RsEventKind.CLOSE) continue;

            const day = ev.day;
            const direction = ev.direction as RsDirection;

            const dt = new Date(`${day}T00:00:00Z`);
            const year = dt.getUTCFullYear();
            const month = String(dt.getUTCMonth() + 1).padStart(2, '0');
            const monthKey = `${year}-${month}`;
            const lastDayForMonth = lastSampleByMonth.get(monthKey);
            if (!lastDayForMonth || lastDayForMonth !== day) continue;

            const idx = monthlySamples.findIndex((s) => s.day === day);
            if (idx <= 0) continue;
            const prev = monthlySamples[idx - 1];
            const cur = monthlySamples[idx];

            const latestPoint = series.monthly.find(
              (p) => String(p.day).slice(0, 10) === day,
            );
            const price = Number((latestPoint as any)?.targetClose);
            if (!Number.isFinite(price) || price <= 0) continue;

            const timestamp = new Date(`${day}T00:00:00Z`).getTime();
            const rsYesterday = Number(prev.rsRaw);
            const rsToday = Number(cur.rsRaw);
            const rsNormYesterday = Number(prev.rsNorm);
            const rsNormToday = Number(cur.rsNorm);

            const interval = Interval.MONTHLY as Interval;
            const common = {
              pair: pairId,
              baseline: base,
              symbol: sym,
              day,
              timestamp,
              direction,
              rsYesterday,
              rsToday,
              rsNormYesterday,
              rsNormToday,
              price,
              interval,
            };

            if (ev.kind === RsEventKind.OPEN) {
              const positionId = buildPositionId(day, timestamp, pairId, interval, direction);
              openMonthlyIds[direction] = positionId;
              writes.push(
                buildOpenWriteEvent({
                  ...common,
                  positionId,
                }),
              );
            } else if (ev.kind === RsEventKind.CLOSE) {
              const positionId = openMonthlyIds[direction];
              if (!positionId) continue;
              openMonthlyIds[direction] = undefined;
              writes.push(
                buildCloseWriteEvent({
                  ...common,
                  positionId,
                }),
              );
            }
          }

        }
      } catch (e: any) {
        logger.warn('canonical_engine_monthly_failed', { pairId, message: e?.message });
      }
    }
  }

  // Derive ActivityEvents for all intervals directly from the canonical
  // writes and the RS samples using the shared helper, so backfill and
  // realtime can share the same logic.
  const dailyWrites = writes.filter(
    (w) => (w.interval ?? Interval.DAILY) === Interval.DAILY,
  );
  const weeklyWrites = writes.filter(
    (w) => (w.interval ?? Interval.DAILY) === Interval.WEEKLY,
  );
  const monthlyWrites = writes.filter(
    (w) => (w.interval ?? Interval.DAILY) === Interval.MONTHLY,
  );

  activity.push(
    ...generateActivityFromWrites({
      pairId,
      baseline: base,
      symbol: sym,
      interval: Interval.DAILY,
      samples: dailySamples,
      writes: dailyWrites,
    }),
    ...generateActivityFromWrites({
      pairId,
      baseline: base,
      symbol: sym,
      interval: Interval.WEEKLY,
      samples: weeklySamples,
      writes: weeklyWrites,
    }),
    ...generateActivityFromWrites({
      pairId,
      baseline: base,
      symbol: sym,
      interval: Interval.MONTHLY,
      samples: monthlySamples,
      writes: monthlyWrites,
    }),
  );

  logger.info('runCanonicalRsEngineForPair summary', {
    pairId,
    dailySamples: dailySamples.length,
    writes: writes.length,
    activity: activity.length,
  });

  return { writes, activity };
}
