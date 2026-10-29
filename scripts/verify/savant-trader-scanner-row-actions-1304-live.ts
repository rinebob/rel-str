/**
 * Verification (LIVE): get_equity_historicals wire contract (task #1304).
 *
 * Calls the real tool through the local RH MCP executor and validates the
 * live response against the contract: data.results[] →
 * {symbol, interval, bounds, bars[]}, bar prices as strings, volume as a
 * number, begins_at ISO-8601.
 *
 * Deliberately NOT registered in run-all.ts — it needs the executor running
 * and would fail the offline sweep (same convention as run-drift-check.ts
 * for #682). Run it directly when verifying the contract for real.
 *
 * Usage: npx tsx scripts/verify/savant-trader-scanner-row-actions-1304-live.ts
 *
 * Requires: RH MCP executor at http://127.0.0.1:3456.
 * Pass: every check prints OK and the script exits 0 (~250 day bars for a
 * ~370-day AAPL range — buffer covers non-trading days — is healthy).
 * Fail: the offending check prints FAIL with detail; exit 1. An unreachable
 * executor is a FAIL — this script exists to verify the live path.
 */

import type {
  EquityHistoricalsRequest,
  EquityHistoricalsResult,
  ToolExecutionResult,
} from '@robinhood-mcp/contracts';

const API_BASE = 'http://127.0.0.1:3456/api/rh/tools';

let failures = 0;
function ok(msg: string): void {
  console.log(`OK   ${msg}`);
}
function fail(msg: string): void {
  failures++;
  console.log(`FAIL ${msg}`);
}

async function main(): Promise<void> {
  const start = new Date(Date.now() - 370 * 24 * 60 * 60 * 1000).toISOString();
  const request: EquityHistoricalsRequest = {
    symbols: ['AAPL'],
    start_time: start,
    interval: 'day',
  };

  let body: ToolExecutionResult;
  try {
    const res = await fetch(`${API_BASE}/get_equity_historicals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ args: request }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      fail(`executor returned HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
      return;
    }
    body = (await res.json()) as ToolExecutionResult;
  } catch (err) {
    fail(
      `RH MCP executor unreachable at ${API_BASE} — start the executor and re-run ` +
        `(${err instanceof Error ? err.message : String(err)})`,
    );
    return;
  }

  if (body.success !== true) {
    fail(`tool call failed: ${body.error ?? JSON.stringify(body).slice(0, 300)}`);
    return;
  }
  ok('tool call succeeded');

  // Boundary cast — ToolExecutionSuccess.parsed is `unknown` by design; this
  // script is precisely what verifies the parsed shape.
  const parsed = body.parsed as EquityHistoricalsResult | undefined;
  const results = parsed?.data?.results;
  if (!Array.isArray(results) || results.length === 0) {
    fail(`expected data.results[] with ≥1 entry, got ${JSON.stringify(parsed).slice(0, 300)}`);
    return;
  }
  ok(`data.results has ${results.length} symbol entr${results.length === 1 ? 'y' : 'ies'}`);

  const entry = results[0];
  if (entry.symbol !== 'AAPL') fail(`results[0].symbol = ${entry.symbol}, expected AAPL`);
  else ok(`results[0].symbol = '${entry.symbol}'`);
  if (entry.interval !== 'day') fail(`results[0].interval = ${entry.interval}, expected 'day'`);
  else ok(`results[0].interval = '${entry.interval}'`);

  const bars = entry.bars;
  if (!Array.isArray(bars) || bars.length === 0) {
    fail('results[0].bars is empty — expected ~250 day bars for a 1-year range');
    return;
  }
  ok(`results[0].bars has ${bars.length} day bars`);

  const bad = bars.filter(
    (b) =>
      typeof b.begins_at !== 'string' ||
      typeof b.open_price !== 'string' ||
      typeof b.high_price !== 'string' ||
      typeof b.low_price !== 'string' ||
      typeof b.close_price !== 'string' ||
      typeof b.volume !== 'number',
  );
  if (bad.length > 0) {
    fail(`${bad.length}/${bars.length} bars violate the contract shape; first: ${JSON.stringify(bad[0])}`);
    return;
  }
  ok('all bars match the contract: begins_at string, *_price strings, volume number');

  const firstBegins = bars[0].begins_at;
  if (typeof firstBegins !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(firstBegins)) {
    fail(`begins_at '${firstBegins}' is not ISO-8601`);
    return;
  }
  ok(`begins_at is ISO-8601 ('${firstBegins}')`);
}

main()
  .then(() => {
    console.log(`\n=== ${failures === 0 ? 'PASS' : `FAIL (${failures} check(s) failed)`} ===`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.log(`FAIL unexpected error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
