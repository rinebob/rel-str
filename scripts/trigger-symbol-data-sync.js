#!/usr/bin/env node
/**
 * Trigger Symbol-Data Sync Script
 *
 * Calls symbolDataSyncAdminHttp directly via the Firebase Functions REST API
 * using a service-account impersonation ID token so verifyAdminToken passes.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * USAGE
 * ─────────────────────────────────────────────────────────────────────────────
 *   node scripts/trigger-symbol-data-sync.js [options]
 *
 * Options:
 *   --symbols SYM1,SYM2,...   Comma-separated symbols (default: all)
 *   --force                   Force full backfill even if data exists
 *
 * Examples:
 *   node scripts/trigger-symbol-data-sync.js --symbols A
 *   node scripts/trigger-symbol-data-sync.js --symbols A,AAPL --force
 *   node scripts/trigger-symbol-data-sync.js --force
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AUTHENTICATION
 * ─────────────────────────────────────────────────────────────────────────────
 * Uses service account impersonation to generate an ID token with the correct
 * audience. Requires:
 *   gcloud auth login
 *   gcloud config set project rel-str
 *   gcloud iam service-accounts list   (to find the functions SA)
 *
 * The functions service account is typically:
 *   rel-str@appspot.gserviceaccount.com
 *
 * You must have the "Service Account Token Creator" role on that SA, or be
 * an owner/editor of the project.
 */

const { execSync } = require('child_process');

const PROJECT_ID = 'rel-str';
const REGION = 'us-central1';
const FUNCTION_NAME = 'symbolDataSyncAdminHttp';
const FUNCTION_URL = `https://${REGION}-${PROJECT_ID}.cloudfunctions.net/${FUNCTION_NAME}`;
const SERVICE_ACCOUNT = `${PROJECT_ID}@appspot.gserviceaccount.com`;

// --- Parse args ---
const args = process.argv.slice(2);
const getFlag = (flag) => args.includes(flag);
const getArg = (flag) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; };

const symbolsArg = getArg('--symbols');
const symbols = symbolsArg ? symbolsArg.split(',').map(s => s.trim().toUpperCase()) : undefined;
const forceFullFetch = getFlag('--force');

function getIdToken() {
  try {
    return execSync(
      `gcloud auth print-identity-token --impersonate-service-account=${SERVICE_ACCOUNT} --audiences=${FUNCTION_URL}`,
      { encoding: 'utf8' }
    ).trim();
  } catch (err) {
    console.error('Failed to get ID token via service account impersonation.');
    console.error('Ensure you have Service Account Token Creator role on:', SERVICE_ACCOUNT);
    console.error(err.message);
    process.exit(1);
  }
}

async function main() {
  const payload = {
    forceFullFetch,
    ...(symbols ? { symbols } : {}),
  };

  console.log(`\nTriggering symbolDataSyncAdminHttp:`);
  console.log(`  symbols:        ${symbols ? symbols.join(', ') : '(all)'}`);
  console.log(`  forceFullFetch: ${forceFullFetch}`);
  console.log('');

  const token = getIdToken();

  const response = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  const body = await response.json();

  if (!response.ok) {
    console.error('✗ Call failed:', JSON.stringify(body, null, 2));
    process.exit(1);
  }

  console.log('✓ Sync enqueued:');
  console.log(`  total:    ${body.total}`);
  console.log(`  enqueued: ${body.enqueued}`);
  console.log(`  errors:   ${body.errors}`);
  console.log(`  message:  ${body.message}`);
}

main().catch(err => {
  console.error('\n✗ Fatal error:', err?.message || err);
  process.exit(1);
});
