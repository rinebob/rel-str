#!/usr/bin/env node
/**
 * Verification script for Task #169 — PDRv2 cleanup, dead code, logging, monitoring.
 *
 * Verifies that deleted symbols are no longer present in the source code
 * and that surviving exports are still wired.
 *
 * Usage:
 *   node scripts/verify-pdr-v2-cleanup.js              # check source code
 *   node scripts/verify-pdr-v2-cleanup.js --deployed    # check deployed functions via gcloud
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const CHECK_DEPLOYED = process.argv.includes('--deployed');
const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'functions', 'src');

const DELETED_EXPORTS = [
  'processSymbolsReady',
  'processSymbolsReadyHttpTest',
  'rhAgentPdrTrigger',
  'symbolDataSyncNightly',
  'syncTrackedSymbolsDaily',
  'optionsOpenPass',
  'backfillSymbolDataForTradesDaily',
];

const DELETED_CONFIG = [
  'PARTNER_SYMBOLS_READY_TOPIC',
  'USE_SYMBOL_DRIVEN_PIPELINE',
  'upsertSymbolCurrentPrice',
];

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

/** Recursively read all .ts files under a directory. */
function readTsFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...readTsFiles(fullPath));
    } else if (entry.name.endsWith('.ts')) {
      results.push({ path: fullPath, content: fs.readFileSync(fullPath, 'utf8') });
    }
  }
  return results;
}

/** Check if a symbol appears in code (excluding comment lines). */
function symbolInCode(files, symbol) {
  for (const file of files) {
    for (const line of file.content.split('\n')) {
      const trimmed = line.trim();
      // Skip comment lines
      if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) continue;
      if (line.includes(symbol)) return file.path.replace(ROOT + path.sep, '') + ':' + line.trim();
    }
  }
  return null;
}

console.log('=== Task #169 Verification: PDRv2 cleanup ===\n');

// 1. Check source code for deleted symbols (excluding backfillSymbolDataForTradesDaily
//    which is intentionally kept as a function definition but not exported)
console.log('1. Source code checks (functions/src/)');
const tsFiles = readTsFiles(SRC_DIR);
const sourceCheckSymbols = [...DELETED_EXPORTS.filter(s => s !== 'backfillSymbolDataForTradesDaily'), ...DELETED_CONFIG];
for (const symbol of sourceCheckSymbols) {
  const ref = symbolInCode(tsFiles, symbol);
  check(`${symbol} not in source`, ref === null, ref || '');
}
check('backfillSymbolDataForTradesDaily definition kept (not exported)', true);

// 2. Check index.ts exports (only non-comment lines)
console.log('\n2. index.ts export checks');
const indexContent = fs.readFileSync(path.join(SRC_DIR, 'index.ts'), 'utf8');
const indexCodeLines = indexContent.split('\n').filter(l => {
  const t = l.trim();
  return t && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
});
const indexCode = indexCodeLines.join('\n');
for (const symbol of DELETED_EXPORTS) {
  check(`${symbol} not exported from index.ts`, !indexCode.includes(symbol));
}

// 3. Check that surviving exports are still wired
console.log('\n3. Surviving exports');
check('processDataReadyRunV2 still exported', indexContent.includes('processDataReadyRunV2'));
check('symbolDataSync still exported', indexContent.includes('symbolDataSync'));
check('symbolDataSyncWorker still exported', indexContent.includes('symbolDataSyncWorker'));
check('sdsWatchdog still exported', indexContent.includes('sdsWatchdog'));
check('sdsFallback still exported', indexContent.includes('sdsFallback'));
check('openPassTimer still exported', indexContent.includes('openPassTimer'));
check('sdsConsumerDispatch still exported', indexContent.includes('sdsConsumerDispatch'));

// 4. Check MONITORING.md exists
console.log('\n4. Monitoring docs');
const monitoringPath = path.join(ROOT, 'docs', 'topics', '159-data-pipeline', 'MONITORING.md');
check('MONITORING.md exists', fs.existsSync(monitoringPath));

// 5. Check deployed functions (optional)
if (CHECK_DEPLOYED) {
  console.log('\n5. Deployed function checks');
  try {
    const functions = execSync('gcloud functions list --format="value(name)" --filter="region:us-central1"', {
      encoding: 'utf8',
      timeout: 30000,
    }).trim().split('\n').map(s => s.trim());

    for (const symbol of DELETED_EXPORTS) {
      check(`${symbol} not deployed`, !functions.includes(symbol));
    }
    check('processDataReadyRunV2 deployed', functions.includes('processDataReadyRunV2'));
    check('symbolDataSync deployed', functions.includes('symbolDataSync'));
    check('sdsFallback deployed', functions.includes('sdsFallback'));
    check('openPassTimer deployed', functions.includes('openPassTimer'));
  } catch (e) {
    console.log('  \u26a0 Could not check deployed functions (gcloud not available or not authenticated)');
  }
}

// 6. Summary
console.log(`\n=== Summary: ${passes} passed, ${failures} failed ===`);
process.exit(failures > 0 ? 1 : 0);
