import { onRequest } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { db, FieldValue } from './firebase-admin-init';
import { upsertRootPosition, upsertPairSignalsDaily, writePairSignalOpen, finalizePairSignalClose } from './webhooks/positions-manager';
import { RsDirection, RsPositionOpened, RsPositionClosed, RsPositionStatus, RsDirectionEnum, RsSourceEnum, PositionState } from './types/signal.types';
import { rebuildSignalsDailyMirrorImpl } from './rs-signal-history.callables';
import { PAIRS_COLLECTION, SIGNALS_DAILY_COLLECTION, ANALYTICS_COLLECTION, ANALYTICS_SUMMARY_DOC, POSITIONS_COLLECTION, SIGNALS_DAILY_ROOT_COLLECTION, DAYS_SUBCOLLECTION } from './webhooks/webhooks-config';

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

    // Resolve pairs list exclusively from pair-registry (backend source of truth)
    const regSnap = await db.collection('pair-registry').get();
    const registryPairs = regSnap.docs
      .map(d => String(d.id))
      .sort();
    if (verbose) logger.info('using pair-registry pairs', { event: 'pairRegistry', count: registryPairs.length });

    const resSummary: Array<{ pair: string; opens: number; closes: number }> = [];
    const daysTouched = new Set<string>();

    for (const pair of registryPairs) {
      const [base, sym] = pair.split('-', 2);
      // Load archive rows for range (POST-only); each archive-{YYYY} holds docs keyed by YYMMDD with fields including { day, post.{rs, rsRaw, rsNorm, ac?}, pre? }
      const allDays: Array<{ day: string; rs: number; ac?: number; baseAc?: number }> = [];
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
          const { rs, ac, baseAc } = resolvePostValues(raw, verbose, pair, day, logger);
          if (verbose) {
            if (ac == null || baseAc == null) {
              logger.info('price source missing for day', { event: 'priceSource', phase: 'collect', pair, day, ac, baseAc });
            } else {
              logger.info('price source collected for day', { event: 'priceSource', phase: 'collect', pair, day, ac, baseAc });
            }
          }
          if (Number.isFinite(rs)) allDays.push({ day, rs: Number(rs), ac, baseAc });
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

      for (let i = 1; i < allDays.length; i++) {
        const y = allDays[i-1];
        const t = allDays[i];
        // Crossing detection using POST-only values (yesterday vs today)
        const crossedOpenLong = y.rs < thrOpenLong && t.rs >= thrOpenLong;
        const crossedCloseLong = y.rs >= thrCloseLong && t.rs < thrCloseLong;
        const crossedOpenShort = y.rs > thrOpenShort && t.rs <= thrOpenShort;
        // Close SHORT when RS rises back above the short CLOSE threshold (compare to thrCloseShort)
        const crossedCloseShort = y.rs <= thrCloseShort && t.rs > thrCloseShort;

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
            // Update running PnL snapshot for open position (root positions hot/archive)
            try {
              const openPx = Number.isFinite((startOpened as any)?.openPrice) ? Number((startOpened as any).openPrice) : undefined;
              const curPx = Number.isFinite((t as any)?.ac) ? Number((t as any).ac) : undefined;
              let change: number | undefined;
              let pctChange: number | undefined;
              if (openPx != null && curPx != null) {
                if (direction === RsDirectionEnum.LONG) {
                  change = Number(curPx - openPx);
                } else if (direction === RsDirectionEnum.SHORT) {
                  change = Number(openPx - curPx);
                }
                pctChange = change != null && openPx ? Number((change / openPx) * 100) : undefined;
              }
              const patch: any = {
                lastUpdateDay: t.day,
                currentPrice: curPx,
                currentChange: change,
                currentPctChange: pctChange,
                currentRs: t.rs,
              };
              await upsertRootPosition(pid, t.day, RsPositionStatus.OPEN, patch);
              logger.info('position snapshot (hold)', {
                event: 'positionSnapshot',
                positionId: pid,
                pair,
                baseline: base,
                symbol: sym,
                side: direction === RsDirectionEnum.LONG ? 'LONG' : 'SHORT',
                day: t.day,
                currentPrice: patch.currentPrice ?? null,
                currentChange: patch.currentChange ?? null,
                currentPctChange: patch.currentPctChange ?? null,
              });
            } catch {}
          }
          if (verbose && holdLogs < verboseCap) {
            const openPx = Number.isFinite((startOpened as any)?.openPrice) ? Number((startOpened as any).openPrice) : undefined;
            logger.info(`RS HOLD(start) ${direction ?? 'n/a'} pair=${pair} day=${t.day} posId=${pid} open=${openPx ?? 'n/a'}`,
              { event: 'hold', phase: 'start', direction, pair, baseline: base, symbol: sym, positionId: pid, day: t.day, openPrice: openPx, rsYesterday: y.rs, rsToday: t.rs });
            holdLogs++;
          }
          daysTouched.add(t.day);
          await commitIfNeeded();
        }

        // Close first if any
        if (state === PositionState.LONG && crossedCloseLong && opened) {
          const d = new Date(`${t.day}T00:00:00Z`);
          const posId = `${String((opened as any).day).replace(/-/g,'')}-${dow(new Date((opened as any).t)).toUpperCase()}-${pair}-${String(RsDirectionEnum.LONG).toUpperCase()}`;
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
            source: RsSourceEnum.POST,
            rsYesterday: y.rs,
            rsToday: t.rs,
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
            // Move canonical per-pair signal from open bucket to year-sharded closed bucket
            try {
              await finalizePairSignalClose(pair, posId, t.day, {
                exitPrice: closePx,
                netPnL: change ?? 0,
                percentReturn: pctChange ?? 0,
                closed: closedWithPx,
              } as any);
            } catch {}
            // Add close; also remove any stale hold/open entries for the same position to enforce mutual exclusivity
            const dailyClosePatchLong = {
              newCloses: FieldValue.arrayUnion({ positionId: posId, direction: RsDirectionEnum.LONG }),
              holds: FieldValue.arrayRemove({ positionId: posId, direction: RsDirectionEnum.LONG }),
              newOpens: FieldValue.arrayRemove({ positionId: posId, direction: RsDirectionEnum.LONG }),
              updatedAt: FieldValue.serverTimestamp(),
            } as any;
            batch.set(dailyRef, dailyClosePatchLong, { merge: true }); opsInBatch++;
            // Mirror per-pair daily to year shard
            try { await upsertPairSignalsDaily(pair, t.day, dailyClosePatchLong); } catch {}
            // Ensure hot/archive mirror only via sharded positions buckets (no legacy flat doc)
            try {
              const netPnL = change ?? 0;
              const percentReturn = pctChange ?? 0;
              const mirrorPatch: any = {
                entryPrice: openPx,
                exitPrice: closePx,
                entryDay: (opened as any)?.day,
                exitDay: t.day,
                netPnL,
                percentReturn,
                status: RsPositionStatus.CLOSED,
                exitRs: t.rs,
              };
              await upsertRootPosition(posId, t.day, RsPositionStatus.CLOSED, mirrorPatch);
              logger.info('position finalize (close:long)', {
                event: 'positionFinalize',
                positionId: posId,
                pair,
                baseline: base,
                symbol: sym,
                side: 'LONG',
                exitDay: t?.day ?? null,
                entryPrice: mirrorPatch.entryPrice ?? null,
                exitPrice: mirrorPatch.exitPrice ?? null,
                netPnL,
                percentReturn,
                exitRs: mirrorPatch.exitRs ?? null,
              });
              // Update global analytics summary (analytics/summary) without touching legacy flat positions docs
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
              logger.warn('analytics summary update failed (close:long)', { positionId: posId, message: (e as any)?.message, stack: (e as any)?.stack });
            }
            if (verbose && closeLogs < verboseCap) {
              logger.info(`RS CLOSE long pair=${pair} day=${t.day} rs=${y.rs.toFixed(3)}→${t.rs.toFixed(3)} open=${openPx ?? 'n/a'} close=${closePx ?? 'n/a'} Δ=${change ?? 'n/a'} (${pctChange ?? 'n/a'}%) posId=${posId}`,
                { event: 'close', direction: 'long', pair, baseline: base, symbol: sym, positionId: posId, day: t.day, openPrice: openPx, closePrice: closePx, change, pctChange, rsYesterday: y.rs, rsToday: t.rs });
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
          const posId = `${String((opened as any).day).replace(/-/g,'')}-${dow(new Date((opened as any).t)).toUpperCase()}-${pair}-${String(RsDirectionEnum.SHORT).toUpperCase()}`;
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
            source: RsSourceEnum.POST,
            rsYesterday: y.rs,
            rsToday: t.rs,
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
            // Move canonical per-pair signal from open bucket to year-sharded closed bucket
            try {
              await finalizePairSignalClose(pair, posId, t.day, {
                exitPrice: closePx,
                netPnL: change ?? 0,
                percentReturn: pctChange ?? 0,
                closed: closedWithPxS,
              } as any);
            } catch {}
            // Add close; also remove any stale hold/open entries for the same position to enforce mutual exclusivity
            const dailyClosePatchShort = {
              newCloses: FieldValue.arrayUnion({ positionId: posId, direction: RsDirectionEnum.SHORT }),
              holds: FieldValue.arrayRemove({ positionId: posId, direction: RsDirectionEnum.SHORT }),
              newOpens: FieldValue.arrayRemove({ positionId: posId, direction: RsDirectionEnum.SHORT }),
              updatedAt: FieldValue.serverTimestamp(),
            } as any;
            batch.set(dailyRef, dailyClosePatchShort, { merge: true }); opsInBatch++;
            // Mirror to sharded root positions only (no legacy flat doc)
            try {
              const mirrorPatchS: any = {
                entryPrice: openPx,
                exitPrice: closePx,
                entryDay: (opened as any)?.day,
                exitDay: t.day,
                netPnL: change ?? 0,
                percentReturn: pctChange ?? 0,
                status: RsPositionStatus.CLOSED,
                exitRs: t.rs,
              };
              await upsertRootPosition(posId, t.day, RsPositionStatus.CLOSED, mirrorPatchS);
            } catch {}
            if (verbose && closeLogs < verboseCap) {
              logger.info(`RS CLOSE short pair=${pair} day=${t.day} rs=${y.rs.toFixed(3)}→${t.rs.toFixed(3)} open=${openPx ?? 'n/a'} close=${closePx ?? 'n/a'} Δ=${change ?? 'n/a'} (${pctChange ?? 'n/a'}%) posId=${posId}`,
                { event: 'close', direction: 'short', pair, baseline: base, symbol: sym, positionId: posId, day: t.day, openPrice: openPx, closePrice: closePx, change, pctChange, rsYesterday: y.rs, rsToday: t.rs });
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
            source: RsSourceEnum.POST,
            rsYesterday: y.rs,
            rsToday: t.rs,
            ...(Number.isFinite(t.ac) ? { openPrice: Number(t.ac) } : {}),
          };
          if (verbose) logger.info('OPEN price (long)', { event: 'openPrice', pair, day: t.day, rsYesterday: y.rs, rsToday: t.rs, ac: t.ac, openPx });
          const posId = `${t.day.replace(/-/g,'')}-${dow(d).toUpperCase()}-${pair}-${String(RsDirectionEnum.LONG).toUpperCase()}`;
          const yr = String(t.day).slice(0, 4);
          const dailyRef = db
            .collection(PAIRS_COLLECTION).doc(pair)
            .collection(SIGNALS_DAILY_COLLECTION).doc(yr)
            .collection(DAYS_SUBCOLLECTION).doc(t.day);
          if (!dryRun) {
            const openedWithPx = { ...openedPartial, ...(openPx != null ? { openPrice: openPx } : {}) } as Partial<RsPositionOpened>;
            if (verbose) logger.info('WRITE (open long) openedWithPx', { event: 'writePositionOpen', pair, positionId: posId, openedWithPx });
            // Canonical per-pair signal open: write to signals/open/items and mirror to root positions
            try {
              await writePairSignalOpen(pair, posId, t.day, {
                baseline: base,
                symbol: sym,
                direction: RsDirectionEnum.LONG,
                entryDay: t.day,
                entryTimestamp: d.getTime(),
                entryPrice: openPx,
                opened: openedWithPx,
              } as any);
            } catch {}
            // Add open; also remove any stale hold/close entries for the same position to enforce mutual exclusivity
            const dailyOpenPatchLong = {
              newOpens: FieldValue.arrayUnion({ positionId: posId, direction: RsDirectionEnum.LONG }),
              holds: FieldValue.arrayRemove({ positionId: posId, direction: RsDirectionEnum.LONG }),
              newCloses: FieldValue.arrayRemove({ positionId: posId, direction: RsDirectionEnum.LONG }),
              updatedAt: FieldValue.serverTimestamp(),
            } as any;
            batch.set(dailyRef, dailyOpenPatchLong, { merge: true }); opsInBatch++;
            // Mirror per-pair daily to year shard
            try { await upsertPairSignalsDaily(pair, t.day, dailyOpenPatchLong); } catch {}
            // Mirror to sharded root positions only (no legacy flat doc)
            try {
              const mirrorPatch: any = {
                entryDay: t.day,
                status: RsPositionStatus.OPEN,
              };
              if (openPx != null) {
                mirrorPatch.entryPrice = openPx;
                mirrorPatch.currentPrice = openPx;
                mirrorPatch.currentChange = 0;
                mirrorPatch.currentPctChange = 0;
                mirrorPatch.lastUpdateDay = t.day;
                mirrorPatch.currentRs = t.rs;
              }
              await upsertRootPosition(posId, t.day, RsPositionStatus.OPEN, mirrorPatch);
            } catch {}
            if (verbose && openLogs < verboseCap) {
              logger.info(`RS OPEN  long pair=${pair} day=${t.day} rs=${y.rs.toFixed(3)}→${t.rs.toFixed(3)} open=${openPx ?? 'n/a'} posId=${posId}`,
                { event: 'open', direction: 'long', pair, baseline: base, symbol: sym, positionId: posId, day: t.day, openPrice: openPx, rsYesterday: y.rs, rsToday: t.rs });
              openLogs++;
            }
          }
          daysTouched.add(t.day);
          const openedFullLong = openedPartial as RsPositionOpened;
          state = PositionState.LONG; direction = RsDirectionEnum.LONG as unknown as RsDirection; opened = openedFullLong; opens += 1;
          await commitIfNeeded();
        }

        if (state === PositionState.FLAT && crossedOpenShort) {
          const d = new Date(`${t.day}T00:00:00Z`);
          const openPx = Number.isFinite(t.ac) ? Number(t.ac) : undefined;
          const openedPartial: Partial<RsPositionOpened> = {
            day: t.day,
            t: d.getTime(),
            source: RsSourceEnum.POST,
            rsYesterday: y.rs,
            rsToday: t.rs,
            ...(Number.isFinite(t.ac) ? { openPrice: Number(t.ac) } : {}),
          };
          if (verbose) logger.info('OPEN price (short)', { event: 'openPrice', pair, day: t.day, rsYesterday: y.rs, rsToday: t.rs, ac: t.ac, openPx });
          const posId = `${t.day.replace(/-/g,'')}-${dow(d).toUpperCase()}-${pair}-${String(RsDirectionEnum.SHORT).toUpperCase()}`;
          const yr = String(t.day).slice(0, 4);
          const dailyRef = db
            .collection(PAIRS_COLLECTION).doc(pair)
            .collection(SIGNALS_DAILY_COLLECTION).doc(yr)
            .collection(DAYS_SUBCOLLECTION).doc(t.day);
          if (!dryRun) {
            const openedWithPxS = { ...openedPartial, ...(openPx != null ? { openPrice: openPx } : {}) } as Partial<RsPositionOpened>;
            if (verbose) logger.info('WRITE (open short) openedWithPxS', { event: 'writePositionOpen', pair, positionId: posId, openedWithPx: openedWithPxS });
            // Canonical per-pair signal open: write to signals/open/items and mirror to root positions
            try {
              await writePairSignalOpen(pair, posId, t.day, {
                baseline: base,
                symbol: sym,
                direction: RsDirectionEnum.SHORT,
                entryDay: t.day,
                entryTimestamp: d.getTime(),
                entryPrice: openPx,
                opened: openedWithPxS,
              } as any);
            } catch {}
            const dailyOpenPatchShort = {
              newOpens: FieldValue.arrayUnion({ positionId: posId, direction: RsDirectionEnum.SHORT }),
              holds: FieldValue.arrayRemove({ positionId: posId, direction: RsDirectionEnum.SHORT }),
              newCloses: FieldValue.arrayRemove({ positionId: posId, direction: RsDirectionEnum.SHORT }),
              updatedAt: FieldValue.serverTimestamp(),
            } as any;
            batch.set(dailyRef, dailyOpenPatchShort, { merge: true }); opsInBatch++;
            // Mirror per-pair daily to year shard
            try { await upsertPairSignalsDaily(pair, t.day, dailyOpenPatchShort); } catch {}
            // Mirror to sharded root positions only (no legacy flat doc)
            try {
              const mirrorPatchS: any = {
                entryDay: t.day,
                status: RsPositionStatus.OPEN,
              };
              if (openPx != null) {
                mirrorPatchS.entryPrice = openPx;
                mirrorPatchS.currentPrice = openPx;
                mirrorPatchS.currentChange = 0;
                mirrorPatchS.currentPctChange = 0;
                mirrorPatchS.lastUpdateDay = t.day;
                mirrorPatchS.currentRs = t.rs;
              }
              await upsertRootPosition(posId, t.day, RsPositionStatus.OPEN, mirrorPatchS);
            } catch {}
            if (verbose && openLogs < verboseCap) {
              logger.info(`RS OPEN  short pair=${pair} day=${t.day} rs=${y.rs.toFixed(3)}→${t.rs.toFixed(3)} open=${openPx ?? 'n/a'} posId=${posId}`,
                { event: 'open', direction: 'short', pair, baseline: base, symbol: sym, positionId: posId, day: t.day, openPrice: openPx, rsYesterday: y.rs, rsToday: t.rs });
              openLogs++;
            }
          }
          daysTouched.add(t.day);
          const openedFullShort = openedPartial as RsPositionOpened;
          state = PositionState.SHORT; direction = RsDirectionEnum.SHORT as unknown as RsDirection; opened = openedFullShort; opens += 1;
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

function resolvePostValues(raw: any, verbose: boolean, pair: string, day: string, logger: any): { rs?: number; ac?: number; baseAc?: number; postKeys: string[] } {
  const post: any = raw?.post ?? {};
  const rs = Number.isFinite(post?.rs) ? Number(post.rs) : undefined;
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

  // STRICT: fail fast if either field is missing; include chosen keys and available keys for quick wiring.
  if (ac == null || baseAc == null) {
    throw new Error(`Missing price fields in raw.post for ${pair} day=${day}; expected post.${PRICE_PATH} and post.${BASE_PRICE_PATH}. postKeys=${JSON.stringify(postKeys)}`);
  }

  return { rs, ac, baseAc, postKeys };
}

function computeClosePrices(
  opened: Partial<RsPositionOpened> | undefined,
  t: { day: string; ac?: number },
  _allDays: Array<{ day: string; ac?: number }>,
): { openPx?: number; closePx?: number; usedFallback: boolean } {
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

