#!/usr/bin/env node
/**
 * Trigger RH Agent Manual Run Script
 *
 * Calls rhAgentManualRun directly via the Firebase Functions REST API.
 * Supports targeting specific symbols and/or a specific market date.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * USAGE
 * ─────────────────────────────────────────────────────────────────────────────
 *   node scripts/trigger-rh-agent-run.js [options]
 *
 * Options:
 *   --date YYYY-MM-DD        Override market date (default: today)
 *   --symbols SYM1,SYM2,...  Comma-separated list of symbols (default: all enabled)
 *
 * Examples:
 *   node scripts/trigger-rh-agent-run.js --date 2026-06-20
 *   node scripts/trigger-rh-agent-run.js --date 2026-06-20 --symbols AAPL,MSFT,NVDA
 *   node scripts/trigger-rh-agent-run.js --symbols ABT,XLY,WMT
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AUTHENTICATION
 * ─────────────────────────────────────────────────────────────────────────────
 * Uses gcloud to call the function — no service account key needed.
 * Must be logged in:
 *   gcloud auth login
 */

const PROJECT_ID = 'rel-str';
const REGION = 'us-central1';
const FUNCTION_NAME = 'rhAgentManualRun';

// --- Parse args ---
const args = process.argv.slice(2);
const getArg = (flag) => {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : null;
};

const dateArg = getArg('--date');
const symbolsArg = getArg('--symbols');
const symbols = symbolsArg ? symbolsArg.split(',').map(s => s.trim().toUpperCase()) : undefined;
const date = dateArg || new Date().toISOString().slice(0, 10);

// --- Invoke callable via fetch + gcloud identity-token ---
const { execSync } = require('child_process');

/** Get a current gcloud access token for authenticated callable invocation. */
function getAccessToken() {
  return execSync('gcloud auth print-access-token', { encoding: 'utf8' }).trim();
}

/** Trigger rhAgentManualRun for the configured date and optional symbol list. */
async function main() {
  const payload = { date, ...(symbols ? { symbols } : {}) };

  console.log(`\nTriggering rhAgentManualRun:`);
  console.log(`  date:    ${date}`);
  console.log(`  symbols: ${symbols ? symbols.join(', ') : '(all enabled)'}`);
  console.log('');

  const url = `https://${REGION}-${PROJECT_ID}.cloudfunctions.net/${FUNCTION_NAME}`;
  const token = getAccessToken();

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ data: payload }),
  });

  const body = await response.json();

  if (!response.ok) {
    console.error('✗ Call failed:', JSON.stringify(body, null, 2));
    process.exit(1);
  }

  const result = body.result ?? body;
  console.log('✓ Run triggered:');
  console.log(`  runId:         ${result.runId}`);
  console.log(`  status:        ${result.status}`);
  console.log(`  totalSymbols:  ${result.totalSymbols}`);
  console.log(`  enqueued:      ${result.enqueued}`);
  console.log(`  message:       ${result.message}`);
}

main().catch(err => {
  console.error('\n✗ Fatal error:', err?.message || err);
  process.exit(1);
});
