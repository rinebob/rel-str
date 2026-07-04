/**
 * Generate Historical Signal History
 *
 * One-time backfill script: computes the full ST Trend Rider indicator series
 * for each rh-agent symbol exactly like the chart callable does, then writes
 * every signal to signal-history/{barDate}. This guarantees the left-side signal
 * list and the right-side chart dots are generated from the exact same source.
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
 *   --wipeout              Delete all existing signal-history docs for each symbol before regenerating.
 *
 * Full usage guide, examples, and safety rules:
 *   docs/implementations/RS-BE-SIGNALS-BACKFILL-GUIDE_how-to-use-generate-historical-signal-history.md
 */
import { initializeApp, cert, applicationDefault, App } from 'firebase-admin/app';
import { getFirestore, Firestore, FieldValue } from 'firebase-admin/firestore';
import * as fs from 'fs';
import * as path from 'path';

import { computeSymbolIndicatorSeries } from '../src/rh-agent-cloud-function/rh-agent-indicator-computation';
import type { OhlcBar as CallableOhlcBar } from '../src/rh-agent-cloud-function/rh-agent-types';
import { StSignalDirection } from '../src/rh-agent-cloud-function/rh-agent-config';
import type { StrategyOutput } from '../src/rh-agent-cloud-function/strategies/base-strategy';

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const DRY_RUN   = process.argv.includes('--dry-run');
const OVERWRITE = process.argv.includes('--overwrite');
const WIPEOUT   = process.argv.includes('--wipeout');
const CSV       = process.argv.includes('--csv');

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

/** Normalize rs-bars arrays into the exact shape the callable consumes. */
function normalizeToCallableBars(
  daily: OhlcBar[],
  weekly: OhlcBar[],
  monthly: OhlcBar[],
): { daily: CallableOhlcBar[]; weekly: CallableOhlcBar[]; monthly: CallableOhlcBar[] } {
  const toCallable = (bars: OhlcBar[]): CallableOhlcBar[] =>
    bars.map(b => ({
      d: barDate(b),
      o: b.o ?? b.open ?? 0,
      h: b.h ?? b.high ?? 0,
      l: b.l ?? b.low ?? 0,
      c: b.c ?? b.close ?? 0,
      v: b.v ?? b.volume,
    }));
  return { daily: toCallable(daily), weekly: toCallable(weekly), monthly: toCallable(monthly) };
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
  if (WIPEOUT) {
    console.log(`Skipped:  ${totalSkipped} (not tracked during wipeout)`);
  } else {
    console.log(`Skipped:  ${totalSkipped} (already existed)`);
  }
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
    .map((b: OhlcBar) => barDate(b))
    .filter((d: string) => d >= FROM_DATE && d <= TO_DATE)
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

  // Wipeout: in live mode delete existing docs; in dry-run mode simulate the wipeout
  if (WIPEOUT) {
    const existingSnap = await historyRef.get();
    if (existingSnap.docs.length > 0) {
      if (DRY_RUN) {
        console.log(`  ${symbol}: would wipe ${existingSnap.docs.length} existing signal-history docs`);
      } else {
        let deleted = 0;
        for (let i = 0; i < existingSnap.docs.length; i += BATCH_SIZE) {
          const batch = db.batch();
          for (const doc of existingSnap.docs.slice(i, i + BATCH_SIZE)) {
            batch.delete(doc.ref);
            deleted++;
          }
          await batch.commit();
        }
        console.log(`  ${symbol}: wiped ${deleted} existing signal-history docs`);
      }
    }
    // After wipeout, nothing is "existing" anymore
    existingDates = new Set<string>();
  }

  // Compute the full indicator series exactly like the chart callable
  const callableBars = normalizeToCallableBars(allDaily, allWeekly, allMonthly);
  const series = computeSymbolIndicatorSeries(symbol, callableBars.daily, callableBars.weekly, callableBars.monthly);

  // Collect every ST Trend Rider signal and group by bar date
  const signalsByDate = new Map<string, StrategyOutput[]>();
  const addSignal = (barDate: string, s: StrategyOutput) => {
    const list = signalsByDate.get(barDate) ?? [];
    list.push(s);
    signalsByDate.set(barDate, list);
  };

  for (const [, intervalData] of Object.entries(series.intervals)) {
    const signals = intervalData?.signals ?? {};
    for (const [family, markers] of Object.entries(signals)) {
      if (!markers || !family.startsWith('zone')) continue;
      for (const m of markers) {
        if (!m.d) continue;
        addSignal(m.d, {
          action: m.direction === 'long' ? StSignalDirection.LONG : StSignalDirection.SHORT,
          confidence: 0,
          reason: m.reason,
          signalType: m.signalType,
          barDate: m.d,
          indicators: {},
        });
      }
    }
  }

  // Filter to requested date range and apply skip/existing logic
  const toWrite: { barDate: string; signals: StrategyOutput[] }[] = [];
  for (const date of candidateDates) {
    if (!OVERWRITE && existingDates.has(date)) continue;
    const fired = signalsByDate.get(date) ?? [];
    if (fired.length > 0) {
      toWrite.push({ barDate: date, signals: fired });
    }
  }

  if (toWrite.length === 0) {
    return { written: 0, skipped: existingDates.size };
  }

  if (DRY_RUN) {
    if (CSV) {
      for (const { barDate: d, signals } of toWrite) {
        for (const s of signals) {
          console.log(`${d},${s.signalType},${s.action}`);
        }
      }
    } else {
      for (const { barDate: d, signals } of toWrite) {
        for (const s of signals) {
          console.log(`    [dry-run] ${symbol}/${d} → ${s.signalType} (${s.action})`);
        }
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
