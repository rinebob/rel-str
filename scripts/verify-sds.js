#!/usr/bin/env node
/**
 * Verify SDS (symbolDataSync) end-to-end against prod.
 *
 * Publishes a crafted PDR message to the partner-data-ready topic, then polls
 * Firestore for the expected run doc, sequence doc, and symbol-data writes.
 *
 * USAGE
 *   node scripts/verify-sds.js --phase post --sequence A --interval DAILY [options]
 *   node scripts/verify-sds.js --phase pre [options]
 *
 * Options:
 *   --phase post|pre          PDR phase (default: post)
 *   --sequence A|B|C          POST sequence (default: A)
 *   --interval DAILY|WEEKLY|MONTHLY  POST interval (default: DAILY)
 *   --symbols SYM1,SYM2       Comma-separated symbols for includeSymbols (B/C)
 *   --exclude SYM1,SYM2       Comma-separated symbols for excludeSymbols (A)
 *   --market-date YYYY-MM-DD  Override marketDate (default: today ET)
 *   --wait-seconds N          Max seconds to poll for results (default: 120)
 *   --dry-run                 Print message without publishing
 *
 * Prerequisites:
 *   - gcloud auth login, gcloud config set project rel-str
 *   - SDS function deployed (symbolDataSync, symbolDataSyncWorker)
 *   - firebase-admin available: cd functions && npm install
 */

const { execSync } = require('child_process');
const { pollForResult } = require('./verify-sds-helpers');
let admin; // lazy-loaded only when needed (verification phase)

// ── Args ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const getFlag = (flag) => args.includes(flag);
const getArg = (flag) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; };

const phase = (getArg('--phase') || 'post').toLowerCase();
const sequence = (getArg('--sequence') || 'A').toUpperCase();
const interval = (getArg('--interval') || 'DAILY').toUpperCase();
const symbolsArg = getArg('--symbols');
const excludeArg = getArg('--exclude');
const marketDateArg = getArg('--market-date');
const waitSeconds = parseInt(getArg('--wait-seconds') || '120', 10);
const dryRun = getFlag('--dry-run');

// ── Constants ────────────────────────────────────────────────────────

const PARTNER_PROJECT = 'alpha-vantage-proxy-api';
const PARTNER_TOPIC = 'partner-data-ready';

// ── Helpers ──────────────────────────────────────────────────────────

function getMarketDateET() {
  if (marketDateArg) return marketDateArg;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function getDowAbbrev(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][date.getUTCDay()];
}

function buildRunId(marketDate, phase, sequence, interval) {
  if (phase === 'pre') {
    const hhmm = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).format(new Date()).replace(':', '');
    return `${marketDate}-${getDowAbbrev(marketDate)}-LIVE-${hhmm}`;
  }
  const clockMap = { A: '1335', B: '1800', C: '0400' };
  return `${marketDate}-${getDowAbbrev(marketDate)}-POST-${sequence}-${clockMap[sequence]}-${interval}`;
}

function buildPayload(marketDate, phase, sequence, interval) {
  if (phase === 'pre') {
    return {
      version: 'v1', runId: buildRunId(marketDate, phase, sequence, interval),
      phase: 'pre', intervals: ['intraday'], time: Date.now(), marketDate,
      env: 'production', status: 'end', runStatus: 'completed',
      finalizedCountTotal: 5, pendingCount: 0, trigger: 'manual',
    };
  }
  const payload = {
    version: 'v1', runId: buildRunId(marketDate, phase, sequence, interval),
    phase: 'post', intervals: [interval.toLowerCase()], time: Date.now(), marketDate,
    env: 'production', status: 'end', runStatus: 'completed',
    finalizedCountTotal: 5, pendingCount: 0, trigger: 'manual',
  };
  if (sequence === 'A') {
    payload.excludeSymbols = excludeArg ? excludeArg.split(',').map(s => s.trim().toUpperCase()) : [];
  } else {
    payload.includeSymbols = symbolsArg ? symbolsArg.split(',').map(s => s.trim().toUpperCase()) : ['AAPL'];
  }
  return payload;
}

function buildAttributes(marketDate, phase, sequence, interval) {
  const attrs = {
    runId: buildRunId(marketDate, phase, sequence, interval),
    version: 'v1', phase, marketDate, env: 'production',
  };
  if (phase === 'pre') {
    attrs.runType = 'intraday-snapshot';
    attrs.clockPt = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).format(new Date()).replace(':', '');
  } else {
    attrs.runType = 'ts-post-all-intervals';
    attrs.interval = interval.toLowerCase();
  }
  return attrs;
}

function publishMessage(topic, payload, attributes) {
  // Escape double quotes in JSON for the shell — wrap in double quotes and escape inner quotes.
  // This works on both cmd.exe and MINGW64 (bash).
  const message = JSON.stringify(payload).replace(/"/g, '\\"');
  const attrFlags = Object.entries(attributes).map(([k, v]) => `${k}=${v}`).join(',');
  const cmd = `gcloud pubsub topics publish ${topic} --project ${PARTNER_PROJECT} --message="${message}" --attribute=${attrFlags}`;
  console.log('Publishing via gcloud...');
  console.log(`  topic:      projects/${PARTNER_PROJECT}/topics/${PARTNER_TOPIC}`);
  console.log(`  runId:      ${attributes.runId}`);
  console.log(`  phase:      ${attributes.phase}`);
  if (attributes.interval) console.log(`  interval:   ${attributes.interval}`);
  if (attributes.clockPt) console.log(`  clockPt:    ${attributes.clockPt}`);
  console.log('');
  return execSync(cmd, { encoding: 'utf8', stdio: 'pipe' }).trim();
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  const marketDate = getMarketDateET();
  const runId = buildRunId(marketDate, phase, sequence, interval);
  const payload = buildPayload(marketDate, phase, sequence, interval);
  const attributes = buildAttributes(marketDate, phase, sequence, interval);

  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('  SDS Verification');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log(`  marketDate: ${marketDate}`);
  console.log(`  phase:      ${phase}`);
  if (phase === 'post') { console.log(`  sequence:   ${sequence}`); console.log(`  interval:   ${interval}`); }
  console.log(`  runId:      ${runId}`);
  console.log('');
  console.log('Payload:');
  console.log(JSON.stringify(payload, null, 2));
  console.log('');
  console.log('Attributes:');
  console.log(JSON.stringify(attributes, null, 2));
  console.log('');

  if (dryRun) { console.log('--dry-run: not publishing. Exiting.'); return; }

  const topic = `projects/${PARTNER_PROJECT}/topics/${PARTNER_TOPIC}`;
  console.log('Publish result:', publishMessage(topic, payload, attributes));
  console.log('');

  admin = require('../functions/node_modules/firebase-admin');
  admin.initializeApp({ projectId: 'rel-str' });
  const db = admin.firestore();

  const ok = await pollForResult(db, runId, marketDate, phase, sequence, interval, waitSeconds, symbolsArg);

  console.log('');
  if (ok) { console.log('✓ Verification PASSED'); process.exit(0); }
  else { console.log('✗ Verification FAILED'); process.exit(1); }
}

main().catch(err => {
  console.error('\n✗ Fatal error:', err?.message || err);
  process.exit(1);
});
