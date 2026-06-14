/**
 * Seed RH Agent Test Data from Production
 *
 * One-time script to pull real data from prod Firestore and seed emulator:
 * - Top 20 symbols from symbol-data (by market cap or just first 20 enabled)
 * - Their rs-symbol-cache bar data for latest market date
 * - Exports to .firebase/emulator-data for persistence
 *
 * Usage:
 *   cd functions
 *   npx tsx scripts/seed-rh-agent-from-prod.ts
 *
 * Prerequisites:
 *   - Service account key with prod Firestore read access
 *   - Firebase CLI for emulator export
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// Top 20 by market cap (hardcoded - update as needed)
const TOP_20_SYMBOLS = [
  'AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN', 'META', 'TSLA', 'AVGO', 'JPM', 'V',
  'UNH', 'JNJ', 'XOM', 'MA', 'PG', 'HD', 'CVX', 'LLY', 'MRK', 'KO'
];

// Config
const PROD_PROJECT_ID = 'rel-str';
const EMULATOR_HOST = 'localhost:8088';
const EXPORT_DIR = path.join(process.cwd(), '..', '.firebase', 'emulator-data');

/**
 * Initialize prod Firestore connection
 */
function initProdFirestore() {
  // Check for service account
  const saPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!saPath || !fs.existsSync(saPath)) {
    console.error('❌ Set GOOGLE_APPLICATION_CREDENTIALS to service account JSON');
    console.error('   Example: set GOOGLE_APPLICATION_CREDENTIALS=C:\\path\\to\\sa-key.json');
    process.exit(1);
  }

  const app = initializeApp({
    credential: cert(saPath),
    projectId: PROD_PROJECT_ID,
  }, 'prod');

  return getFirestore(app);
}

/**
 * Initialize emulator Firestore connection
 */
function initEmulatorFirestore() {
  process.env.FIRESTORE_EMULATOR_HOST = EMULATOR_HOST;

  const app = initializeApp({
    projectId: 'rel-str',
  }, 'emulator');

  return getFirestore(app);
}

/**
 * Fetch symbol metadata from prod
 */
async function fetchSymbolMetadata(prodDb: any, symbols: string[]) {
  console.log(`📊 Fetching metadata for ${symbols.length} symbols...`);

  const metadata: any[] = [];
  const batchSize = 10;

  for (let i = 0; i < symbols.length; i += batchSize) {
    const batch = symbols.slice(i, i + batchSize);
    const snaps = await Promise.all(
      batch.map((sym) => prodDb.collection('symbol-data').doc(sym).get())
    );

    snaps.forEach((snap, idx) => {
      if (snap.exists) {
        metadata.push({
          symbol: batch[idx],
          ...snap.data(),
        });
      }
    });

    console.log(`   ✓ Batch ${i / batchSize + 1}: ${batch.length} symbols`);
  }

  console.log(`📊 Found ${metadata.length} symbols with metadata`);
  return metadata;
}

/**
 * Find latest market date with rs-symbol-cache data
 */
async function findLatestMarketDate(prodDb: any): Promise<string | null> {
  console.log('🔍 Finding latest market date in rs-symbol-cache...');

  const snapshot = await prodDb
    .collection('rs-symbol-cache')
    .orderBy('__name__', 'desc')
    .limit(1)
    .get();

  if (snapshot.empty) {
    console.error('❌ No rs-symbol-cache data found');
    return null;
  }

  const latestDate = snapshot.docs[0].id;
  console.log(`📅 Latest market date: ${latestDate}`);
  return latestDate;
}

/**
 * Fetch bar data from rs-symbol-cache for specific symbols
 */
async function fetchBarData(prodDb: any, symbols: string[], marketDate: string) {
  console.log(`📈 Fetching bar data for ${symbols.length} symbols (${marketDate})...`);

  const barData: Record<string, any> = {};
  const batchSize = 5;

  for (let i = 0; i < symbols.length; i += batchSize) {
    const batch = symbols.slice(i, i + batchSize);
    const snaps = await Promise.all(
      batch.map((sym) =>
        prodDb
          .collection('rs-symbol-cache')
          .doc(marketDate)
          .collection('symbols')
          .doc(sym)
          .get()
      )
    );

    snaps.forEach((snap, idx) => {
      if (snap.exists) {
        barData[batch[idx]] = snap.data();
      }
    });

    console.log(`   ✓ Batch ${i / batchSize + 1}: ${batch.length} symbols`);
  }

  const foundCount = Object.keys(barData).length;
  console.log(`📈 Found bar data for ${foundCount}/${symbols.length} symbols`);

  return barData;
}

/**
 * Seed emulator Firestore
 */
async function seedEmulator(emuDb: any, metadata: any[], barData: Record<string, any>, marketDate: string) {
  console.log('🌱 Seeding emulator Firestore...');

  // 1. Create rh-agent-symbols collection
  console.log('   Creating rh-agent-symbols...');
  for (let i = 0; i < metadata.length; i++) {
    const meta = metadata[i];
    await emuDb.collection('rh-agent-symbols').doc(meta.symbol).set({
      symbol: meta.symbol,
      name: meta.name || meta.symbol,
      enabled: true,
      priority: i + 1,
      addedAt: Timestamp.now(),
    });
  }
  console.log(`   ✓ ${metadata.length} symbols in rh-agent-symbols`);

  // 2. Create rs-symbol-cache/{marketDate}/symbols/{symbol}
  console.log(`   Creating rs-symbol-cache/${marketDate}...`);
  const symbolsWithData = Object.keys(barData);

  for (const symbol of symbolsWithData) {
    const data = barData[symbol];
    await emuDb
      .collection('rs-symbol-cache')
      .doc(marketDate)
      .collection('symbols')
      .doc(symbol)
      .set({
        dailyBars: data.dailyBars || [],
        weeklyBars: data.weeklyBars || null,
        monthlyBars: data.monthlyBars || null,
        fetchedAt: data.fetchedAt || Timestamp.now(),
        runId: data.runId || null,
      });
  }
  console.log(`   ✓ ${symbolsWithData.length} symbols in rs-symbol-cache`);

  // 3. Create symbol-data for reference
  console.log('   Creating symbol-data...');
  for (const meta of metadata) {
    await emuDb.collection('symbol-data').doc(meta.symbol).set({
      symbol: meta.symbol,
      name: meta.name || null,
      currentPrice: meta.currentPrice || null,
      currency: meta.currency || null,
      region: meta.region || null,
      type: meta.type || null,
    });
  }
  console.log(`   ✓ ${metadata.length} symbols in symbol-data`);

  console.log('🌱 Emulator seed complete!');
}

/**
 * Export emulator data to disk
 */
function exportEmulatorData() {
  console.log('💾 Exporting emulator data...');

  // Ensure directory exists
  if (!fs.existsSync(EXPORT_DIR)) {
    fs.mkdirSync(EXPORT_DIR, { recursive: true });
  }

  try {
    // Note: This requires emulators to be running
    // We'll provide instructions instead
    console.log(`\n⚠️  To export data, run:`);
    console.log(`   firebase emulators:export ${EXPORT_DIR} --force`);
    console.log(`\n   Or wait for auto-export on emulator stop (--export-on-exit flag)`);
  } catch (e: any) {
    console.error('Export failed:', e?.message);
  }
}

/**
 * Main
 */
async function main() {
  console.log('🚀 RH Agent Seed Script - Production → Emulator\n');

  try {
    // Init connections
    const prodDb = initProdFirestore();
    const emuDb = initEmulatorFirestore();

    // Fetch from prod
    const metadata = await fetchSymbolMetadata(prodDb, TOP_20_SYMBOLS);
    if (metadata.length === 0) {
      console.error('❌ No symbol metadata found');
      process.exit(1);
    }

    const marketDate = await findLatestMarketDate(prodDb);
    if (!marketDate) {
      console.error('❌ No market date found');
      process.exit(1);
    }

    const barData = await fetchBarData(
      prodDb,
      metadata.map((m) => m.symbol),
      marketDate
    );

    // Seed emulator
    await seedEmulator(emuDb, metadata, barData, marketDate);

    // Export instructions
    exportEmulatorData();

    console.log('\n✅ Done! Summary:');
    console.log(`   - ${metadata.length} symbols with metadata`);
    console.log(`   - ${Object.keys(barData).length} symbols with bar data`);
    console.log(`   - Market date: ${marketDate}`);
    console.log(`\n📝 Next steps:`);
    console.log(`   1. Start emulators: npm run emulators:start`);
    console.log(`   2. Test scheduler: curl http://localhost:5002/rel-str/us-central1/rhAgentDailyScheduler`);
    console.log(`   3. Check Firestore: http://localhost:4000/firestore`);

    process.exit(0);
  } catch (error: any) {
    console.error('\n❌ Fatal error:', error?.message);
    console.error(error?.stack);
    process.exit(1);
  }
}

main();
