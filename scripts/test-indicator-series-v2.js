#!/usr/bin/env node
/**
 * Test rhAgentGetSymbolIndicatorSeriesV2
 *
 * Calls the V2 callable via the Firebase callable REST protocol and prints
 * bar counts, interval keys, and a sample of the first dotMarker dates.
 *
 * USAGE
 *   node scripts/test-indicator-series-v2.js --symbol A
 *   node scripts/test-indicator-series-v2.js --symbol AAPL,MSFT
 */

const { execSync } = require('child_process');

const PROJECT_ID  = 'rel-str';
const REGION      = 'us-central1';
const FUNCTION_NAME = 'rhAgentGetSymbolIndicatorSeriesV2';
const FUNCTION_URL  = `https://${REGION}-${PROJECT_ID}.cloudfunctions.net/${FUNCTION_NAME}`;
const SERVICE_ACCOUNT = `${PROJECT_ID}@appspot.gserviceaccount.com`;

const args       = process.argv.slice(2);
const getArg     = (flag) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; };
const symbolsArg = getArg('--symbol') || getArg('--symbols') || 'A';
const symbols    = symbolsArg.split(',').map(s => s.trim().toUpperCase());

function getIdToken() {
  try {
    return execSync(
      `gcloud auth print-identity-token --impersonate-service-account=${SERVICE_ACCOUNT} --audiences=${FUNCTION_URL}`,
      { encoding: 'utf8' }
    ).trim();
  } catch (err) {
    console.error('Failed to get ID token.');
    console.error(err.message);
    process.exit(1);
  }
}

async function callV2(symbol, idToken) {
  const response = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${idToken}`,
    },
    body: JSON.stringify({ data: { symbol } }),
  });

  const body = await response.json();

  if (!response.ok || body.error) {
    throw new Error(body.error?.message || `HTTP ${response.status}`);
  }

  return body.result;
}

function summarize(symbol, result) {
  console.log(`\n── ${symbol} ──────────────────────────`);
  if (!result) { console.log('  (null result)'); return; }

  const intervals = Object.keys(result.intervals ?? {});
  console.log(`  marketDate: ${result.marketDate}`);
  console.log(`  intervals:  ${intervals.join(', ')}`);

  for (const interval of intervals) {
    const iv = result.intervals[interval];
    const indicators = Object.keys(iv?.indicators ?? {});
    const signals    = Object.keys(iv?.signals ?? {});
    const dotKeys    = Object.keys(iv?.dotMarkers ?? {});
    console.log(`\n  [${interval}]`);
    console.log(`    indicators: ${indicators.join(', ') || '(none)'}`);
    console.log(`    signals:    ${signals.join(', ') || '(none)'}`);
    console.log(`    dotMarkers: ${dotKeys.map(k => `${k}(${iv.dotMarkers[k]?.length ?? 0})`).join(', ') || '(none)'}`);

    // Sample: last 3 zone v1 dots if present
    const zv1 = iv?.dotMarkers?.zoneV1;
    if (zv1?.length) {
      console.log(`    zoneV1 last 3: ${zv1.slice(-3).map(d => d.date || d.d || JSON.stringify(d)).join(', ')}`);
    }
  }
}

async function main() {
  console.log(`Testing rhAgentGetSymbolIndicatorSeriesV2`);
  console.log(`  symbols: ${symbols.join(', ')}`);

  const idToken = getIdToken();

  for (const symbol of symbols) {
    try {
      const result = await callV2(symbol, idToken);
      summarize(symbol, result);
    } catch (err) {
      console.error(`\n  ✗ ${symbol}: ${err.message}`);
    }
  }

  console.log('\nDone.');
}

main().catch(err => {
  console.error('\n✗ Fatal:', err?.message || err);
  process.exit(1);
});
