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

  // Resolve desired storage window
  const envWindowRaw = Number(process.env.RS_WINDOW);
  const envWindow = Number.isFinite(envWindowRaw) && envWindowRaw > 0 ? envWindowRaw : undefined;
  const existingWindowRaw = Number(existingMeta?.window);
  const existingWindow = Number.isFinite(existingWindowRaw) && existingWindowRaw > 0 ? existingWindowRaw : undefined;
  const desiredWindow = Math.max(existingWindow ?? 0, envWindow ?? 0, 30);

  const meta = {
    baseline,
    symbol: target,
    interval: existingMeta?.interval ?? 'DAILY',
    // Use the larger of existing window and RS_WINDOW so backfills can expand retention
    window: desiredWindow,
  };

  // ============ Helpers ============
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

  // Frontend V1-inspired RS rank calculation
  // COMPARISON_MATRICES from FE (rs.constants.ts)
  const COMPARISON_MATRICES: string[] = [
    '00000','00001','00010','00011','00100','00101','00110','00111',
    '01000','01001','01010','01011','01100','01101','01110','01111',
    '10000','10001','10010','10011','10100','10101','10110','10111',
    '11000','11001','11010','11011','11100','11101','11110','11111',
  ];

  // Build day->percentChange map anchored to prior-day post-close for both base and target
  const pctByDay = (bars: PartnerBar[]): Map<string, number> => {
    const out = new Map<string, number>();
    for (let i = 0; i < bars.length; i++) {
      const b = bars[i];
      const d = b?.d;
      if (!d) continue;
      // Use adjusted close (ac) when present; fallback to c
      const today = Number(b?.ac ?? b?.c ?? 0);
      // Find prior trading day's post-close
      let prevIdx = i - 1;
      let prev: PartnerBar | undefined;
      while (prevIdx >= 0 && !prev) {
        const pd = bars[prevIdx]?.d;
        if (pd && !isWeekend(pd)) prev = bars[prevIdx];
        prevIdx--;
      }
      const prevClose = Number(prev?.ac ?? prev?.c ?? 0);
      const pct = prevClose > 0 ? ((today - prevClose) / prevClose) * 100 : 0;
      out.set(d, Number(pct.toFixed(6)));
    }
    return out;
  };

  const basePctByDay = pctByDay(baselineBars);
  const targetPctByDay = pctByDay(targetBars);

  // Calculate rank in [0,1] using 5-day window and matrices
  function calculateRankForDay(day: string): number {
    const bi = baseIndexByDay.get(day);
    const ti = targetIndexByDay.get(day);
    if (bi === undefined || ti === undefined) return 0;

    // Collect last 5 trading days including current if available
    const collectLast5 = (bars: PartnerBar[], startIdx: number): number[] => {
      const arr: number[] = [];
      let idx = startIdx;
      while (idx >= 0 && arr.length < 5) {
        const d = bars[idx]?.d;
        if (d && !isWeekend(d)) {
          arr.push((bars === baselineBars ? basePctByDay : targetPctByDay).get(d) ?? 0);
        }
        idx--;
      }
      // reverse to chronological order
      return arr.reverse();
    };

    let baseWin = collectLast5(baselineBars, bi);
    let targWin = collectLast5(targetBars, ti);
    if (baseWin.length < 5 || targWin.length < 5) return 0; // insufficient history

    // Apply V1 ranking logic
    const outcomes: Array<[string, number]> = [];
    for (const matrix of COMPARISON_MATRICES) {
      const bits = matrix.split('');
      const values: number[] = [];
      for (let j = 0; j < bits.length; j++) {
        const useTarget = bits[j] === '1';
        const v = useTarget ? targWin[j] : baseWin[j];
        values.push(v);
      }
      const sum = Number(values.reduce((acc, v) => acc + v, 0).toFixed(4));
      outcomes.push([matrix, sum]);
    }
    outcomes.sort((a, b) => (a[1] > b[1] ? 1 : a[1] < b[1] ? -1 : 0));
    const idx = outcomes.findIndex(([m]) => m === '11111');
    if (idx < 0) return 0;
    const rank = (idx + 1) / COMPARISON_MATRICES.length; // normalize to (0,1]
    return Number(rank.toFixed(6));
  }

  // ============ Merge and write ============
  const byDay = new Map<string, any>();
  for (const d of existingData) if (d?.day) byDay.set(d.day, { ...d });

  for (const e of entries) {
    const dayObj = byDay.get(e.day) || { day: e.day, dow: e.dow };

    // Price-based deltas vs prior-day post-close (for display/debug)
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

    // Calculate RS rank consistent with FE V1 logic
    const rsRank = calculateRankForDay(e.day);

    if (phase === 'pre') {
      dayObj.pre = {
        time: e.it,
        t: e.t,
        base: { price: e.baseClose, change: Number(baseChange.toFixed(6)), percentChange: Number(basePct.toFixed(6)) },
        target: { price: e.targetClose, change: Number(targetChange.toFixed(6)), percentChange: Number(targetPct.toFixed(6)) },
        rs: rsRank,
        source: 'intraday',
      };
    } else {
      dayObj.post = {
        t: e.t,
        base: { price: e.baseClose, change: Number(baseChange.toFixed(6)), percentChange: Number(basePct.toFixed(6)) },
        target: { price: e.targetClose, change: Number(targetChange.toFixed(6)), percentChange: Number(targetPct.toFixed(6)) },
        rs: rsRank,
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
