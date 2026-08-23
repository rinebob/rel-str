#!/usr/bin/env node
/**
 * Verification script for Task #172 — Spread chart migration to local bar store.
 *
 * Verifies that spread-viewer.store.ts uses LocalBarReadService instead of
 * RsBarsService, and that the toOHLCDatum helper is used for data conversion.
 *
 * Usage:
 *   node scripts/verify-spread-chart-migration.js
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const STORE_PATH = path.join(ROOT, 'src', 'app', 'features', 'rh-agent', 'stores', 'spread-viewer.store.ts');

let failures = 0;
let passes = 0;

function check(name, condition, detail) {
  if (condition) {
    console.log(`  \u2713 ${name}`);
    passes++;
  } else {
    console.log(`  \u2717 ${name}${detail ? ' \u2014 ' + detail : ''}`);
    failures++;
  }
}

console.log('=== Task #172 Verification: Spread chart migration to local bar store ===\n');

// 1. Store checks
console.log('1. Store checks');
const storeContent = fs.existsSync(STORE_PATH) ? fs.readFileSync(STORE_PATH, 'utf8') : '';
check('spread-viewer.store.ts exists', fs.existsSync(STORE_PATH));
check('imports LocalBarReadService', storeContent.includes('LocalBarReadService'));
check('does NOT import RsBarsService', !storeContent.includes('RsBarsService'));
check('uses localBarReadService.getDailyBarsForRange$', storeContent.includes('localBarReadService.getDailyBarsForRange$'));
check('does NOT call rsBarsService.getDailyBars$', !storeContent.includes('rsBarsService.getDailyBars$'));
check('uses toOHLCDatum for conversion', storeContent.includes('toOHLCDatum'));
check('uses getMarketDatePT for date', storeContent.includes('getMarketDatePT'));

// 2. getPairDailyBars callable NOT removed
console.log('\n2. getPairDailyBars callable preserved');
const indexContent = fs.readFileSync(path.join(ROOT, 'functions', 'src', 'index.ts'), 'utf8');
check('getPairDailyBars callable still exported', indexContent.includes('getPairDailyBars'));

// 3. Run tests
console.log('\n3. Run unit tests');
try {
  execSync('npx jest --config jest.config.js --testPathPatterns "local-bar-read|ohlc-datum" --no-coverage', {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 60000,
    stdio: 'pipe',
  });
  check('LocalBarReadService + toOHLCDatum unit tests pass', true);
} catch (e) {
  check('LocalBarReadService + toOHLCDatum unit tests pass', false, e.stdout || e.message);
}

// 4. Summary
console.log(`\n=== Summary: ${passes} passed, ${failures} failed ===`);
process.exit(failures > 0 ? 1 : 0);
