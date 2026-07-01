/**
 * Generate Historical Signal History
 *
 * One-time backfill script: walks every bar date for each rh-agent symbol,
 * runs the ST_ZONE_UPTICK strategy against the bar slice up to that date,
 * and writes fired signals to signal-history/{barDate}.
 *
 * Source:  rs-bars/{symbol}  (daily/weekly/monthly arrays)
 * Target:  rh-agent-symbols/{symbol}/signal-history/{barDate}
 *
 * Usage (from functions/ dir):
 *   npx tsx scripts/generate-historical-signal-history.ts [options]
 *
 * Options:
 *   --dry-run              Print what would be written, no Firestore writes.
 *   --symbol <ticker>      Process a single symbol only.
 *   --from <YYYY-MM-DD>    Only write signal-history docs on or after this date (default: 2019-01-01).
 *   --to <YYYY-MM-DD>      Only write signal-history docs on or before this date (default: today).
 *   --overwrite            Overwrite existing signal-history docs (default: skip existing).
 */
import { initializeApp, cert, applicationDefault, App } from 'firebase-admin/app';
import { getFirestore, Firestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import * as fs from 'fs';
import * as path from 'path';

import { execute as runStrategy } from '../src/rh-agent-cloud-function/strategies/st-zone-uptick/st-zone-uptick.strategy';
import type { StrategyInput, StrategyOutput } from '../src/rh-agent-cloud-function/strategies/base-strategy';

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const DRY_RUN   = process.argv.includes('--dry-run');
const OVERWRITE = process.argv.includes('--overwrite');

function argValue(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? process.argv[idx + 1] ?? null : null;
}

const SINGLE_SYMBOL = argValue('--symbol');
const FROM_DATE     = argValue('--from') ?? '2019-01-01';
const TO_DATE       = argValue('--to')   ?? new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SYMBOLS_COLLECTION      = 'rh-agent-symbols';
const RS_BARS_COLLECTION      = 'rs-bars';
const SIGNAL_HISTORY_SUB      = 'signal-history';
const BATCH_SIZE              = 400;
const BACKFILL_RUN_ID         = 'backfill-historical';

// Minimum bars required before running the strategy (matches worker)
const MIN_DAILY_BARS  = 45;
const MIN_WEEKLY_BARS = 30;
const MIN_MONTHLY_BARS = 30;

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

function initFirestore(): Firestore {
  const scriptDir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'));
  const repoRoot  = path.resolve(scriptDir, '..', '..');

  const keyPaths = [
    process.env.GOOGLE_APPLICATION_CREDENTIALS,
    path.join(repoRoot, 'keys', 'rel-str-firebase-adminsdk.json'),
    path.join(repoRoot, 'keys', 'rel-str-partner-caller-prod.json'),
    path.join(repoRoot, 'functions', 'service-account-key.json'),
  ].filter(Boolean) as string[];

  let app: App;
  for (const keyPath of keyPaths) {
    try {
      if (fs.existsSync(keyPath)) {
        const sa = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
        app = initializeApp({ credential: cert(sa), projectId: 'rel-str' });
        console.log(`✓ Firebase initialized with: ${path.basename(keyPath)}`);
        return getFirestore(app);
      }
    } catch (_) {}
  }

  app = initializeApp({ credential: applicationDefault(), projectId: 'rel-str' });
  console.log('✓ Firebase initialized with Application Default Credentials');
  return getFirestore(app);
}

// ---------------------------------------------------------------------------
// Bar helpers
// ---------------------------------------------------------------------------

interface OhlcBar {
  d?: string;
  date?: string;
  o?: number; open?: number;
  h?: number; high?: number;
  l?: number; low?: number;
  c?: number; close?: number;
  v?: number; volume?: number;
}

function barDate(b: OhlcBar): string {
  return (b.d ?? b.date ?? '').slice(0, 10);
}

/** Return all bars with date <= cutoff, sorted ascending. */
function barsUpTo(bars: OhlcBar[], cutoff: string): OhlcBar[] {
  return bars
    .filter(b => barDate(b) <= cutoff)
    .sort((a, b) => barDate(a).localeCompare(barDate(b)));
}

/** Most recent weekly/monthly bar date on or before the given daily date. */
function htfBarsUpTo(bars: OhlcBar[], cutoff: string): OhlcBar[] {
  return barsUpTo(bars, cutoff);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('\n=== Generate Historical Signal History ===');
  console.log(`Mode:      ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE'}`);
  console.log(`From:      ${FROM_DATE}`);
  console.log(`To:        ${TO_DATE}`);
  console.log(`Overwrite: ${OVERWRITE}`);
  if (SINGLE_SYMBOL) console.log(`Symbol:    ${SINGLE_SYMBOL}`);
  console.log('');

  const db = initFirestore();

  // 1. Get symbol list
  const symbolsRef  = db.collection(SYMBOLS_COLLECTION);
  const symbolsSnap = SINGLE_SYMBOL
    ? await symbolsRef.where('symbol', '==', SINGLE_SYMBOL).get()
    : await symbolsRef.get();

  if (symbolsSnap.empty) {
    console.log('No symbols found.');
    return;
  }

  const symbols = symbolsSnap.docs.map(d => d.id);
  console.log(`Found ${symbols.length} symbol(s).\n`);

  let totalSignals  = 0;
  let totalSkipped  = 0;
  let totalErrors   = 0;

  for (const symbol of symbols) {
    try {
      const { written, skipped } = await processSymbol(db, symbol);
      totalSignals += written;
      totalSkipped += skipped;
      console.log(`  ${symbol}: wrote ${written}, skipped ${skipped}`);
    } catch (err: any) {
      console.error(`  [ERROR] ${symbol}: ${err?.message}`);
      totalErrors++;
    }
  }

  console.log('\n=== Summary ===');
  console.log(`Symbols:  ${symbols.length}`);
  console.log(`Written:  ${totalSignals}`);
  console.log(`Skipped:  ${totalSkipped} (already existed)`);
  console.log(`Errors:   ${totalErrors}`);
  if (DRY_RUN) console.log('\n(DRY RUN — no data was written)');
}

// ---------------------------------------------------------------------------
// Per-symbol
// ---------------------------------------------------------------------------

async function processSymbol(
  db: Firestore,
  symbol: string
): Promise<{ written: number; skipped: number }> {

  // Load rs-bars
  const barsSnap = await db.collection(RS_BARS_COLLECTION).doc(symbol).get();
  if (!barsSnap.exists) {
    console.log(`  ${symbol}: no rs-bars doc — skip`);
    return { written: 0, skipped: 0 };
  }

  const data = barsSnap.data() as any;
  const allDaily:   OhlcBar[] = Array.isArray(data?.daily)   ? data.daily   : [];
  const allWeekly:  OhlcBar[] = Array.isArray(data?.weekly)  ? data.weekly  : [];
  const allMonthly: OhlcBar[] = Array.isArray(data?.monthly) ? data.monthly : [];

  if (allDaily.length === 0) {
    console.log(`  ${symbol}: no daily bars — skip`);
    return { written: 0, skipped: 0 };
  }

  // Filter to the requested date window
  const candidateDates = allDaily
    .map(b => barDate(b))
    .filter(d => d >= FROM_DATE && d <= TO_DATE)
    .sort();

  if (candidateDates.length === 0) {
    return { written: 0, skipped: 0 };
  }

  // Load existing signal-history docs to skip if not overwriting
  const historyRef = db.collection(SYMBOLS_COLLECTION).doc(symbol).collection(SIGNAL_HISTORY_SUB);
  let existingDates = new Set<string>();
  if (!OVERWRITE) {
    const existingSnap = await historyRef.get();
    existingDates = new Set(existingSnap.docs.map(d => d.id));
  }

  // Collect writes
  const toWrite: { barDate: string; signals: StrategyOutput[] }[] = [];

  for (const date of candidateDates) {
    if (!OVERWRITE && existingDates.has(date)) continue;

    const dailySlice   = barsUpTo(allDaily, date);
    const weeklySlice  = htfBarsUpTo(allWeekly, date);
    const monthlySlice = htfBarsUpTo(allMonthly, date);

    if (dailySlice.length < MIN_DAILY_BARS || weeklySlice.length < MIN_WEEKLY_BARS) continue;

    const input: StrategyInput = {
      symbol,
      marketDate: date,
      bars:         dailySlice   as any,
      weeklyBars:   weeklySlice  as any,
      monthlyBars:  monthlySlice.length >= MIN_MONTHLY_BARS ? (monthlySlice as any) : undefined,
    };

    const rawResult = runStrategy(input, {});
    const results: StrategyOutput[] = Array.isArray(rawResult) ? rawResult : [rawResult];
    const fired = results.filter(r => r.action && r.barDate === date);

    if (fired.length > 0) {
      toWrite.push({ barDate: date, signals: fired });
    }
  }

  if (toWrite.length === 0) {
    return { written: 0, skipped: existingDates.size };
  }

  if (DRY_RUN) {
    for (const { barDate: d, signals } of toWrite) {
      for (const s of signals) {
        console.log(`    [dry-run] ${symbol}/${d} → ${s.signalType} (${s.action})`);
      }
    }
    return { written: toWrite.length, skipped: existingDates.size };
  }

  // Write in batches
  let written = 0;
  for (let i = 0; i < toWrite.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const chunk = toWrite.slice(i, i + BATCH_SIZE);

    for (const { barDate: d, signals } of chunk) {
      const docRef = historyRef.doc(d);
      const signalsMap: Record<string, any> = {};
      for (const s of signals) {
        signalsMap[`signals.${s.signalType}`] = { ...s, sourceRunId: BACKFILL_RUN_ID };
      }
      batch.set(
        docRef,
        {
          symbol,
          date: d,
          updatedAt:       FieldValue.serverTimestamp(),
          canonicalizedAt: FieldValue.serverTimestamp(),
          ...signalsMap,
        },
        { merge: true }
      );
      written++;
    }

    await batch.commit();
  }

  return { written, skipped: existingDates.size };
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
