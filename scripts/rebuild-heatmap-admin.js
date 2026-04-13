#!/usr/bin/env node
/**
 * Rebuild heatmap snapshots using Firebase Admin SDK
 * This script properly authenticates with Firebase to call the rebuildHeatmapSnapshotAdmin function
 * 
 * Usage:
 *   node rebuild-heatmap-admin.js [baseline] [--all]
 * 
 * Examples:
 *   node rebuild-heatmap-admin.js QQQ
 *   node rebuild-heatmap-admin.js --all
 */

const path = require('path');

// Load firebase-admin from functions/node_modules
const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));

// Initialize Firebase Admin
// Try multiple possible service account key locations
const possiblePaths = [
  path.join(__dirname, '..', 'keys', 'rel-str-firebase-adminsdk.json'),
  path.join(__dirname, '..', 'keys', 'rel-str-partner-caller-prod.json'),
];

let serviceAccount;
let usedPath;
for (const keyPath of possiblePaths) {
  try {
    serviceAccount = require(keyPath);
    usedPath = keyPath;
    break;
  } catch (e) {
    // Try next path
  }
}

if (!serviceAccount) {
  console.error('Error: Could not find service account key in any of these locations:');
  possiblePaths.forEach(p => console.error('  -', p));
  console.error('\nPlease ensure a service account key file exists.');
  process.exit(1);
}

console.log('Using service account key:', path.basename(usedPath));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: 'rel-str'
});

const allBaselines = ['SPY', 'QQQ', 'XLB', 'XLC', 'XLE', 'XLF', 'XLI', 'XLK', 'XLP', 'XLU', 'XLV', 'XLY', 'XME', 'XPH', 'XSD'];

async function rebuildSnapshot(baseline) {
  console.log(`\nRebuilding ${baseline}-DAILY-2026-H1...`);
  
  try {
    const rebuildHeatmapSnapshotAdmin = admin.functions().httpsCallable('rebuildHeatmapSnapshotAdmin');
    
    const result = await rebuildHeatmapSnapshotAdmin({
      baseline: baseline,
      timeframe: 'DAILY',
      year: 2026,
      half: 1
    });
    
    const data = result.data;
    
    if (data.ok) {
      console.log(`✓ Success - pairs: ${data.pairs}, dates: ${data.dates}, docId: ${data.docId}`);
      return { success: true, baseline, data };
    } else {
      console.error(`✗ Failed: ${data.message}`);
      return { success: false, baseline, error: data.message };
    }
  } catch (error) {
    console.error(`✗ Error: ${error.message}`);
    return { success: false, baseline, error: error.message };
  }
}

async function main() {
  const args = process.argv.slice(2);
  
  let baselinesToProcess;
  if (args.includes('--all')) {
    baselinesToProcess = allBaselines;
  } else if (args.length > 0 && !args[0].startsWith('--')) {
    baselinesToProcess = [args[0].toUpperCase()];
  } else {
    console.log('Usage: node rebuild-heatmap-admin.js [baseline] [--all]');
    console.log('Examples:');
    console.log('  node rebuild-heatmap-admin.js QQQ');
    console.log('  node rebuild-heatmap-admin.js --all');
    process.exit(1);
  }
  
  console.log('========================================');
  console.log('Rebuild Heatmap Snapshots (2026-H1)');
  console.log('========================================');
  console.log(`Baselines: ${baselinesToProcess.join(', ')}`);
  
  const results = [];
  
  for (const baseline of baselinesToProcess) {
    const result = await rebuildSnapshot(baseline);
    results.push(result);
    
    // Small delay between requests
    if (baselinesToProcess.length > 1) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  
  // Summary
  const successCount = results.filter(r => r.success).length;
  const failureCount = results.filter(r => !r.success).length;
  
  console.log('\n========================================');
  console.log('Summary');
  console.log('========================================');
  console.log(`Total: ${results.length}`);
  console.log(`Success: ${successCount}`);
  console.log(`Failures: ${failureCount}`);
  
  if (failureCount > 0) {
    console.log('\nFailed shards:');
    results.filter(r => !r.success).forEach(r => {
      console.log(`  - ${r.baseline}: ${r.error}`);
    });
  }
  
  process.exit(failureCount > 0 ? 1 : 0);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
