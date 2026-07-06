/**
 * RS-Bars Interval Diagnostic & Backfill
 *
 * MODE 1 — Diagnose (default):
 *   Scans every rs-bars Firestore doc, checks the FULL bar array for each
 *   interval, and reports any symbol with interval corruption or stale data.
 *   Writes backfill-targets.json listing only affected symbols.
 *
 *   npx tsx scripts/diagnose-bar-interval-mismatch.ts
 *
 * MODE 2 — Backfill (--backfill flag):
 *   Reads backfill-targets.json, deletes those rs-bars docs, then fetches
 *   fresh D/W/M data from the partner API and writes directly to Firestore.
 *   Requires --confirm-delete flag to prevent accidental runs.
 *
 *   npx tsx scripts/diagnose-bar-interval-mismatch.ts --backfill --confirm-delete
 *
 * Optional env vars:
 *   PROJECT  - Firebase project ID (default: rel-str)
 *   LIMIT    - max symbols to check in diagnose mode (default: all)
 */

import 'dotenv/config';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import type { OhlcBar } from '../src/rh-agent-cloud-function/rh-agent-types';

const PROJECT      = process.env['PROJECT'] ?? 'rel-str';
const LIMIT        = process.env['LIMIT'] ? parseInt(process.env['LIMIT'], 10) : Infinity;
const MODE_BACKFILL   = process.argv.includes('--backfill');
const CONFIRM_DELETE  = process.argv.includes('--confirm-delete');
const TARGETS_FILE    = 'scripts/backfill-targets.json';

const PARTNER_AUDIENCE = process.env['PARTNER_AUDIENCE'] ?? 'https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net';
const PARTNER_TS_URL   = `${PARTNER_AUDIENCE.replace(/\/$/, '')}/partnerTimeSeriesV2`;
const SA_IMPERSONATE   = process.env['IMPERSONATE_SERVICE_ACCOUNT'] ?? 'rel-str-partner-caller-prod@rel-str.iam.gserviceaccount.com';

const DAILY_BACKFILL_YEARS   = 7;
const WEEKLY_BACKFILL_YEARS  = 7;
const MONTHLY_BACKFILL_YEARS = 8;
const CONCURRENCY = 10; // parallel symbol fetches during backfill

if (!getApps().length) {
  initializeApp({ projectId: PROJECT });
}
const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });

// ============================================================================
// Date helpers
// ============================================================================

function dowOf(d: string): number { return new Date(`${d}T00:00:00.000Z`).getUTCDay(); }
function dowLabel(d: string): string { return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dowOf(d)]; }

function dateYearsAgo(years: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return d.toISOString().slice(0, 10);
}

/**
 * US market holidays (full closes) — extend as needed.
 * Format: YYYY-MM-DD UTC.
 */
const MARKET_HOLIDAYS = new Set([
  '2026-01-01', // New Year's Day
  '2026-01-19', // MLK Day
  '2026-02-16', // Presidents' Day
  '2026-04-03', // Good Friday
  '2026-05-25', // Memorial Day
  '2026-06-19', // Juneteenth
  '2026-07-03', // Independence Day (observed — market closed)
  '2026-09-07', // Labor Day
  '2026-11-26', // Thanksgiving
  '2026-11-27', // Black Friday (early close — treat as holiday for bar purposes)
  '2026-12-25', // Christmas
  '2025-01-01', '2025-01-20', '2025-02-17', '2025-04-18',
  '2025-05-26', '2025-06-19', '2025-07-04', '2025-09-01',
  '2025-11-27', '2025-12-25',
  // 2024
  '2024-01-01', '2024-01-15', '2024-02-19', '2024-03-29',
  '2024-05-27', '2024-06-19', '2024-07-04', '2024-09-02',
  '2024-11-28', '2024-12-25',
  // 2023
  '2023-01-02', '2023-01-16', '2023-02-20', '2023-04-07',
  '2023-05-29', '2023-06-19', '2023-07-04', '2023-09-04',
  '2023-11-23', '2023-12-25',
  // 2022
  '2022-01-17', '2022-02-21', '2022-04-15',
  '2022-05-30', '2022-06-20', '2022-07-04', '2022-09-05',
  '2022-11-24', '2022-12-26',
  // 2021
  '2021-01-01', '2021-01-18', '2021-02-15', '2021-04-02',
  '2021-05-31', '2021-07-05', '2021-09-06',
  '2021-11-25', '2021-12-24',
  // 2020
  '2020-01-01', '2020-01-20', '2020-02-17', '2020-04-10',
  '2020-05-25', '2020-07-03', '2020-09-07',
  '2020-11-26', '2020-12-25',
  // 2019
  '2019-01-01', '2019-01-21', '2019-02-18', '2019-04-19',
  '2019-05-27', '2019-07-04', '2019-09-02',
  '2019-11-28', '2019-12-25',
]);

function isTradingDay(dateStr: string): boolean {
  const dow = new Date(`${dateStr}T00:00:00.000Z`).getUTCDay();
  return dow !== 0 && dow !== 6 && !MARKET_HOLIDAYS.has(dateStr);
}

/** Last market trading day: skips weekends and known US market holidays. */
function lastTradingDay(): string {
  const d = new Date();
  // If before market close (9 PM UTC ≈ 2 PM PT + buffer), step back one day first
  if (d.getUTCHours() < 21) {
    d.setUTCDate(d.getUTCDate() - 1);
  }
  // Roll back until we land on a trading day
  let dateStr = d.toISOString().slice(0, 10);
  while (!isTradingDay(dateStr)) {
    d.setUTCDate(d.getUTCDate() - 1);
    dateStr = d.toISOString().slice(0, 10);
  }
  return dateStr;
}

// ============================================================================
// Interval validation — calendar-aware, no gap heuristics
// ============================================================================

interface Violation { index: number; date: string; reason: string; }

/**
 * Last trading day of the ISO week (Mon–Sun) containing dateStr.
 * Walks back from Friday of that week skipping holidays/weekends.
 */
function lastTradingDayOfWeek(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  const dow = d.getUTCDay(); // 0=Sun ... 6=Sat
  // Find the Friday of this week
  const daysToFriday = dow <= 5 ? 5 - dow : 6; // if Sun(0) go forward 5, if Sat(6) go back 1
  const friday = new Date(d);
  friday.setUTCDate(d.getUTCDate() + (dow === 0 ? -2 : 5 - dow)); // Mon-Fri: go to Friday; Sun: prior Friday
  let candidate = friday.toISOString().slice(0, 10);
  // Walk back if Friday is a holiday
  while (!isTradingDay(candidate)) {
    friday.setUTCDate(friday.getUTCDate() - 1);
    candidate = friday.toISOString().slice(0, 10);
  }
  return candidate;
}

/** Last trading day of the month containing dateStr. */
function lastTradingDayOfMonth(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  let candidate = last.toISOString().slice(0, 10);
  while (!isTradingDay(candidate)) {
    last.setUTCDate(last.getUTCDate() - 1);
    candidate = last.toISOString().slice(0, 10);
  }
  return candidate;
}

/**
 * DAILY:   every bar must be a valid trading day (Mon–Fri, not a holiday).
 * WEEKLY:  every non-final bar must be a Friday (SA anchors to Friday).
 *          Final bar may be any weekday (current partial week).
 * MONTHLY: every non-final bar must be the last trading day of its month.
 *          Final bar may be partial current month.
 */
function findAllViolations(bars: OhlcBar[], interval: 'DAILY' | 'WEEKLY' | 'MONTHLY'): Violation[] {
  const violations: Violation[] = [];
  if (bars.length === 0) return violations;

  if (interval === 'DAILY') {
    for (let i = 0; i < bars.length; i++) {
      if (!isTradingDay(bars[i].d)) {
        const dow = dowOf(bars[i].d);
        const why = (dow === 0 || dow === 6) ? `${dowLabel(bars[i].d)} (weekend)` : `market holiday`;
        violations.push({ index: i, date: bars[i].d, reason: `non-trading day in DAILY array — ${why}` });
      }
    }
  } else if (interval === 'WEEKLY') {
    // Every non-final bar must be the last trading day of its week (Friday, or Thursday on holiday weeks)
    for (let i = 0; i < bars.length - 1; i++) {
      const expected = lastTradingDayOfWeek(bars[i].d);
      if (bars[i].d !== expected) {
        violations.push({ index: i, date: bars[i].d,
          reason: `WEEKLY bar on ${dowLabel(bars[i].d)} ${bars[i].d} — expected week-end ${expected}` });
      }
    }
    // Final bar: just must be a weekday (current partial week)
    const last = bars[bars.length - 1];
    const lastDow = dowOf(last.d);
    if (lastDow === 0 || lastDow === 6) {
      violations.push({ index: bars.length - 1, date: last.d,
        reason: `WEEKLY last bar on ${dowLabel(last.d)} — weekend date` });
    }
  } else if (interval === 'MONTHLY') {
    for (let i = 0; i < bars.length - 1; i++) {
      const expected = lastTradingDayOfMonth(bars[i].d);
      if (bars[i].d !== expected) {
        violations.push({ index: i, date: bars[i].d,
          reason: `MONTHLY bar on ${bars[i].d} — expected month-end ${expected}` });
      }
    }
  }
  return violations;
}

// ============================================================================
// Partner API helpers
// ============================================================================

function getIdToken(): string {
  try {
    return execSync(
      `gcloud auth print-identity-token --audiences="${PARTNER_TS_URL}" --impersonate-service-account="${SA_IMPERSONATE}"`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
  } catch (err: any) {
    console.error('Failed to get ID token:', err?.stderr || err?.message);
    process.exit(1);
  }
}

async function fetchBars(symbol: string, interval: string, from: string, to: string, token: string): Promise<OhlcBar[]> {
  const url = `${PARTNER_TS_URL}?symbol=${symbol}&interval=${interval}&from=${from}&to=${to}&adjusted=true`;
  const res  = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Partner API ${res.status} for ${symbol}/${interval}`);
  const json = (await res.json()) as any;
  return ((json?.bars ?? []) as any[]).map((raw: any): OhlcBar | null => {
    let d = '';
    if (raw?.d && typeof raw.d === 'string') d = raw.d.slice(0, 10);
    else if (raw?.t && Number.isFinite(Number(raw.t))) d = new Date(Number(raw.t)).toISOString().slice(0, 10);
    const c = Number(raw?.c ?? raw?.ac);
    if (!d || !Number.isFinite(c) || c <= 0) return null;
    const o = Number(raw?.o), h = Number(raw?.h), l = Number(raw?.l), v = Number(raw?.v);
    const bar: OhlcBar = { d, o: Number.isFinite(o) ? o : c, h: Number.isFinite(h) ? h : c, l: Number.isFinite(l) ? l : c, c };
    if (Number.isFinite(v) && v > 0) bar.v = v;
    return bar;
  }).filter((b): b is OhlcBar => b !== null);
}

// ============================================================================
// MODE 1 — Diagnose
// ============================================================================

interface SymbolReport {
  symbol: string;
  issues: string[];
  dailyLastBar: string;
  weeklyLastBar: string;
  monthlyLastBar: string;
}

async function runDiagnose(): Promise<void> {
  const expectedLastDay = lastTradingDay();
  console.log(`Scanning rs-bars in project: ${PROJECT}`);
  console.log(`Expected last trading day:   ${expectedLastDay}\n`);

  const refs = await db.collection('rs-bars').listDocuments();
  let allSymbols = refs.map(r => r.id).sort();
  if (LIMIT !== Infinity) allSymbols = allSymbols.slice(0, LIMIT);
  console.log(`Total symbols: ${allSymbols.length}\n`);

  const affectedSymbols: string[] = [];
  const reports: SymbolReport[] = [];

  for (const symbol of allSymbols) {
    const snap = await db.collection('rs-bars').doc(symbol).get();
    if (!snap.exists) {
      console.log(`⚠️  ${symbol} — missing doc`);
      affectedSymbols.push(symbol);
      continue;
    }

    const data  = snap.data() as { daily?: OhlcBar[]; weekly?: OhlcBar[]; monthly?: OhlcBar[] };
    const daily   = data.daily   ?? [];
    const weekly  = data.weekly  ?? [];
    const monthly = data.monthly ?? [];

    const dailyLastBar   = daily.at(-1)?.d   ?? 'n/a';
    const weeklyLastBar  = weekly.at(-1)?.d  ?? 'n/a';
    const monthlyLastBar = monthly.at(-1)?.d ?? 'n/a';

    const issues: string[] = [];

    // Stale daily check
    if (dailyLastBar !== expectedLastDay) {
      issues.push(`DAILY lastBar=${dailyLastBar} (expected ${expectedLastDay})`);
    }

    // Full array violation scan
    const dv = findAllViolations(daily,   'DAILY');
    const wv = findAllViolations(weekly,  'WEEKLY');
    const mv = findAllViolations(monthly, 'MONTHLY');

    if (dv.length > 0) issues.push(`DAILY:   ${dv.length} violation(s), first at ${dv[0].date} — ${dv[0].reason}`);
    if (wv.length > 0) issues.push(`WEEKLY:  ${wv.length} violation(s), first at ${wv[0].date} — ${wv[0].reason}`);
    if (mv.length > 0) issues.push(`MONTHLY: ${mv.length} violation(s), first at ${mv[0].date} — ${mv[0].reason}`);

    const ok = issues.length === 0;
    console.log(`${ok ? '✅' : '❌'} ${symbol.padEnd(8)} D:${String(daily.length).padEnd(5)} W:${String(weekly.length).padEnd(4)} M:${String(monthly.length).padEnd(4)} lastBar=${dailyLastBar}${ok ? '' : `  ← ${issues[0]}`}`);

    if (!ok) {
      affectedSymbols.push(symbol);
      reports.push({ symbol, issues, dailyLastBar, weeklyLastBar, monthlyLastBar });
    }
  }

  console.log(`\n${'─'.repeat(70)}`);
  console.log(`✅ Clean:    ${allSymbols.length - affectedSymbols.length}`);
  console.log(`❌ Affected: ${affectedSymbols.length} / ${allSymbols.length}`);

  if (affectedSymbols.length > 0) {
    console.log(`\nAffected symbols:\n  ${affectedSymbols.join(', ')}`);
    writeFileSync(TARGETS_FILE, JSON.stringify({ expectedLastDay, symbols: affectedSymbols, reports }, null, 2));
    console.log(`\nWrote ${TARGETS_FILE} — run with --backfill --confirm-delete to fix.`);
  } else {
    console.log('\nAll symbols are clean. Nothing to backfill.');
  }
}

// ============================================================================
// MODE 2 — Backfill
// ============================================================================

async function runBackfill(): Promise<void> {
  if (!CONFIRM_DELETE) {
    console.error('ERROR: --backfill requires --confirm-delete flag to prevent accidental data loss.');
    process.exit(1);
  }
  if (!existsSync(TARGETS_FILE)) {
    console.error(`ERROR: ${TARGETS_FILE} not found. Run in diagnose mode first.`);
    process.exit(1);
  }

  const targets = JSON.parse(readFileSync(TARGETS_FILE, 'utf-8')) as { symbols: string[] };
  const limitArg = process.argv.indexOf('--limit');
  const limit = limitArg !== -1 ? parseInt(process.argv[limitArg + 1], 10) : undefined;
  const symbols = limit ? targets.symbols.slice(0, limit) : targets.symbols;
  console.log(`Backfilling ${symbols.length}${limit ? ` (of ${targets.symbols.length})` : ''} affected symbols in project: ${PROJECT}`);
  console.log('Getting partner API token...');
  const token = getIdToken();
  const toDate = new Date().toISOString().slice(0, 10);

  // Stage 1: Delete affected docs
  console.log(`\nStage 1: Deleting ${symbols.length} rs-bars docs...`);
  const BATCH_SIZE = 50;
  for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
    const batch = db.batch();
    for (const sym of symbols.slice(i, i + BATCH_SIZE)) {
      batch.delete(db.collection('rs-bars').doc(sym));
    }
    await batch.commit();
    console.log(`  Deleted batch ${Math.floor(i / BATCH_SIZE) + 1} (${Math.min(i + BATCH_SIZE, symbols.length)}/${symbols.length})`);
  }
  console.log('Stage 1 complete.\n');

  // Stage 2: Fetch, validate, write
  console.log('Stage 2: Fetching fresh data from partner API...\n');
  const results = { ok: 0, skipped: 0, error: 0, errorSymbols: [] as string[] };

  // Process in chunks of CONCURRENCY
  for (let i = 0; i < symbols.length; i += CONCURRENCY) {
    const chunk = symbols.slice(i, i + CONCURRENCY);
    await Promise.all(chunk.map(async (symbol) => {
      try {
        const [rawD, rawW, rawM] = await Promise.all([
          fetchBars(symbol, 'DAILY',   dateYearsAgo(DAILY_BACKFILL_YEARS),   toDate, token),
          fetchBars(symbol, 'WEEKLY',  dateYearsAgo(WEEKLY_BACKFILL_YEARS),  toDate, token),
          fetchBars(symbol, 'MONTHLY', dateYearsAgo(MONTHLY_BACKFILL_YEARS), toDate, token),
        ]);

        // Validate each interval
        const dvD = findAllViolations(rawD, 'DAILY');
        const dvW = findAllViolations(rawW, 'WEEKLY');
        const dvM = findAllViolations(rawM, 'MONTHLY');

        if (dvD.length > 0) console.log(`  ⚠️  ${symbol} DAILY still has ${dvD.length} violation(s) from partner — skipping DAILY`);
        if (dvW.length > 0) console.log(`  ⚠️  ${symbol} WEEKLY still has ${dvW.length} violation(s) from partner — skipping WEEKLY`);
        if (dvM.length > 0) console.log(`  ⚠️  ${symbol} MONTHLY still has ${dvM.length} violation(s) from partner — skipping MONTHLY`);

        const daily   = dvD.length === 0 ? rawD : [];
        const weekly  = dvW.length === 0 ? rawW : [];
        const monthly = dvM.length === 0 ? rawM : [];

        if (daily.length === 0) {
          console.log(`  ⛔ ${symbol} — no valid daily bars, skipping write`);
          results.skipped++;
          return;
        }

        await db.collection('rs-bars').doc(symbol).set({
          symbol,
          daily,
          weekly,
          monthly,
          version: new Date().toISOString(),
          lastSyncedAt: FieldValue.serverTimestamp(),
          lastEodSyncAt: FieldValue.serverTimestamp(),
          lastDailyBarDate:   daily.at(-1)?.d   ?? '',
          lastWeeklyBarDate:  weekly.at(-1)?.d  ?? '',
          lastMonthlyBarDate: monthly.at(-1)?.d ?? '',
        });

        console.log(`  ✅ ${symbol.padEnd(8)} D:${String(daily.length).padEnd(5)} W:${String(weekly.length).padEnd(4)} M:${String(monthly.length).padEnd(4)} lastDaily=${daily.at(-1)?.d}`);
        results.ok++;
      } catch (err: any) {
        console.error(`  ❌ ${symbol} ERROR: ${err?.message}`);
        results.error++;
        results.errorSymbols.push(symbol);
      }
    }));
  }

  console.log(`\n${'─'.repeat(70)}`);
  console.log(`✅ OK:      ${results.ok}`);
  console.log(`⚠️  Skipped: ${results.skipped}`);
  console.log(`❌ Errors:  ${results.error}${results.error > 0 ? `  [${results.errorSymbols.join(', ')}]` : ''}`);

  if (results.errorSymbols.length > 0) {
    writeFileSync(TARGETS_FILE, JSON.stringify({ symbols: results.errorSymbols }, null, 2));
    console.log(`\nWrote failed symbols back to ${TARGETS_FILE} for retry.`);
  }
}

// ============================================================================
// Entry point
// ============================================================================

if (MODE_BACKFILL) {
  runBackfill().catch(err => { console.error('Backfill failed:', err); process.exit(1); });
} else {
  runDiagnose().catch(err => { console.error('Diagnose failed:', err); process.exit(1); });
}
