/**
 * Verify task #1131 — shared scanner contracts against a live preview_scan.
 *
 * Runs two non-persistent preview_scan calls through the real executor and
 * asserts the response conforms to the shared PreviewScanResult wire
 * contract (shared/robinhood-mcp-contracts.ts) plus the domain helpers in
 * shared/scanner-contracts.ts:
 *
 *   1. Enum filter — FILTER_TYPE_INSTRUMENT_TYPE ANY_OF STOCK (the
 *      dep-prev-scan-01 recipe): envelope, row fields, stringified columns,
 *      filters_applied echo, isScanTruncated agreement.
 *   2. Expression filter — symbol ANY_OF [AAPL, MSFT]: the other ScanFilter
 *      variant round-trips on the wire and returns exactly the scoped rows.
 *
 * Needs the local RH MCP session (DPAPI credentials). Preview persists
 * nothing — safe to re-run.
 *
 * Usage (from functions/):
 *   npx tsx scripts/verify/rh-scanner-contracts-1131.ts
 */
import { isScanTruncated } from '../../../shared/scanner-contracts';
import type {
  PreviewScanResponse,
  PreviewScanResult,
  ScanFilter,
  ScanResultRow,
} from '../../../shared/robinhood-mcp-contracts';
import { executeObservationTool } from '../../src/rh-agent-mcp/tools/robinhood-tool-executor';

let passed = 0;
let failed = 0;

function check(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  OK  ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL  ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const assert = (cond: boolean, msg: string) => {
  if (!cond) throw new Error(msg);
};

async function preview(filters: ScanFilter[]): Promise<PreviewScanResult> {
  const res = await executeObservationTool('preview_scan', { filters });
  assert(res.success, `preview_scan failed: ${res.success ? '' : res.error}`);
  const payload = (res.success ? res.parsed ?? res.redacted : null) as PreviewScanResponse;
  assert(!!payload?.data?.result, 'parsed payload missing data.result');
  return payload.data.result;
}

function checkRowShape(label: string, result: PreviewScanResult): void {
  check(`${label}: total_items is a number >= results.length`, () => {
    assert(typeof result.total_items === 'number', 'total_items not a number');
    assert(result.total_items >= result.results.length, 'total_items < rows returned');
  });
  check(`${label}: every row carries ticker/instrument_id/instrument_type + string columns`, () => {
    assert(result.results.length > 0, 'no rows returned');
    for (const row of result.results) {
      assert(typeof row.ticker === 'string' && row.ticker.length > 0, 'missing ticker');
      assert(typeof row.instrument_id === 'string', 'missing instrument_id');
      assert(typeof row.instrument_type === 'string', 'missing instrument_type');
      for (const [k, v] of Object.entries(row.columns)) {
        assert(typeof k === 'string' && typeof v === 'string', `column ${k} not string: ${typeof v}`);
      }
    }
  });
}

console.log('rh-scanner-contracts-1131 — live preview_scan contract check\n');

// 1. Enum-filter scan (dep-prev-scan-01 recipe).
const enumResult = await preview([
  {
    filter_type: 'FILTER_TYPE_INSTRUMENT_TYPE',
    predicate: 'PREDICATE_ANY_OF',
    values: ['STOCK'],
  },
]);
checkRowShape('enum scan', enumResult);
check('enum scan: filters_applied echoes filter_type_enum', () => {
  const applied = enumResult.filters_applied ?? [];
  assert(
    applied.some((f) => f.filter_type_enum === 'FILTER_TYPE_INSTRUMENT_TYPE'),
    `no FILTER_TYPE_INSTRUMENT_TYPE in echo: ${JSON.stringify(applied).slice(0, 200)}`,
  );
});
check('enum scan: isScanTruncated agrees with row/total counts', () => {
  // Independent re-derivation — a verify script that imports the function's
  // own logic can't catch a bug in it.
  const expected =
    enumResult.results.length >= 200 || enumResult.total_items > enumResult.results.length;
  assert(isScanTruncated(enumResult) === expected, 'isScanTruncated mismatch');
});

// 2. Expression symbol-scope scan — the ANY_OF batching shape the prune path uses.
const scopeResult = await preview([
  { expression: 'symbol', predicate: 'ANY_OF', values: ['AAPL', 'MSFT'] },
]);
checkRowShape('scope scan', scopeResult);
check('scope scan: returns exactly the scoped tickers', () => {
  const tickers = scopeResult.results.map((r: ScanResultRow) => r.ticker).sort();
  assert(
    JSON.stringify(tickers) === JSON.stringify(['AAPL', 'MSFT']),
    `unexpected tickers: ${tickers.join(',')}`,
  );
  assert(!isScanTruncated(scopeResult), 'scoped scan should not be truncated');
});

console.log(`\n=== Summary: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
