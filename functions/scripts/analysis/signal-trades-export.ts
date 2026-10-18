/**
 * @topic #553 — Layer 0 forensics export (discussion with user; unticketed)
 *
 * signal-trades-export — one CSV row per signal-source paper trade,
 * covering the whole lifecycle + excursion stats. Read-only against prod.
 *
 * Row groups:
 *   identity   — ids, signal dims, symbol-meta slices
 *   lifecycle  — entry/exit fills, status, ret%, daysHeld (direction-aware)
 *   excursion  — MFE/MAE + peak/trough dates from SDS daily bars (share
 *                legs) or the daily marks map (option legs — coarser grain)
 *   shadows    — non-governing variant outcomes (counterfactual exits)
 *   features   — signalIndicators spread as ind.* columns (auto-ingested
 *                trades only; manual accepts never carried the stamp)
 *
 * Conventions:
 *   - tradeRetPct/mfe/mae direction-aware: long (px-entry)/entry, short inverse.
 *   - Excursion window starts the bar AFTER entryDate — the entry fill is
 *     a ~2:20pm PT quote; entry-day high/low predates it.
 *   - OPEN trades mark-to-latest-mark, exitReason='OPEN' (right-censored).
 *   - Option-leg excursion uses marks[date].mark (1/day) — flagged
 *     excursionSource='marks' vs 'bars' so the grains never blend silently.
 *
 * Output: .devin/tmp/signal-trades-{today}.csv
 *
 * Usage (from functions/):
 *   npx tsx scripts/analysis/signal-trades-export.ts [outDir]
 *
 * Requires: ADC (rel-str). Read-only — never writes.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { db } from '../../src/firebase-admin-init';
import { TradeSide } from '../../../shared/common';
import { computeStTrendStrength } from '../../src/indicators/st-trend-strength';
import {
  PaperTradeStatus,
  type PaperTrade,
} from '../../../shared/paper-trading-contracts';

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
);
const today = new Date().toLocaleDateString('en-CA', {
  timeZone: 'America/Los_Angeles',
});
const outDir = process.argv[2] ?? path.join(REPO_ROOT, '.devin', 'tmp');
const outPath = path.join(outDir, `signal-trades-${today}.csv`);

// ── SDS bars ────────────────────────────────────────────────────────────────

interface Bar { d: string; o: number; h: number; l: number; c: number }

const barCache = new Map<string, Bar[]>();
async function barsFor(symbol: string): Promise<Bar[]> {
  const cached = barCache.get(symbol);
  if (cached) return cached;
  const years = new Set<number>();
  const now = new Date();
  for (const y of [now.getFullYear(), now.getFullYear() - 1]) years.add(y);
  const bars: Bar[] = [];
  for (const y of years) {
    const snap = await db.doc(`symbol-data/${symbol}/daily/${y}`).get();
    for (const b of (snap.data()?.bars ?? []) as Bar[]) bars.push(b);
  }
  bars.sort((a, b) => a.d.localeCompare(b.d));
  barCache.set(symbol, bars);
  return bars;
}

// ── ST Trend Strength (computed context, sampled at entry bar) ──────────────

interface StrengthAtEntry {
  diPlus: number; diMinus: number; diHist: number; adx: number;
}

const strengthCache = new Map<string, Map<string, StrengthAtEntry>>();
async function strengthAt(
  symbol: string,
  date: string,
): Promise<StrengthAtEntry | undefined> {
  let byDate = strengthCache.get(symbol);
  if (!byDate) {
    const bars = await barsFor(symbol);
    const r = computeStTrendStrength(
      bars.map((b) => ({ open: b.o, high: b.h, low: b.l, close: b.c })),
    );
    byDate = new Map();
    bars.forEach((b, i) =>
      byDate!.set(b.d, {
        diPlus: r.diPlus[i], diMinus: r.diMinus[i],
        diHist: r.diHist[i], adx: r.adx[i],
      }),
    );
    strengthCache.set(symbol, byDate);
  }
  return byDate.get(date);
}

// ── Excursion ───────────────────────────────────────────────────────────────

interface Excursion {
  mfePct?: number; maePct?: number;
  mfeDate?: string; maeDate?: string;
  daysToMfe?: number;
  source: 'bars' | 'marks' | 'none';
}

/** Direction-aware excursion over [date, extremePx] observations strictly
 *  after entryDate through endDate. Long: favorable=high; short: favorable=low. */
function excursion(
  entryPrice: number,
  entryDate: string,
  endDate: string,
  obs: { d: string; hi: number; lo: number }[],
  isShort: boolean,
  source: 'bars' | 'marks',
): Excursion {
  let mfe = 0, mae = 0, mfeDate: string | undefined, maeDate: string | undefined;
  let daysToMfe: number | undefined, n = 0;
  for (const { d, hi, lo } of obs) {
    if (d <= entryDate || d > endDate) continue;
    n++;
    const fav = isShort ? entryPrice - lo : hi - entryPrice;
    const adv = isShort ? entryPrice - hi : lo - entryPrice;
    if (fav / entryPrice > mfe) { mfe = fav / entryPrice; mfeDate = d; daysToMfe = n; }
    if (adv / entryPrice < mae) { mae = adv / entryPrice; maeDate = d; }
  }
  return {
    mfePct: mfe * 100, maePct: mae * 100,
    mfeDate, maeDate, daysToMfe,
    source: n > 0 ? source : 'none',
  };
}

// ── Row build ───────────────────────────────────────────────────────────────

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}
const f2 = (v: number | undefined) => (v === undefined ? '' : v.toFixed(4));

async function rowFor(
  docId: string,
  t: PaperTrade,
): Promise<Record<string, string>> {
  const entryFill = t.fills.find((f) => f.role === 'entry');
  const exitFill = t.fills.find((f) => f.role === 'exit');
  const governing = t.variantRuns.find((v) => v.governing);
  const entryPrice = entryFill?.price ?? t.legs[0]?.entryMark;
  const entryDate = entryFill?.date ?? '';
  const isShort =
    (t.order?.side ?? t.legs[0]?.side) === TradeSide.SHORT;
  const dir = isShort ? -1 : 1;

  const markDates = Object.keys(t.marks ?? {}).sort();
  const lastMarkDate = markDates[markDates.length - 1] ?? '';
  const lastMark = num(t.marks?.[lastMarkDate]?.mark) ?? t.legs[0]?.lastMark;
  const endDate =
    t.status === PaperTradeStatus.CLOSED
      ? exitFill?.date ?? governing?.exitEvent?.date ?? lastMarkDate
      : lastMarkDate;

  const exitPrice =
    num(exitFill?.price) ?? num(governing?.exitEvent?.price);
  const tradeRetPct =
    entryPrice && (exitPrice ?? lastMark)
      ? (((exitPrice ?? lastMark)! - entryPrice) / entryPrice) * 100 * dir
      : undefined;
  // Raw direction-neutral % move of the marked instrument — the observation
  // behind tradeRetPct (shorts profit when symbolMovePct is negative).
  const symbolMovePct =
    entryPrice && (exitPrice ?? lastMark)
      ? (((exitPrice ?? lastMark)! - entryPrice) / entryPrice) * 100
      : undefined;

  // Excursion: bars for share legs, daily marks for option legs.
  let ex: Excursion = { source: 'none', mfePct: undefined, maePct: undefined };
  if (entryPrice && entryDate && endDate) {
    if (t.legs.every((l) => l.kind === 'share')) {
      const obs = (await barsFor(t.symbol)).map((b) => ({ d: b.d, hi: b.h, lo: b.l }));
      ex = excursion(entryPrice, entryDate, endDate, obs, isShort, 'bars');
    } else {
      const obs = markDates
        .map((d) => {
          const m = num(t.marks?.[d]?.mark);
          return m === undefined ? null : { d, hi: m, lo: m };
        })
        .filter((o): o is { d: string; hi: number; lo: number } => !!o);
      ex = excursion(entryPrice, entryDate, endDate, obs, isShort, 'marks');
    }
  }

  const shadows = t.variantRuns
    .filter((v) => !v.governing)
    .map((v) => {
      const e = v.exitEvent;
      return `${v.variantKey}:${e ? `EXITED ${e.date}@${e.price} pnl=${e.pnl?.toFixed(2)} ${e.daysHeld}d` : 'active'}`;
    })
    .join(' | ');

  const strength = entryDate ? await strengthAt(t.symbol, entryDate) : undefined;
  const fin = (v: number | undefined) =>
    v !== undefined && Number.isFinite(v) ? v.toFixed(2) : '';

  const row: Record<string, string> = {
    tradeId: docId,
    status: t.status,
    symbol: t.symbol,
    signalId: t.signalId ?? '',
    signalType: t.signalType ?? '',
    signalTimeframe: t.signalTimeframe ?? '',
    signalStatus: t.signalStatus ?? '',
    signalRunId: t.signalRunId ?? '',
    signalBarDate: t.signalBarDate ?? '',
    captureList: (t as { captureList?: string }).captureList ?? '',
    direction: isShort ? 'short' : 'long',
    expression: t.expression ?? '',
    sector: t.sector ?? '',
    industry: t.industry ?? '',
    capTier: (t as { marketCapTier?: string }).marketCapTier ?? '',
    cohortId: t.cohortId ?? '',
    governingVariant: t.governingVariant ?? '',
    createdAt: String(t.createdAt ?? ''),
    entryDate, entryPrice: f2(entryPrice),
    quantity: String(t.order?.quantity ?? ''),
    exitDate: exitPrice !== undefined ? (exitFill?.date ?? governing?.exitEvent?.date ?? '') : '',
    exitPrice: f2(exitPrice),
    symbolMovePct: f2(symbolMovePct),
    exitReason:
      t.status === PaperTradeStatus.CLOSED
        ? governing?.variantKey ?? 'manual'
        : t.status === PaperTradeStatus.OPEN
          ? 'OPEN'
          : t.status,
    tradeRetPct: f2(tradeRetPct),
    realizedPnl: f2(t.realizedPnl),
    unrealizedPnl: f2(t.unrealizedPnl),
    daysHeld: String(governing?.exitEvent?.daysHeld ?? ''),
    lastMarkDate, lastMark: f2(lastMark),
    mfePct: f2(ex.mfePct), maePct: f2(ex.maePct),
    mfeDate: ex.mfeDate ?? '', maeDate: ex.maeDate ?? '',
    daysToMfe: ex.daysToMfe !== undefined ? String(ex.daysToMfe) : '',
    givebackRatio:
      tradeRetPct !== undefined && ex.mfePct && ex.mfePct > 0
        ? f2(tradeRetPct / ex.mfePct)
        : '',
    excursionSource: ex.source,
    shadowOutcomes: shadows,
    'strength.diPlus': fin(strength?.diPlus),
    'strength.diMinus': fin(strength?.diMinus),
    'strength.diHist': fin(strength?.diHist),
    'strength.adx': fin(strength?.adx),
  };
  for (const [k, v] of Object.entries(t.signalIndicators ?? {})) {
    row[`ind.${k}`] = String(v ?? '');
  }
  return row;
}

// ── CSV ─────────────────────────────────────────────────────────────────────

function csvEscape(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

async function main() {
  const snap = await db.collection('paper-trading/trades/items').get();
  const trades = snap.docs
    .map((d) => [d.id, d.data() as PaperTrade] as const)
    .filter(([, t]) => t.source === 'signal')
    .sort(([, a], [, b]) => String(a.createdAt).localeCompare(String(b.createdAt)));

  const rows: Record<string, string>[] = [];
  for (const [id, t] of trades) rows.push(await rowFor(id, t));

  // Union of keys — ind.* columns vary per signal type.
  const fixed = Object.keys(rows[0] ?? {}).filter((k) => !k.startsWith('ind.'));
  const indKeys = [
    ...new Set(rows.flatMap((r) => Object.keys(r).filter((k) => k.startsWith('ind.')))),
  ].sort();
  const cols = [...fixed, ...indKeys];

  const lines = [
    cols.join(','),
    ...rows.map((r) => cols.map((c) => csvEscape(r[c] ?? '')).join(',')),
  ];
  mkdirSync(outDir, { recursive: true });
  writeFileSync(outPath, lines.join('\n'));

  const byStatus: Record<string, number> = {};
  for (const [, t] of trades) byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
  console.log(`${rows.length} rows → ${outPath}`);
  console.log('status:', JSON.stringify(byStatus));
  console.log(`columns: ${cols.length} (${indKeys.length} ind.*)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
