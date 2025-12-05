import { onRequest } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { db, FieldValue } from './firebase-admin-init';
import { upsertPairSignalsDaily, appendRootPositionTimelineUpdate } from './webhooks/positions-manager';
import { RsDirection, RsPositionOpened, RsPositionClosed, RsPositionStatus, RsSource, PositionState } from './types/signal.types';
import { detectRsEvents } from './webhooks/rs-signals-engine';
import { applyRsEventsForPair, type RsWriteEvent } from './webhooks/rs-events-consumer';
import { rebuildSignalsDailyMirrorImpl } from './rs-signal-history.callables';
import { PAIRS_COLLECTION, SIGNALS_DAILY_COLLECTION, ANALYTICS_COLLECTION, ANALYTICS_SUMMARY_DOC, POSITIONS_COLLECTION, SIGNALS_DAILY_ROOT_COLLECTION, DAYS_SUBCOLLECTION, RsEventKind, type RsSample, type RsThresholds, type RsEvent } from './webhooks/webhooks-config';

interface BackfillPairSummary {
  pair: string;
  opens: number;
  closes: number;
}

interface ArchiveDaySample {
  day: string;
  rsNorm: number;
  rsRaw?: number;
  ac?: number;
  baseAc?: number;
}

interface ResolvePostValuesResult {
  rsNorm?: number;
  rsRaw?: number;
  ac?: number;
  baseAc?: number;
  postKeys: string[];
}

interface ClosePriceSample {
  day: string;
  ac?: number;
}

interface ClosePriceComputation {
  openPx?: number;
  closePx?: number;
  usedFallback: boolean;
}

// Admin-protected HTTP endpoint to backfill canonical RsSignalHistory from POST archive
// Auth: Bearer ADMIN_BACKFILL_TOKEN (env var)
export const backfillSignalsHistory = onRequest({ region: 'us-central1', timeoutSeconds: 540 }, async (req, res) => {
  try {
    const auth = req.headers['authorization'] || req.headers['Authorization'];
    const token = typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.substring(7) : '';
    const expected = process.env.ADMIN_BACKFILL_TOKEN || '';
    if (!expected || token !== expected) {
      res.status(401).json({ ok: false, error: 'unauthorized' });
      return;
    }

    const body = (req.method === 'POST' ? (req.body || {}) : (req.query || {})) as any;
    const fromRaw = String(body.from || '').trim(); // YYYY-MM-DD
    const toRaw = String(body.to || '').trim();     // YYYY-MM-DD
    const dryRun = body.dryRun === true || String(body.dryRun || '').toLowerCase() === 'true';
    const thrOpenLong = Number(body.openLong ?? 0.80);
    const thrCloseLong = Number(body.closeLong ?? 0.80);
    const thrOpenShort = Number(body.openShort ?? 0.20);
    const thrCloseShort = Number(body.closeShort ?? 0.20);
    const verbose = body.verbose === true || String(body.verbose || '').toLowerCase() === 'true';
    const verboseCap = Math.max(1, Math.min(200, Number(body.verboseCap ?? 50)));
    const doMirror = body.mirror === true || String(body.mirror || '').toLowerCase() === 'true';
    const auto = body.auto === true || String(body.auto || '').toLowerCase() === 'true' || (!fromRaw || !toRaw);
    const autoLookbackDays = Math.max(1, Math.min(1825, Number(body.autoLookbackDays ?? 365))); // up to 5 years max

    // Helper formatters
    const fmt = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    const addDays = (d: Date, n: number) => { const x = new Date(d.getTime()); x.setUTCDate(x.getUTCDate() + n); return x; };
    const todayUtcStr = fmt(new Date());

    // Discover most recent mirror day by scanning backward from today (UTC)
    const findMostRecentMirrorDay = async (maxDays: number): Promise<string | undefined> => {
      for (let i = 0; i < maxDays; i++) {
        const d = fmt(addDays(new Date(), -i));
        const snap = await db.collection(SIGNALS_DAILY_ROOT_COLLECTION).doc(d).get();
        if (snap.exists) return d;
      }
      return undefined;
    };

    // Resolve effective range
    let from = fromRaw;
    let to = toRaw;
    if (auto) {
      const mostRecent = await findMostRecentMirrorDay(autoLookbackDays);
      const startDate = mostRecent ? addDays(new Date(mostRecent + 'T00:00:00Z'), 1) : addDays(new Date(), -30);
      from = fmt(startDate);
      to = todayUtcStr;
      logger.info('auto-resolved backfill range', { mode: 'auto', mostRecentMirrorDay: mostRecent || null, from, to, autoLookbackDays });
    }
    if (!from || !to) {
      res.status(400).json({ ok: false, error: 'missing from/to (YYYY-MM-DD) and auto resolution failed' });
      return;
    }

    // Resolve pairs list: explicit pairs param (if provided) takes precedence over pair-registry.
    let registryPairs: string[] = [];
    const pairsArg = (body.pairs ?? body.pair ?? body.pairId) as any;
    if (Array.isArray(pairsArg)) {
      registryPairs = pairsArg
        .map((p: any) => String(p || '').trim())
        .filter(Boolean)
        .sort();
      if (verbose) logger.info('using explicit pairs list', { event: 'pairsParam', count: registryPairs.length, pairs: registryPairs });
    } else if (typeof pairsArg === 'string' && pairsArg.trim().length > 0) {
      registryPairs = pairsArg
        .split(',')
        .map((p: string) => p.trim())
        .filter(Boolean)
        .sort();
      if (verbose) logger.info('using explicit pairs string', { event: 'pairsParam', count: registryPairs.length, pairs: registryPairs });
    }

    // Fallback to pair-registry when no explicit pairs were provided
    if (registryPairs.length === 0) {
      const regSnap = await db.collection('pair-registry').get();
      registryPairs = regSnap.docs
        .map(d => String(d.id))
        .sort();
      if (verbose) logger.info('using pair-registry pairs', { event: 'pairRegistry', count: registryPairs.length });
    }

    const resSummary: BackfillPairSummary[] = [];
    const daysTouched = new Set<string>();

    for (const pair of registryPairs) {
      const [base, sym] = pair.split('-', 2);
      // Load archive rows for range (POST-only); each archive-{YYYY} holds docs keyed by YYMMDD with fields including { day, post.{rsNorm, rsRaw, ac?, baseAc?}, pre? }
      const allDays: ArchiveDaySample[] = [];
      const fromYear = Number(from.substring(0, 4));
      const toYear = Number(to.substring(0, 4));
      for (let y = fromYear; y <= toYear; y++) {
        const colRef = db.collection(PAIRS_COLLECTION).doc(pair).collection(`archive-${y}`);
        const q = await colRef.where('day', '>=', `${y}-${String(from.substring(5,7))}`).get().catch(async () => await colRef.get());
        for (const d of q.docs) {
          const raw = d.data() as any;
          const day = String(raw?.day || '').trim();
          if (!day || day < from || day > to) continue;
          if (verbose) {
            // Surface the exact archive path and whether post exists as soon as the document is read
            logger.info('archive doc read', {
              event: 'archiveRead',
              pair,
              year: y,
              collection: `archive-${y}`,
              docId: d.id,
              day,
              hasPost: !!raw?.post,
            });
          }
          const { rsNorm, rsRaw, ac, baseAc } = resolvePostValues(raw, verbose, pair, day, logger);
          if (verbose) {
            if (ac == null || baseAc == null) {
              logger.info('price source missing for day', { event: 'priceSource', phase: 'collect', pair, day, ac, baseAc });
            } else {
              logger.info('price source collected for day', { event: 'priceSource', phase: 'collect', pair, day, ac, baseAc });
            }
          }
          if (Number.isFinite(rsNorm)) allDays.push({ day, rsNorm: Number(rsNorm), rsRaw, ac, baseAc });
        }
      }

      // Sort ascending by day
      allDays.sort((a, b) => a.day.localeCompare(b.day));

      let state: PositionState = PositionState.FLAT;
      let opened: RsPositionOpened | undefined;
      let direction: RsDirection | undefined;
      let opens = 0, closes = 0;
      let openLogs = 0, closeLogs = 0, holdLogs = 0;

      const writes: FirebaseFirestore.WriteBatch[] = [];
      let batch = db.batch();
      let opsInBatch = 0;

      const dow = (d: Date) => ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getUTCDay()];

      const commitIfNeeded = async () => {
        if (opsInBatch >= 400) {
          writes.push(batch);
          batch = db.batch();
          opsInBatch = 0;
        }
      };
      // Precompute RS events for the full series so OPEN/CLOSE state can carry across days
      const thresholds: RsThresholds = {
        openLong: thrOpenLong,
        closeLong: thrCloseLong,
        openShort: thrOpenShort,
        closeShort: thrCloseShort,
      };

      const samples: RsSample[] = allDays.map((d) => ({
        day: d.day,
        rsNorm: d.rsNorm,
        rsRaw: Number(d.rsRaw ?? d.rsNorm),
      }));

      const allEvents: RsEvent[] = detectRsEvents(samples, thresholds);
      const eventsByDay = new Map<string, RsEvent[]>();
      for (const ev of allEvents) {
        const list = eventsByDay.get(ev.day) ?? [];
        list.push(ev);
        eventsByDay.set(ev.day, list);
      }

      for (let i = 1; i < allDays.length; i++) {
        const y = allDays[i-1];
        const t = allDays[i];

        const todaysEvents = eventsByDay.get(t.day) ?? [];
        const crossedOpenLong = todaysEvents.some((e) => e.kind === RsEventKind.OPEN && e.direction === RsDirection.LONG);
        const crossedOpenShort = todaysEvents.some((e) => e.kind === RsEventKind.OPEN && e.direction === RsDirection.SHORT);
        const crossedCloseLong = todaysEvents.some((e) => e.kind === RsEventKind.CLOSE && e.direction === RsDirection.LONG);
        const crossedCloseShort = todaysEvents.some((e) => e.kind === RsEventKind.CLOSE && e.direction === RsDirection.SHORT);

        // HOLD-FIRST: snapshot state at the start of the day and record hold carryover
        // Prevent a same-day newOpen or a same-day close from also being recorded as a hold.
        const startState = state;
        const startOpened = opened;
        const willCloseToday = (startState === PositionState.LONG && crossedCloseLong)
          || (startState === PositionState.SHORT && crossedCloseShort);
        if (startState !== PositionState.FLAT && startOpened && startOpened.day !== t.day && !willCloseToday) {
          const yr = String(t.day).slice(0, 4);
          const dailyRef = db
            .collection(PAIRS_COLLECTION).doc(pair)
            .collection(SIGNALS_DAILY_COLLECTION).doc(yr)
            .collection(DAYS_SUBCOLLECTION).doc(t.day);
          const pid = `${String(startOpened.day).replace(/-/g,'')}-${dow(new Date(startOpened.t)).toUpperCase()}-${pair}-${String(direction).toUpperCase()}`;
          if (!dryRun) {
            // Add hold; also remove any stale open/close entries for the same position to enforce mutual exclusivity
            const dailyHoldPatch = {
              holds: FieldValue.arrayUnion({ positionId: pid, direction }),
              newOpens: FieldValue.arrayRemove({ positionId: pid, direction }),
              newCloses: FieldValue.arrayRemove({ positionId: pid, direction }),
              updatedAt: FieldValue.serverTimestamp(),
            } as any;
            batch.set(dailyRef, dailyHoldPatch, { merge: true }); opsInBatch++;
            // Mirror per-pair daily to year shard
            try { await upsertPairSignalsDaily(pair, t.day, dailyHoldPatch); } catch {}
            // Append timeline update for open position (root positions timeline)
            try {
              const curPx = Number.isFinite((t as any)?.ac) ? Number((t as any).ac) : undefined;
              if (curPx != null) {
                await appendRootPositionTimelineUpdate({
                  positionId: pid,
                  day: t.day,
                  timestamp: new Date(`${t.day}T00:00:00Z`).getTime(),
                  price: curPx,
                  rs: t.rsRaw,
                  source: 'post',
                });
              }
            } catch {}
          }
          if (verbose && holdLogs < verboseCap) {
            const openPx = Number.isFinite((startOpened as any)?.openPrice) ? Number((startOpened as any).openPrice) : undefined;
            logger.info(`RS HOLD(start) ${direction ?? 'n/a'} pair=${pair} day=${t.day} posId=${pid} open=${openPx ?? 'n/a'}`,
              { event: 'hold', phase: 'start', direction, pair, baseline: base, symbol: sym, positionId: pid, day: t.day, openPrice: openPx, rsYesterday: y.rsNorm, rsToday: t.rsNorm });
            holdLogs++;
          }
          daysTouched.add(t.day);
          await commitIfNeeded();
        }

        // Close first if any
        if (state === PositionState.LONG && crossedCloseLong && opened) {
          const d = new Date(`${t.day}T00:00:00Z`);
          const posId = `${String((opened as any).day).replace(/-/g,'')}-${dow(new Date((opened as any).t)).toUpperCase()}-${pair}-${String(RsDirection.LONG).toUpperCase()}`;
          const { openPx, closePx, usedFallback } = computeClosePrices(opened, { day: t.day, ac: t.ac }, allDays);
          const change = (closePx != null && openPx != null) ? Number(closePx - openPx) : undefined;
          const pctChange = (change != null && openPx != null) ? Number((change / openPx) * 100) : undefined;
          if (verbose) logger.info('CLOSE price (long)', { event: 'closePrice', pair, positionId: posId, day: t.day, openedDay: (opened as any)?.day, usedFallback, openPx, closePx, change, pctChange });
          if (openPx == null || closePx == null) {
            logger.error?.('MISSING PRICES (long close) — aborting', { event: 'priceError', pair, positionId: posId, day: t.day, openPx, closePx });
            throw new Error(`Missing prices for long close ${posId} day=${t.day}: openPx=${openPx} closePx=${closePx}`);
          }
          const closed: Partial<RsPositionClosed> = {
            day: t.day,
            t: d.getTime(),
            source: RsSource.POST,
            rsYesterday: y.rsNorm,
            rsToday: t.rsNorm,
            ...(closePx != null ? { closePrice: closePx } : {}),
            ...(change != null ? { change } : {}),
            ...(pctChange != null ? { pctChange } : {}),
          } as any;
          const yr = String(t.day).slice(0, 4);
          const dailyRef = db
            .collection(PAIRS_COLLECTION).doc(pair)
            .collection(SIGNALS_DAILY_COLLECTION).doc(yr)
            .collection(DAYS_SUBCOLLECTION).doc(t.day);
          if (!dryRun) {
            const openedWithPx = { ...opened, ...(openPx != null ? { openPrice: openPx } : {}) } as Partial<RsPositionOpened>;
            const closedWithPx = { ...closed } as Partial<RsPositionClosed>;
            if (verbose) logger.info('WRITE (close long) openedWithPx/closedWithPx', { event: 'writePositionClose', pair, positionId: posId, openedWithPx, closedWithPx });

            // Canonical close signal + root position close via shared helper
            const closeWrite: RsWriteEvent = {
              kind: 'CLOSE',
              pair,
              baseline: base,
              symbol: sym,
              day: t.day,
              timestamp: d.getTime(),
              direction: RsDirection.LONG,
              rsYesterday: y.rsNorm,
              rsToday: t.rsNorm,
              price: closePx!,
              positionId: posId,
            };
            try { await applyRsEventsForPair([closeWrite]); } catch {}

            // Add close; also remove any stale hold/open entries for the same position to enforce mutual exclusivity
            const dailyClosePatchLong = {
              newCloses: FieldValue.arrayUnion({ positionId: posId, direction: RsDirection.LONG }),
              holds: FieldValue.arrayRemove({ positionId: posId, direction: RsDirection.LONG }),
              newOpens: FieldValue.arrayRemove({ positionId: posId, direction: RsDirection.LONG }),
              updatedAt: FieldValue.serverTimestamp(),
            } as any;
            batch.set(dailyRef, dailyClosePatchLong, { merge: true }); opsInBatch++;
            // Mirror per-pair daily to year shard
            try { await upsertPairSignalsDaily(pair, t.day, dailyClosePatchLong); } catch {}
            // Close root position timeline and update analytics summary (no legacy flat mirror)
            try {

              const netPnL = change ?? 0;
              const percentReturn = pctChange ?? 0;

              try {
                const summaryRef = db.collection(ANALYTICS_COLLECTION).doc(ANALYTICS_SUMMARY_DOC);
                await summaryRef.set({
                  totalNetPnL: FieldValue.increment(netPnL || 0),
                  totalTrades: FieldValue.increment(1),
                  totalWinningTrades: FieldValue.increment((netPnL || 0) > 0 ? 1 : 0),
                  totalLosingTrades: FieldValue.increment((netPnL || 0) <= 0 ? 1 : 0),
                  lastUpdated: FieldValue.serverTimestamp(),
                }, { merge: true });
                logger.info('summary increments applied (long)', { positionId: posId, netPnL, percentReturn });
                try {
                  const snap = await summaryRef.get();
                  const cur = (snap.exists ? snap.data() : {}) as any;
                  const totalNet = Number(cur?.totalNetPnL || 0);
                  const totalTr = Number(cur?.totalTrades || 0);
                  const avg = totalTr > 0 ? (totalNet / totalTr) : 0;
                  await summaryRef.set({ avgNetPnL: avg }, { merge: true });
                } catch {}
              } catch (e) {
                logger.warn('analytics summary update failed (long)', { positionId: posId, message: (e as any)?.message, stack: (e as any)?.stack });
              }
            } catch (e) {
              logger.warn('position timeline close failed (long)', { positionId: posId, message: (e as any)?.message, stack: (e as any)?.stack });
            }
            if (verbose && closeLogs < verboseCap) {
              logger.info(`RS CLOSE long pair=${pair} day=${t.day} rs=${y.rsNorm.toFixed(3)}→${t.rsNorm.toFixed(3)} open=${openPx ?? 'n/a'} close=${closePx ?? 'n/a'} Δ=${change ?? 'n/a'} (${pctChange ?? 'n/a'}%) posId=${posId}`,
                { event: 'close', direction: 'long', pair, baseline: base, symbol: sym, positionId: posId, day: t.day, openPrice: openPx, closePrice: closePx, change, pctChange, rsYesterday: y.rsNorm, rsToday: t.rsNorm });
              closeLogs++;
            }
          }
          opens += 0; closes += 1;
          state = PositionState.FLAT; opened = undefined; direction = undefined;
          daysTouched.add(t.day);
          await commitIfNeeded();
        }
        if (state === PositionState.SHORT && crossedCloseShort && opened) {
          const d = new Date(`${t.day}T00:00:00Z`);
          const posId = `${String((opened as any).day).replace(/-/g,'')}-${dow(new Date((opened as any).t)).toUpperCase()}-${pair}-${String(RsDirection.SHORT).toUpperCase()}`;
          const { openPx, closePx, usedFallback } = computeClosePrices(opened, { day: t.day, ac: t.ac }, allDays);
          const change = (closePx != null && openPx != null) ? Number(openPx - closePx) : undefined;
          const pctChange = (change != null && openPx != null) ? Number((change / openPx) * 100) : undefined;
          if (verbose) logger.info('CLOSE price (short)', { event: 'closePrice', pair, positionId: posId, day: t.day, openedDay: (opened as any)?.day, usedFallback, openPx, closePx, change, pctChange });
          if (openPx == null || closePx == null) {
            logger.error?.('MISSING PRICES (short close) — aborting', { event: 'priceError', pair, positionId: posId, day: t.day, openPx, closePx });
            throw new Error(`Missing prices for short close ${posId} day=${t.day}: openPx=${openPx} closePx=${closePx}`);
          }
          const closed: Partial<RsPositionClosed> = {
            day: t.day,
            t: d.getTime(),
            source: RsSource.POST,
            rsYesterday: y.rsNorm,
            rsToday: t.rsNorm,
            ...(closePx != null ? { closePrice: closePx } : {}),
            ...(change != null ? { change } : {}),
            ...(pctChange != null ? { pctChange } : {}),
          } as any;
          const yr = String(t.day).slice(0, 4);
          const dailyRef = db
            .collection(PAIRS_COLLECTION).doc(pair)
            .collection(SIGNALS_DAILY_COLLECTION).doc(yr)
            .collection(DAYS_SUBCOLLECTION).doc(t.day);
          if (!dryRun) {
            const openedWithPxS = { ...opened, ...(openPx != null ? { openPrice: openPx } : {}) } as Partial<RsPositionOpened>;
            const closedWithPxS = { ...closed } as Partial<RsPositionClosed>;
            if (verbose) logger.info('WRITE (close short) openedWithPx/closedWithPx', { event: 'writePositionClose', pair, positionId: posId, openedWithPx: openedWithPxS, closedWithPx: closedWithPxS });

            // Canonical close signal + root position close via shared helper
            const closeWriteS: RsWriteEvent = {
              kind: 'CLOSE',
              pair,
              baseline: base,
              symbol: sym,
              day: t.day,
              timestamp: d.getTime(),
              direction: RsDirection.SHORT,
              rsYesterday: y.rsNorm,
              rsToday: t.rsNorm,
              price: closePx!,
              positionId: posId,
            };
            try { await applyRsEventsForPair([closeWriteS]); } catch {}

            // Add close; also remove any stale hold/open entries for the same position to enforce mutual exclusivity
            const dailyClosePatchShort = {
              newCloses: FieldValue.arrayUnion({ positionId: posId, direction: RsDirection.SHORT }),
              holds: FieldValue.arrayRemove({ positionId: posId, direction: RsDirection.SHORT }),
              newOpens: FieldValue.arrayRemove({ positionId: posId, direction: RsDirection.SHORT }),
              updatedAt: FieldValue.serverTimestamp(),
            } as any;
            batch.set(dailyRef, dailyClosePatchShort, { merge: true }); opsInBatch++;
            // Close root position timeline and update analytics summary (no legacy flat doc)
            try {

              const netPnL = change ?? 0;

              try {
                const summaryRef = db.collection(ANALYTICS_COLLECTION).doc(ANALYTICS_SUMMARY_DOC);
                await summaryRef.set({
                  totalNetPnL: FieldValue.increment(netPnL || 0),
                  totalTrades: FieldValue.increment(1),
                  totalWinningTrades: FieldValue.increment((netPnL || 0) > 0 ? 1 : 0),
                  totalLosingTrades: FieldValue.increment((netPnL || 0) <= 0 ? 1 : 0),
                  lastUpdated: FieldValue.serverTimestamp(),
                }, { merge: true });
              } catch (e) {
                logger.warn('analytics summary update failed (short)', { positionId: posId, message: (e as any)?.message, stack: (e as any)?.stack });
              }
            } catch (e) {
              logger.warn('position timeline close failed (short)', { positionId: posId, message: (e as any)?.message, stack: (e as any)?.stack });
            }
            if (verbose && closeLogs < verboseCap) {
              logger.info(`RS CLOSE short pair=${pair} day=${t.day} rs=${y.rsNorm.toFixed(3)}→${t.rsNorm.toFixed(3)} open=${openPx ?? 'n/a'} close=${closePx ?? 'n/a'} Δ=${change ?? 'n/a'} (${pctChange ?? 'n/a'}%) posId=${posId}`,
                { event: 'close', direction: 'short', pair, baseline: base, symbol: sym, positionId: posId, day: t.day, openPrice: openPx, closePrice: closePx, change, pctChange, rsYesterday: y.rsNorm, rsToday: t.rsNorm });
              closeLogs++;
            }
          }
          opens += 0; closes += 1;
          state = PositionState.FLAT; opened = undefined; direction = undefined;
          daysTouched.add(t.day);
          await commitIfNeeded();
        }

        // Open next if flat
        if (state === PositionState.FLAT && crossedOpenLong) {
          const d = new Date(`${t.day}T00:00:00Z`);
          const openPx = Number.isFinite(t.ac) ? Number(t.ac) : undefined;
          const openedPartial: Partial<RsPositionOpened> = {
            day: t.day,
            t: d.getTime(),
            source: RsSource.POST,
            rsYesterday: y.rsNorm,
            rsToday: t.rsNorm,
            ...(Number.isFinite(t.ac) ? { openPrice: Number(t.ac) } : {}),
          };
          if (verbose) logger.info('OPEN price (long)', { event: 'openPrice', pair, day: t.day, rsYesterday: y.rsNorm, rsToday: t.rsNorm, ac: t.ac, openPx });
          const posId = `${t.day.replace(/-/g,'')}-${dow(d).toUpperCase()}-${pair}-${String(RsDirection.LONG).toUpperCase()}`;
          const yr = String(t.day).slice(0, 4);
          const dailyRef = db
            .collection(PAIRS_COLLECTION).doc(pair)
            .collection(SIGNALS_DAILY_COLLECTION).doc(yr)
            .collection(DAYS_SUBCOLLECTION).doc(t.day);
          if (!dryRun) {
            if (!Number.isFinite(openPx) || (openPx as number) <= 0) {
              if (verbose) {
                logger.warn('OPEN skipped due to invalid price (long backfill)', {
                  event: 'openSkip',
                  direction: 'long',
                  pair,
                  day: t.day,
                  ac: t.ac,
                  openPx,
                });
              }
            } else {
            const openedWithPx = { ...openedPartial, ...(openPx != null ? { openPrice: openPx } : {}) } as Partial<RsPositionOpened>;
            if (verbose) logger.info('WRITE (open long) openedWithPx', { event: 'writePositionOpen', pair, positionId: posId, openedWithPx });

            // Canonical per-pair signal open + root position open via shared helper
            const openWrite: RsWriteEvent = {
              kind: 'OPEN',
              pair,
              baseline: base,
              symbol: sym,
              day: t.day,
              timestamp: d.getTime(),
              direction: RsDirection.LONG,
              rsYesterday: y.rsNorm,
              rsToday: t.rsNorm,
              price: openPx!,
              positionId: posId,
            };
            try { await applyRsEventsForPair([openWrite]); } catch (e:any) {
              logger.warn('writePairSignalOpen failed (long backfill)', {
                event: 'openError',
                pair,
                positionId: posId,
                day: t.day,
                message: e?.message,
              });
            }
            // Add open; also remove any stale hold/close entries for the same position to enforce mutual exclusivity
            const dailyOpenPatchLong = {
              newOpens: FieldValue.arrayUnion({ positionId: posId, direction: RsDirection.LONG }),
              holds: FieldValue.arrayRemove({ positionId: posId, direction: RsDirection.LONG }),
              newCloses: FieldValue.arrayRemove({ positionId: posId, direction: RsDirection.LONG }),
              updatedAt: FieldValue.serverTimestamp(),
            } as any;
            batch.set(dailyRef, dailyOpenPatchLong, { merge: true }); opsInBatch++;
            // Mirror per-pair daily to year shard
            try { await upsertPairSignalsDaily(pair, t.day, dailyOpenPatchLong); } catch {}
            if (verbose && openLogs < verboseCap) {
              logger.info(`RS OPEN  long pair=${pair} day=${t.day} rs=${y.rsNorm.toFixed(3)}→${t.rsNorm.toFixed(3)} open=${openPx ?? 'n/a'} posId=${posId}`,
                { event: 'open', direction: RsDirection.LONG, pair, baseline: base, symbol: sym, positionId: posId, day: t.day, openPrice: openPx, rsYesterday: y.rsNorm, rsToday: t.rsNorm });
              openLogs++;
            }
            }
          }
          daysTouched.add(t.day);
          const openedFullLong = openedPartial as RsPositionOpened;
          state = PositionState.LONG; direction = RsDirection.LONG as unknown as RsDirection; opened = openedFullLong; opens += 1;
          await commitIfNeeded();
        }

        if (state === PositionState.FLAT && crossedOpenShort) {
          const d = new Date(`${t.day}T00:00:00Z`);
          const openPx = Number.isFinite(t.ac) ? Number(t.ac) : undefined;
          const openedPartial: Partial<RsPositionOpened> = {
            day: t.day,
            t: d.getTime(),
            source: RsSource.POST,
            rsYesterday: y.rsNorm,
            rsToday: t.rsNorm,
            ...(Number.isFinite(t.ac) ? { openPrice: Number(t.ac) } : {}),
          };
          if (verbose) logger.info('OPEN price (short)', { event: 'openPrice', pair, day: t.day, rsYesterday: y.rsNorm, rsToday: t.rsNorm, ac: t.ac, openPx });
          const posId = `${t.day.replace(/-/g,'')}-${dow(d).toUpperCase()}-${pair}-${String(RsDirection.SHORT).toUpperCase()}`;
          const yr = String(t.day).slice(0, 4);
          const dailyRef = db
            .collection(PAIRS_COLLECTION).doc(pair)
            .collection(SIGNALS_DAILY_COLLECTION).doc(yr)
            .collection(DAYS_SUBCOLLECTION).doc(t.day);
          if (!dryRun) {
            if (!Number.isFinite(openPx) || (openPx as number) <= 0) {
              if (verbose) {
                logger.warn('OPEN skipped due to invalid price (short backfill)', {
                  event: 'openSkip',
                  direction: RsDirection.SHORT,
                  pair,
                  day: t.day,
                  ac: t.ac,
                  openPx,
                });
              }
            } else {
            const openedWithPxS = { ...openedPartial, ...(openPx != null ? { openPrice: openPx } : {}) } as Partial<RsPositionOpened>;
            if (verbose) logger.info('WRITE (open short) openedWithPxS', { event: 'writePositionOpen', pair, positionId: posId, openedWithPx: openedWithPxS });

            // Canonical per-pair signal open + root position open via shared helper
            const openWriteS: RsWriteEvent = {
              kind: 'OPEN',
              pair,
              baseline: base,
              symbol: sym,
              day: t.day,
              timestamp: d.getTime(),
              direction: RsDirection.SHORT,
              rsYesterday: y.rsNorm,
              rsToday: t.rsNorm,
              price: openPx!,
              positionId: posId,
            };
            try { await applyRsEventsForPair([openWriteS]); } catch (e:any) {
              logger.warn('writePairSignalOpen failed (short backfill)', {
                event: 'openError',
                pair,
                positionId: posId,
                day: t.day,
                message: e?.message,
              });
            }
            const dailyOpenPatchShort = {
              newOpens: FieldValue.arrayUnion({ positionId: posId, direction: RsDirection.SHORT }),
              holds: FieldValue.arrayRemove({ positionId: posId, direction: RsDirection.SHORT }),
              newCloses: FieldValue.arrayRemove({ positionId: posId, direction: RsDirection.SHORT }),
              updatedAt: FieldValue.serverTimestamp(),
            } as any;
            batch.set(dailyRef, dailyOpenPatchShort, { merge: true }); opsInBatch++;
            // Mirror per-pair daily to year shard
            try { await upsertPairSignalsDaily(pair, t.day, dailyOpenPatchShort); } catch {}
            if (verbose && openLogs < verboseCap) {
              logger.info(`RS OPEN  short pair=${pair} day=${t.day} rs=${y.rsNorm.toFixed(3)}→${t.rsNorm.toFixed(3)} open=${openPx ?? 'n/a'} posId=${posId}`,
                { event: 'open', direction: RsDirection.SHORT, pair, baseline: base, symbol: sym, positionId: posId, day: t.day, openPrice: openPx, rsYesterday: y.rsNorm, rsToday: t.rsNorm });
              openLogs++;
            }
            }
          }
          daysTouched.add(t.day);
          const openedFullShort = openedPartial as RsPositionOpened;
          state = PositionState.SHORT; direction = RsDirection.SHORT as unknown as RsDirection; opened = openedFullShort; opens += 1;
          await commitIfNeeded();
        }

        // End-of-day hold block removed; holds are recorded at day start based on previous day's state.
      }

      if (!dryRun && opsInBatch > 0) writes.push(batch);
      for (const b of writes) await b.commit();
      resSummary.push({ pair, opens, closes });
      logger.info('backfill pair done', { pair, opens, closes, openLogs, closeLogs, holdLogs });
    }

    // Optionally rebuild mirrors for all touched days
    if (doMirror && daysTouched.size > 0) {
      const days = Array.from(daysTouched).sort();
      logger.info('rebuild mirrors for days', { count: days.length });
      for (const d of days) {
        try {
          const r = await rebuildSignalsDailyMirrorImpl({ day: d });
          const opens = r?.counts?.opens ?? 0;
          const holds = r?.counts?.holds ?? 0;
          const closes = r?.counts?.closes ?? 0;
          logger.info(`RS MIRROR day=${d} opens=${opens} holds=${holds} closes=${closes}`, { event: 'mirror', day: d, counts: r?.counts });
        } catch (e: any) {
          logger.error('mirror rebuild failed', { day: d, message: e?.message });
        }
      }
    }

    res.status(200).json({ ok: true, from, to, pairs: registryPairs.length, summary: resSummary });
  } catch (e: any) {
    logger.error('backfillSignalsHistory error', { message: e?.message, stack: e?.stack });
    res.status(500).json({ ok: false, error: e?.message });
  }
});

function resolvePostValues(
  raw: any,
  verbose: boolean,
  pair: string,
  day: string,
  logger: any,
): ResolvePostValuesResult {
  const post: any = raw?.post ?? {};
  const rsNorm = Number.isFinite(post?.rsNorm)
    ? Number(post.rsNorm)
    : (Number.isFinite(post?.rs) ? Number(post.rs) : undefined);

  const rsRaw = Number.isFinite(post?.rsRaw)
    ? Number(post.rsRaw)
    : undefined;
  const postKeys = Object.keys(post || {});

  // When verbose, log the shape of raw.post and a tiny preview of values to surface upstream mapping issues.
  if (verbose) {
    try {
      const entries = Object.entries(post || {});
      const sampleObj = Object.fromEntries(entries.slice(0, 10));
      const sample = JSON.stringify(sampleObj).slice(0, 500);
      logger.info('archive post shape', { event: 'postShape', pair, day, postKeys, sample });
      // If common containers exist, preview them specifically
      if (post?.base) {
        const basePreview = JSON.stringify(post.base).slice(0, 500);
        logger.info('archive post.base preview', { event: 'postBase', pair, day, basePreview });
      }
      if (post?.target) {
        const targetPreview = JSON.stringify(post.target).slice(0, 500);
        logger.info('archive post.target preview', { event: 'postTarget', pair, day, targetPreview });
      }
    } catch {}
  }

  // Archive schema (strict): pair price at post.target.price, baseline price at post.base.price
  const PRICE_PATH = 'target.price';
  const BASE_PRICE_PATH = 'base.price';
  // Support nested resolution via dot-paths: e.g., 'target.ac', 'base.close'
  const getByPath = (obj: any, path: string): any => {
    if (!path) return undefined;
    if (!obj) return undefined;
    const parts = path.split('.');
    let cur: any = obj;
    for (const p of parts) {
      if (cur == null) return undefined;
      cur = cur[p];
    }
    return cur;
  };
  const acRaw = getByPath(post, PRICE_PATH);
  const baseAcRaw = getByPath(post, BASE_PRICE_PATH);
  const ac = Number.isFinite(acRaw) ? Number(acRaw) : undefined;
  const baseAc = Number.isFinite(baseAcRaw) ? Number(baseAcRaw) : undefined;

  if (verbose) {
    (global as any)?.logger?.info?.(ac == null || baseAc == null ? 'price source missing for day' : 'price source collected for day', {
      event: 'priceSource', phase: 'collect', pair, day, ac, baseAc, postKeys, pricePath: PRICE_PATH, basePricePath: BASE_PRICE_PATH,
    });
  }

  // STRICT: fail fast if RS fields are missing; include available keys for quick wiring.
  if (!Number.isFinite(rsNorm) || !Number.isFinite(rsRaw)) {
    throw new Error(
      `Missing RS fields in raw.post for ${pair} day=${day}; expected post.rsNorm/post.rs and post.rsRaw. postKeys=${JSON.stringify(postKeys)}`,
    );
  }

  return { rsNorm: Number(rsNorm), rsRaw: Number(rsRaw), ac, baseAc, postKeys };
}

function computeClosePrices(
  opened: Partial<RsPositionOpened> | undefined,
  t: ClosePriceSample,
  _allDays: ClosePriceSample[],
): ClosePriceComputation {
  // STRICT: No fallback. Only use captured opened.openPrice and today's t.ac
  const openPx = Number.isFinite((opened as any)?.openPrice) ? Number((opened as any).openPrice) : undefined;
  const closePx = Number.isFinite(t.ac) ? Number(t.ac) : undefined;
  return { openPx, closePx, usedFallback: false };
}

// Admin utility: backfill missing status on existing positions/* by inferring from exit fields
export const backfillPositionsStatus = onRequest({ region: 'us-central1', timeoutSeconds: 540 }, async (req, res) => {
  try {
    const auth = req.headers['authorization'] || req.headers['Authorization'];
    const token = typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.substring(7) : '';
    const expected = process.env.ADMIN_BACKFILL_TOKEN || '';
    if (!expected || token !== expected) {
      res.status(401).json({ ok: false, error: 'unauthorized' });
      return;
    }

    const dryRun = String((req.method === 'POST' ? (req.body?.dryRun) : (req.query?.dryRun)) || '').toLowerCase() === 'true';
    const limit = Math.max(1, Math.min(5000, Number((req.method === 'POST' ? (req.body?.limit) : (req.query?.limit)) || 1000)));

    const snap = await db.collection(POSITIONS_COLLECTION).limit(limit).get();
    let scanned = 0, updated = 0, skipped = 0;
    for (const d of snap.docs) {
      scanned++;
      const v = d.data() as any;
      // Skip if status already present
      if (v && (v.status !== undefined)) { skipped++; continue; }
      const hasExit = v?.exitTimestamp != null || !!v?.exitDay || !!v?.exitIso || v?.exitPrice != null;
      const status = hasExit ? RsPositionStatus.CLOSED : RsPositionStatus.OPEN;
      if (dryRun) { continue; }
      await d.ref.set({ status, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      updated++;
    }

    res.json({ ok: true, scanned, updated, skipped, dryRun, limit });
  } catch (e: any) {
    logger.error('backfillPositionsStatus error', { message: e?.message, stack: e?.stack });
    res.status(500).json({ ok: false, error: e?.message });
  }
});

// Admin utility: backfill/normalize positionId on existing positions/* and remove legacy tradeId
export const backfillPositionsIds = onRequest({ region: 'us-central1', timeoutSeconds: 540 }, async (req, res) => {
  try {
    const auth = req.headers['authorization'] || req.headers['Authorization'];
    const token = typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.substring(7) : '';
    const expected = process.env.ADMIN_BACKFILL_TOKEN || '';
    if (!expected || token !== expected) {
      res.status(401).json({ ok: false, error: 'unauthorized' });
      return;
    }

    const dryRun = String((req.method === 'POST' ? (req.body?.dryRun) : (req.query?.dryRun)) || '').toLowerCase() === 'true';
    const limit = Math.max(1, Math.min(5000, Number((req.method === 'POST' ? (req.body?.limit) : (req.query?.limit)) || 2000)));

    const snap = await db.collection(POSITIONS_COLLECTION).limit(limit).get();
    let scanned = 0, updated = 0, skipped = 0;
    for (const doc of snap.docs) {
      scanned++;
      const val = doc.data() as any;
      const currentPid = val?.positionId as string | undefined;
      const legacyTid = val?.tradeId as string | undefined;
      const desiredPid = currentPid || legacyTid || doc.id;

      // If already normalized and no legacy field present, skip
      const hasLegacy = legacyTid !== undefined;
      if (desiredPid === currentPid && !hasLegacy) { skipped++; continue; }

      if (dryRun) { updated++; continue; }

      const patch: any = { updatedAt: FieldValue.serverTimestamp() };
      if (!currentPid) patch.positionId = desiredPid;
      patch.tradeId = FieldValue.delete();
      await doc.ref.set(patch, { merge: true });
      updated++;
    }

    res.json({ ok: true, scanned, updated, skipped, dryRun, limit });
  } catch (e: any) {
    logger.error('backfillPositionsIds error', { message: e?.message, stack: e?.stack });
    res.status(500).json({ ok: false, error: e?.message });
  }
});

