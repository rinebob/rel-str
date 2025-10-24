import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../firebase-admin-init';
import type { Phase, PhaseSeriesPoint, PartnerBar } from './webhooks-config';
import { logger } from 'firebase-functions/v2';

/**
 * Write unified RS series for a pair into Firestore (pairs-data schema).
 *
 * Document path: pairs-data/{BASELINE}-{TARGET}
 * Shape:
 * {
 *   meta: { baseline, symbol, interval, window },
 *   lastUpdatedAt: Timestamp,
 *   latest: { day, pre?{}, post?{} },
 *   data: [ { day, dow, pre?{}, post?{} }, ... ]
 * }
 *
 * Notes:
 * - Pre phase computes change/percentChange versus prior-day post-close adjusted close (ac).
 * - Post phase also computes versus prior-day post-close (ac, fallback c).
 * - Retention: limited to meta.window elements (default 30) from the tail.
 * - Upsert: per-day entries merged; existing other phase preserved when one phase updates.
 */
export async function writeUnifiedSeries(
  baseline: string,
  target: string,
  phase: Phase,
  entries: PhaseSeriesPoint[],
  baselineBars: PartnerBar[],
  targetBars: PartnerBar[]
): Promise<void> {
  if (entries.length === 0) return;
  const pairId = `${baseline}-${target}`;
  const pairRef = db.collection('pairs-data').doc(pairId);

  const snap = await pairRef.get();
  const existing = (snap.exists ? (snap.data() as any) : {}) || {};
  const existingData: Array<any> = Array.isArray(existing.data) ? existing.data : [];
  const existingMeta: any = (existing.meta as any) || {};

  const meta = {
    baseline,
    symbol: target,
    interval: existingMeta?.interval ?? 'DAILY',
    window: Number.isFinite(existingMeta?.window) ? Number(existingMeta.window) : 30,
  };

  const baseIndexByDay = new Map<string, number>();
  for (let i = 0; i < baselineBars.length; i++) {
    const d = baselineBars[i]?.d;
    if (d) baseIndexByDay.set(d, i);
  }
  const targetIndexByDay = new Map<string, number>();
  for (let i = 0; i < targetBars.length; i++) {
    const d = targetBars[i]?.d;
    if (d) targetIndexByDay.set(d, i);
  }

  const isWeekend = (dayStr?: string) => {
    if (!dayStr) return false;
    const dow = new Date(dayStr + 'T00:00:00.000Z').getUTCDay();
    return dow === 0 || dow === 6;
  };
  function findPrevTradingBar(bars: PartnerBar[], idx?: number): PartnerBar | undefined {
    if (idx === undefined || idx <= 0) return undefined;
    let j = idx - 1;
    while (j >= 0) {
      const d = bars[j]?.d;
      if (d && !isWeekend(d)) return bars[j];
      j--;
    }
    return undefined;
  }

  const byDay = new Map<string, any>();
  for (const d of existingData) if (d?.day) byDay.set(d.day, { ...d });

  for (const e of entries) {
    const dayObj = byDay.get(e.day) || { day: e.day, dow: e.dow };
    const rs = e.baseClose > 0 ? e.targetClose / e.baseClose : undefined;

    const bi = baseIndexByDay.get(e.day);
    const ti = targetIndexByDay.get(e.day);
    const prevBase = findPrevTradingBar(baselineBars, bi);
    const prevTarget = findPrevTradingBar(targetBars, ti);
    const prevBaseClose = Number(prevBase?.ac || prevBase?.c || 0);
    const prevTargetClose = Number(prevTarget?.ac || prevTarget?.c || 0);
    const baseChange = Number.isFinite(prevBaseClose) && prevBaseClose > 0 ? e.baseClose - prevBaseClose : 0;
    const targetChange = Number.isFinite(prevTargetClose) && prevTargetClose > 0 ? e.targetClose - prevTargetClose : 0;
    const basePct = Number.isFinite(prevBaseClose) && prevBaseClose > 0 ? (baseChange / prevBaseClose) * 100 : 0;
    const targetPct = Number.isFinite(prevTargetClose) && prevTargetClose > 0 ? (targetChange / prevTargetClose) * 100 : 0;

    if (phase === 'pre') {
      dayObj.pre = {
        time: e.it,
        t: e.t,
        base: { price: e.baseClose, change: Number(baseChange.toFixed(6)), percentChange: Number(basePct.toFixed(6)) },
        target: { price: e.targetClose, change: Number(targetChange.toFixed(6)), percentChange: Number(targetPct.toFixed(6)) },
        rs: Number((rs ?? 0).toFixed(6)),
        source: 'intraday',
      };
    } else {
      dayObj.post = {
        t: e.t,
        base: { price: e.baseClose, change: Number(baseChange.toFixed(6)), percentChange: Number(basePct.toFixed(6)) },
        target: { price: e.targetClose, change: Number(targetChange.toFixed(6)), percentChange: Number(targetPct.toFixed(6)) },
        rs: Number((rs ?? 0).toFixed(6)),
        source: 'adjustedClose',
      };
    }

    byDay.set(e.day, dayObj);
  }

  let merged = Array.from(byDay.values()).sort((a, b) => String(a.day).localeCompare(String(b.day)));
  if (merged.length > meta.window) merged = merged.slice(merged.length - meta.window);

  const latest = merged[merged.length - 1];

  await pairRef.set(
    {
      meta,
      lastUpdatedAt: FieldValue.serverTimestamp(),
      latest,
      data: merged,
    },
    { merge: true }
  );

  logger.info(`pairs-data_write_done ${pairId} phase=${phase} days=${merged.length} latestDay=${latest?.day}`);
}
