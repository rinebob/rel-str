#!/usr/bin/env node
/**
 * Verification script for Task #171 — Option chart migration to local bar store.
 *
 * Verifies that options-contract-viewer.store.ts uses LocalBarReadService
 * instead of RsBarsService, and that LocalBarReadService has the
 * getDailyBarsForRange$ method needed by the store.
 *
 * Usage:
 *   node scripts/verify-option-chart-migration.js
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const STORE_PATH = path.join(ROOT, 'src', 'app', 'features', 'rh-agent', 'stores', 'options-contract-viewer.store.ts');
const SERVICE_PATH = path.join(ROOT, 'src', 'app', 'core', 'services', 'local-bar-read.service.ts');

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

console.log('=== Task #171 Verification: Option chart migration to local bar store ===\n');

// 1. Store checks
console.log('1. Store checks');
const storeContent = fs.existsSync(STORE_PATH) ? fs.readFileSync(STORE_PATH, 'utf8') : '';
check('options-contract-viewer.store.ts exists', fs.existsSync(STORE_PATH));
check('imports LocalBarReadService', storeContent.includes('LocalBarReadService'));
check('does NOT import RsBarsService', !storeContent.includes('RsBarsService'));
check('uses localBarReadService.getDailyBarsForRange$', storeContent.includes('localBarReadService.getDailyBarsForRange$'));
check('does NOT call rsBarsService.getDailyBars$', !storeContent.includes('rsBarsService.getDailyBars$'));
check('has OhlcBar → OHLCDatum conversion', storeContent.includes('toOHLCDatum'));

// 2. Service checks
console.log('\n2. Service checks');
const serviceContent = fs.existsSync(SERVICE_PATH) ? fs.readFileSync(SERVICE_PATH, 'utf8') : '';
check('local-bar-read.service.ts exists', fs.existsSync(SERVICE_PATH));
check('getDailyBarsForRange$ method exists', serviceContent.includes('getDailyBarsForRange$'));
check('getDailyBarsForRange$ uses Promise.allSettled', serviceContent.includes('Promise.allSettled'));

// 3. getPairDailyBars callable NOT removed
console.log('\n3. getPairDailyBars callable preserved');
const indexContent = fs.readFileSync(path.join(ROOT, 'functions', 'src', 'index.ts'), 'utf8');
check('getPairDailyBars callable still exported', indexContent.includes('getPairDailyBars'));

// 4. Run tests
console.log('\n4. Run unit tests');
try {
  execSync('npx jest --config jest.config.js --testPathPatterns "local-bar-read" --no-coverage', {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 60000,
    stdio: 'pipe',
  });
  check('LocalBarReadService unit tests pass', true);
} catch (e) {
  check('LocalBarReadService unit tests pass', false, e.stdout || e.message);
}

// 5. Summary
console.log(`\n=== Summary: ${passes} passed, ${failures} failed ===`);
process.exit(failures > 0 ? 1 : 0);
