/**
 * Manual test script for RH Agent dashboard callables.
 *
 * Tests the public dashboard callables introduced / cleaned up in Phase 4.3:
 *   - rhAgentGetSymbolsWithSignals
 *   - rhAgentGetSymbolSignalHistory
 *   - rhAgentGetRunHistory
 *
 * Usage:
 *   node scripts/test-rh-agent-callables.js
 *
 * Environment variables:
 *   RH_AGENT_REGION   - Cloud Functions region (default: us-central1)
 *   RH_AGENT_PROJECT  - Firebase project ID (default: rel-str)
 *   USE_EMULATOR      - Set to "1" to call the local emulator (default port 5001)
 *   MARKET_DATE       - Market date to query (default: yesterday in America/Los_Angeles)
 *   TIMEFRAME         - "D" or "W" (default: D)
 *   DAYS              - Number of bar dates for signal history (default: 14)
 */

const https = require('https');
const http = require('http');

const REGION = process.env.RH_AGENT_REGION || 'us-central1';
const PROJECT = process.env.RH_AGENT_PROJECT || 'rel-str';
const USE_EMULATOR = process.env.USE_EMULATOR === '1';
const TIMEFRAME = process.env.TIMEFRAME || 'D';
const DAYS = parseInt(process.env.DAYS || '14', 10);

function getMarketDate() {
  if (process.env.MARKET_DATE) return process.env.MARKET_DATE;
  const d = new Date();
  // Use yesterday in PT to avoid weekends/holidays if possible
  d.setDate(d.getDate() - 1);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const y = parts.find((p) => p.type === 'year').value;
  const m = parts.find((p) => p.type === 'month').value;
  const day = parts.find((p) => p.type === 'day').value;
  return `${y}-${m}-${day}`;
}

const MARKET_DATE = getMarketDate();

function callCallable(name, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ data });
    const path = USE_EMULATOR
      ? `/${PROJECT}/${REGION}/${name}`
      : `/${PROJECT}/${REGION}/${name}`;
    const hostname = USE_EMULATOR ? '127.0.0.1' : `${REGION}-${PROJECT}.cloudfunctions.net`;
    const protocol = USE_EMULATOR ? http : https;
    const port = USE_EMULATOR ? 5001 : 443;

    const options = {
      hostname,
      port,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = protocol.request(options, (res) => {
      let responseBody = '';
      res.on('data', (chunk) => {
        responseBody += chunk;
      });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(responseBody);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            reject(new Error(`Callable ${name} failed: ${res.statusCode} ${JSON.stringify(parsed)}`));
          }
        } catch (e) {
          reject(new Error(`Callable ${name} returned non-JSON: ${responseBody}`));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function logResult(title, data) {
  console.log(`\n=== ${title} ===`);
  console.log(JSON.stringify(data, null, 2));
}

async function main() {
  console.log('RH Agent dashboard callables test');
  console.log(`Target: ${USE_EMULATOR ? 'emulator 127.0.0.1:5001' : `https://${REGION}-${PROJECT}.cloudfunctions.net`}`);
  console.log(`marketDate: ${MARKET_DATE}, timeframe: ${TIMEFRAME}, days: ${DAYS}`);

  // 1. rhAgentGetSymbolsWithSignals
  const symbolsResponse = await callCallable('rhAgentGetSymbolsWithSignals', {
    marketDate: MARKET_DATE,
    timeframe: TIMEFRAME,
  });
  logResult('rhAgentGetSymbolsWithSignals', symbolsResponse);

  // 2. rhAgentGetSymbolSignalHistory for the first symbol
  const symbols = symbolsResponse?.result?.symbols || symbolsResponse?.symbols || [];
  if (symbols.length > 0) {
    const first = symbols[0];
    const historyResponse = await callCallable('rhAgentGetSymbolSignalHistory', {
      symbol: first.symbol,
      timeframe: TIMEFRAME,
      days: DAYS,
    });
    logResult('rhAgentGetSymbolSignalHistory', historyResponse);
  } else {
    console.log('\nNo symbols returned; skipping rhAgentGetSymbolSignalHistory.');
  }

  // 3. rhAgentGetRunHistory
  const runHistoryResponse = await callCallable('rhAgentGetRunHistory', { limit: 5 });
  logResult('rhAgentGetRunHistory', runHistoryResponse);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
